//! Work queue with bounded concurrency. Generic over a `Processor`, so it is
//! tested with fakes; the real processor (search + download) is in runner.rs.

use std::collections::VecDeque;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::watch;
use tokio::task::JoinSet;

use super::state::TrackStatus;
use crate::spotify::model::TrackMeta;

pub const DEFAULT_CONCURRENCY: usize = 2;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Everything a worker needs to import one track.
#[derive(Debug, Clone)]
pub struct WorkItem {
    /// Position inside this import (0..n); used to route updates.
    pub index: usize,
    pub track_id: i64,
    pub meta: TrackMeta,
    pub dest_dir: PathBuf,
    /// Already sanitized file name without extension.
    pub stem: String,
    /// The track's own cover when already known (singles).
    pub cover_url: Option<String>,
    /// The playlist's cover, used if the track's own cover cannot be fetched (7.3.6).
    pub fallback_cover_url: Option<String>,
    /// Manual retry: searches with the plain query instead of "... audio".
    pub retry: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ItemOutcome {
    Done { path: PathBuf },
    NeedsReview,
    Failed { code: String },
    Cancelled,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Update {
    Stage {
        index: usize,
        status: TrackStatus,
    },
    Fraction {
        index: usize,
        fraction: f32,
    },
    Matched {
        index: usize,
        source_url: String,
        score: i32,
    },
    Cover {
        index: usize,
        path: PathBuf,
    },
    Finished {
        index: usize,
        outcome: ItemOutcome,
    },
}

pub type UpdateSink = Arc<dyn Fn(Update) + Send + Sync>;

/// What a processor can report while it works on one item.
#[derive(Clone)]
pub struct ItemCtx {
    index: usize,
    pub cancel: watch::Receiver<bool>,
    sink: UpdateSink,
}

impl ItemCtx {
    pub fn stage(&self, status: TrackStatus) {
        (*self.sink)(Update::Stage {
            index: self.index,
            status,
        });
    }

    pub fn fraction(&self, fraction: f32) {
        (*self.sink)(Update::Fraction {
            index: self.index,
            fraction,
        });
    }

    pub fn matched(&self, source_url: String, score: i32) {
        (*self.sink)(Update::Matched {
            index: self.index,
            source_url,
            score,
        });
    }

    pub fn cover(&self, path: PathBuf) {
        (*self.sink)(Update::Cover {
            index: self.index,
            path,
        });
    }

    pub fn is_cancelled(&self) -> bool {
        *self.cancel.borrow()
    }
}

pub trait Processor: Send + Sync + 'static {
    fn process<'a>(&'a self, item: WorkItem, ctx: ItemCtx) -> BoxFuture<'a, ItemOutcome>;
}

#[derive(Debug, Clone, Copy)]
pub struct QueueConfig {
    pub concurrency: usize,
    /// Random pause between two tracks of the same worker, in milliseconds.
    pub pause_ms: (u64, u64),
}

impl Default for QueueConfig {
    fn default() -> Self {
        Self {
            concurrency: DEFAULT_CONCURRENCY,
            pause_ms: (250, 900),
        }
    }
}

/// Random value in `min..=max` without a random-number dependency (one byte of a UUID).
pub fn jitter_ms(min: u64, max: u64) -> u64 {
    if max <= min {
        return min;
    }
    let byte = u64::from(uuid::Uuid::new_v4().as_bytes()[0]);
    min + (max - min) * byte / 255
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

async fn worker_loop<P: Processor>(
    queue: Arc<Mutex<VecDeque<WorkItem>>>,
    processor: Arc<P>,
    mut cancel: watch::Receiver<bool>,
    sink: UpdateSink,
    pause_ms: (u64, u64),
) {
    loop {
        if *cancel.borrow() {
            break;
        }
        let next = lock(&queue).pop_front();
        let Some(item) = next else { break };
        let index = item.index;
        let ctx = ItemCtx {
            index,
            cancel: cancel.clone(),
            sink: sink.clone(),
        };
        let outcome = processor.process(item, ctx).await;
        (*sink)(Update::Finished { index, outcome });

        let more = !lock(&queue).is_empty();
        if more && !*cancel.borrow() {
            let ms = jitter_ms(pause_ms.0, pause_ms.1);
            if ms > 0 {
                tokio::select! {
                    () = tokio::time::sleep(Duration::from_millis(ms)) => {}
                    _ = cancel.changed() => {}
                }
            }
        }
    }
}

/// Runs every item with at most `cfg.concurrency` at the same time. Items that
/// never started because of a cancellation are reported as `Cancelled`.
/// Returns whether the queue was cancelled. A panicking worker only loses its
/// own item (the caller's safety net marks it failed).
pub async fn run_queue<P: Processor>(
    items: Vec<WorkItem>,
    processor: Arc<P>,
    cfg: QueueConfig,
    cancel: watch::Receiver<bool>,
    sink: UpdateSink,
) -> bool {
    let queue = Arc::new(Mutex::new(VecDeque::from(items)));
    let mut workers = JoinSet::new();
    for _ in 0..cfg.concurrency.max(1) {
        workers.spawn(worker_loop(
            queue.clone(),
            processor.clone(),
            cancel.clone(),
            sink.clone(),
            cfg.pause_ms,
        ));
    }
    while workers.join_next().await.is_some() {}

    let leftover: Vec<WorkItem> = lock(&queue).drain(..).collect();
    for item in leftover {
        (*sink)(Update::Finished {
            index: item.index,
            outcome: ItemOutcome::Cancelled,
        });
    }
    *cancel.borrow()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Fake {
        current: AtomicUsize,
        max: AtomicUsize,
        calls: AtomicUsize,
        work_ms: u64,
        cancel_after_first: Option<Arc<watch::Sender<bool>>>,
        panic_on: Option<usize>,
    }

    impl Fake {
        fn new(work_ms: u64) -> Self {
            Self {
                current: AtomicUsize::new(0),
                max: AtomicUsize::new(0),
                calls: AtomicUsize::new(0),
                work_ms,
                cancel_after_first: None,
                panic_on: None,
            }
        }
    }

    impl Processor for Fake {
        fn process<'a>(&'a self, item: WorkItem, ctx: ItemCtx) -> BoxFuture<'a, ItemOutcome> {
            Box::pin(async move {
                self.calls.fetch_add(1, Ordering::SeqCst);
                if self.panic_on == Some(item.index) {
                    panic!("boom");
                }
                ctx.stage(TrackStatus::Searching);
                let now = self.current.fetch_add(1, Ordering::SeqCst) + 1;
                self.max.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(self.work_ms)).await;
                self.current.fetch_sub(1, Ordering::SeqCst);
                ctx.fraction(1.0);
                if let Some(tx) = &self.cancel_after_first {
                    let _ = tx.send(true);
                }
                ItemOutcome::Done {
                    path: PathBuf::from(format!("{}.opus", item.index)),
                }
            })
        }
    }

    fn items(n: usize) -> Vec<WorkItem> {
        (0..n)
            .map(|index| WorkItem {
                index,
                track_id: index as i64 + 100,
                meta: TrackMeta {
                    spotify_id: format!("id{index}"),
                    title: "T".into(),
                    artist: "A".into(),
                    duration_ms: 1000,
                },
                dest_dir: PathBuf::from("dest"),
                stem: format!("stem{index}"),
                cover_url: None,
                fallback_cover_url: None,
                retry: false,
            })
            .collect()
    }

    fn recording_sink() -> (UpdateSink, Arc<Mutex<Vec<Update>>>) {
        let log = Arc::new(Mutex::new(Vec::new()));
        let writer = log.clone();
        let sink: UpdateSink = Arc::new(move |u| lock(&writer).push(u));
        (sink, log)
    }

    fn cfg(concurrency: usize) -> QueueConfig {
        QueueConfig {
            concurrency,
            pause_ms: (0, 0),
        }
    }

    fn finished(log: &Mutex<Vec<Update>>) -> Vec<(usize, ItemOutcome)> {
        let mut v: Vec<(usize, ItemOutcome)> = lock(log)
            .iter()
            .filter_map(|u| match u {
                Update::Finished { index, outcome } => Some((*index, outcome.clone())),
                _ => None,
            })
            .collect();
        v.sort_by_key(|(i, _)| *i);
        v
    }

    #[tokio::test]
    async fn never_runs_more_than_the_configured_concurrency() {
        let fake = Arc::new(Fake::new(20));
        let (sink, log) = recording_sink();
        let (_tx, rx) = watch::channel(false);
        let cancelled = run_queue(items(6), fake.clone(), cfg(2), rx, sink).await;
        assert!(!cancelled);
        assert_eq!(fake.max.load(Ordering::SeqCst), 2);
        let done = finished(&log);
        assert_eq!(done.len(), 6);
        assert!(
            done.iter()
                .all(|(_, o)| matches!(o, ItemOutcome::Done { .. }))
        );
        assert_eq!(
            done.iter().map(|(i, _)| *i).collect::<Vec<_>>(),
            [0, 1, 2, 3, 4, 5]
        );
    }

    #[tokio::test]
    async fn concurrency_of_one_is_sequential() {
        let fake = Arc::new(Fake::new(5));
        let (sink, _log) = recording_sink();
        let (_tx, rx) = watch::channel(false);
        run_queue(items(4), fake.clone(), cfg(1), rx, sink).await;
        assert_eq!(fake.max.load(Ordering::SeqCst), 1);
        assert_eq!(fake.calls.load(Ordering::SeqCst), 4);
    }

    #[tokio::test]
    async fn cancelling_before_start_runs_nothing() {
        let fake = Arc::new(Fake::new(5));
        let (sink, log) = recording_sink();
        let (_tx, rx) = watch::channel(true);
        let cancelled = run_queue(items(4), fake.clone(), cfg(2), rx, sink).await;
        assert!(cancelled);
        assert_eq!(fake.calls.load(Ordering::SeqCst), 0);
        let done = finished(&log);
        assert_eq!(done.len(), 4);
        assert!(done.iter().all(|(_, o)| *o == ItemOutcome::Cancelled));
    }

    #[tokio::test]
    async fn cancelling_midway_stops_pulling_new_items() {
        let (tx, rx) = watch::channel(false);
        let tx = Arc::new(tx);
        let mut fake = Fake::new(5);
        fake.cancel_after_first = Some(tx.clone());
        let fake = Arc::new(fake);
        let (sink, log) = recording_sink();
        let cancelled = run_queue(items(5), fake.clone(), cfg(1), rx, sink).await;
        assert!(cancelled);
        assert_eq!(fake.calls.load(Ordering::SeqCst), 1);
        let done = finished(&log);
        assert!(matches!(done[0].1, ItemOutcome::Done { .. }));
        assert!(done[1..].iter().all(|(_, o)| *o == ItemOutcome::Cancelled));
        assert_eq!(done.len(), 5);
    }

    #[tokio::test]
    async fn processor_updates_reach_the_sink_in_order() {
        let fake = Arc::new(Fake::new(1));
        let (sink, log) = recording_sink();
        let (_tx, rx) = watch::channel(false);
        run_queue(items(1), fake, cfg(1), rx, sink).await;
        assert_eq!(
            *lock(&log),
            vec![
                Update::Stage {
                    index: 0,
                    status: TrackStatus::Searching
                },
                Update::Fraction {
                    index: 0,
                    fraction: 1.0
                },
                Update::Finished {
                    index: 0,
                    outcome: ItemOutcome::Done {
                        path: PathBuf::from("0.opus")
                    }
                },
            ]
        );
    }

    #[tokio::test]
    async fn a_panicking_item_does_not_hang_or_stop_the_other_worker() {
        let mut fake = Fake::new(1);
        fake.panic_on = Some(0);
        let fake = Arc::new(fake);
        let (sink, log) = recording_sink();
        let (_tx, rx) = watch::channel(false);
        run_queue(items(3), fake, cfg(2), rx, sink).await;
        let done = finished(&log);
        assert_eq!(done.iter().map(|(i, _)| *i).collect::<Vec<_>>(), [1, 2]);
    }

    #[test]
    fn jitter_stays_within_bounds() {
        for _ in 0..200 {
            let v = jitter_ms(250, 900);
            assert!((250..=900).contains(&v));
        }
        assert_eq!(jitter_ms(5, 5), 5);
        assert_eq!(jitter_ms(9, 3), 9);
    }
}

//! Track states, global progress and the payloads of the events sent to the UI.

use serde::Serialize;

/// The states of the `tracks.status` column that the importer uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackStatus {
    Queued,
    Searching,
    Downloading,
    Tagging,
    Done,
    NeedsReview,
    Failed,
}

impl TrackStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TrackStatus::Queued => "queued",
            TrackStatus::Searching => "searching",
            TrackStatus::Downloading => "downloading",
            TrackStatus::Tagging => "tagging",
            TrackStatus::Done => "done",
            TrackStatus::NeedsReview => "needs_review",
            TrackStatus::Failed => "failed",
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            TrackStatus::Done | TrackStatus::NeedsReview | TrackStatus::Failed
        )
    }

    /// Share of a track's work that is already done when it enters this state,
    /// so the global progress starts moving before any bytes are downloaded.
    pub fn baseline(self) -> f32 {
        match self {
            TrackStatus::Queued => 0.0,
            TrackStatus::Searching => 0.05,
            TrackStatus::Downloading => 0.10,
            TrackStatus::Tagging => 0.97,
            TrackStatus::Done | TrackStatus::NeedsReview | TrackStatus::Failed => 1.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub total: usize,
    pub done: usize,
    pub needs_review: usize,
    pub failed: usize,
    pub cancelled: bool,
}

/// Event `import://progress`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    pub import_id: String,
    pub fraction: f32,
    pub finished: usize,
    pub total: usize,
}

/// Event `import://track-state`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackStatePayload {
    pub import_id: String,
    pub track_id: i64,
    pub status: String,
}

/// Event `import://done`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DonePayload {
    pub import_id: String,
    #[serde(flatten)]
    pub summary: ImportSummary,
}

/// Global progress of one import: the average of every track's progress.
/// A finished track (done, needs review or failed) counts as 1.0.
#[derive(Debug)]
pub struct ProgressTracker {
    statuses: Vec<TrackStatus>,
    fractions: Vec<f32>,
    last_emitted: f32,
    last_finished: usize,
}

impl ProgressTracker {
    pub fn new(total: usize) -> Self {
        Self {
            statuses: vec![TrackStatus::Queued; total],
            fractions: vec![0.0; total],
            last_emitted: -1.0,
            last_finished: 0,
        }
    }

    pub fn total(&self) -> usize {
        self.statuses.len()
    }

    pub fn set_status(&mut self, index: usize, status: TrackStatus) {
        if let Some(s) = self.statuses.get_mut(index) {
            *s = status;
            // Progress never goes backwards: a state only raises the floor.
            let floor = status.baseline();
            if floor > self.fractions[index] {
                self.fractions[index] = floor;
            }
        }
    }

    /// Progress never goes backwards and is ignored once the track finished.
    pub fn set_fraction(&mut self, index: usize, fraction: f32) {
        let Some(status) = self.statuses.get(index) else {
            return;
        };
        if status.is_terminal() {
            return;
        }
        let f = fraction.clamp(0.0, 1.0);
        if f > self.fractions[index] {
            self.fractions[index] = f;
        }
    }

    pub fn fraction(&self) -> f32 {
        if self.fractions.is_empty() {
            return 1.0;
        }
        self.fractions.iter().sum::<f32>() / self.fractions.len() as f32
    }

    pub fn finished(&self) -> usize {
        self.statuses.iter().filter(|s| s.is_terminal()).count()
    }

    /// True when the UI should hear about it: the global fraction moved at least
    /// 0.5 % or another track finished. Updates the reference point.
    pub fn changed_enough(&mut self) -> bool {
        let fraction = self.fraction();
        let finished = self.finished();
        if finished != self.last_finished || (fraction - self.last_emitted).abs() >= 0.005 {
            self.last_emitted = fraction;
            self.last_finished = finished;
            true
        } else {
            false
        }
    }

    /// Tracks that never reached a final state (e.g. a crashed worker) count as failed.
    pub fn summary(&self, cancelled: bool) -> ImportSummary {
        let count = |s: TrackStatus| self.statuses.iter().filter(|x| **x == s).count();
        let done = count(TrackStatus::Done);
        let needs_review = count(TrackStatus::NeedsReview);
        ImportSummary {
            total: self.statuses.len(),
            done,
            needs_review,
            failed: self.statuses.len() - done - needs_review,
            cancelled,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn status_strings_match_the_database() {
        assert_eq!(TrackStatus::Queued.as_str(), "queued");
        assert_eq!(TrackStatus::Searching.as_str(), "searching");
        assert_eq!(TrackStatus::Downloading.as_str(), "downloading");
        assert_eq!(TrackStatus::Tagging.as_str(), "tagging");
        assert_eq!(TrackStatus::Done.as_str(), "done");
        assert_eq!(TrackStatus::NeedsReview.as_str(), "needs_review");
        assert_eq!(TrackStatus::Failed.as_str(), "failed");
        assert!(TrackStatus::Done.is_terminal() && TrackStatus::Failed.is_terminal());
        assert!(!TrackStatus::Queued.is_terminal() && !TrackStatus::Downloading.is_terminal());
        assert!(!TrackStatus::Tagging.is_terminal());
    }

    #[test]
    fn fraction_is_the_average_of_the_tracks() {
        let mut t = ProgressTracker::new(4);
        assert!(close(t.fraction(), 0.0));
        t.set_fraction(0, 0.5);
        assert!(close(t.fraction(), 0.125));
        t.set_status(1, TrackStatus::Done);
        assert!(close(t.fraction(), 0.375));
    }

    #[test]
    fn progress_is_monotonic_and_frozen_when_finished() {
        let mut t = ProgressTracker::new(2);
        t.set_fraction(0, 0.8);
        t.set_fraction(0, 0.3);
        assert!(close(t.fraction(), 0.4));
        t.set_status(0, TrackStatus::Failed);
        t.set_fraction(0, 0.1);
        assert!(close(t.fraction(), 0.5));
        t.set_fraction(99, 0.5); // out of range: ignored
        t.set_status(99, TrackStatus::Done);
        assert_eq!(t.finished(), 1);
    }

    #[test]
    fn empty_import_is_complete() {
        let t = ProgressTracker::new(0);
        assert!(close(t.fraction(), 1.0));
        assert_eq!(t.total(), 0);
    }

    #[test]
    fn emission_is_throttled_but_finishing_a_track_always_counts() {
        let mut t = ProgressTracker::new(1000);
        assert!(t.changed_enough()); // first call
        t.set_fraction(0, 0.1); // +0.0001 globally
        assert!(!t.changed_enough());
        t.set_status(0, TrackStatus::Done); // +0.001 globally, but a track finished
        assert!(t.changed_enough());
        assert!(!t.changed_enough());
    }

    #[test]
    fn summary_counts_unfinished_tracks_as_failed() {
        let mut t = ProgressTracker::new(5);
        t.set_status(0, TrackStatus::Done);
        t.set_status(1, TrackStatus::Done);
        t.set_status(2, TrackStatus::NeedsReview);
        t.set_status(3, TrackStatus::Failed);
        t.set_status(4, TrackStatus::Downloading);
        assert_eq!(
            t.summary(true),
            ImportSummary {
                total: 5,
                done: 2,
                needs_review: 1,
                failed: 2,
                cancelled: true
            }
        );
    }

    #[test]
    fn non_terminal_states_set_a_progress_floor() {
        let mut t = ProgressTracker::new(2);
        t.set_status(0, TrackStatus::Searching);
        assert!(close(t.fraction(), 0.025));
        t.set_status(0, TrackStatus::Downloading);
        assert!(close(t.fraction(), 0.05));
        t.set_fraction(0, 0.6); // download progress
        assert!(close(t.fraction(), 0.3));
        t.set_status(0, TrackStatus::Tagging);
        assert!(close(t.fraction(), 0.485));
        t.set_status(0, TrackStatus::Searching); // never goes back
        assert!(close(t.fraction(), 0.485));
    }

    #[test]
    fn payloads_serialize_in_camel_case() {
        let p = serde_json::to_value(ProgressPayload {
            import_id: "x".into(),
            fraction: 0.5,
            finished: 1,
            total: 2,
        })
        .expect("json");
        assert_eq!(p["importId"], "x");
        assert_eq!(p["finished"], 1);

        let d = serde_json::to_value(DonePayload {
            import_id: "x".into(),
            summary: ImportSummary {
                total: 3,
                done: 2,
                needs_review: 1,
                failed: 0,
                cancelled: false,
            },
        })
        .expect("json");
        assert_eq!(d["importId"], "x");
        assert_eq!(d["needsReview"], 1);
        assert_eq!(d["cancelled"], false);

        let s = serde_json::to_value(TrackStatePayload {
            import_id: "x".into(),
            track_id: 7,
            status: "done".into(),
        })
        .expect("json");
        assert_eq!(s["trackId"], 7);
    }
}

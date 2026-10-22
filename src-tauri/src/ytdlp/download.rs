//! Downloads one track's audio with yt-dlp as opus, with progress, cancellation
//! and cleanup of partial files. The final path is computed here, never read
//! from yt-dlp's output.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;
use thiserror::Error;
use tokio::sync::watch;

use super::search::is_valid_video_id;
use super::{RunError, classify_failure, kill_process_tree, spawn_ytdlp};
use crate::library::names::{MAX_FILE_STEM_CHARS, is_inside, is_safe_component};

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const MAX_STDERR_BYTES: usize = 64 * 1024;
const PROGRESS_TEMPLATE: &str = "download:CUPID %(progress.status)s %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s";

/// Suffixes (after "<stem>.") of the temporary files a run can leave behind.
const PARTIAL_SUFFIXES: [&str; 11] = [
    "opus",
    "webm",
    "m4a",
    "part",
    "webm.part",
    "m4a.part",
    "opus.part",
    "ytdl",
    "webm.ytdl",
    "m4a.ytdl",
    "temp.opus",
];

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DownloadError {
    #[error("invalid video id")]
    InvalidVideoId,
    #[error("unsafe file name")]
    UnsafeName,
    #[error("destination is outside the music folder")]
    OutsideRoot,
    #[error("download cancelled")]
    Cancelled,
    #[error("ffmpeg not found next to the app")]
    MissingFfmpeg,
    #[error("yt-dlp finished but the output file is missing")]
    MissingOutput,
    #[error("i/o error: {0}")]
    Io(String),
    #[error(transparent)]
    Run(#[from] RunError),
}

impl DownloadError {
    /// Stable code for the frontend to map to an i18n message.
    pub fn code(&self) -> &'static str {
        match self {
            DownloadError::InvalidVideoId => "download.invalid_video_id",
            DownloadError::UnsafeName => "download.unsafe_name",
            DownloadError::OutsideRoot => "download.outside_root",
            DownloadError::Cancelled => "download.cancelled",
            DownloadError::MissingFfmpeg => "download.missing_ffmpeg",
            DownloadError::MissingOutput => "download.missing_output",
            DownloadError::Io(_) => "download.io",
            DownloadError::Run(e) => e.code(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Downloading,
    Converting,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    pub phase: Phase,
    pub downloaded: u64,
    pub total: Option<u64>,
}

impl Progress {
    /// 0.0..=1.0 while downloading with a known size; `None` otherwise.
    pub fn fraction(&self) -> Option<f32> {
        match (self.phase, self.total) {
            (Phase::Downloading, Some(total)) if total > 0 => {
                Some((self.downloaded as f32 / total as f32).min(1.0))
            }
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadOutcome {
    pub path: PathBuf,
    /// The file already existed, so nothing was downloaded.
    pub reused: bool,
}

pub struct DownloadRequest<'a> {
    pub video_id: &'a str,
    pub music_root: &'a Path,
    pub dest_dir: &'a Path,
    /// Already sanitized (see `library::names::track_file_stem`), without extension.
    pub file_stem: &'a str,
}

/// `%` starts a yt-dlp output-template field, so literal ones are doubled.
fn escape_template(s: &str) -> String {
    s.replace('%', "%%")
}

pub fn build_args(video_id: &str, ffmpeg_dir: &Path, dest_dir: &Path, stem: &str) -> Vec<String> {
    let template = format!(
        "{}{}{}.%(ext)s",
        escape_template(&dest_dir.to_string_lossy()),
        std::path::MAIN_SEPARATOR,
        escape_template(stem)
    );
    let mut args: Vec<String> = [
        "--ignore-config",
        "--no-warnings",
        "--newline",
        "--no-playlist",
        "--no-mtime",
        "--socket-timeout",
        "15",
        "--retries",
        "3",
        "-f",
        "bestaudio",
        "-x",
        "--audio-format",
        "opus",
        "--audio-quality",
        "0",
        "--ffmpeg-location",
    ]
    .iter()
    .map(|s| (*s).to_string())
    .collect();
    args.push(ffmpeg_dir.to_string_lossy().into_owned());
    args.push("--progress-template".into());
    args.push(PROGRESS_TEMPLATE.into());
    args.push("-o".into());
    args.push(template);
    // Everything after "--" is a positional argument, never an option.
    args.push("--".into());
    args.push(format!("https://www.youtube.com/watch?v={video_id}"));
    args
}

/// Parses one stdout line: our "CUPID ..." progress lines (real format:
/// `CUPID downloading <bytes> <total|NA> <estimate|NA>`) and the ExtractAudio line.
pub fn parse_progress_line(line: &str) -> Option<Progress> {
    let line = line.trim();
    if line.starts_with("[ExtractAudio]") {
        return Some(Progress {
            phase: Phase::Converting,
            downloaded: 0,
            total: None,
        });
    }
    let rest = line.strip_prefix("CUPID ")?;
    let mut parts = rest.split_whitespace();
    let status = parts.next()?;
    if status != "downloading" && status != "finished" {
        return None;
    }
    let downloaded = parts.next()?.parse::<u64>().ok()?;
    let total = parts
        .next()
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| parts.next().and_then(|s| s.parse::<u64>().ok()));
    Some(Progress {
        phase: Phase::Downloading,
        downloaded,
        total,
    })
}

/// Checks everything that comes from outside; returns the final `.opus` path.
fn validate_request(req: &DownloadRequest<'_>) -> Result<PathBuf, DownloadError> {
    if !is_valid_video_id(req.video_id) {
        return Err(DownloadError::InvalidVideoId);
    }
    if !is_safe_component(req.file_stem, MAX_FILE_STEM_CHARS) {
        return Err(DownloadError::UnsafeName);
    }
    let target = req.dest_dir.join(format!("{}.opus", req.file_stem));
    if !is_inside(req.music_root, req.dest_dir) || !is_inside(req.music_root, &target) {
        return Err(DownloadError::OutsideRoot);
    }
    Ok(target)
}

/// The folder that holds ffmpeg: next to the app executable (D-86).
fn ffmpeg_dir() -> Result<PathBuf, DownloadError> {
    let exe = std::env::current_exe().map_err(|e| DownloadError::Io(e.to_string()))?;
    let dir = exe
        .parent()
        .ok_or_else(|| DownloadError::Io("executable has no parent folder".into()))?
        .to_path_buf();
    let name = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    if dir.join(name).is_file() {
        Ok(dir)
    } else {
        Err(DownloadError::MissingFfmpeg)
    }
}

/// Deletes the temporary files of one stem (never other tracks' files).
fn cleanup_partials(dir: &Path, stem: &str) {
    let prefix = format!("{stem}.");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(rest) = name.strip_prefix(&prefix)
            && PARTIAL_SUFFIXES.contains(&rest)
        {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Downloads the audio of `req.video_id` to `<dest_dir>/<file_stem>.opus`.
/// Set the `cancel` channel to `true` (or drop its sender) to abort.
pub async fn download_audio<F>(
    app: &AppHandle,
    req: &DownloadRequest<'_>,
    cancel: &mut watch::Receiver<bool>,
    mut on_progress: F,
) -> Result<DownloadOutcome, DownloadError>
where
    F: FnMut(Progress),
{
    let target = validate_request(req)?;
    if target.is_file() {
        return Ok(DownloadOutcome {
            path: target,
            reused: true,
        });
    }
    if *cancel.borrow() {
        return Err(DownloadError::Cancelled);
    }

    let args = build_args(req.video_id, &ffmpeg_dir()?, req.dest_dir, req.file_stem);
    let (mut rx, child) = spawn_ytdlp(app, &args)?;

    let mut deadline = std::pin::pin!(tokio::time::sleep(DOWNLOAD_TIMEOUT));
    let mut stderr: Vec<u8> = Vec::new();
    let mut code: Option<i32> = None;

    let finished: Result<(), DownloadError> = loop {
        tokio::select! {
            event = rx.recv() => match event {
                None => break Err(DownloadError::Run(RunError::Spawn(
                    "yt-dlp event stream closed".into(),
                ))),
                Some(CommandEvent::Stdout(bytes)) => {
                    for line in String::from_utf8_lossy(&bytes).lines() {
                        if let Some(progress) = parse_progress_line(line) {
                            on_progress(progress);
                        }
                    }
                }
                Some(CommandEvent::Stderr(bytes)) => {
                    if stderr.len() < MAX_STDERR_BYTES {
                        stderr.extend_from_slice(&bytes);
                        stderr.push(b'\n');
                    }
                }
                Some(CommandEvent::Error(msg)) => {
                    break Err(DownloadError::Run(RunError::Spawn(msg)));
                }
                Some(CommandEvent::Terminated(payload)) => {
                    code = payload.code;
                    break Ok(());
                }
                Some(_) => {}
            },
            _ = cancel.changed() => break Err(DownloadError::Cancelled),
            _ = &mut deadline => break Err(DownloadError::Run(RunError::Timeout)),
        }
    };

    match finished {
        Ok(()) if code == Some(0) => {
            if target.is_file() {
                Ok(DownloadOutcome {
                    path: target,
                    reused: false,
                })
            } else {
                cleanup_partials(req.dest_dir, req.file_stem);
                Err(DownloadError::MissingOutput)
            }
        }
        Ok(()) => {
            let text = String::from_utf8_lossy(&stderr).into_owned();
            cleanup_partials(req.dest_dir, req.file_stem);
            Err(DownloadError::Run(classify_failure(code, &text)))
        }
        Err(e) => {
            kill_process_tree(child);
            // Give Windows a moment to release the files before deleting them.
            tokio::time::sleep(Duration::from_millis(400)).await;
            cleanup_partials(req.dest_dir, req.file_stem);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("cupid-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).expect("create temp dir");
        d
    }

    #[test]
    fn builds_args_with_user_text_only_inside_the_output_template() {
        let args = build_args(
            "dGoHLoDmHdI",
            Path::new("ff"),
            Path::new("dest"),
            "Song 100% - X",
        );
        let n = args.len();
        assert_eq!(args[n - 2], "--");
        assert_eq!(args[n - 1], "https://www.youtube.com/watch?v=dGoHLoDmHdI");
        let o = args.iter().position(|a| a == "-o").expect("-o present");
        assert!(args[o + 1].ends_with("Song 100%% - X.%(ext)s"));
        assert_eq!(args.iter().filter(|a| a.contains("Song")).count(), 1);
        let f = args
            .iter()
            .position(|a| a == "--ffmpeg-location")
            .expect("ffmpeg flag");
        assert_eq!(args[f + 1], "ff");
    }

    #[test]
    fn escapes_percent_in_output_template() {
        assert_eq!(
            escape_template("100% Pure %(title)s"),
            "100%% Pure %%(title)s"
        );
        assert_eq!(escape_template("plain"), "plain");
    }

    #[test]
    fn parses_real_progress_lines() {
        let p = parse_progress_line("CUPID downloading 1024 3497900 NA ").expect("progress");
        assert_eq!(
            p,
            Progress {
                phase: Phase::Downloading,
                downloaded: 1024,
                total: Some(3_497_900)
            }
        );
        let f = parse_progress_line("CUPID finished 3497900 3497900 NA \r").expect("finished");
        assert_eq!(f.downloaded, 3_497_900);
        assert_eq!(
            parse_progress_line("CUPID downloading 500 NA 1000").map(|p| p.total),
            Some(Some(1000))
        );
        assert_eq!(
            parse_progress_line("CUPID downloading 500 NA NA").map(|p| p.total),
            Some(None)
        );
        let c =
            parse_progress_line("[ExtractAudio] Destination: C:\\x\\prueba.opus").expect("convert");
        assert_eq!(c.phase, Phase::Converting);

        assert_eq!(
            parse_progress_line("[download] Destination: C:\\x\\prueba.webm"),
            None
        );
        assert_eq!(
            parse_progress_line("Deleting original file x (pass -k to keep)"),
            None
        );
        assert_eq!(parse_progress_line("CUPID error 0 NA NA"), None);
        assert_eq!(parse_progress_line("CUPID downloading abc NA NA"), None);
        assert_eq!(parse_progress_line(""), None);
    }

    #[test]
    fn progress_fraction_is_clamped_and_optional() {
        let p = |d, t| Progress {
            phase: Phase::Downloading,
            downloaded: d,
            total: t,
        };
        assert_eq!(p(50, Some(100)).fraction(), Some(0.5));
        assert_eq!(p(200, Some(100)).fraction(), Some(1.0));
        assert_eq!(p(10, None).fraction(), None);
        assert_eq!(p(10, Some(0)).fraction(), None);
        let converting = Progress {
            phase: Phase::Converting,
            downloaded: 0,
            total: None,
        };
        assert_eq!(converting.fraction(), None);
    }

    #[test]
    fn cleanup_removes_only_our_partial_files() {
        let dir = temp_dir();
        let stem = "01 - A - B";
        let ours = [
            "01 - A - B.part",
            "01 - A - B.webm",
            "01 - A - B.webm.part",
            "01 - A - B.opus",
            "01 - A - B.ytdl",
            "01 - A - B.temp.opus",
        ];
        let theirs = [
            "02 - A - B.opus",
            "01 - A - B.mp3",
            "01 - A - B.txt",
            "01 - A - B copy.opus",
            "01 - A - B.v2.opus",
        ];
        for name in ours.iter().chain(theirs.iter()) {
            std::fs::write(dir.join(name), b"x").expect("write file");
        }
        cleanup_partials(&dir, stem);
        for name in ours {
            assert!(!dir.join(name).exists(), "{name} should be gone");
        }
        for name in theirs {
            assert!(dir.join(name).exists(), "{name} should stay");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validates_requests_before_touching_anything() {
        let root = std::env::temp_dir().join("CupidPlayerTest");
        let dest = root.join("Singles");
        let req = |id: &'static str, dir: &'static Path, stem: &'static str| {
            validate_request(&DownloadRequest {
                video_id: id,
                music_root: Path::new(""),
                dest_dir: dir,
                file_stem: stem,
            })
            .map(|_| ())
        };
        // Cheap checks that do not depend on the root:
        assert_eq!(
            req("short", Path::new(""), "ok"),
            Err(DownloadError::InvalidVideoId)
        );
        assert_eq!(
            req("dGoHLoDmHdI", Path::new(""), "a/b"),
            Err(DownloadError::UnsafeName)
        );
        assert_eq!(
            req("dGoHLoDmHdI", Path::new(""), ".."),
            Err(DownloadError::UnsafeName)
        );

        let ok = DownloadRequest {
            video_id: "dGoHLoDmHdI",
            music_root: &root,
            dest_dir: &dest,
            file_stem: "Car, the garden - Scars",
        };
        assert_eq!(
            validate_request(&ok),
            Ok(dest.join("Car, the garden - Scars.opus"))
        );

        let other = std::env::temp_dir().join("Other");
        let outside = DownloadRequest {
            dest_dir: &other,
            ..ok
        };
        assert_eq!(validate_request(&outside), Err(DownloadError::OutsideRoot));
    }
}

//! yt-dlp sidecar integration. Only Rust launches it: the webview has no shell
//! permissions (see capabilities/default.json).

pub mod matcher;
pub mod search;

use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use thiserror::Error;

const MAX_STDOUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const STDERR_TAIL_CHARS: usize = 200;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RunError {
    #[error("could not start yt-dlp: {0}")]
    Spawn(String),
    #[error("yt-dlp timed out")]
    Timeout,
    #[error("yt-dlp output too large")]
    TooLarge,
    #[error("yt-dlp failed (exit {code:?}): {detail}")]
    Failed {
        code: Option<i32>,
        detail: String,
        /// The "No supported JavaScript runtime" warning appeared (see D-74).
        js_runtime_warning: bool,
    },
}

impl RunError {
    /// Stable code for the frontend to map to an i18n message.
    pub fn code(&self) -> &'static str {
        match self {
            RunError::Spawn(_) => "ytdlp.spawn",
            RunError::Timeout => "ytdlp.timeout",
            RunError::TooLarge => "ytdlp.too_large",
            RunError::Failed { js_runtime_warning: true, .. } => "ytdlp.failed_js_runtime",
            RunError::Failed { .. } => "ytdlp.failed",
        }
    }
}

#[derive(Debug)]
pub struct RunOutput {
    pub stdout: String,
    pub stderr: String,
}

/// Last "ERROR" line of yt-dlp's stderr (or the last line), without control
/// characters and capped, so it is safe to log and show.
fn last_error_line(stderr: &str) -> String {
    let lines: Vec<&str> = stderr
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let pick = lines
        .iter()
        .rev()
        .find(|l| l.starts_with("ERROR"))
        .or_else(|| lines.last())
        .copied()
        .unwrap_or("");
    pick.chars()
        .filter(|c| !c.is_control())
        .take(STDERR_TAIL_CHARS)
        .collect()
}

fn classify_failure(code: Option<i32>, stderr: &str) -> RunError {
    RunError::Failed {
        code,
        detail: last_error_line(stderr),
        js_runtime_warning: stderr.contains("JavaScript runtime"),
    }
}

/// Runs the yt-dlp sidecar with `args` (always a vector: never a shell string)
/// and waits for it, killing the process on timeout.
pub async fn run_ytdlp(
    app: &AppHandle,
    args: &[String],
    timeout: Duration,
) -> Result<RunOutput, RunError> {
    let cmd = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| RunError::Spawn(e.to_string()))?
        .args(args)
        .env("PYTHONIOENCODING", "utf-8");
    let (mut rx, child) = cmd.spawn().map_err(|e| RunError::Spawn(e.to_string()))?;

    let collect = async {
        let mut stdout: Vec<u8> = Vec::new();
        let mut stderr: Vec<u8> = Vec::new();
        let mut code: Option<i32> = None;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    if stdout.len() + line.len() > MAX_STDOUT_BYTES {
                        return Err(RunError::TooLarge);
                    }
                    stdout.extend_from_slice(&line);
                    stdout.push(b'\n'); // blank lines are harmless for JSON lines
                }
                CommandEvent::Stderr(line) => {
                    if stderr.len() < MAX_STDERR_BYTES {
                        stderr.extend_from_slice(&line);
                        stderr.push(b'\n');
                    }
                }
                CommandEvent::Error(msg) => return Err(RunError::Spawn(msg)),
                CommandEvent::Terminated(payload) => {
                    code = payload.code;
                    break;
                }
                _ => {}
            }
        }
        Ok::<_, RunError>((stdout, stderr, code))
    };

    match tokio::time::timeout(timeout, collect).await {
        Err(_) => {
            let _ = child.kill();
            Err(RunError::Timeout)
        }
        Ok(Err(e)) => {
            let _ = child.kill();
            Err(e)
        }
        Ok(Ok((stdout, stderr, code))) => {
            let stdout = String::from_utf8_lossy(&stdout).into_owned();
            let stderr = String::from_utf8_lossy(&stderr).into_owned();
            if code == Some(0) {
                Ok(RunOutput { stdout, stderr })
            } else {
                Err(classify_failure(code, &stderr))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_error_line_prefers_error_lines_and_truncates() {
        let stderr = "WARNING: something\nERROR: video unavailable\n  \nWARNING: later\n";
        assert_eq!(last_error_line(stderr), "ERROR: video unavailable");
        assert_eq!(last_error_line("only a warning\n"), "only a warning");
        assert_eq!(last_error_line(""), "");
        let long = format!("ERROR: {}", "x".repeat(500));
        assert_eq!(last_error_line(&long).chars().count(), STDERR_TAIL_CHARS);
    }

    #[test]
    fn failed_runs_flag_the_js_runtime_warning() {
        let with = classify_failure(
            Some(1),
            "WARNING: [youtube] No supported JavaScript runtime could be found.\nERROR: x",
        );
        assert_eq!(with.code(), "ytdlp.failed_js_runtime");
        let without = classify_failure(Some(1), "ERROR: x");
        assert_eq!(without.code(), "ytdlp.failed");
        assert!(matches!(without, RunError::Failed { code: Some(1), .. }));
    }
}
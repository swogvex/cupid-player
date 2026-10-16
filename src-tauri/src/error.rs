use serde::{Serialize, Serializer};
use std::fmt;

#[derive(Debug)]
pub enum AppError {
    InvalidScale(u32),
    Window(tauri::Error),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::InvalidScale(n) => write!(f, "invalid window scale: {n}"),
            AppError::Window(e) => write!(f, "window error: {e}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Window(e)
    }
}

// Tauri commands need a serializable error; the frontend receives a plain string.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
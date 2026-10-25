use serde::Serialize;

/// Every command returns `Result<_, AppError>`. `Err` rejects the JS promise
/// with the serialized value, so it has to implement `Serialize`.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("Could not read image: {0}")]
    Image(#[from] image::ImageError),
    #[error("Could not move to Trash: {0}")]
    Trash(#[from] trash::Error),
    #[error("Not allowed: {0}")]
    Forbidden(String),
    #[error("{0}")]
    InvalidEdit(String),
    #[error("Editing {0} images isn't supported")]
    UnsupportedFormat(String),
    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

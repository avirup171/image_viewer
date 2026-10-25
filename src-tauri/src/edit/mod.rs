//! Non-destructive-until-saved image editing.
//!
//! The frontend sends a list of operations (`EditOp`) describing what the user
//! did, e.g. `[{ "type": "crop", "x": 10, "y": 20, "width": 640, "height": 480 }]`.
//! Rust loads the original, runs the operations in order, and saves the result
//! either as a new file next to it or in place of it (see `output.rs`).
//!
//! ## Adding a new edit (e.g. rotate, resize, brightness)
//! 1. Create `edit/<name>.rs` with a struct holding its parameters and
//!    `impl Operation for <Name>`.
//! 2. Add a variant to `EditOp` and an arm to `EditOp::operation`.
//! 3. Add the matching TypeScript type in `src/edit/types.ts` and a tool in
//!    `src/edit/tools/`.
//!
//! Nothing else (loading, metadata, saving, the command) needs to change.

mod crop;
mod output;

use std::path::PathBuf;

use image::{DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    error::{AppError, AppResult},
    imaging,
    library::{self, ImageEntry},
    state::AppState,
};

pub use crop::Crop;
pub use output::SaveMode;

/// One step of an edit. Every operation takes an image and returns a new one.
pub trait Operation {
    fn apply(&self, image: DynamicImage) -> AppResult<DynamicImage>;
}

/// The operations the frontend can request. `tag = "type"` means the JSON
/// looks like `{ "type": "crop", ...fields }`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EditOp {
    Crop(Crop),
}

impl EditOp {
    fn operation(&self) -> &dyn Operation {
        match self {
            EditOp::Crop(op) => op,
        }
    }
}

/// Runs every operation in order.
pub fn apply_ops(image: DynamicImage, ops: &[EditOp]) -> AppResult<DynamicImage> {
    ops.iter().try_fold(image, |img, op| op.operation().apply(img))
}

/// Formats we can decode *and* write back without losing anything important.
/// GIF is excluded: re-encoding would drop every frame after the first.
pub fn is_editable(format: ImageFormat) -> bool {
    matches!(format, ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP | ImageFormat::Bmp)
}

#[derive(Debug, Serialize)]
pub struct EditResult {
    /// The file that now holds the edited image (new file, or the original path).
    entry: ImageEntry,
    replaced: bool,
}

/// Load → apply operations → save. Runs on a blocking thread.
pub fn run_edit(path: PathBuf, ops: &[EditOp], mode: SaveMode) -> AppResult<EditResult> {
    if ops.is_empty() {
        return Err(AppError::InvalidEdit("There are no changes to save".into()));
    }
    let loaded = imaging::open_oriented(&path)?;
    if !is_editable(loaded.format) {
        return Err(AppError::UnsupportedFormat(format!("{:?}", loaded.format).to_uppercase()));
    }

    let edited = apply_ops(loaded.image.clone(), ops)?;
    let dest = output::save(&edited, &loaded, &path, mode)?;

    Ok(EditResult {
        entry: library::entry_for(&dest)?,
        replaced: matches!(mode, SaveMode::Replace),
    })
}

#[tauri::command]
pub async fn apply_edits(
    state: State<'_, AppState>,
    path: String,
    ops: Vec<EditOp>,
    mode: SaveMode,
) -> AppResult<EditResult> {
    let path = PathBuf::from(path);
    if !state.is_allowed(&path) || !library::has_image_ext(&path) {
        return Err(AppError::Forbidden(path.to_string_lossy().into_owned()));
    }
    tauri::async_runtime::spawn_blocking(move || run_edit(path, &ops, mode))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imaging::test_support::*;

    #[test]
    fn ops_deserialize_from_frontend_json() {
        let ops: Vec<EditOp> = serde_json::from_str(
            r#"[{ "type": "crop", "x": 1, "y": 2, "width": 3, "height": 4 }]"#,
        )
        .unwrap();
        assert!(matches!(&ops[0], EditOp::Crop(c) if *c == Crop { x: 1, y: 2, width: 3, height: 4 }));

        let mode: SaveMode = serde_json::from_str(r#""newFile""#).unwrap();
        assert!(matches!(mode, SaveMode::NewFile));
        let mode: SaveMode = serde_json::from_str(r#""replace""#).unwrap();
        assert!(matches!(mode, SaveMode::Replace));
    }

    #[test]
    fn pipeline_applies_in_order() {
        let img = DynamicImage::new_rgb8(100, 80);
        let ops = vec![
            EditOp::Crop(Crop { x: 10, y: 10, width: 60, height: 50 }),
            EditOp::Crop(Crop { x: 0, y: 0, width: 30, height: 20 }),
        ];
        let out = apply_ops(img, &ops).unwrap();
        assert_eq!((out.width(), out.height()), (30, 20));
    }

    #[test]
    fn save_as_new_file_keeps_original_and_metadata() {
        let dir = temp_dir("edit-new");
        let src = dir.join("IMG_1.jpg");
        write_jpeg(&src, 400, 300, "TestCam X1", 6); // displays as 300x400
        let before = std::fs::read(&src).unwrap();

        let ops = [EditOp::Crop(Crop { x: 50, y: 100, width: 200, height: 150 })];
        let result = run_edit(src.clone(), &ops, SaveMode::NewFile).unwrap();

        assert!(!result.replaced);
        let dest = dir.join("IMG_1 (edited).jpg");
        assert_eq!(result.entry.path, dest.to_string_lossy());
        assert_eq!(std::fs::read(&src).unwrap(), before, "original untouched");

        assert_eq!(image::image_dimensions(&dest).unwrap(), (200, 150));
        // Camera info survives; orientation is now "normal" because the pixels
        // were rotated before cropping.
        assert_eq!(read_exif(&dest), (Some(1), Some("TestCam X1".into())));

        // A second save doesn't overwrite the first copy.
        let again = run_edit(src.clone(), &ops, SaveMode::NewFile).unwrap();
        assert_eq!(again.entry.path, dir.join("IMG_1 (edited 2).jpg").to_string_lossy());
    }

    #[test]
    fn rejects_bad_crops_and_gifs() {
        let dir = temp_dir("edit-bad");
        let src = dir.join("a.jpg");
        write_jpeg(&src, 100, 100, "Cam", 1);

        let outside = [EditOp::Crop(Crop { x: 90, y: 0, width: 20, height: 10 })];
        assert!(matches!(run_edit(src.clone(), &outside, SaveMode::NewFile), Err(AppError::InvalidEdit(_))));
        assert!(matches!(run_edit(src.clone(), &[], SaveMode::NewFile), Err(AppError::InvalidEdit(_))));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1, "nothing written on failure");

        let gif = dir.join("anim.gif");
        image::DynamicImage::new_rgb8(10, 10).save(&gif).unwrap();
        let ok_crop = [EditOp::Crop(Crop { x: 0, y: 0, width: 5, height: 5 })];
        assert!(matches!(run_edit(gif, &ok_crop, SaveMode::Replace), Err(AppError::UnsupportedFormat(_))));
    }
}

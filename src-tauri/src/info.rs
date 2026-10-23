//! Image metadata for the info panel and status bar.

use std::{fs::File, io::BufReader, path::PathBuf};

use exif::{In, Tag};
use image::ImageReader;
use serde::Serialize;
use tauri::State;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

#[derive(Serialize)]
pub struct MetaField {
    label: &'static str,
    value: String,
}

#[derive(Serialize)]
pub struct ImageInfo {
    /// Display dimensions (already swapped for rotated photos).
    width: Option<u32>,
    height: Option<u32>,
    format: Option<String>,
    /// Camera fields that were present, in display order. Empty for
    /// screenshots, PNGs, etc.
    camera: Vec<MetaField>,
}

const CAMERA_TAGS: &[(Tag, &str)] = &[
    (Tag::Model, "Camera"),
    (Tag::LensModel, "Lens"),
    (Tag::FocalLength, "Focal length"),
    (Tag::FNumber, "Aperture"),
    (Tag::ExposureTime, "Shutter"),
    (Tag::PhotographicSensitivity, "ISO"),
    (Tag::DateTimeOriginal, "Taken"),
];

fn read_info(path: PathBuf) -> AppResult<ImageInfo> {
    // Reading dimensions only parses the header, not the pixels: fast.
    let reader = ImageReader::open(&path)?.with_guessed_format()?;
    let format = reader.format().map(|f| format!("{f:?}").to_uppercase());
    let dims = reader.into_dimensions().ok();

    // No EXIF block is normal (PNG, screenshots), so failures become `None`.
    let exif = File::open(&path)
        .ok()
        .and_then(|f| exif::Reader::new().read_from_container(&mut BufReader::new(f)).ok());

    let mut camera = Vec::new();
    let mut orientation = 1;
    if let Some(exif) = &exif {
        for &(tag, label) in CAMERA_TAGS {
            if let Some(field) = exif.get_field(tag, In::PRIMARY) {
                let value = field.display_value().with_unit(exif).to_string();
                let value = value.trim_matches('"').trim().to_string();
                if !value.is_empty() {
                    camera.push(MetaField { label, value });
                }
            }
        }
        if let Some(o) = exif
            .get_field(Tag::Orientation, In::PRIMARY)
            .and_then(|f| f.value.get_uint(0))
        {
            orientation = o;
        }
    }

    // EXIF orientations 5–8 are rotated 90°, so width and height swap on screen.
    let (width, height) = match dims {
        Some((w, h)) if (5..=8).contains(&orientation) => (Some(h), Some(w)),
        Some((w, h)) => (Some(w), Some(h)),
        None => (None, None),
    };

    Ok(ImageInfo { width, height, format, camera })
}

#[tauri::command]
pub async fn image_info(state: State<'_, AppState>, path: String) -> AppResult<ImageInfo> {
    let path = PathBuf::from(path);
    if !state.is_allowed(&path) {
        return Err(AppError::Forbidden(path.to_string_lossy().into_owned()));
    }
    tauri::async_runtime::spawn_blocking(move || read_info(path))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

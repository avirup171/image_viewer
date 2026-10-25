//! Writing edited images to disk, safely.
//!
//! Both modes first write to a temporary file in the same folder, so a crash
//! or full disk never leaves a half-written image behind:
//! - `NewFile`: rename the temp file to "<name> (edited).<ext>" (or "(edited 2)"…).
//! - `Replace`: move the original to the Trash (so it can be recovered), then
//!   rename the temp file into the original's place.

use std::{
    fs,
    io::{BufWriter, Write},
    path::{Path, PathBuf},
};

use image::{
    DynamicImage, ImageEncoder, ImageFormat,
    codecs::{bmp::BmpEncoder, jpeg::JpegEncoder, png::PngEncoder, webp::WebPEncoder},
};
use serde::Deserialize;

use crate::{
    error::{AppError, AppResult},
    imaging::LoadedImage,
};

/// JPEG quality for re-encoding: visually lossless for photos, ~half the size of 100.
const JPEG_QUALITY: u8 = 92;
const EDITED_SUFFIX: &str = "edited";

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SaveMode {
    /// Keep the original; write a sibling copy.
    NewFile,
    /// Overwrite the original (the old file goes to the Trash).
    Replace,
}

pub fn save(image: &DynamicImage, source: &LoadedImage, original: &Path, mode: SaveMode) -> AppResult<PathBuf> {
    let dir = original
        .parent()
        .ok_or_else(|| AppError::Other("Image has no parent folder".into()))?;
    let file_name = original
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = dir.join(format!(".{file_name}.{}.edit-tmp", std::process::id()));

    if let Err(e) = write_encoded(image, source, &tmp) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }

    match mode {
        SaveMode::NewFile => {
            let dest = unique_edited_path(original);
            fs::rename(&tmp, &dest).inspect_err(|_| {
                let _ = fs::remove_file(&tmp);
            })?;
            Ok(dest)
        }
        SaveMode::Replace => {
            // Trash first: if that fails, the original is still in place.
            if let Err(e) = trash::delete(original) {
                let _ = fs::remove_file(&tmp);
                return Err(e.into());
            }
            fs::rename(&tmp, original).map_err(|e| {
                AppError::Other(format!(
                    "The original is in the Trash, but the edited image couldn't be moved into place \
                     ({e}). It was saved as {}",
                    tmp.display()
                ))
            })?;
            Ok(original.to_path_buf())
        }
    }
}

/// Encode in the original's format, carrying over its colour profile and EXIF.
fn write_encoded(image: &DynamicImage, source: &LoadedImage, path: &Path) -> AppResult<()> {
    let mut out = BufWriter::new(fs::File::create(path)?);
    match source.format {
        ImageFormat::Jpeg => encode(image, source, JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY))?,
        ImageFormat::Png => encode(image, source, PngEncoder::new(&mut out))?,
        // The image crate only writes lossless WebP, so files may grow.
        ImageFormat::WebP => encode(image, source, WebPEncoder::new_lossless(&mut out))?,
        ImageFormat::Bmp => encode(image, source, BmpEncoder::new(&mut out))?,
        other => return Err(AppError::UnsupportedFormat(format!("{other:?}").to_uppercase())),
    }
    out.flush()?;
    out.get_ref().sync_all()?; // make sure it's on disk before we rename / trash
    Ok(())
}

fn encode<E: ImageEncoder>(image: &DynamicImage, source: &LoadedImage, mut encoder: E) -> AppResult<()> {
    // Not every format can store every kind of metadata; skipping it is fine.
    if let Some(icc) = &source.icc_profile {
        let _ = encoder.set_icc_profile(icc.clone());
    }
    if let Some(exif) = &source.exif {
        let _ = encoder.set_exif_metadata(exif.clone());
    }
    // write_with_encoder converts colour types the format can't store (e.g. RGBA → RGB for JPEG).
    image.write_with_encoder(encoder)?;
    Ok(())
}

/// "IMG_1.jpg" → "IMG_1 (edited).jpg", then "(edited 2)", "(edited 3)"…
/// Editing "IMG_1 (edited).jpg" again gives "IMG_1 (edited 2).jpg", not
/// "IMG_1 (edited) (edited).jpg".
pub fn unique_edited_path(original: &Path) -> PathBuf {
    let dir = original.parent().unwrap_or(Path::new("."));
    let stem = original.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = original.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let base = strip_edited_suffix(&stem);

    (1..)
        .map(|n| {
            let suffix = if n == 1 { format!("({EDITED_SUFFIX})") } else { format!("({EDITED_SUFFIX} {n})") };
            dir.join(format!("{base} {suffix}{ext}"))
        })
        .find(|p| !p.exists())
        .expect("an unused name exists")
}

fn strip_edited_suffix(stem: &str) -> &str {
    let Some(open) = stem.rfind(" (") else { return stem };
    let inner = &stem[open + 2..];
    let Some(inner) = inner.strip_suffix(')') else { return stem };
    let is_edited = inner == EDITED_SUFFIX
        || inner
            .strip_prefix(EDITED_SUFFIX)
            .and_then(|rest| rest.strip_prefix(' '))
            .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()));
    if is_edited { &stem[..open] } else { stem }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        edit::{Crop, EditOp, SaveMode, run_edit},
        imaging::test_support::*,
    };

    #[test]
    fn edited_names() {
        assert_eq!(strip_edited_suffix("IMG_1"), "IMG_1");
        assert_eq!(strip_edited_suffix("IMG_1 (edited)"), "IMG_1");
        assert_eq!(strip_edited_suffix("IMG_1 (edited 12)"), "IMG_1");
        assert_eq!(strip_edited_suffix("Trip (day 2)"), "Trip (day 2)");
        assert_eq!(strip_edited_suffix("x (edited two)"), "x (edited two)");

        let dir = temp_dir("names");
        let p = dir.join("IMG_1 (edited).jpg");
        assert_eq!(unique_edited_path(&p), dir.join("IMG_1 (edited).jpg"));
        fs::write(dir.join("IMG_1 (edited).jpg"), b"x").unwrap();
        assert_eq!(unique_edited_path(&p), dir.join("IMG_1 (edited 2).jpg"));
    }

    #[test]
    fn replace_swaps_in_the_edit_and_trashes_the_original() {
        let dir = temp_dir("replace");
        let src = dir.join("photo.jpg");
        write_jpeg(&src, 120, 80, "Cam", 1);

        let ops = [EditOp::Crop(Crop { x: 0, y: 0, width: 60, height: 40 })];
        match run_edit(src.clone(), &ops, SaveMode::Replace) {
            Ok(result) => {
                assert_eq!(image::image_dimensions(&src).unwrap(), (60, 40));
                let names: Vec<_> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
                assert_eq!(names, vec![std::ffi::OsString::from("photo.jpg")], "no temp files left: {result:?}");
            }
            // Some CI sandboxes have no Trash; then the original must be untouched.
            Err(AppError::Trash(_)) => {
                assert_eq!(image::image_dimensions(&src).unwrap(), (120, 80));
                assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "temp file cleaned up");
            }
            Err(e) => panic!("unexpected error: {e}"),
        }
    }

    #[test]
    fn png_with_alpha_round_trips() {
        let dir = temp_dir("png");
        let src = dir.join("shot.png");
        image::DynamicImage::new_rgba8(64, 32).save(&src).unwrap();
        let ops = [EditOp::Crop(Crop { x: 8, y: 8, width: 16, height: 16 })];
        let r = run_edit(src, &ops, SaveMode::NewFile).unwrap();
        let out = image::open(dir.join("shot (edited).png")).unwrap();
        assert_eq!((out.width(), out.height()), (16, 16));
        assert!(out.color().has_alpha(), "transparency kept: {r:?}");
    }
}

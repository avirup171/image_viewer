//! Shared image loading, used by thumbnails and editing.
//!
//! Photos often store their pixels sideways plus an EXIF "orientation" flag
//! that tells viewers to rotate them. The webview honours that flag, so every
//! coordinate the frontend sends (e.g. a crop box) is in the *rotated* space.
//! We therefore always rotate the pixels on load, and reset the flag in the
//! EXIF we keep, so a saved file isn't rotated a second time by other apps.

use std::path::Path;

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, metadata::Orientation};

use crate::{
    error::{AppError, AppResult},
    heic,
};

pub struct LoadedImage {
    /// Pixels, already rotated per EXIF orientation.
    pub image: DynamicImage,
    /// The format edits are saved in: the original's, or JPEG for HEIC.
    pub format: ImageFormat,
    /// Decoded from HEIC / HEIF (macOS). Edits then become a JPEG copy.
    pub from_heic: bool,
    /// Colour profile (e.g. Display P3 from an iPhone), kept so colours don't shift.
    pub icc_profile: Option<Vec<u8>>,
    /// Raw EXIF (TIFF) block with orientation reset to "normal" and the
    /// embedded preview thumbnail unlinked. Keeps camera, lens, date taken…
    pub exif: Option<Vec<u8>>,
}

pub fn open_oriented(path: &Path) -> AppResult<LoadedImage> {
    if heic::is_heic(path) {
        return open_heic(path);
    }
    let reader = ImageReader::open(path)?.with_guessed_format()?;
    let format = reader
        .format()
        .ok_or_else(|| AppError::Other("Unrecognised image format".into()))?;

    let mut decoder = reader.into_decoder()?;
    let orientation = decoder.orientation()?;
    // Metadata is optional; a failure to read it never blocks opening the image.
    let icc_profile = decoder.icc_profile().ok().flatten();
    let exif = decoder.exif_metadata().ok().flatten().map(clean_exif);

    let mut image = DynamicImage::from_decoder(decoder)?;
    image.apply_orientation(orientation);

    Ok(LoadedImage { image, format, from_heic: false, icc_profile, exif })
}

/// HEIC through the platform decoder (`heic/`). Its pixels arrive already
/// upright, but iPhone files still carry an EXIF orientation flag, so it is
/// reset here too. Edits are saved as JPEG (`format`).
fn open_heic(path: &Path) -> AppResult<LoadedImage> {
    let decoded = heic::decode(path, None)?;
    Ok(LoadedImage {
        image: decoded.image,
        format: ImageFormat::Jpeg,
        from_heic: true,
        icc_profile: decoded.icc_profile,
        exif: heic::exif_block(path).map(clean_exif),
    })
}

/// For display only (thumbnails): at most `max` pixels on the longest edge,
/// rotated upright. HEIC is decoded straight at that size, which is much
/// faster than decoding a 12-megapixel photo and then shrinking it.
pub fn open_scaled(path: &Path, max: u32) -> AppResult<DynamicImage> {
    if heic::is_heic(path) {
        return Ok(heic::decode(path, Some(max))?.image);
    }
    Ok(open_oriented(path)?.image.thumbnail(max, max))
}

/// Orientation reset to "normal" (the pixels are rotated already) and the
/// embedded preview thumbnail unlinked.
fn clean_exif(mut chunk: Vec<u8>) -> Vec<u8> {
    let _ = Orientation::remove_from_exif_chunk(&mut chunk);
    unlink_exif_thumbnail(&mut chunk);
    chunk
}

/// EXIF can embed a small preview of the *original* image (IFD1). After a crop
/// that preview would be wrong, and some apps show it. IFD0 ends with the
/// offset of IFD1; setting it to 0 detaches the preview. Leaves the chunk
/// untouched if it doesn't parse as expected.
fn unlink_exif_thumbnail(chunk: &mut [u8]) {
    let little = match chunk.get(0..4) {
        Some([0x49, 0x49, 42, 0]) => true,  // "II*\0"
        Some([0x4d, 0x4d, 0, 42]) => false, // "MM\0*"
        _ => return,
    };
    let read_u16 = |b: &[u8]| if little { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) };
    let read_u32 = |b: &[u8]| {
        let a = [b[0], b[1], b[2], b[3]];
        if little { u32::from_le_bytes(a) } else { u32::from_be_bytes(a) }
    };

    let Some(ifd0) = chunk.get(4..8).map(read_u32).map(|o| o as usize) else { return };
    let Some(count) = chunk.get(ifd0..ifd0 + 2).map(read_u16).map(usize::from) else { return };
    let next = ifd0 + 2 + count * 12;
    if let Some(slot) = chunk.get_mut(next..next + 4) {
        slot.copy_from_slice(&[0, 0, 0, 0]);
    }
}

#[cfg(test)]
pub mod test_support {
    //! Helpers for tests: build JPEGs with a chosen EXIF orientation + camera model.
    use std::path::Path;

    use image::{ImageEncoder, RgbImage, codecs::jpeg::JpegEncoder};

    /// Minimal little-endian TIFF block: Model (ASCII) + Orientation (SHORT).
    pub fn exif_chunk(model: &str, orientation: u16) -> Vec<u8> {
        let mut model_bytes = model.as_bytes().to_vec();
        model_bytes.push(0);
        let entries = 2u16;
        let ifd0 = 8u32;
        let data_offset = ifd0 + 2 + u32::from(entries) * 12 + 4;

        let mut b = vec![0x49, 0x49, 42, 0];
        b.extend_from_slice(&ifd0.to_le_bytes());
        b.extend_from_slice(&entries.to_le_bytes());
        // 0x0110 Model, type 2 (ASCII), count, offset to the string
        b.extend_from_slice(&0x0110u16.to_le_bytes());
        b.extend_from_slice(&2u16.to_le_bytes());
        b.extend_from_slice(&(model_bytes.len() as u32).to_le_bytes());
        b.extend_from_slice(&data_offset.to_le_bytes());
        // 0x0112 Orientation, type 3 (SHORT), count 1, value inline
        b.extend_from_slice(&0x0112u16.to_le_bytes());
        b.extend_from_slice(&3u16.to_le_bytes());
        b.extend_from_slice(&1u32.to_le_bytes());
        b.extend_from_slice(&orientation.to_le_bytes());
        b.extend_from_slice(&[0, 0]);
        // next IFD offset (pretend there's a thumbnail IFD right after the data)
        b.extend_from_slice(&(data_offset + model_bytes.len() as u32).to_le_bytes());
        b.extend_from_slice(&model_bytes);
        b
    }

    /// Writes a `w`×`h` JPEG (as stored, before orientation) with EXIF.
    pub fn write_jpeg(path: &Path, w: u32, h: u32, model: &str, orientation: u16) {
        let img = RgbImage::from_fn(w, h, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, 90]));
        let file = std::fs::File::create(path).unwrap();
        let mut enc = JpegEncoder::new_with_quality(file, 90);
        enc.set_exif_metadata(exif_chunk(model, orientation)).unwrap();
        enc.write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgb8).unwrap();
    }

    /// A fresh, empty directory under the system temp dir.
    pub fn temp_dir(name: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("spektro-photo-test-{name}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Reads (orientation, model) back with kamadak-exif.
    pub fn read_exif(path: &Path) -> (Option<u32>, Option<String>) {
        let f = std::fs::File::open(path).unwrap();
        let Ok(exif) = exif::Reader::new().read_from_container(&mut std::io::BufReader::new(f)) else {
            return (None, None);
        };
        let orientation = exif
            .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
            .and_then(|f| f.value.get_uint(0));
        let model = exif
            .get_field(exif::Tag::Model, exif::In::PRIMARY)
            .map(|f| f.display_value().to_string().trim_matches('"').to_string());
        (orientation, model)
    }
}

#[cfg(test)]
mod tests {
    use super::{test_support::*, *};

    #[test]
    fn rotates_pixels_and_resets_orientation_flag() {
        let dir = temp_dir("open");
        let p = dir.join("portrait.jpg");
        // Stored 400x300, orientation 6 = "rotate 90° clockwise to display"
        write_jpeg(&p, 400, 300, "TestCam X1", 6);

        let loaded = open_oriented(&p).unwrap();
        assert_eq!(loaded.format, ImageFormat::Jpeg);
        assert_eq!((loaded.image.width(), loaded.image.height()), (300, 400));

        let exif = loaded.exif.expect("exif kept");
        assert_eq!(Orientation::from_exif_chunk(&exif), Some(Orientation::NoTransforms));
        assert!(!loaded.from_heic);
    }

    #[test]
    fn heic_exif_is_cleaned_on_every_platform() {
        // The fixture's EXIF says "rotate 90°" (6); after loading it must say "normal".
        let raw = heic::exif_block(&heic_fixture()).unwrap();
        assert_eq!(Orientation::from_exif_chunk(&raw), Some(Orientation::Rotate90));
        assert_eq!(Orientation::from_exif_chunk(&clean_exif(raw)), Some(Orientation::NoTransforms));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn opens_heic_upright_for_editing() {
        let loaded = open_oriented(&heic_fixture()).unwrap();
        assert!(loaded.from_heic);
        assert_eq!(loaded.format, ImageFormat::Jpeg);
        assert_eq!((loaded.image.width(), loaded.image.height()), (40, 60));
        assert_eq!(Orientation::from_exif_chunk(&loaded.exif.unwrap()), Some(Orientation::NoTransforms));
        let thumb = open_scaled(&heic_fixture(), 30).unwrap();
        assert_eq!((thumb.width(), thumb.height()), (20, 30));
    }

    fn heic_fixture() -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("test-data/rotated.heic")
    }

    #[test]
    fn unlinks_thumbnail_ifd() {
        let mut chunk = exif_chunk("Cam", 1);
        unlink_exif_thumbnail(&mut chunk);
        let next = 8 + 2 + 2 * 12;
        assert_eq!(&chunk[next..next + 4], &[0, 0, 0, 0]);
        // Garbage input is left alone rather than panicking.
        let mut junk = vec![1, 2, 3];
        unlink_exif_thumbnail(&mut junk);
        assert_eq!(junk, vec![1, 2, 3]);
    }
}

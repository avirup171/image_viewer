//! HEIC / HEIF photos (the iPhone camera format). macOS only.
//!
//! Decoding uses Apple's ImageIO framework (`imageio.rs`), the decoder
//! Preview and Photos use. It ships with macOS, so there is nothing to
//! bundle, and it works inside the App Store sandbox. On other platforms HEIC
//! files are not listed at all (see `library::EXTS`), so `decode` and
//! `dimensions` only return an error there.
//!
//! The webview can't be relied on to show HEIC (only macOS 14+ can), so the
//! viewer gets full-size images through our `preview://` protocol
//! (`thumbs.rs`), which calls `imaging::open_oriented` → `decode` here.
//!
//! Edits are saved as a JPEG copy: writing HEIC needs an HEVC encoder.

use std::path::Path;

use image::DynamicImage;

#[cfg(target_os = "macos")]
mod imageio;

/// Pixels plus the colour profile they're in (Display P3 for most iPhone photos).
pub struct Decoded {
    pub image: DynamicImage,
    pub icc_profile: Option<Vec<u8>>,
}

/// True for `.heic` / `.heif` files (any platform; listing is decided by `library::EXTS`).
pub fn is_heic(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("heic") || e.eq_ignore_ascii_case("heif"))
}

// `decode(path, max_size)`: the primary image, rotated upright; `max_size`
// caps the longest edge (thumbnails), `None` decodes at full size.
// `dimensions(path)`: displayed (width, height) from the header only.
#[cfg(target_os = "macos")]
pub use imageio::{decode, dimensions};

#[cfg(not(target_os = "macos"))]
pub fn decode(_path: &Path, _max_size: Option<u32>) -> crate::error::AppResult<Decoded> {
    Err(crate::error::AppError::UnsupportedFormat("HEIC".into()))
}

#[cfg(not(target_os = "macos"))]
pub fn dimensions(_path: &Path) -> crate::error::AppResult<(u32, u32)> {
    Err(crate::error::AppError::UnsupportedFormat("HEIC".into()))
}

/// The raw EXIF (TIFF) block, read with kamadak-exif (pure Rust, so this part
/// works and is tested on every platform).
pub fn exif_block(path: &Path) -> Option<Vec<u8>> {
    let file = std::fs::File::open(path).ok()?;
    let exif = exif::Reader::new()
        .read_from_container(&mut std::io::BufReader::new(file))
        .ok()?;
    Some(exif.buf().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A 60×40 HEIC (left half red, right half blue) stored with a 90°
    /// clockwise rotation and EXIF Model "TestCam HEIC". Displays as 40×60,
    /// red on top. Made with pillow-heif (see test-data/README.md).
    pub fn fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("test-data/rotated.heic")
    }

    #[test]
    fn recognises_heic_extensions() {
        assert!(is_heic(Path::new("IMG_0001.HEIC")));
        assert!(is_heic(Path::new("a/b.heif")));
        assert!(!is_heic(Path::new("photo.jpg")));
        assert!(!is_heic(Path::new("heic")));
    }

    #[test]
    fn reads_exif_from_heic_container() {
        let chunk = exif_block(&fixture()).expect("fixture has EXIF");
        let exif = exif::Reader::new().read_raw(chunk).unwrap();
        let model = exif.get_field(exif::Tag::Model, exif::In::PRIMARY).unwrap();
        assert!(model.display_value().to_string().contains("TestCam HEIC"));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn decoding_is_macos_only() {
        assert!(decode(&fixture(), None).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn decodes_upright_with_size_limit() {
        use image::GenericImageView;
        let full = decode(&fixture(), None).unwrap();
        assert_eq!(full.image.dimensions(), (40, 60), "rotation applied");
        let top = full.image.get_pixel(20, 10).0;
        let bottom = full.image.get_pixel(20, 50).0;
        assert!(top[0] > 150 && top[2] < 100, "top is red: {top:?}");
        assert!(bottom[2] > 150 && bottom[0] < 100, "bottom is blue: {bottom:?}");
        assert_eq!(dimensions(&fixture()).unwrap(), (40, 60));

        let small = decode(&fixture(), Some(30)).unwrap();
        assert_eq!(small.image.dimensions(), (20, 30));
    }
}

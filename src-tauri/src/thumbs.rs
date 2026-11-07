//! The `thumb://` and `preview://` custom protocols: like Tauri's asset
//! protocol, except instead of serving the file as-is they decode it in Rust
//! and cache the result on disk.
//! - `thumb://`: a small preview for the grid, filmstrip and navigator.
//! - `preview://`: the full-size image as JPEG, for formats the webview can't
//!   display itself (HEIC). It keeps the colour profile (e.g. Display P3).
//!
//! Frontend: `convertFileSrc(path, "thumb")` builds the URL:
//!   macOS/Linux: thumb://localhost/%2FUsers%2Fyou%2Fpics%2Fa.jpg
//!   Windows:     http://thumb.localhost/C%3A%5Cpics%5Ca.jpg

use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::Cursor,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use image::{
    DynamicImage, ImageEncoder, ImageFormat,
    codecs::{jpeg::JpegEncoder, png::PngEncoder},
};
use percent_encoding::percent_decode_str;
use tauri::{
    Manager, Runtime, UriSchemeContext, UriSchemeResponder,
    http::{Request, Response, StatusCode, header},
};

use crate::{
    error::{AppError, AppResult},
    imaging,
    library::has_image_ext,
    state::AppState,
};

/// Longest edge in pixels. The grid's largest tile is 280 CSS px, so this
/// stays sharp on a 2x (Retina) display.
const THUMB_MAX: u32 = 560;

/// JPEG quality of full-size previews: high, since this is what the viewer shows.
const PREVIEW_QUALITY: u8 = 90;

struct Thumb {
    bytes: Vec<u8>,
    mime: &'static str,
}

/// What a request is for.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Kind {
    Thumb,
    Preview,
}

/// Registered in lib.rs with `register_asynchronous_uri_scheme_protocol`.
/// "Asynchronous" means we get a `responder` and can answer later, so slow
/// decodes don't block the webview's other requests.
pub fn handle<R: Runtime>(ctx: UriSchemeContext<'_, R>, req: Request<Vec<u8>>, responder: UriSchemeResponder) {
    serve(ctx, req, responder, Kind::Thumb);
}

/// The `preview://` scheme (full size). Same checks, permits and cache as thumbnails.
pub fn handle_preview<R: Runtime>(ctx: UriSchemeContext<'_, R>, req: Request<Vec<u8>>, responder: UriSchemeResponder) {
    serve(ctx, req, responder, Kind::Preview);
}

fn serve<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    req: Request<Vec<u8>>,
    responder: UriSchemeResponder,
    kind: Kind,
) {
    let app = ctx.app_handle().clone();
    // The path is everything after the leading "/", percent-encoded.
    let raw = req.uri().path().trim_start_matches('/').to_owned();

    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let response = match resolve(&state, &raw) {
            Err(e) => error_response(StatusCode::FORBIDDEN, &e.to_string()),
            Ok(src) => {
                // Wait for a free slot, then decode on the blocking pool.
                let _permit = state.thumb_permits.clone().acquire_owned().await;
                let cache_dir = app
                    .path()
                    .app_cache_dir()
                    .map(|d| d.join("thumbs"))
                    .unwrap_or_else(|_| std::env::temp_dir().join("spektro_photo_thumbs"));

                let result =
                    tauri::async_runtime::spawn_blocking(move || make(&src, &cache_dir, kind))
                        .await;

                match result {
                    Ok(Ok(t)) => Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, t.mime)
                        .body(t.bytes)
                        .unwrap(),
                    Ok(Err(AppError::Io(e))) if e.kind() == std::io::ErrorKind::NotFound => {
                        error_response(StatusCode::NOT_FOUND, "not found")
                    }
                    Ok(Err(e)) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
                    Err(e) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
                }
            }
        };
        responder.respond(response);
    });
}

/// Decode the URL path and check it against the folders the user opened.
/// Without this check, any script in the webview could request thumbnails of
/// any image on disk.
fn resolve(state: &AppState, raw: &str) -> AppResult<PathBuf> {
    let decoded = percent_decode_str(raw)
        .decode_utf8()
        .map_err(|e| AppError::Other(e.to_string()))?;
    let path = PathBuf::from(decoded.as_ref());
    if !has_image_ext(&path) || !state.is_allowed(&path) {
        return Err(AppError::Forbidden(path.to_string_lossy().into_owned()));
    }
    Ok(path)
}

fn make(src: &Path, cache_dir: &Path, kind: Kind) -> AppResult<Thumb> {
    // Cache key = kind + path + size + mtime, so an edited file gets a fresh image.
    // (DefaultHasher can change between Rust versions; that only causes misses.)
    let meta = fs::metadata(src)?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    let mut h = DefaultHasher::new();
    (kind, src, meta.len(), mtime, THUMB_MAX).hash(&mut h);
    let key = format!("{:016x}", h.finish());

    for (ext, mime) in [("jpg", "image/jpeg"), ("png", "image/png")] {
        if let Ok(bytes) = fs::read(cache_dir.join(format!("{key}.{ext}"))) {
            return Ok(Thumb { bytes, mime });
        }
    }

    let mut bytes = Vec::new();
    let (ext, mime) = match kind {
        Kind::Thumb => {
            // Decoded upright and at most THUMB_MAX on the longest edge
            // (`thumbnail` is a fast resize that never upscales).
            let small = imaging::open_scaled(src, THUMB_MAX)?;
            // JPEG is much smaller, but has no transparency; keep PNG for images with alpha.
            if small.color().has_alpha() {
                small.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)?;
                ("png", "image/png")
            } else {
                JpegEncoder::new_with_quality(&mut bytes, 82).encode_image(&small.to_rgb8())?;
                ("jpg", "image/jpeg")
            }
        }
        Kind::Preview => {
            // Full size, so the viewer's 100% zoom and the editor's crop
            // coordinates match the real pixels.
            let loaded = imaging::open_oriented(src)?;
            encode_preview(&loaded.image, loaded.icc_profile.as_deref(), &mut bytes)?
        }
    };

    // Best effort: a failed cache write just means we regenerate next time.
    // Write to a temp name, then rename, so a half-written file is never read.
    if fs::create_dir_all(cache_dir).is_ok() {
        let tmp = cache_dir.join(format!("{key}.{ext}.tmp"));
        if fs::write(&tmp, &bytes).is_ok() {
            let _ = fs::rename(&tmp, cache_dir.join(format!("{key}.{ext}")));
        }
    }

    Ok(Thumb { bytes, mime })
}

/// JPEG (or PNG when there's transparency), with the colour profile embedded
/// so the webview shows wide-gamut photos with the right colours.
fn encode_preview(img: &DynamicImage, icc: Option<&[u8]>, out: &mut Vec<u8>) -> AppResult<(&'static str, &'static str)> {
    if img.color().has_alpha() {
        let mut enc = PngEncoder::new(out);
        if let Some(icc) = icc {
            let _ = enc.set_icc_profile(icc.to_vec());
        }
        DynamicImage::ImageRgba8(img.to_rgba8()).write_with_encoder(enc)?;
        Ok(("png", "image/png"))
    } else {
        let mut enc = JpegEncoder::new_with_quality(out, PREVIEW_QUALITY);
        if let Some(icc) = icc {
            let _ = enc.set_icc_profile(icc.to_vec());
        }
        DynamicImage::ImageRgb8(img.to_rgb8()).write_with_encoder(enc)?;
        Ok(("jpg", "image/jpeg"))
    }
}

fn error_response(status: StatusCode, msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imaging::test_support::{temp_dir, write_jpeg};

    #[test]
    fn previews_and_thumbs_are_cached_separately() {
        let dir = temp_dir("preview");
        let src = dir.join("big.jpg");
        write_jpeg(&src, 1200, 800, "Cam", 1);
        let cache = dir.join("cache");

        let thumb = make(&src, &cache, Kind::Thumb).unwrap();
        let full = make(&src, &cache, Kind::Preview).unwrap();
        assert_eq!(image::load_from_memory(&thumb.bytes).unwrap().width(), THUMB_MAX);
        let full_img = image::load_from_memory(&full.bytes).unwrap();
        assert_eq!((full_img.width(), full_img.height()), (1200, 800), "full size");
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 2);

        // Second request comes from the cache, byte for byte.
        assert_eq!(make(&src, &cache, Kind::Preview).unwrap().bytes, full.bytes);
    }

    #[test]
    fn preview_keeps_the_colour_profile() {
        let mut out = Vec::new();
        let icc = b"not-a-real-profile-but-kept-as-is".to_vec();
        encode_preview(&DynamicImage::new_rgb8(8, 8), Some(&icc), &mut out).unwrap();
        let mut dec = image::codecs::jpeg::JpegDecoder::new(std::io::Cursor::new(&out)).unwrap();
        use image::ImageDecoder;
        assert_eq!(dec.icc_profile().unwrap(), Some(icc));
    }
}

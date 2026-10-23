//! The `thumb://` custom protocol: like Tauri's asset protocol, except instead
//! of serving the file as-is it decodes, resizes and caches a small preview.
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

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, codecs::jpeg::JpegEncoder};
use percent_encoding::percent_decode_str;
use tauri::{
    Manager, Runtime, UriSchemeContext, UriSchemeResponder,
    http::{Request, Response, StatusCode, header},
};

use crate::{
    error::{AppError, AppResult},
    library::has_image_ext,
    state::AppState,
};

/// Longest edge in pixels. The grid's largest tile is 280 CSS px, so this
/// stays sharp on a 2x (Retina) display.
const THUMB_MAX: u32 = 560;

struct Thumb {
    bytes: Vec<u8>,
    mime: &'static str,
}

/// Registered in lib.rs with `register_asynchronous_uri_scheme_protocol`.
/// "Asynchronous" means we get a `responder` and can answer later, so slow
/// decodes don't block the webview's other requests.
pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    req: Request<Vec<u8>>,
    responder: UriSchemeResponder,
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
                    .unwrap_or_else(|_| std::env::temp_dir().join("image_viewer_thumbs"));

                let result =
                    tauri::async_runtime::spawn_blocking(move || make_thumb(&src, &cache_dir))
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

fn make_thumb(src: &Path, cache_dir: &Path) -> AppResult<Thumb> {
    // Cache key = path + size + mtime, so an edited file gets a fresh thumbnail.
    // (DefaultHasher can change between Rust versions; that only causes misses.)
    let meta = fs::metadata(src)?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    let mut h = DefaultHasher::new();
    (src, meta.len(), mtime, THUMB_MAX).hash(&mut h);
    let key = format!("{:016x}", h.finish());

    for (ext, mime) in [("jpg", "image/jpeg"), ("png", "image/png")] {
        if let Ok(bytes) = fs::read(cache_dir.join(format!("{key}.{ext}"))) {
            return Ok(Thumb { bytes, mime });
        }
    }

    // Decode, honouring EXIF orientation so portrait photos aren't sideways.
    let mut decoder = ImageReader::open(src)?.with_guessed_format()?.into_decoder()?;
    let orientation = decoder.orientation()?;
    let mut img = DynamicImage::from_decoder(decoder)?;
    img.apply_orientation(orientation);

    // `thumbnail` is a fast resize that keeps aspect ratio and never upscales
    // past THUMB_MAX on the longest edge.
    let small = img.thumbnail(THUMB_MAX, THUMB_MAX);

    // JPEG is much smaller, but has no transparency; keep PNG for images with alpha.
    let mut bytes = Vec::new();
    let (ext, mime) = if small.color().has_alpha() {
        small.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)?;
        ("png", "image/png")
    } else {
        JpegEncoder::new_with_quality(&mut bytes, 82).encode_image(&small.to_rgb8())?;
        ("jpg", "image/jpeg")
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

fn error_response(status: StatusCode, msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

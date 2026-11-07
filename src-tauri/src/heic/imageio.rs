//! The macOS half of HEIC support: Apple's ImageIO + CoreGraphics through the
//! objc2 bindings.
//!
//! ImageIO's "thumbnail" call is also its decode-and-rotate call: with
//! `CreateThumbnailWithTransform` it applies the photo's orientation, and with
//! `ThumbnailMaxPixelSize` set to the full size it returns a full-resolution
//! image. We then draw that `CGImage` into a plain RGBA buffer we own and hand
//! it to the `image` crate like any other decoded picture.

use std::path::Path;

use image::{DynamicImage, RgbImage, RgbaImage};
use objc2_core_foundation::{
    CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType, CFURL, CGPoint, CGRect, CGSize,
};
use objc2_core_graphics::{
    CGBitmapContextCreate, CGBitmapInfo, CGColorSpace, CGColorSpaceModel, CGContext, CGImage,
    CGImageAlphaInfo, kCGColorSpaceSRGB,
};
use objc2_image_io::{
    CGImageSource, kCGImagePropertyOrientation, kCGImagePropertyPixelHeight,
    kCGImagePropertyPixelWidth, kCGImageSourceCreateThumbnailFromImageAlways,
    kCGImageSourceCreateThumbnailWithTransform, kCGImageSourceShouldCacheImmediately,
    kCGImageSourceThumbnailMaxPixelSize,
};

use super::Decoded;
use crate::error::{AppError, AppResult};

fn fail(what: &str, path: &Path) -> AppError {
    AppError::Other(format!("Could not {what} {}", path.display()))
}

fn open_source(path: &Path) -> AppResult<CFRetained<CGImageSource>> {
    let url = CFURL::from_file_path(path).ok_or_else(|| fail("open", path))?;
    // SAFETY: no options dictionary is passed.
    unsafe { CGImageSource::with_url(&url, None) }.ok_or_else(|| fail("read", path))
}

/// Stored width, height and EXIF-style orientation (1–8) of the first image.
fn stored_size(src: &CGImageSource, path: &Path) -> AppResult<(u32, u32, i64)> {
    // SAFETY: no options dictionary is passed.
    let props = unsafe { src.properties_at_index(0, None) }.ok_or_else(|| fail("read", path))?;
    // SAFETY: ImageIO's properties dictionary has CFString keys and CFType values.
    let props = unsafe { CFRetained::cast_unchecked::<CFDictionary<CFString, CFType>>(props) };
    let number = |key: &CFString| {
        props
            .get(key)
            .and_then(|v| v.downcast_ref::<CFNumber>().and_then(|n| n.as_i64()))
    };
    // SAFETY: reading constant CFStrings exported by ImageIO.
    let (w, h, orientation) = unsafe {
        (
            number(kCGImagePropertyPixelWidth),
            number(kCGImagePropertyPixelHeight),
            number(kCGImagePropertyOrientation),
        )
    };
    match (w, h) {
        (Some(w), Some(h)) if w > 0 && h > 0 => Ok((w as u32, h as u32, orientation.unwrap_or(1))),
        _ => Err(fail("read the size of", path)),
    }
}

/// Displayed size (after rotation) from the header, without decoding pixels.
pub fn dimensions(path: &Path) -> AppResult<(u32, u32)> {
    let src = open_source(path)?;
    let (w, h, orientation) = stored_size(&src, path)?;
    // Orientations 5–8 are rotated by 90°, so width and height swap on screen.
    Ok(if (5..=8).contains(&orientation) { (h, w) } else { (w, h) })
}

pub fn decode(path: &Path, max_size: Option<u32>) -> AppResult<Decoded> {
    let src = open_source(path)?;
    let (w, h, _) = stored_size(&src, path)?;
    let longest = w.max(h);
    let target = max_size.map_or(longest, |m| m.clamp(1, longest));

    let yes: &CFType = CFBoolean::new(true);
    let size = CFNumber::new_i64(i64::from(target));
    // SAFETY: reading constant CFStrings exported by ImageIO.
    let keys: [&CFString; 4] = unsafe {
        [
            kCGImageSourceCreateThumbnailFromImageAlways, // decode the real image, not an embedded preview
            kCGImageSourceCreateThumbnailWithTransform,   // apply the orientation
            kCGImageSourceShouldCacheImmediately,         // decode now, on this blocking thread
            kCGImageSourceThumbnailMaxPixelSize,
        ]
    };
    let values: [&CFType; 4] = [yes, yes, yes, &size];
    let options = CFDictionary::<CFString, CFType>::from_slices(&keys, &values);
    let options: &CFDictionary = (*options).as_ref();

    // SAFETY: the options dictionary uses ImageIO's documented keys and value types.
    let image = unsafe { src.thumbnail_at_index(0, Some(options)) }.ok_or_else(|| fail("decode", path))?;
    rasterize(&image, path)
}

/// Draws a CGImage into an 8-bit buffer we own.
fn rasterize(image: &CGImage, path: &Path) -> AppResult<Decoded> {
    let (w, h) = (CGImage::width(Some(image)), CGImage::height(Some(image)));
    if w == 0 || h == 0 {
        return Err(fail("decode", path));
    }
    let alpha = CGImage::alpha_info(Some(image));
    let opaque = [CGImageAlphaInfo::None, CGImageAlphaInfo::NoneSkipFirst, CGImageAlphaInfo::NoneSkipLast]
        .contains(&alpha);

    // Keep the photo's own RGB colour space (usually Display P3) and its ICC
    // profile, so an edited copy keeps its colours. Anything else (grey,
    // HDR spaces without a profile) is drawn into sRGB.
    let own = CGImage::color_space(Some(image))
        .filter(|cs| CGColorSpace::model(Some(&**cs)) == CGColorSpaceModel::RGB)
        .and_then(|cs| CGColorSpace::icc_data(Some(&*cs)).map(|icc| (cs, icc.to_vec())));
    let (space, icc_profile) = match own {
        Some((cs, icc)) => (cs, Some(icc)),
        None => {
            // SAFETY: reading a constant CFString exported by CoreGraphics.
            let srgb = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }));
            (srgb.ok_or_else(|| fail("decode", path))?, None)
        }
    };

    let layout = if opaque { CGImageAlphaInfo::NoneSkipLast } else { CGImageAlphaInfo::PremultipliedLast };
    let bitmap_info = layout.0 | CGBitmapInfo::ByteOrder32Big.0; // bytes in memory: R, G, B, A
    let mut buf = vec![0u8; w * h * 4];
    {
        // SAFETY: `buf` holds exactly h rows of w*4 bytes (8-bit RGBA) and
        // outlives the context, which is dropped at the end of this block.
        let ctx = unsafe {
            CGBitmapContextCreate(buf.as_mut_ptr().cast(), w, h, 8, w * 4, Some(&*space), bitmap_info)
        }
        .ok_or_else(|| fail("decode", path))?;
        let rect = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(w as f64, h as f64));
        CGContext::draw_image(Some(&*ctx), rect, Some(image));
    }

    let (w32, h32) = (w as u32, h as u32);
    let image = if opaque {
        let rgb: Vec<u8> = buf.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect();
        RgbImage::from_raw(w32, h32, rgb).map(DynamicImage::ImageRgb8)
    } else {
        // CoreGraphics only draws premultiplied alpha; the image crate expects straight alpha.
        for px in buf.chunks_exact_mut(4) {
            let a = u32::from(px[3]);
            if a > 0 && a < 255 {
                for c in &mut px[..3] {
                    *c = ((u32::from(*c) * 255 + a / 2) / a).min(255) as u8;
                }
            }
        }
        RgbaImage::from_raw(w32, h32, buf).map(DynamicImage::ImageRgba8)
    };
    Ok(Decoded { image: image.ok_or_else(|| fail("decode", path))?, icc_profile })
}

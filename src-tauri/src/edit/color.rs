//! Colour matrices: the shared machinery behind brightness, contrast,
//! saturation and temperature (see `adjust.rs`).
//!
//! Each of those adjustments is an *affine* map on a pixel's (r, g, b) values,
//! so it can be written as a 3×4 matrix (3×3 plus an offset column). Two such
//! maps compose into one, so any number of adjustments costs a single pass
//! over the pixels, with a single clamp at the end.
//!
//! The frontend builds the very same matrix (`src/edit/colorMatrix.ts`) and
//! hands it to an SVG `<feColorMatrix>` for the live preview. Keeping the maths
//! identical on both sides is what makes the preview match the saved file.
//! Values are normalised to 0.0–1.0 and work on the stored (gamma-encoded)
//! values, which is also what the SVG filter does with
//! `color-interpolation-filters="sRGB"`. Alpha is never changed.

use image::DynamicImage;

/// Row `i` gives output channel `i` (R, G, B): `[r, g, b, offset]`.
pub type ColorMatrix = [[f32; 4]; 3];

pub const IDENTITY: ColorMatrix = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]];

/// `then ∘ first`: the matrix that applies `first`, then `then`.
pub fn compose(then: &ColorMatrix, first: &ColorMatrix) -> ColorMatrix {
    std::array::from_fn(|i| {
        std::array::from_fn(|j| {
            let mixed: f32 = (0..3).map(|k| then[i][k] * first[k][j]).sum();
            // The offset column also gets `then`'s own offset.
            if j == 3 { mixed + then[i][3] } else { mixed }
        })
    })
}

/// A diagonal matrix: multiply each channel, then add `offset` to all three.
pub fn scale(r: f32, g: f32, b: f32, offset: f32) -> ColorMatrix {
    [[r, 0.0, 0.0, offset], [0.0, g, 0.0, offset], [0.0, 0.0, b, offset]]
}

fn apply_px(m: &ColorMatrix, [r, g, b]: [f32; 3]) -> [f32; 3] {
    let row = |i: usize| (m[i][0] * r + m[i][1] * g + m[i][2] * b + m[i][3]).clamp(0.0, 1.0);
    [row(0), row(1), row(2)]
}

/// Runs `m` over interleaved samples (`channels` = 3 for RGB, 4 for RGBA).
fn apply_samples<T: Copy>(
    data: &mut [T],
    channels: usize,
    m: &ColorMatrix,
    to_unit: impl Fn(T) -> f32,
    from_unit: impl Fn(f32) -> T,
) {
    for px in data.chunks_exact_mut(channels) {
        let out = apply_px(m, [to_unit(px[0]), to_unit(px[1]), to_unit(px[2])]);
        for (dst, v) in px.iter_mut().zip(out) {
            *dst = from_unit(v);
        }
    }
}

/// Applies `m` to every pixel, keeping 16-bit and float images at their depth.
/// Greyscale images become RGB, because the result may no longer be grey.
pub fn apply(image: DynamicImage, m: &ColorMatrix) -> DynamicImage {
    use DynamicImage as D;
    if *m == IDENTITY {
        return image;
    }
    let u8_in = |v: u8| f32::from(v) / 255.0;
    let u8_out = |v: f32| (v * 255.0).round() as u8;
    let u16_in = |v: u16| f32::from(v) / 65535.0;
    let u16_out = |v: f32| (v * 65535.0).round() as u16;
    let f_in = |v: f32| v;
    let f_out = |v: f32| v;

    match image {
        D::ImageRgb8(mut b) => {
            apply_samples(&mut b, 3, m, u8_in, u8_out);
            D::ImageRgb8(b)
        }
        D::ImageRgba8(mut b) => {
            apply_samples(&mut b, 4, m, u8_in, u8_out);
            D::ImageRgba8(b)
        }
        D::ImageRgb16(mut b) => {
            apply_samples(&mut b, 3, m, u16_in, u16_out);
            D::ImageRgb16(b)
        }
        D::ImageRgba16(mut b) => {
            apply_samples(&mut b, 4, m, u16_in, u16_out);
            D::ImageRgba16(b)
        }
        D::ImageRgb32F(mut b) => {
            apply_samples(&mut b, 3, m, f_in, f_out);
            D::ImageRgb32F(b)
        }
        D::ImageRgba32F(mut b) => {
            apply_samples(&mut b, 4, m, f_in, f_out);
            D::ImageRgba32F(b)
        }
        // Greyscale (and any future layout): convert, then run the matching arm.
        D::ImageLuma16(_) => apply(D::ImageRgb16(image.to_rgb16()), m),
        D::ImageLumaA16(_) => apply(D::ImageRgba16(image.to_rgba16()), m),
        other if other.color().has_alpha() => apply(D::ImageRgba8(other.to_rgba8()), m),
        other => apply(D::ImageRgb8(other.to_rgb8()), m),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GenericImageView, LumaA, Rgb, Rgba};

    #[test]
    fn compose_applies_right_then_left() {
        // Double, then add 0.1  vs  add 0.1, then double.
        let double = scale(2.0, 2.0, 2.0, 0.0);
        let plus = scale(1.0, 1.0, 1.0, 0.1);
        assert_eq!(compose(&plus, &double)[0], [2.0, 0.0, 0.0, 0.1]);
        assert_eq!(compose(&double, &plus)[0], [2.0, 0.0, 0.0, 0.2]);
        assert_eq!(compose(&IDENTITY, &double), double);
    }

    #[test]
    fn applies_and_clamps_without_touching_alpha() {
        let img = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(2, 1, Rgba([100, 200, 50, 77])));
        let out = apply(img, &scale(2.0, 2.0, 1.0, 0.0));
        assert_eq!(out.get_pixel(0, 0), Rgba([200, 255, 50, 77]));
    }

    #[test]
    fn keeps_16_bit_depth_and_promotes_grey() {
        let img = DynamicImage::ImageRgb16(image::ImageBuffer::from_pixel(1, 1, Rgb([1000u16, 2000, 3000])));
        let out = apply(img, &scale(2.0, 1.0, 1.0, 0.0));
        assert_eq!(out.as_rgb16().unwrap().get_pixel(0, 0), &Rgb([2000, 2000, 3000]));

        let grey = DynamicImage::ImageLumaA8(image::ImageBuffer::from_pixel(1, 1, LumaA([100u8, 9])));
        let out = apply(grey, &scale(1.0, 1.0, 0.5, 0.0));
        assert_eq!(out.as_rgba8().unwrap().get_pixel(0, 0), &Rgba([100, 100, 50, 9]));
    }

    #[test]
    fn identity_returns_the_image_unchanged() {
        let grey = DynamicImage::new_luma8(3, 3);
        assert!(matches!(apply(grey, &IDENTITY), DynamicImage::ImageLuma8(_)));
    }
}

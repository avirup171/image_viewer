//! Brightness, contrast, saturation and colour temperature.
//!
//! One `Adjust` operation carries all four slider values (each -100…100,
//! 0 = unchanged). Each slider is turned into a colour matrix by its own small
//! function below, the matrices are composed, and the image is processed in a
//! single pass (see `color.rs`).
//!
//! The frontend mirrors this file in `src/edit/tools/adjust/adjustments.ts`.
//! If you change a formula or the order, change it there too, or the preview
//! will no longer match the saved image. The `matches_frontend_matrix` test
//! pins the numbers.
//!
//! ## Adding a slider (e.g. tint)
//! Add a field to `Adjust`, a `fn tint(v) -> ColorMatrix`, and a line in
//! `Adjust::matrix`; then the same three things in `adjustments.ts`.

use image::DynamicImage;
use serde::Deserialize;

use super::{
    Operation,
    color::{self, ColorMatrix, IDENTITY},
};
use crate::error::{AppError, AppResult};

pub const MIN: i32 = -100;
pub const MAX: i32 = 100;

/// Rec. 709 luma weights: how bright each channel looks to the eye.
/// The same weights CSS's `saturate()` uses.
const LUMA: [f32; 3] = [0.2126, 0.7152, 0.0722];

/// How strongly temperature ±100 scales red and blue (±20 %).
const TEMPERATURE_STRENGTH: f32 = 0.2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(default)]
pub struct Adjust {
    pub brightness: i32,
    pub contrast: i32,
    pub saturation: i32,
    pub temperature: i32,
}

/// -100…100 → 0.5…2.0 (one photographic stop either way).
fn stops(v: i32) -> f32 {
    2f32.powf(v as f32 / 100.0)
}

/// Multiply every channel: -100 halves the values, +100 doubles them.
fn brightness(v: i32) -> ColorMatrix {
    let k = stops(v);
    color::scale(k, k, k, 0.0)
}

/// Stretch values away from mid-grey (0.5), or squeeze them towards it.
fn contrast(v: i32) -> ColorMatrix {
    let k = stops(v);
    color::scale(k, k, k, 0.5 * (1.0 - k))
}

/// Blend between the pixel's own grey (its luma) and its colour:
/// -100 = black and white, +100 = twice as colourful.
fn saturation(v: i32) -> ColorMatrix {
    let s = 1.0 + v as f32 / 100.0;
    let mut m = IDENTITY;
    for (i, row) in m.iter_mut().enumerate() {
        for (j, cell) in row.iter_mut().take(3).enumerate() {
            *cell = LUMA[j] * (1.0 - s) + if i == j { s } else { 0.0 };
        }
    }
    m
}

/// Warmer (positive) boosts red and cuts blue; cooler does the opposite.
fn temperature(v: i32) -> ColorMatrix {
    let t = TEMPERATURE_STRENGTH * v as f32 / 100.0;
    color::scale(1.0 + t, 1.0, 1.0 - t, 0.0)
}

impl Adjust {
    /// All sliders as one matrix. Applied in this order: white balance first
    /// (like a camera), then brightness, contrast, and saturation last.
    pub fn matrix(&self) -> ColorMatrix {
        [
            temperature(self.temperature),
            brightness(self.brightness),
            contrast(self.contrast),
            saturation(self.saturation),
        ]
        .iter()
        .fold(IDENTITY, |acc, next| color::compose(next, &acc))
    }

    fn validate(&self) -> AppResult<()> {
        let fields = [
            ("Brightness", self.brightness),
            ("Contrast", self.contrast),
            ("Saturation", self.saturation),
            ("Temperature", self.temperature),
        ];
        for (name, v) in fields {
            if !(MIN..=MAX).contains(&v) {
                return Err(AppError::InvalidEdit(format!("{name} must be between {MIN} and {MAX} (got {v})")));
            }
        }
        Ok(())
    }
}

impl Operation for Adjust {
    fn apply(&self, image: DynamicImage) -> AppResult<DynamicImage> {
        self.validate()?;
        Ok(color::apply(image, &self.matrix()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GenericImageView, Rgb, RgbImage};

    fn one_px(rgb: [u8; 3], adjust: Adjust) -> [u8; 3] {
        let img = DynamicImage::ImageRgb8(RgbImage::from_pixel(1, 1, Rgb(rgb)));
        let p = adjust.apply(img).unwrap().get_pixel(0, 0).0;
        [p[0], p[1], p[2]]
    }

    fn close(a: &ColorMatrix, b: &ColorMatrix) -> bool {
        a.iter().flatten().zip(b.iter().flatten()).all(|(x, y)| (x - y).abs() < 1e-5)
    }

    #[test]
    fn zero_is_identity() {
        assert!(close(&Adjust::default().matrix(), &IDENTITY));
        assert_eq!(one_px([10, 120, 250], Adjust::default()), [10, 120, 250]);
    }

    #[test]
    fn each_slider_does_what_it_says() {
        let px = [100, 150, 200];
        assert_eq!(one_px(px, Adjust { brightness: 100, ..Default::default() }), [200, 255, 255]);
        assert_eq!(one_px(px, Adjust { brightness: -100, ..Default::default() }), [50, 75, 100]);
        // Contrast pivots on mid-grey: -100 halves each value's distance from it.
        assert_eq!(one_px([128, 128, 128], Adjust { contrast: -100, ..Default::default() }), [128, 128, 128]);
        assert_eq!(one_px(px, Adjust { contrast: -100, ..Default::default() }), [114, 139, 164]);
        // -100 saturation = luma grey: 0.2126·100 + 0.7152·150 + 0.0722·200 ≈ 143.
        assert_eq!(one_px(px, Adjust { saturation: -100, ..Default::default() }), [143, 143, 143]);
        let warm = one_px(px, Adjust { temperature: 50, ..Default::default() });
        assert_eq!(warm, [110, 150, 180]);
        let cool = one_px(px, Adjust { temperature: -50, ..Default::default() });
        assert_eq!(cool, [90, 150, 220]);
    }

    /// The exact numbers `adjustments.ts` produces for these values (checked
    /// by running the TS code). If this fails, the preview and the saved file
    /// have drifted apart.
    #[test]
    fn matches_frontend_matrix() {
        let m = Adjust { brightness: 20, contrast: -30, saturation: 40, temperature: 25 }.matrix();
        let expected: ColorMatrix = [
            [1.288_246, -0.266_922, -0.025_599, 0.093_874],
            [-0.083_312, 1.039_324, -0.025_599, 0.093_874],
            [-0.083_312, -0.266_922, 1.215_335, 0.093_874],
        ];
        assert!(close(&m, &expected), "{m:?}");
    }

    #[test]
    fn rejects_out_of_range_values() {
        let img = DynamicImage::new_rgb8(1, 1);
        let bad = Adjust { contrast: 101, ..Default::default() };
        assert!(matches!(bad.apply(img), Err(AppError::InvalidEdit(_))));
    }
}

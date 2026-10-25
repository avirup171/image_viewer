use image::DynamicImage;
use serde::Deserialize;

use super::Operation;
use crate::error::{AppError, AppResult};

/// A rectangle in the image's *displayed* pixel space (after EXIF rotation),
/// which is what the frontend measures against.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct Crop {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl Operation for Crop {
    fn apply(&self, image: DynamicImage) -> AppResult<DynamicImage> {
        let (w, h) = (image.width(), image.height());
        // checked_add: a malicious or buggy x + width can't overflow past the check.
        let fits = |start: u32, len: u32, max: u32| start.checked_add(len).is_some_and(|end| end <= max);

        if self.width == 0 || self.height == 0 {
            return Err(AppError::InvalidEdit("The crop area is empty".into()));
        }
        if !fits(self.x, self.width, w) || !fits(self.y, self.height, h) {
            return Err(AppError::InvalidEdit(format!(
                "The crop area ({}×{} at {},{}) is outside the {w}×{h} image",
                self.width, self.height, self.x, self.y
            )));
        }
        Ok(image.crop_imm(self.x, self.y, self.width, self.height))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GenericImageView, Rgb, RgbImage};

    #[test]
    fn crops_the_requested_pixels() {
        // Each pixel encodes its own coordinates, so we can check exactly what we got.
        let img = DynamicImage::ImageRgb8(RgbImage::from_fn(50, 40, |x, y| Rgb([x as u8, y as u8, 0])));
        let out = Crop { x: 10, y: 5, width: 20, height: 15 }.apply(img).unwrap();
        assert_eq!(out.dimensions(), (20, 15));
        assert_eq!(out.get_pixel(0, 0).0[..2], [10, 5]);
        assert_eq!(out.get_pixel(19, 14).0[..2], [29, 19]);
    }

    #[test]
    fn full_image_crop_is_allowed() {
        let img = DynamicImage::new_rgb8(50, 40);
        assert!(Crop { x: 0, y: 0, width: 50, height: 40 }.apply(img).is_ok());
    }

    #[test]
    fn rejects_empty_out_of_bounds_and_overflowing_crops() {
        let cases = [
            Crop { x: 0, y: 0, width: 0, height: 10 },
            Crop { x: 41, y: 0, width: 10, height: 10 },
            Crop { x: 0, y: 35, width: 10, height: 6 },
            Crop { x: u32::MAX, y: 0, width: 2, height: 2 },
        ];
        for c in cases {
            assert!(c.apply(DynamicImage::new_rgb8(50, 40)).is_err(), "{c:?} should fail");
        }
    }
}

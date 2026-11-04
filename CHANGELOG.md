# Changelog

All notable changes to Image Viewer are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **HEIC / HEIF photos on macOS** (iPhone photos): thumbnails, full-size viewing, zoom, camera details, crop and adjust.
  - Decoded in Rust by Apple's ImageIO framework, so rotation and wide-gamut colour (Display P3) are kept.
  - Edits are saved as a JPEG copy (`name (edited).jpg`), with camera data and colour profile kept. *Replace original* isn't available for HEIC.
  - HEIC files aren't listed on Windows.
- **Remove a folder from the recent list**, in the sidebar and on the welcome screen: click the × that appears on hover, or focus the folder and press <kbd>⌫</kbd>. Only the list entry goes; the folder isn't touched. An Undo toast puts it back.

### Developer
- `src-tauri/src/heic/`: `mod.rs` (format check, EXIF via kamadak-exif, any platform) and `imageio.rs` (macOS decoder through `objc2-image-io` / `objc2-core-graphics`).
- New `preview://` protocol (thumbs.rs) serves a full-size JPEG for formats the webview can't show, with the same folder checks and disk cache as `thumb://`.
- `imaging::open_scaled` decodes HEIC thumbnails directly at thumbnail size.
- HEIC test fixture in `src-tauri/test-data/`; decoder tests run on macOS only.

## [0.1.2] - 2026-11-01

### Added
- **Adjust colours.** Press <kbd>A</kbd> in the grid or viewer, click the new adjust button, or switch tabs inside the editor.
  - Temperature, brightness, contrast and saturation sliders (-100 to +100) in a side panel.
  - Live preview that matches the saved file, also shown while cropping, so a crop and an adjustment are saved together.
  - <kbd>Tab</kbd> between sliders, arrow keys to change one (<kbd>Shift</kbd>: 10), double-click to reset one, or *Reset all*.
- Editor shortcuts for switching tools (<kbd>C</kbd> / <kbd>A</kbd>) in the shortcuts sheet.

### Developer
- Colour-matrix pipeline in Rust (`edit/color.rs`) and TypeScript (`src/edit/colorMatrix.ts`), with one `Adjust` operation (`edit/adjust.rs`) mirrored by `tools/adjust/adjustments.ts`. A test pins the matrix both sides must produce.
- Tools can now provide a side `Panel` and a `colorMatrix` for live preview; `EditMode` can open on a given tool.
- 16-bit PNGs keep their bit depth when adjusted; greyscale images become RGB.

## [0.1.1] - 2026-10-26

### Added
- **Crop editor.** Open it with <kbd>C</kbd> or the crop button in the viewer.
  - Draggable crop box with corner and edge handles; drag outside the box to draw a new one.
  - Aspect presets: Free, Original, 1:1, 4:3, 3:2, 16:9, with a portrait / landscape switch.
  - Arrow keys nudge the box by 1 px (<kbd>Shift</kbd>: 10 px).
  - **Save as copy** (<kbd>⌘</kbd><kbd>S</kbd>) writes `name (edited).ext` beside the original, then `(edited 2)` and so on.
  - **Replace original** asks for confirmation, then moves the original to the Trash so it can be restored.
- Edited images keep their EXIF metadata (camera, lens, date taken…) and colour profile.
- Editor shortcuts in the keyboard shortcuts sheet (<kbd>?</kbd>).
- MIT license.

### Changed
- Photos stored sideways (EXIF orientation) are cropped as displayed, then saved upright with the orientation flag reset.
- Images and thumbnails reload automatically after a file is replaced by an edit.
- File modification times are tracked in milliseconds instead of seconds.
- Thumbnails and editing share one image loader in Rust.

### Developer
- New modular edit pipeline: an `Operation` trait and `EditOp` enum in Rust (`src-tauri/src/edit/`), and a tool registry in the frontend (`src/edit/`). The README's "Adding an edit tool" section explains how to add one.
- Rust unit tests for cropping, EXIF orientation, metadata preservation, file naming, and the save-as-copy and replace paths (`cargo test`).

### Known limitations
- Animated GIFs can't be edited (saving would keep only the first frame).
- JPEGs are re-encoded at quality 92; WebP is saved losslessly, so files may grow.

## [0.1.0] - 2026-10-23

First release.

### Added
- Open a folder or an image from the dialog, by drag and drop, or from recent folders.
- Thumbnail grid with adjustable size, filtering by name, and sorting by name, date or size. Thumbnails are generated in Rust and cached on disk.
- Viewer with zoom toward the cursor, panning, fit / 100%, view-only rotation, a navigator when zoomed in, and a filmstrip.
- Info panel with file details and camera EXIF.
- Move to Trash with a 5-second Undo.
- Keyboard shortcuts for everything, listed with <kbd>?</kbd>.
- Remembers window size, thumbnail size, sort order and recent folders.
- Installers for macOS (Apple Silicon, `.dmg`) and Windows (`.msi` and `-setup.exe`), built by GitHub Actions.

[Unreleased]: https://github.com/avirup171/image_viewer/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/avirup171/image_viewer/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/avirup171/image_viewer/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/avirup171/image_viewer/releases/tag/v0.1.0

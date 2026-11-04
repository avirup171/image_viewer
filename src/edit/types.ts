// Shapes shared with the Rust side (src-tauri/src/edit). Keep them in sync:
// each EditOp variant here matches a variant of the Rust `EditOp` enum.
import type { ImageEntry } from "../lib/api";

export type CropOp = { type: "crop"; x: number; y: number; width: number; height: number };

/** Each slider is -100…100, 0 = unchanged. Rust: edit/adjust.rs. */
export type AdjustOp = {
  type: "adjust";
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
};

/** Every operation the backend understands. Add new tools' ops to this union. */
export type EditOp = CropOp | AdjustOp;

/** "newFile" keeps the original; "replace" moves the original to the Trash. */
export type SaveMode = "newFile" | "replace";

export type EditResult = { entry: ImageEntry; replaced: boolean };

export type Size = { width: number; height: number };

/**
 * Formats the backend can edit (no animated GIFs). HEIC (macOS) is edited too,
 * but always saved as a JPEG copy: see `isHeic` in lib/api.ts.
 */
export const canEdit = (entry: ImageEntry) => /\.(jpe?g|png|webp|bmp|heic|heif)$/i.test(entry.name);

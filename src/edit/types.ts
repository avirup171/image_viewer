// Shapes shared with the Rust side (src-tauri/src/edit). Keep them in sync:
// each EditOp variant here matches a variant of the Rust `EditOp` enum.
import type { ImageEntry } from "../lib/api";

export type CropOp = { type: "crop"; x: number; y: number; width: number; height: number };

/** Every operation the backend understands. Add new tools' ops to this union. */
export type EditOp = CropOp;

/** "newFile" keeps the original; "replace" moves the original to the Trash. */
export type SaveMode = "newFile" | "replace";

export type EditResult = { entry: ImageEntry; replaced: boolean };

export type Size = { width: number; height: number };

/** Formats the backend can edit and save without losing anything (no animated GIFs). */
export const canEdit = (entry: ImageEntry) => /\.(jpe?g|png|webp|bmp)$/i.test(entry.name);

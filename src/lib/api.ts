// Typed wrappers around the Rust commands and protocols. Keeping every
// `invoke` in one file means the TS types and the Rust structs are easy to
// compare when one of them changes.
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type { EditOp, EditResult, SaveMode } from "../edit/types";

/** `modified` is milliseconds since 1970. */
export type ImageEntry = { path: string; name: string; size: number; modified: number };

export type Folder = {
  dir: string;
  name: string;
  parent_name: string | null;
  images: ImageEntry[];
  /** Set when a single file was opened, so we can select it. */
  selected: string | null;
};

export type MetaField = { label: string; value: string };

export type ImageInfo = {
  width: number | null;
  height: number | null;
  format: string | null;
  camera: MetaField[];
};

export const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp"];

/** Open a folder, or an image (opens its folder with that image selected). */
export const openPath = (path: string) => invoke<Folder>("open_path", { path });
export const trashImage = (path: string) => invoke<void>("trash_image", { path });
export const getImageInfo = (path: string) => invoke<ImageInfo>("image_info", { path });
/** Crop (and future edits) in Rust, then save as a copy or replace the original. */
export const applyEdits = (path: string, ops: EditOp[], mode: SaveMode) =>
  invoke<EditResult>("apply_edits", { path, ops, mode });

/**
 * Changes whenever the file does. Added to image URLs as `?v=…` so the webview
 * reloads a file that was replaced in place (Tauri ignores the query string).
 */
export const versionOf = (e: ImageEntry) => `${e.modified}-${e.size}`;

/** Full-size image, served as-is by Tauri's asset protocol. */
export const fullSrc = (e: ImageEntry) => `${convertFileSrc(e.path)}?v=${versionOf(e)}`;
/** Small cached preview, served by our own thumb:// protocol (thumbs.rs). */
export const thumbSrc = (e: ImageEntry) => `${convertFileSrc(e.path, "thumb")}?v=${versionOf(e)}`;

export const isMac = navigator.userAgent.includes("Mac");
export const modKey = isMac ? "⌘" : "Ctrl+";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[u]}`;
}

export function formatDate(unixMillis: number): string {
  if (!unixMillis) return "—";
  return new Date(unixMillis).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

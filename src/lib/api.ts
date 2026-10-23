// Typed wrappers around the Rust commands and protocols. Keeping every
// `invoke` in one file means the TS types and the Rust structs are easy to
// compare when one of them changes.
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

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

/** Full-size image, served as-is by Tauri's asset protocol. */
export const fullSrc = (path: string) => convertFileSrc(path);
/** Small cached preview, served by our own thumb:// protocol (thumbs.rs). */
export const thumbSrc = (path: string) => convertFileSrc(path, "thumb");

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

export function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Pure geometry for the crop box, in image pixels. No React, no DOM, so it's
// easy to reason about (and to unit-test later).
import type { Size } from "../../types";

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export const fullRect = (b: Size): Rect => ({ x: 0, y: 0, w: b.width, h: b.height });

/**
 * Resize (or move) `start` by dragging `handle` by (dx, dy), keeping the box
 * inside the image, at least `min` pixels, and at `ratio` (width / height) if set.
 * The edge or corner opposite the handle stays put.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  b: Size,
  ratio: number | null,
  min: number,
): Rect {
  if (handle === "move") {
    return {
      ...start,
      x: clamp(start.x + dx, 0, b.width - start.w),
      y: clamp(start.y + dy, 0, b.height - start.h),
    };
  }

  const east = handle.includes("e");
  const west = handle.includes("w");
  const south = handle.includes("s");
  const north = handle.includes("n");
  const minW = Math.min(min, b.width);
  const minH = Math.min(min, b.height);
  let left = start.x;
  let right = start.x + start.w;
  let top = start.y;
  let bottom = start.y + start.h;

  if (!ratio) {
    if (east) right = clamp(right + dx, left + minW, b.width);
    if (west) left = clamp(left + dx, 0, right - minW);
    if (south) bottom = clamp(bottom + dy, top + minH, b.height);
    if (north) top = clamp(top + dy, 0, bottom - minH);
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  // Fixed ratio: work out the width, derive the height from it.
  // `lowW`/`highW` bound the width so both sides respect min size and image bounds.
  const lowW = Math.max(minW, minH * ratio);
  const fit = (raw: number, highW: number) => Math.min(Math.max(raw, lowW), highW);

  if ((east || west) && (north || south)) {
    // Corner: the opposite corner is the anchor; follow whichever axis moved more.
    const ax = east ? left : right;
    const ay = south ? top : bottom;
    const rawW = east ? right + dx - ax : ax - (left + dx);
    const rawH = south ? bottom + dy - ay : ay - (top + dy);
    const maxW = east ? b.width - ax : ax;
    const maxH = south ? b.height - ay : ay;
    const w = fit(Math.max(rawW, rawH * ratio), Math.min(maxW, maxH * ratio));
    const h = w / ratio;
    return { x: east ? ax : ax - w, y: south ? ay : ay - h, w, h };
  }

  if (east || west) {
    // Side edge: width follows the pointer, height grows evenly up and down.
    const ax = east ? left : right;
    const cy = start.y + start.h / 2;
    const rawW = east ? right + dx - ax : ax - (left + dx);
    const maxW = east ? b.width - ax : ax;
    const maxH = 2 * Math.min(cy, b.height - cy);
    const w = fit(rawW, Math.min(maxW, maxH * ratio));
    const h = w / ratio;
    return { x: east ? ax : ax - w, y: cy - h / 2, w, h };
  }

  // Top or bottom edge: height follows the pointer, width grows evenly left and right.
  const ay = south ? top : bottom;
  const cx = start.x + start.w / 2;
  const rawH = south ? bottom + dy - ay : ay - (top + dy);
  const maxH = south ? b.height - ay : ay;
  const maxW = 2 * Math.min(cx, b.width - cx);
  const w = fit(rawH * ratio, Math.min(maxW, maxH * ratio));
  const h = w / ratio;
  return { x: cx - w / 2, y: south ? ay : ay - h, w, h };
}

/** A new box dragged out from `anchor` to `p` (any direction). */
export function drawRect(anchor: Point, p: Point, b: Size, ratio: number | null): Rect {
  const px = clamp(p.x, 0, b.width);
  const py = clamp(p.y, 0, b.height);
  const right = px >= anchor.x;
  const down = py >= anchor.y;
  let w = Math.abs(px - anchor.x);
  let h = Math.abs(py - anchor.y);
  if (ratio) {
    const maxW = right ? b.width - anchor.x : anchor.x;
    const maxH = down ? b.height - anchor.y : anchor.y;
    w = Math.min(Math.max(w, h * ratio), maxW, maxH * ratio);
    h = w / ratio;
  }
  return { x: right ? anchor.x : anchor.x - w, y: down ? anchor.y : anchor.y - h, w, h };
}

/** The largest box of `ratio` that fits the image, centred on `around` where possible. */
export function fitRatio(around: Rect, ratio: number, b: Size): Rect {
  const w = Math.min(b.width, b.height * ratio);
  const h = w / ratio;
  const cx = around.x + around.w / 2;
  const cy = around.y + around.h / 2;
  return { x: clamp(cx - w / 2, 0, b.width - w), y: clamp(cy - h / 2, 0, b.height - h), w, h };
}

/** Whole pixels, still inside the image and at least 1×1. This is what gets saved. */
export function roundRect(r: Rect, b: Size): Rect {
  const x = clamp(Math.round(r.x), 0, b.width - 1);
  const y = clamp(Math.round(r.y), 0, b.height - 1);
  return {
    x,
    y,
    w: clamp(Math.round(r.w), 1, b.width - x),
    h: clamp(Math.round(r.h), 1, b.height - y),
  };
}

export function isFullImage(r: Rect, b: Size): boolean {
  const q = roundRect(r, b);
  return q.x === 0 && q.y === 0 && q.w === b.width && q.h === b.height;
}

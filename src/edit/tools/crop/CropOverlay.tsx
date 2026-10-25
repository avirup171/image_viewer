import { useRef, useState, type PointerEvent } from "react";
import type { ToolProps } from "../../tool";
import { drawRect, resizeRect, type Handle, type Point, type Rect } from "./cropMath";
import { ratioOf, type CropState } from "./cropState";

/** Smallest box, in screen pixels, so handles never overlap. */
const MIN_SCREEN_PX = 24;
const HANDLES: Exclude<Handle, "move">[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

type Drag = { handle: Handle | "draw"; start: Rect; origin: Point };

/**
 * The crop box over the image: drag inside to move, drag a handle to resize,
 * drag on the darkened area to draw a new box.
 */
export function CropOverlay({ state, setState, image, scale }: ToolProps<CropState>) {
  const layerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const ratio = ratioOf(state, image);
  const min = Math.max(1, MIN_SCREEN_PX / scale);

  // Screen position → image pixels.
  const toImage = (e: PointerEvent): Point => {
    const r = layerRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined;
    drag.current = { handle: handle ?? "draw", start: state.rect, origin: toImage(e) };
    // Capture so the drag keeps working when the pointer leaves the image.
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toImage(e);
    const rect =
      d.handle === "draw"
        ? drawRect(d.origin, p, image, ratio)
        : resizeRect(d.start, d.handle, p.x - d.origin.x, p.y - d.origin.y, image, ratio, min);
    setState((s) => ({ ...s, rect }));
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    // A click (or tiny drag) on the dark area shouldn't collapse the box.
    if (d?.handle === "draw") {
      setState((s) => (s.rect.w < min || s.rect.h < min ? { ...s, rect: d.start } : s));
    }
  };

  const r = state.rect;
  return (
    <div
      ref={layerRef}
      className={"crop-layer" + (dragging ? " dragging" : "")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Dims everything outside the box. Clipped separately from the box so
          the handles aren't cut off at the image edge. */}
      <div className="crop-dim" aria-hidden="true">
        <div className="crop-hole" style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale }} />
      </div>
      <div
        className="crop-box"
        data-handle="move"
        aria-label="Crop area. Drag to move, or use the arrow keys."
        style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale }}
      >
        <div className="crop-grid" aria-hidden="true">
          <span className="v1" />
          <span className="v2" />
          <span className="h1" />
          <span className="h2" />
        </div>
        {HANDLES.map((h) => (
          <div key={h} className={`crop-handle h-${h}`} data-handle={h} aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}

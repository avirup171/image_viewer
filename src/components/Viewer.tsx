import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type MouseEvent } from "react";
import { fullSrc, thumbSrc, type ImageEntry } from "../lib/api";
import { useImageInfo } from "../lib/useImageInfo";
import { InfoPanel } from "./InfoPanel";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExitFullscreenIcon,
  FullscreenIcon,
  GridIcon,
  InfoIcon,
  RotateIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "./Icons";

const MAX_ZOOM = 8;
const STEP = 1.25;
const FIT_PAD = 24;
let hintShown = false; // show the zoom hint once per app session

type Props = {
  images: ImageEntry[];
  index: number;
  dir: string;
  onIndex: (i: number) => void;
  onClose: () => void;
  infoOpen: boolean;
  onToggleInfo: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onTrash: (entry: ImageEntry) => void;
  onReveal: (path: string) => void;
  onCopyPath: (path: string) => void;
  keysDisabled: boolean;
};

type Point = { x: number; y: number };

/** Per-image view state. `zoom: null` means "fit to window". */
type ViewState = {
  path: string;
  natural: { w: number; h: number } | null;
  failed: boolean;
  zoom: number | null;
  offset: Point; // image centre relative to stage centre, in screen px
  rotation: number; // degrees, multiple of 90
};

const fresh = (path: string): ViewState => ({
  path,
  natural: null,
  failed: false,
  zoom: null,
  offset: { x: 0, y: 0 },
  rotation: 0,
});

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function Viewer(p: Props) {
  const entry = p.images[p.index];
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [hint, setHint] = useState(!hintShown);

  // Reset zoom/rotation when the image changes. Adjusting state during render
  // (instead of in an effect) avoids one frame drawn with the old image's size.
  const [vs, setVs] = useState(() => fresh(entry.path));
  if (vs.path !== entry.path) setVs(fresh(entry.path));
  const v = vs.path === entry.path ? vs : fresh(entry.path);

  const info = useImageInfo(p.infoOpen ? entry.path : null);

  // Track the stage size (it changes with the window and the info panel).
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- geometry ----------------------------------------------------------
  const rot = ((v.rotation % 360) + 360) % 360;
  const sideways = rot === 90 || rot === 270;
  const nw = v.natural?.w ?? 0;
  const nh = v.natural?.h ?? 0;
  const boxW = sideways ? nh : nw; // bounding box after rotation
  const boxH = sideways ? nw : nh;
  // "Fit" leaves a FIT_PAD margin so the photo doesn't touch the chrome, and
  // never upscales small images past 100%.
  const fit =
    v.natural && stage.w > 0
      ? Math.max(0.01, Math.min((stage.w - 2 * FIT_PAD) / boxW, (stage.h - 2 * FIT_PAD) / boxH, 1))
      : 1;
  const scale = v.zoom ?? fit;
  const off = v.zoom === null ? { x: 0, y: 0 } : v.offset;

  /** Zoom to `target`, keeping the image point under `at` fixed on screen. */
  function zoomTo(target: number, at: Point = { x: 0, y: 0 }) {
    if (!v.natural) return;
    const next = Math.min(Math.max(target, fit), MAX_ZOOM);
    if (next <= fit + 1e-6) {
      setVs((s) => ({ ...s, zoom: null, offset: { x: 0, y: 0 } }));
      return;
    }
    const k = next / scale;
    setVs((s) => ({
      ...s,
      zoom: next,
      offset: { x: at.x - (at.x - off.x) * k, y: at.y - (at.y - off.y) * k },
    }));
  }
  const fitOr100 = () => (v.zoom === null ? zoomTo(fit < 1 ? 1 : 2) : zoomTo(0));
  const rotate = (deg: number) => setVs((s) => ({ ...s, rotation: s.rotation + deg, zoom: null, offset: { x: 0, y: 0 } }));

  function stagePoint(clientX: number, clientY: number): Point {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  }

  // ---- wheel zoom (native listener: React's onWheel is passive, so it can't
  //      preventDefault). The ref always points at this render's handler. ----
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e) => {
    e.preventDefault();
    // Trackpad pinch arrives as wheel + ctrlKey with small deltas.
    const speed = e.ctrlKey ? 0.01 : 0.002;
    zoomTo(scale * Math.exp(-e.deltaY * speed), stagePoint(e.clientX, e.clientY));
  };
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  // ---- drag to pan --------------------------------------------------------
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (v.zoom === null || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setVs((s) => ({ ...s, offset: { x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y } }));
  };
  const endDrag = () => (drag.current = null);
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    const at = stagePoint(e.clientX, e.clientY);
    if (v.zoom === null) zoomTo(fit < 1 ? 1 : 2, at);
    else zoomTo(0);
  };

  // ---- viewer-only keys (App handles navigation, Esc, I, F, ⌫) -------------
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (p.keysDisabled || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    switch (e.key) {
      case "+":
      case "=":
        zoomTo(scale * STEP);
        break;
      case "-":
      case "_":
        zoomTo(scale / STEP);
        break;
      case "0":
        zoomTo(0);
        break;
      case "1":
        zoomTo(1);
        break;
      case "r":
        rotate(90);
        break;
      case "R":
        rotate(-90);
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ---- small effects --------------------------------------------------------
  useEffect(() => {
    if (!hint) return;
    hintShown = true;
    const t = window.setTimeout(() => setHint(false), 3500);
    return () => window.clearTimeout(t);
  }, [hint]);

  // Warm the cache for neighbours so ← / → feel instant.
  useEffect(() => {
    for (const d of [1, -1]) {
      const n = p.images[p.index + d];
      if (n) new Image().src = fullSrc(n.path);
    }
  }, [p.index, p.images]);

  // ---- navigator (only when zoomed in past the window, unrotated) ----------
  let navigator: { w: number; h: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  if (v.zoom !== null && v.natural && rot === 0) {
    const dw = nw * scale;
    const dh = nh * scale;
    const left = off.x - dw / 2;
    const top = off.y - dh / 2;
    const x0 = clamp01((-stage.w / 2 - left) / dw);
    const x1 = clamp01((stage.w / 2 - left) / dw);
    const y0 = clamp01((-stage.h / 2 - top) / dh);
    const y1 = clamp01((stage.h / 2 - top) / dh);
    if (x1 - x0 < 0.999 || y1 - y0 < 0.999) {
      const k = Math.min(160 / nw, 110 / nh);
      navigator = { w: nw * k, h: nh * k, x0, y0, x1, y1 };
    }
  }

  // Filmstrip window around the current image.
  const start = Math.max(0, p.index - 7);
  const end = Math.min(p.images.length, p.index + 8);
  const zoomLabel = v.zoom === null ? "Fit" : `${Math.round(scale * 100)}%`;

  return (
    <div className="viewer">
      <div className="toolbar viewer-bar">
        <button className="btn compact" onClick={p.onClose} title="Back to grid (Esc)">
          <GridIcon size={16} /> Grid <kbd className="ghost">Esc</kbd>
        </button>
        <div className="viewer-title">
          <span className="strong ellipsis">{entry.name}</span>
          <span className="muted small">
            {p.index + 1} of {p.images.length}
            {v.zoom !== null && ` · ${zoomLabel}`}
          </span>
        </div>
        <div className="row-tight">
          <button className="icon-btn" onClick={() => zoomTo(scale / STEP)} aria-label="Zoom out" title="Zoom out (−)">
            <ZoomOutIcon />
          </button>
          <button
            className="zoom-label"
            onClick={fitOr100}
            aria-label={`Zoom: ${zoomLabel}. Toggle fit and 100%`}
            title="Toggle fit / 100% (0 / 1)"
          >
            {zoomLabel}
          </button>
          <button className="icon-btn" onClick={() => zoomTo(scale * STEP)} aria-label="Zoom in" title="Zoom in (+)">
            <ZoomInIcon />
          </button>
          <span className="divider" aria-hidden="true" />
          <button className="icon-btn" onClick={() => rotate(90)} aria-label="Rotate 90°" title="Rotate (R)">
            <RotateIcon />
          </button>
          <button
            className={"icon-btn" + (p.infoOpen ? " on" : "")}
            onClick={p.onToggleInfo}
            aria-pressed={p.infoOpen}
            aria-label="Info"
            title="Info (I)"
          >
            <InfoIcon />
          </button>
          <button
            className="icon-btn"
            onClick={p.onToggleFullscreen}
            aria-label={p.isFullscreen ? "Exit full screen" : "Full screen"}
            title="Full screen (F)"
          >
            {p.isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </button>
        </div>
      </div>

      <div className="viewer-body">
        <div
          ref={stageRef}
          className={"stage" + (v.zoom !== null ? " pannable" : "")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={onDoubleClick}
        >
          {/* key: a new <img> per file, so a slow load never shows the old one */}
          <img
            key={entry.path}
            className="stage-img"
            src={fullSrc(entry.path)}
            alt={entry.name}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              const path = entry.path;
              setVs((s) => (s.path === path ? { ...s, natural: { w: img.naturalWidth, h: img.naturalHeight } } : s));
            }}
            onError={() => setVs((s) => ({ ...s, failed: true }))}
            style={
              v.natural
                ? {
                    width: nw * scale,
                    height: nh * scale,
                    transform: `translate(-50%, -50%) translate(${off.x}px, ${off.y}px) rotate(${rot}deg)`,
                    imageRendering: scale >= 3 ? "pixelated" : "auto",
                  }
                : { visibility: "hidden" }
            }
          />
          {!v.natural && !v.failed && <span className="spinner big" aria-label="Loading" />}
          {v.failed && <p className="muted stage-msg">Can’t display this image.</p>}

          {p.index > 0 && (
            <button className="nav-btn left" onClick={() => p.onIndex(p.index - 1)} aria-label="Previous image">
              <ChevronLeftIcon size={22} />
            </button>
          )}
          {p.index < p.images.length - 1 && (
            <button className="nav-btn right" onClick={() => p.onIndex(p.index + 1)} aria-label="Next image">
              <ChevronRightIcon size={22} />
            </button>
          )}

          {hint && <div className="hint-pill">Scroll to zoom · drag to pan · double-click for 100%</div>}

          {navigator && (
            <div className="navigator" style={{ width: navigator.w, height: navigator.h }} aria-hidden="true">
              <img src={thumbSrc(entry.path)} alt="" draggable={false} />
              <div
                className="navigator-rect"
                style={{
                  left: `${navigator.x0 * 100}%`,
                  top: `${navigator.y0 * 100}%`,
                  width: `${(navigator.x1 - navigator.x0) * 100}%`,
                  height: `${(navigator.y1 - navigator.y0) * 100}%`,
                }}
              />
            </div>
          )}
        </div>

        {p.infoOpen && (
          <InfoPanel
            entry={entry}
            dir={p.dir}
            info={info}
            onReveal={() => p.onReveal(entry.path)}
            onCopyPath={() => p.onCopyPath(entry.path)}
            onTrash={() => p.onTrash(entry)}
          />
        )}
      </div>

      {!p.isFullscreen && (
        <div className="filmstrip" aria-label="Nearby images">
          {p.images.slice(start, end).map((img, k) => {
            const i = start + k;
            return (
              <button
                key={img.path}
                className={"film" + (i === p.index ? " current" : "")}
                onClick={() => p.onIndex(i)}
                aria-label={img.name}
                aria-current={i === p.index || undefined}
              >
                <img src={thumbSrc(img.path)} alt="" draggable={false} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

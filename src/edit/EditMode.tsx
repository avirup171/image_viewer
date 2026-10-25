import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { applyEdits, fullSrc, modKey, type ImageEntry } from "../lib/api";
import type { ToolProps } from "./tool";
import { tools } from "./tools";
import type { EditResult, SaveMode, Size } from "./types";

const PAD = 40; // space around the image inside the stage
const MAX_SCALE = 4; // tiny images are enlarged, but not absurdly

type Props = {
  entry: ImageEntry;
  onCancel: () => void;
  onSaved: (result: EditResult) => void;
};

/**
 * Full-window editor. Generic over tools: it lays out the image, renders the
 * active tool's controls and overlay, and on save sends every tool's
 * operations to Rust in registry order.
 */
export function EditMode({ entry, onCancel, onSaved }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [image, setImage] = useState<Size | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeId, setActiveId] = useState(tools[0].id);
  const [states, setStates] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState<SaveMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const initAll = (size: Size) => Object.fromEntries(tools.map((t) => [t.id, t.init(size)]));

  const scale = image
    ? Math.max(0.01, Math.min((stage.w - 2 * PAD) / image.width, (stage.h - 2 * PAD) / image.height, MAX_SCALE))
    : 1;

  const propsFor = (id: string): ToolProps<unknown> => ({
    state: states[id],
    setState: (next) =>
      setStates((all) => ({
        ...all,
        [id]: typeof next === "function" ? (next as (prev: unknown) => unknown)(all[id]) : next,
      })),
    image: image!,
    scale,
  });

  const ready = image !== null && tools.every((t) => t.id in states);
  const changedTools = ready ? tools.filter((t) => !t.isNoop(states[t.id], image)) : [];
  const changed = changedTools.length > 0;
  const active = tools.find((t) => t.id === activeId)!;

  async function save(mode: SaveMode) {
    if (!ready || !changed || busy) return;
    const ops = changedTools.flatMap((t) => t.toOps(states[t.id], image));
    setBusy(mode);
    setError(null);
    try {
      onSaved(await applyEdits(entry.path, ops, mode));
    } catch (e) {
      setError(String(e));
      setBusy(null);
      setConfirmReplace(false);
    }
  }

  // ---- keyboard: one listener, always calling this render's handler ----
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (busy) return;
    if (confirmReplace) {
      if (e.key === "Escape") {
        e.preventDefault();
        setConfirmReplace(false);
      }
      return; // let Tab / Enter work on the dialog's buttons
    }
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save("newFile");
      return;
    }
    if (mod || e.altKey || !ready) return;
    const tool = tools.find((t) => t.shortcut === e.key.toLowerCase());
    if (tool) {
      setActiveId(tool.id);
      e.preventDefault();
      return;
    }
    if (active.onKeyDown?.(e, propsFor(active.id))) e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const canvas = image
    ? {
        width: image.width * scale,
        height: image.height * scale,
        left: (stage.w - image.width * scale) / 2,
        top: (stage.h - image.height * scale) / 2,
      }
    : null;
  const { Controls, Overlay } = active;

  return (
    <div className="editor">
      <div className="toolbar editor-bar">
        <button className="btn compact" onClick={onCancel} disabled={!!busy}>
          Cancel <kbd className="ghost">Esc</kbd>
        </button>
        <div className="segmented tools" role="tablist" aria-label="Edit tools">
          {tools.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === activeId}
              onClick={() => setActiveId(t.id)}
              title={`${t.label} (${t.shortcut.toUpperCase()})`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <span className="muted small ellipsis editor-name">{entry.name}</span>
        <div className="spacer" />
        {ready && Controls && <Controls {...propsFor(active.id)} />}
      </div>

      <div ref={stageRef} className="editor-stage">
        <div className="editor-canvas" style={canvas ?? { visibility: "hidden" }}>
          <img
            src={fullSrc(entry)}
            alt={entry.name}
            draggable={false}
            onLoad={(e) => {
              const size = { width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight };
              setImage(size);
              setStates(initAll(size));
            }}
            onError={() => setFailed(true)}
          />
          {ready && Overlay && <Overlay {...propsFor(active.id)} />}
        </div>
        {!image && !failed && <span className="spinner big" aria-label="Loading" />}
        {failed && <p className="muted stage-msg">Can’t load this image.</p>}
      </div>

      <div className="editor-footer">
        <span className="small tabular">{ready && active.describe ? active.describe(states[active.id], image) : ""}</span>
        {error && (
          <span className="small error-text ellipsis" role="alert">
            {error}
          </span>
        )}
        <div className="spacer" />
        <button className="btn" onClick={() => image && setStates(initAll(image))} disabled={!changed || !!busy}>
          Reset
        </button>
        <button className="btn" onClick={() => setConfirmReplace(true)} disabled={!changed || !!busy}>
          Replace original…
        </button>
        <button className="btn primary" onClick={() => save("newFile")} disabled={!changed || !!busy}>
          {busy === "newFile" ? "Saving…" : "Save as copy"} <kbd className="on-accent">{modKey}S</kbd>
        </button>
      </div>

      {confirmReplace && (
        <div className="modal-backdrop" onClick={() => !busy && setConfirmReplace(false)}>
          <div
            className="modal confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="replace-title"
            aria-describedby="replace-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="replace-title">Replace “{entry.name}”?</h2>
            <p id="replace-desc" className="muted">
              The edited image will be saved in its place. The original is moved to the Trash, so you can still
              restore it from there.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmReplace(false)} disabled={!!busy} autoFocus>
                Cancel
              </button>
              <button className="btn danger-solid" onClick={() => save("replace")} disabled={!!busy}>
                {busy === "replace" ? "Replacing…" : "Replace"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

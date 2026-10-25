import { modKey } from "../lib/api";

export type ToastState = {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
};

export function Toast({ toast }: { toast: ToastState | null }) {
  // role="status" makes screen readers announce the message politely.
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.id}>
          <span className="ellipsis">{toast.message}</span>
          {toast.action && (
            <button className="toast-action" onClick={toast.action.run}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const SHORTCUTS: [string, string, string][] = [
  ["← → ↑ ↓", "Move selection", "Previous / next"],
  ["↵ / Space", "Open in viewer", "Next image"],
  ["Esc", "Clear filter", "Back to grid"],
  ["+ / −", "Thumbnail size", "Zoom in / out"],
  ["0 / 1", "—", "Fit / 100%"],
  ["C", "Crop", "Crop"],
  ["R", "—", "Rotate (view only)"],
  ["I", "—", "Toggle info"],
  ["F", "—", "Full screen"],
  ["⌫", "Move to Trash", "Move to Trash"],
  [`${modKey}Z`, "Undo trash", "Undo trash"],
  [`${modKey}F`, "Filter by name", "—"],
  [`${modKey}O`, "Open folder", "Open folder"],
  ["?", "This list", "This list"],
];

const EDITOR_SHORTCUTS: [string, string][] = [
  ["Drag", "Move or resize the crop box; drag outside it to draw a new one"],
  ["← → ↑ ↓", "Nudge the crop box (Shift: 10 px)"],
  [`${modKey}S`, "Save as copy"],
  ["Esc", "Cancel editing"],
];

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button className="btn small-btn" onClick={onClose} autoFocus>
            Close <kbd>Esc</kbd>
          </button>
        </div>
        <table className="shortcuts">
          <thead>
            <tr>
              <th>Key</th>
              <th>Grid</th>
              <th>Viewer</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map(([k, g, v]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{g}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="eyebrow shortcuts-heading">Editor</h3>
        <table className="shortcuts">
          <tbody>
            {EDITOR_SHORTCUTS.map(([k, what]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

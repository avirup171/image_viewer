import type { KeyboardEvent } from "react";
import type { ToolProps } from "../../tool";
import { ADJUSTMENTS, MAX, MIN, formatValue, isZero, zeroState, type AdjustState, type AdjustmentId } from "./adjustments";

const clampValue = (v: number) => Math.min(MAX, Math.max(MIN, Math.round(v)));

/**
 * The sliders, in a panel beside the image. The image itself is previewed by
 * EditMode through the tool's colour matrix, so this only edits numbers.
 */
export function AdjustPanel({ state, setState }: ToolProps<AdjustState>) {
  const set = (id: AdjustmentId, v: number) => setState((s) => ({ ...s, [id]: clampValue(v) }));

  // Native range inputs move 1 per arrow press; Shift moves 10, like the crop nudge.
  const onKeyDown = (id: AdjustmentId) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (!e.shiftKey) return;
    const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    set(id, state[id] + dir * 10);
  };

  return (
    <aside className="edit-panel" aria-label="Adjustments">
      <div className="edit-panel-head">
        <h2 className="eyebrow">Adjust</h2>
        <button className="btn small-btn" onClick={() => setState(zeroState())} disabled={isZero(state)}>
          Reset all
        </button>
      </div>
      {ADJUSTMENTS.map((a, i) => (
        <div key={a.id} className={`slider-row slider-${a.id}`}>
          <label htmlFor={`adjust-${a.id}`} className="slider-label">
            <span>{a.label}</span>
            <output htmlFor={`adjust-${a.id}`} className="tabular">
              {formatValue(state[a.id])}
            </output>
          </label>
          <input
            id={`adjust-${a.id}`}
            type="range"
            min={MIN}
            max={MAX}
            step={1}
            value={state[a.id]}
            onChange={(e) => set(a.id, Number(e.currentTarget.value))}
            onKeyDown={onKeyDown(a.id)}
            onDoubleClick={() => set(a.id, 0)}
            title="Double-click to reset"
            // Pressing A then ← → adjusts straight away.
            autoFocus={i === 0}
          />
          {a.ends && (
            <div className="slider-ends muted small" aria-hidden="true">
              <span>{a.ends[0]}</span>
              <span>{a.ends[1]}</span>
            </div>
          )}
        </div>
      ))}
      <p className="muted small edit-panel-tip">
        Tab between sliders, ← → to change (Shift: 10). Double-click a slider to reset it.
      </p>
    </aside>
  );
}

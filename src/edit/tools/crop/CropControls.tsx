import { SwapIcon } from "../../../components/Icons";
import type { ToolProps } from "../../tool";
import { fitRatio } from "./cropMath";
import { ASPECTS, ratioOf, type AspectId, type CropState } from "./cropState";

/** Aspect-ratio presets shown in the editor toolbar. */
export function CropControls({ state, setState, image }: ToolProps<CropState>) {
  // Changing the ratio snaps the box to the largest box of that ratio,
  // centred on where the current box is.
  const apply = (aspect: AspectId, portrait: boolean) =>
    setState((s) => {
      const ratio = ratioOf({ aspect, portrait }, image);
      return { ...s, aspect, portrait, rect: ratio ? fitRatio(s.rect, ratio, image) : s.rect };
    });

  const canSwap = !["free", "original", "1:1"].includes(state.aspect);

  return (
    <div className="row-tight">
      <div className="segmented" role="group" aria-label="Aspect ratio">
        {ASPECTS.map((a) => {
          const label = a.ratio && state.portrait ? `${a.ratio[1]}:${a.ratio[0]}` : a.label;
          return (
            <button
              key={a.id}
              aria-pressed={state.aspect === a.id}
              onClick={() => apply(a.id, state.portrait)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <button
        className="icon-btn"
        onClick={() => apply(state.aspect, !state.portrait)}
        disabled={!canSwap}
        aria-label={state.portrait ? "Use landscape ratio" : "Use portrait ratio"}
        title="Swap portrait / landscape"
      >
        <SwapIcon />
      </button>
    </div>
  );
}

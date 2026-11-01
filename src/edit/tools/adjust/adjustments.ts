// The sliders of the Adjust tool, in display order, which is also the order
// they're applied in: white balance first, then brightness, contrast, and
// saturation last (the same order as Lightroom).
//
// This mirrors src-tauri/src/edit/adjust.rs. Change a formula here and you
// must change it there too (and the `matches_frontend_matrix` test), or the
// preview stops matching the saved file.
//
// Adding a slider (e.g. tint): add an entry here, plus a field, a function and
// a line in `Adjust::matrix` in adjust.rs. The panel, state, preview and
// saved operation all come from this list.
import { compose, IDENTITY, scale, type ColorMatrix } from "../../colorMatrix";

export const MIN = -100;
export const MAX = 100;

/** Rec. 709 luma weights (same as Rust and CSS saturate()). */
const LUMA = [0.2126, 0.7152, 0.0722];
/** Temperature ±100 scales red and blue by ±20 %. */
const TEMPERATURE_STRENGTH = 0.2;

/** -100…100 → 0.5…2.0, one photographic stop either way. */
const stops = (v: number) => Math.pow(2, v / 100);

export type AdjustmentId = "temperature" | "brightness" | "contrast" | "saturation";
export type AdjustState = Record<AdjustmentId, number>;

type Adjustment = {
  id: AdjustmentId;
  label: string;
  /** Words under the slider's two ends, when "−/+" isn't self-explanatory. */
  ends?: [string, string];
  matrix: (v: number) => ColorMatrix;
};

export const ADJUSTMENTS: Adjustment[] = [
  {
    id: "temperature",
    label: "Temperature",
    ends: ["Cooler", "Warmer"],
    matrix: (v) => {
      const t = (TEMPERATURE_STRENGTH * v) / 100;
      return scale(1 + t, 1, 1 - t, 0);
    },
  },
  {
    id: "brightness",
    label: "Brightness",
    matrix: (v) => {
      const k = stops(v);
      return scale(k, k, k, 0);
    },
  },
  {
    id: "contrast",
    label: "Contrast",
    // Stretch values away from mid-grey (0.5), or squeeze them towards it.
    matrix: (v) => {
      const k = stops(v);
      return scale(k, k, k, 0.5 * (1 - k));
    },
  },
  {
    id: "saturation",
    label: "Saturation",
    // Blend between the pixel's grey (luma) and its colour: -100 = black and white.
    matrix: (v) => {
      const s = 1 + v / 100;
      return [0, 1, 2].map((i) => [...[0, 1, 2].map((j) => LUMA[j] * (1 - s) + (i === j ? s : 0)), 0]);
    },
  },
];

export const zeroState = (): AdjustState =>
  Object.fromEntries(ADJUSTMENTS.map((a) => [a.id, 0])) as AdjustState;

export const isZero = (s: AdjustState) => ADJUSTMENTS.every((a) => s[a.id] === 0);

/** Every slider as one matrix, applied in list order. */
export const matrixOf = (s: AdjustState): ColorMatrix =>
  ADJUSTMENTS.reduce((acc, a) => compose(a.matrix(s[a.id]), acc), IDENTITY);

/** "+12", "−12" (a real minus sign), or "0". */
export const formatValue = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");

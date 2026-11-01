import { AdjustIcon } from "../../../components/Icons";
import { defineTool } from "../../tool";
import { AdjustPanel } from "./AdjustPanel";
import { ADJUSTMENTS, formatValue, isZero, matrixOf, zeroState, type AdjustState } from "./adjustments";

export const adjustTool = defineTool<AdjustState>({
  id: "adjust",
  label: "Adjust",
  shortcut: "a",
  icon: <AdjustIcon size={16} />,

  init: zeroState,
  isNoop: isZero,
  // One operation carries every slider; Rust turns it into the same matrix.
  toOps: (s) => [{ type: "adjust", ...s }],
  describe: (s) =>
    ADJUSTMENTS.filter((a) => s[a.id] !== 0)
      .map((a) => `${a.label} ${formatValue(s[a.id])}`)
      .join(" · "),

  // Live preview, shown whichever tool is active.
  colorMatrix: matrixOf,
  Panel: AdjustPanel,
});

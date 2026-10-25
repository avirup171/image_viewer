import { CropIcon } from "../../../components/Icons";
import { defineTool } from "../../tool";
import { CropControls } from "./CropControls";
import { CropOverlay } from "./CropOverlay";
import { fullRect, isFullImage, resizeRect, roundRect } from "./cropMath";
import type { CropState } from "./cropState";

export const cropTool = defineTool<CropState>({
  id: "crop",
  label: "Crop",
  shortcut: "c",
  icon: <CropIcon size={16} />,

  init: (image) => ({ rect: fullRect(image), aspect: "free", portrait: image.height > image.width }),
  isNoop: (s, image) => isFullImage(s.rect, image),
  toOps: (s, image) => {
    const r = roundRect(s.rect, image);
    return [{ type: "crop", x: r.x, y: r.y, width: r.w, height: r.h }];
  },
  describe: (s, image) => {
    const r = roundRect(s.rect, image);
    return `${r.w} × ${r.h} px`;
  },

  Controls: CropControls,
  Overlay: CropOverlay,

  // Arrow keys nudge the box by 1 px (10 px with Shift).
  onKeyDown: (e, { setState, image }) => {
    const step = e.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (!d) return false;
    setState((s) => ({ ...s, rect: resizeRect(s.rect, "move", d[0], d[1], image, null, 1) }));
    return true;
  },
});

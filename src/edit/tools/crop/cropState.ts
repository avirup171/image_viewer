import type { Size } from "../../types";
import type { Rect } from "./cropMath";

export type AspectId = "free" | "original" | "1:1" | "4:3" | "3:2" | "16:9";

export const ASPECTS: { id: AspectId; label: string; ratio?: [number, number] }[] = [
  { id: "free", label: "Free" },
  { id: "original", label: "Original" },
  { id: "1:1", label: "1:1", ratio: [1, 1] },
  { id: "4:3", label: "4:3", ratio: [4, 3] },
  { id: "3:2", label: "3:2", ratio: [3, 2] },
  { id: "16:9", label: "16:9", ratio: [16, 9] },
];

export type CropState = {
  /** In image pixels; may be fractional while dragging, rounded when saved. */
  rect: Rect;
  aspect: AspectId;
  /** Use the ratio sideways (e.g. 3:4 instead of 4:3). */
  portrait: boolean;
};

/** Width ÷ height the box must keep, or null for a free crop. */
export function ratioOf(s: Pick<CropState, "aspect" | "portrait">, image: Size): number | null {
  if (s.aspect === "free") return null;
  if (s.aspect === "original") return image.width / image.height;
  const [a, b] = ASPECTS.find((x) => x.id === s.aspect)!.ratio!;
  return s.portrait ? b / a : a / b;
}

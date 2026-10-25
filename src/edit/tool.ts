// The contract every edit tool implements. EditMode knows nothing about
// cropping specifically; it renders whichever tools are in the registry
// (tools/index.ts) and collects their operations when saving.
//
// Adding a tool (e.g. "rotate"):
//   1. src/edit/tools/rotate/ with a `defineTool({...})` export
//   2. add it to `tools` in tools/index.ts
//   3. add its op to `EditOp` in types.ts and to the Rust `EditOp` enum
import type { ComponentType, ReactNode } from "react";
import type { EditOp, Size } from "./types";

export type ToolProps<S> = {
  state: S;
  setState: (next: S | ((prev: S) => S)) => void;
  /** The image's displayed size in pixels (after EXIF rotation). */
  image: Size;
  /** Screen pixels per image pixel at the current fit. */
  scale: number;
};

export interface EditTool<S> {
  id: string;
  label: string;
  /** Single-letter shortcut that switches to this tool inside the editor. */
  shortcut: string;
  icon: ReactNode;
  /** Initial (no-change) state for an image. */
  init(image: Size): S;
  /** True when the state wouldn't change the image, so there's nothing to save. */
  isNoop(state: S, image: Size): boolean;
  /** Operations to send to Rust, in order. */
  toOps(state: S, image: Size): EditOp[];
  /** Short status text for the footer, e.g. "1920 × 1080 px". */
  describe?(state: S, image: Size): string;
  /** Controls shown in the editor toolbar while this tool is active. */
  Controls?: ComponentType<ToolProps<S>>;
  /** Drawn on top of the image while this tool is active. */
  Overlay?: ComponentType<ToolProps<S>>;
  /** Keyboard handling while active. Return true if the key was used. */
  onKeyDown?(e: KeyboardEvent, props: ToolProps<S>): boolean;
}

/** Identity helper that keeps the state type `S` checked inside one tool. */
export function defineTool<S>(tool: EditTool<S>): EditTool<S> {
  return tool;
}

// The registry holds tools with different state types.
export type AnyTool = EditTool<any>;

// The editor's tools, in toolbar order. Operations are also applied in this
// order when saving, so geometry-changing tools (crop, rotate) should come
// before tools that work on pixel values (brightness, filters).
import type { AnyTool } from "../tool";
import { cropTool } from "./crop";

export const tools: AnyTool[] = [cropTool];

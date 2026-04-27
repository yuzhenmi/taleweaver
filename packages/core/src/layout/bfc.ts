import type { ElementBox } from "../render/render-node-v2";
import type { LayoutBox } from "./layout-box-v2";
import { createBlockBox } from "./layout-box-v2";
import type { TextMeasurer } from "./text-measurer";

export function layoutBlock(
  node: ElementBox,
  x: number,
  y: number,
  availableWidth: number,
  measurer: TextMeasurer,
): LayoutBox {
  // Stub — full implementation in Task D.3
  if (!node.computedStyle) throw new Error("cascade required");
  return createBlockBox(node.key, x, y, availableWidth, 0, node.computedStyle, []);
}

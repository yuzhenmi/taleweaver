/**
 * Shared setup for integration tests.
 * Provides the default component registry, a mock text measurer,
 * and type-narrowing helpers for render/layout nodes.
 */
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { createMockShaper } from "../layout/mock-shaper";
import type { RenderNode } from "../render/render-node";
import type { LayoutBox, TextRunBox } from "@taleweaver/print";

export const registry = createDefaultComponentRegistry();
export const attrRegistry = createDefaultAttrRegistry();
export const measurer = createMockShaper(8, 16); // 8px per char, 16px line height

/** Narrow a RenderNode to text type, throwing if it isn't one. */
export function expectTextRender(node: RenderNode): Extract<RenderNode, { type: "text" }> {
  if (node.type !== "text") {
    throw new Error(`Expected text render node, got "${node.type}"`);
  }
  return node;
}

/** Narrow a LayoutBox to text-run type, throwing if it isn't one. */
export function expectTextBox(box: LayoutBox): TextRunBox {
  if (box.type !== "text-run") {
    throw new Error(`Expected text-run layout box, got "${box.type}"`);
  }
  return box;
}

/** Recursively collect all text from text-run boxes within a layout box. */
function collectText(box: LayoutBox): string {
  if (box.type === "text-run") return box.text;
  if (box.type === "line" || box.type === "inline" || box.type === "block" || box.type === "inline-block") {
    return box.children.map(collectText).join("");
  }
  return "";
}

/** Collect all text content from a layout line's text-run box descendants. */
export function lineText(line: LayoutBox): string {
  if (line.type === "line") {
    return line.children.map(collectText).join("");
  }
  return "";
}

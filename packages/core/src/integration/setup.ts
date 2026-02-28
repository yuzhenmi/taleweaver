/**
 * Shared setup for integration tests.
 * Provides the default component registry, a mock text measurer,
 * and type-narrowing helpers for render/layout nodes.
 */
import { defaultComponents } from "../components";
import { createRegistry } from "../components/component-registry";
import { createMockMeasurer } from "../layout/text-measurer";
import type { RenderNode } from "../render/render-node";
import type { TextRenderNode } from "../render/text-render-node";
import type { LayoutBox } from "../layout/layout-node";
import type { TextLayoutBox } from "../layout/text-layout-box";

export const registry = createRegistry(defaultComponents);
export const measurer = createMockMeasurer(8, 16); // 8px per char, 16px line height

/** Narrow a RenderNode to text type, throwing if it isn't one. */
export function expectTextRender(node: RenderNode): TextRenderNode {
  if (node.type !== "text") {
    throw new Error(`Expected text render node, got "${node.type}"`);
  }
  return node;
}

/** Narrow a LayoutBox to text type, throwing if it isn't one. */
export function expectTextBox(box: LayoutBox): TextLayoutBox {
  if (box.type !== "text") {
    throw new Error(`Expected text layout box, got "${box.type}"`);
  }
  return box;
}

/** Collect all text content from a layout line's text box children. */
export function lineText(line: LayoutBox): string {
  return line.children.map((c) => expectTextBox(c).text).join("");
}

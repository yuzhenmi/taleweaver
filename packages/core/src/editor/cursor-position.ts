import type { StateNode } from "../state/state-node";
import type { Position } from "../state/position";
import type { LayoutBox, TextLayoutBox } from "../layout/layout-node";
import type { TextMeasurer } from "../layout/text-measurer";
import { getNodeByPath } from "../state/operations";

export interface PixelPosition {
  x: number;
  /** Cursor y (page-relative, offset by half-leading within the line). */
  y: number;
  /** Cursor height (font bounding box height). */
  height: number;
  /** Top of the line box (page-relative, no half-leading offset). */
  lineY: number;
  /** Full line height. */
  lineHeight: number;
  /** Page this position is on. */
  pageIndex: number;
}

interface TextBoxMatch {
  box: TextLayoutBox;
  absoluteX: number;
  absoluteY: number;
  keySuffix: number; // -1 for unsuffixed, N for :N
  pageIndex: number;
}

/** Resolve a state Position to pixel coordinates using the layout tree. */
export function resolvePixelPosition(
  state: StateNode,
  position: Position,
  layoutTree: LayoutBox,
  measurer: TextMeasurer,
): PixelPosition {
  const node = getNodeByPath(state, position.path);
  if (!node) return { x: 0, y: 0, height: 16, lineY: 0, lineHeight: 16, pageIndex: 0 };

  const nodeId = node.id;

  // Collect all TextLayoutBox nodes matching this state node id
  const matches: TextBoxMatch[] = [];
  collectTextBoxes(layoutTree, nodeId, 0, 0, matches);

  if (matches.length === 0) {
    return { x: 0, y: 0, height: 16, lineY: 0, lineHeight: 16, pageIndex: 0 };
  }

  // Sort by key suffix order
  matches.sort((a, b) => a.keySuffix - b.keySuffix);

  // Walk matches consuming offset characters
  let remaining = position.offset;
  for (const match of matches) {
    const textLen = match.box.text.length;
    if (remaining <= textLen) {
      // Cursor falls within this box
      const prefix = match.box.text.slice(0, remaining);
      const xOffset = measurer.measureWidth(prefix, match.box.styles ?? {});
      const cursorHeight = measurer.measureCursorHeight(match.box.styles ?? {});
      const halfLeading = (match.box.height - cursorHeight) / 2;
      return {
        x: match.absoluteX + xOffset,
        y: match.absoluteY + halfLeading,
        height: cursorHeight,
        lineY: match.absoluteY,
        lineHeight: match.box.height,
        pageIndex: match.pageIndex,
      };
    }
    remaining -= textLen;
  }

  // Offset past all boxes — position at end of last box
  const last = matches[matches.length - 1];
  const cursorHeight = measurer.measureCursorHeight(last.box.styles ?? {});
  const halfLeading = (last.box.height - cursorHeight) / 2;
  return {
    x: last.absoluteX + last.box.width,
    y: last.absoluteY + halfLeading,
    height: cursorHeight,
    lineY: last.absoluteY,
    lineHeight: last.box.height,
    pageIndex: last.pageIndex,
  };
}

/** Recursively collect TextLayoutBox nodes whose key matches the given node id. */
function collectTextBoxes(
  box: LayoutBox,
  nodeId: string,
  parentX: number,
  parentY: number,
  out: TextBoxMatch[],
  pageIndex: number = 0,
): void {
  if (box.type === "text") {
    const match = matchKey(box.key, nodeId);
    if (match !== null) {
      out.push({
        box,
        absoluteX: parentX + box.x,
        absoluteY: parentY + box.y,
        keySuffix: match,
        pageIndex,
      });
    }
    return;
  }

  const absX = parentX + box.x;
  const absY = parentY + box.y;
  if (box.type === "page") {
    const idx = parseInt(box.key.slice(5), 10);
    const pi = isNaN(idx) ? pageIndex : idx;
    for (const child of box.children) {
      collectTextBoxes(child, nodeId, absX, absY, out, pi);
    }
    return;
  }
  for (const child of box.children) {
    collectTextBoxes(child, nodeId, absX, absY, out, pageIndex);
  }
}

/** Check if a layout box key matches a node id. Returns suffix number or null. */
function matchKey(key: string, nodeId: string): number | null {
  if (key === nodeId) return -1;
  if (key.startsWith(nodeId + ":")) {
    const suffix = parseInt(key.slice(nodeId.length + 1), 10);
    return isNaN(suffix) ? null : suffix;
  }
  return null;
}

import type { StateNode } from "../state/state-node";
import type { Position } from "../state/position";
import type { LayoutBox, TextLayoutBox } from "../layout/layout-node";
import type { TextMeasurer } from "../layout/text-measurer";
import { getNodeByPath } from "../state/operations";

export interface PixelPosition {
  x: number;
  /** Cursor y (top of line box, page-relative). */
  y: number;
  /** Cursor height (line height, excluding margins). */
  height: number;
  /** Top of the line box (page-relative, no margin offset). */
  lineY: number;
  /** Full line height (excluding margins). */
  lineHeight: number;
  /** Resolved top margin of the line in px. */
  lineMarginTop: number;
  /** Resolved bottom margin of the line in px. */
  lineMarginBottom: number;
  /** Page this position is on. */
  pageIndex: number;
}

interface TextBoxMatch {
  box: TextLayoutBox;
  absoluteX: number;
  absoluteY: number;
  keySuffix: number; // -1 for unsuffixed, N for :N
  pageIndex: number;
  lineMarginTop: number;
  lineMarginBottom: number;
}

/** Resolve a state Position to pixel coordinates using the layout tree. */
export function resolvePixelPosition(
  state: StateNode,
  position: Position,
  layoutTree: LayoutBox,
  measurer: TextMeasurer,
): PixelPosition {
  const node = getNodeByPath(state, position.path);
  if (!node) return { x: 0, y: 0, height: 16, lineY: 0, lineHeight: 16, lineMarginTop: 0, lineMarginBottom: 0, pageIndex: 0 };

  const nodeId = node.id;

  // Collect all TextLayoutBox nodes matching this state node id
  const matches: TextBoxMatch[] = [];
  collectTextBoxes(layoutTree, nodeId, 0, 0, matches);

  if (matches.length === 0) {
    return { x: 0, y: 0, height: 16, lineY: 0, lineHeight: 16, lineMarginTop: 0, lineMarginBottom: 0, pageIndex: 0 };
  }

  // Sort by key suffix order
  matches.sort((a, b) => a.keySuffix - b.keySuffix);

  // Walk matches consuming offset characters
  let remaining = position.offset;
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const textLen = match.box.text.length;
    if (remaining <= textLen) {
      // At a soft-wrap boundary: prefer start of next line
      if (remaining === textLen) {
        const next = matches[i + 1];
        if (next && (next.absoluteY !== match.absoluteY || next.pageIndex !== match.pageIndex)) {
          return {
            x: next.absoluteX,
            y: next.absoluteY,
            height: next.box.height,
            lineY: next.absoluteY,
            lineHeight: next.box.height,
            lineMarginTop: next.lineMarginTop,
            lineMarginBottom: next.lineMarginBottom,
            pageIndex: next.pageIndex,
          };
        }
      }
      // Cursor falls within this box (or end of box on same line)
      const prefix = match.box.text.slice(0, remaining);
      const xOffset = measurer.measureWidth(prefix, match.box.styles ?? {});
      return {
        x: match.absoluteX + xOffset,
        y: match.absoluteY,
        height: match.box.height,
        lineY: match.absoluteY,
        lineHeight: match.box.height,
        lineMarginTop: match.lineMarginTop,
        lineMarginBottom: match.lineMarginBottom,
        pageIndex: match.pageIndex,
      };
    }
    remaining -= textLen;
  }

  // Offset past all boxes — position at end of last box
  const last = matches[matches.length - 1];
  return {
    x: last.absoluteX + last.box.width,
    y: last.absoluteY,
    height: last.box.height,
    lineY: last.absoluteY,
    lineHeight: last.box.height,
    lineMarginTop: last.lineMarginTop,
    lineMarginBottom: last.lineMarginBottom,
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
  lineMarginTop: number = 0,
  lineMarginBottom: number = 0,
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
        lineMarginTop,
        lineMarginBottom,
      });
    }
    return;
  }

  const absX = parentX + box.x;
  const absY = parentY + box.y;
  let mt = lineMarginTop;
  let mb = lineMarginBottom;
  if (box.type === "line") {
    mt = box.marginTop;
    mb = box.marginBottom;
  }
  if (box.type === "page") {
    const idx = parseInt(box.key.slice(5), 10);
    const pi = isNaN(idx) ? pageIndex : idx;
    for (const child of box.children) {
      collectTextBoxes(child, nodeId, absX, absY, out, pi, mt, mb);
    }
    return;
  }
  for (const child of box.children) {
    collectTextBoxes(child, nodeId, absX, absY, out, pageIndex, mt, mb);
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

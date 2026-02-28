import type {
  StateNode,
  Position,
  LayoutBox,
  TextMeasurer,
  TextLayoutBox,
} from "@taleweaver/core";
import { getNodeByPath } from "@taleweaver/core";

export interface PixelPosition {
  x: number;
  y: number;
  height: number;
}

interface TextBoxMatch {
  box: TextLayoutBox;
  absoluteX: number;
  absoluteY: number;
  keySuffix: number; // -1 for unsuffixed, N for :N
}

/** Resolve a state Position to pixel coordinates using the layout tree. */
export function resolvePixelPosition(
  state: StateNode,
  position: Position,
  layoutTree: LayoutBox,
  measurer: TextMeasurer,
): PixelPosition {
  const node = getNodeByPath(state, position.path);
  if (!node) return { x: 0, y: 0, height: 16 };

  const nodeId = node.id;

  // Collect all TextLayoutBox nodes matching this state node id
  const matches: TextBoxMatch[] = [];
  collectTextBoxes(layoutTree, nodeId, 0, 0, matches);

  if (matches.length === 0) {
    return { x: 0, y: 0, height: 16 };
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
      return {
        x: match.absoluteX + xOffset,
        y: match.absoluteY,
        height: match.box.height,
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
  };
}

/** Recursively collect TextLayoutBox nodes whose key matches the given node id. */
function collectTextBoxes(
  box: LayoutBox,
  nodeId: string,
  parentX: number,
  parentY: number,
  out: TextBoxMatch[],
): void {
  if (box.type === "text") {
    const match = matchKey(box.key, nodeId);
    if (match !== null) {
      out.push({
        box,
        absoluteX: parentX + box.x,
        absoluteY: parentY + box.y,
        keySuffix: match,
      });
    }
    return;
  }

  const absX = parentX + box.x;
  const absY = parentY + box.y;
  for (const child of box.children) {
    collectTextBoxes(child, nodeId, absX, absY, out);
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

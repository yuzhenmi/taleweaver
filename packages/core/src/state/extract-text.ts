import type { StateNode } from "./state-node";
import type { Span, Position } from "./position";
import { normalizeSpan, comparePositions, createPosition, pathsEqual } from "./position";
import { getTextContent, getTextContentLength } from "./text-utils";
import { getNodeByPath } from "./operations";

const BLOCK_TYPES = new Set(["paragraph", "heading", "list-item"]);

/**
 * Extract plain text from a document within a selection span.
 * Paragraph boundaries become newlines.
 */
export function extractText(
  state: StateNode,
  span: Span,
): string {
  const normalized = normalizeSpan(span);
  if (comparePositions(normalized.anchor, normalized.focus) === 0) return "";

  const parts: string[] = [];
  collectText(state, state, [], normalized.anchor, normalized.focus, parts, { lastBlockKey: "" });

  return parts.join("");
}

interface CollectState {
  /** Key that uniquely identifies the last block-level parent we visited. */
  lastBlockKey: string;
}

/** Find the path to the nearest block-level ancestor of a text node. */
function findBlockAncestorPath(root: StateNode, textPath: number[]): number[] {
  // Walk up from the text node to find the nearest block-type ancestor
  for (let depth = textPath.length - 1; depth >= 0; depth--) {
    const ancestorPath = textPath.slice(0, depth);
    const ancestor = getNodeByPath(root, ancestorPath);
    if (ancestor && BLOCK_TYPES.has(ancestor.type)) {
      return ancestorPath;
    }
  }
  // Fallback: use everything except the last element
  return textPath.slice(0, -1);
}

function collectText(
  root: StateNode,
  node: StateNode,
  path: number[],
  start: Position,
  end: Position,
  parts: string[],
  state: CollectState,
): void {
  if (node.type === "text") {
    const pos = createPosition(path, 0);
    const endPos = createPosition(path, getTextContentLength(node));

    if (comparePositions(endPos, start) <= 0) return;
    if (comparePositions(pos, end) >= 0) return;

    const content = getTextContent(node);

    const effectiveStart = pathsEqual(path, start.path) ? start.offset : 0;
    const effectiveEnd = pathsEqual(path, end.path) ? end.offset : content.length;

    // Find the nearest block-level ancestor to determine paragraph boundaries
    const blockPath = findBlockAncestorPath(root, path);
    const blockKey = blockPath.join(",");

    if (state.lastBlockKey !== "" && blockKey !== state.lastBlockKey) {
      parts.push("\n");
    }
    state.lastBlockKey = blockKey;

    parts.push(content.slice(effectiveStart, effectiveEnd));
    return;
  }

  for (let i = 0; i < node.children.length; i++) {
    collectText(root, node.children[i], [...path, i], start, end, parts, state);
  }
}

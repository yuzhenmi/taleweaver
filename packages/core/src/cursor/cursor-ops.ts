import type { StateNode } from "../state/state-node";
import type { Position } from "../state/position";
import { createPosition } from "../state/position";
import { getNodeByPath } from "../state/operations";
import { getTextContent, getTextContentLength } from "../state/text-utils";
import { createSelection, type Selection } from "./selection";

// --- Grapheme cluster segmentation ---

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});
const wordSegmenter = new Intl.Segmenter(undefined, {
  granularity: "word",
});

/** Find the next grapheme cluster boundary after `offset` in `text`. */
function nextGraphemeBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  for (const seg of graphemeSegmenter.segment(text)) {
    const end = seg.index + seg.segment.length;
    if (end > offset) return end;
  }
  return text.length;
}

/** Find the previous grapheme cluster boundary before `offset` in `text`. */
function prevGraphemeBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;
  let lastStart = 0;
  for (const seg of graphemeSegmenter.segment(text)) {
    if (seg.index >= offset) return lastStart;
    lastStart = seg.index;
  }
  return lastStart;
}

/** Find the next word boundary after `offset` in `text`.
 *  Always lands at the END of a word, skipping any whitespace/punctuation. */
function nextWordBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  for (const seg of wordSegmenter.segment(text)) {
    const end = seg.index + seg.segment.length;
    if (seg.isWordLike && end > offset) {
      return end;
    }
  }
  return text.length;
}

/** Find the previous word boundary before `offset` in `text`. */
function prevWordBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;
  // Collect word segments, find the start of the word at or before offset
  let lastWordStart = 0;
  let foundWord = false;
  for (const seg of wordSegmenter.segment(text)) {
    const end = seg.index + seg.segment.length;
    if (seg.isWordLike) {
      if (end >= offset) {
        // We're at or past this word
        if (seg.index < offset && seg.index > 0) {
          // We're inside this word — go to its start
          return seg.index;
        }
        if (seg.index >= offset) {
          // We're at or past the start of this word — go to previous word
          return foundWord ? lastWordStart : 0;
        }
      }
      lastWordStart = seg.index;
      foundWord = true;
    }
  }
  return foundWord ? lastWordStart : 0;
}

// --- Cursor movement ---

/**
 * Move cursor by one grapheme cluster in the given direction.
 * Returns a new collapsed selection at the new position.
 */
export function moveByCharacter(
  state: StateNode,
  position: Position,
  direction: "forward" | "backward",
): Selection {
  const node = getNodeByPath(state, position.path);
  if (!node) return createSelection(position, position);

  const content = getTextContent(node);

  if (direction === "forward") {
    const nextBoundary = nextGraphemeBoundary(content, position.offset);
    if (nextBoundary > position.offset) {
      const newPos = createPosition(position.path, nextBoundary);
      return createSelection(newPos, newPos);
    }
    // At end of node — try next text node
    const next = findNextTextNode(state, position.path);
    if (next) {
      const newPos = createPosition(next, 0);
      return createSelection(newPos, newPos);
    }
    return createSelection(position, position);
  } else {
    const prevBoundary = prevGraphemeBoundary(content, position.offset);
    if (prevBoundary < position.offset) {
      const newPos = createPosition(position.path, prevBoundary);
      return createSelection(newPos, newPos);
    }
    // At start of node — try previous text node
    const prev = findPrevTextNode(state, position.path);
    if (prev) {
      const prevNode = getNodeByPath(state, prev)!;
      const newPos = createPosition(prev, getTextContentLength(prevNode));
      return createSelection(newPos, newPos);
    }
    return createSelection(position, position);
  }
}

/**
 * Move cursor by one word in the given direction.
 */
export function moveByWord(
  state: StateNode,
  position: Position,
  direction: "forward" | "backward",
): Selection {
  const node = getNodeByPath(state, position.path);
  if (!node) return createSelection(position, position);

  const content = getTextContent(node);

  if (direction === "forward") {
    const boundary = nextWordBoundary(content, position.offset);
    if (boundary > position.offset) {
      const newPos = createPosition(position.path, boundary);
      return createSelection(newPos, newPos);
    }
    // At end — try next text node
    const next = findNextTextNode(state, position.path);
    if (next) {
      const newPos = createPosition(next, 0);
      return createSelection(newPos, newPos);
    }
    const newPos = createPosition(position.path, content.length);
    return createSelection(newPos, newPos);
  } else {
    const boundary = prevWordBoundary(content, position.offset);
    if (boundary < position.offset) {
      const newPos = createPosition(position.path, boundary);
      return createSelection(newPos, newPos);
    }
    // At start — try previous text node, move to *start of last word*
    const prev = findPrevTextNode(state, position.path);
    if (prev) {
      const prevNode = getNodeByPath(state, prev)!;
      const prevContent = getTextContent(prevNode);
      const prevBoundary = prevWordBoundary(prevContent, prevContent.length);
      const newPos = createPosition(prev, prevBoundary);
      return createSelection(newPos, newPos);
    }
    return createSelection(position, position);
  }
}

/**
 * Select the word surrounding the given position.
 * Returns an expanded selection spanning the word, or a collapsed
 * selection if the position is in empty text.
 */
export function selectWord(
  state: StateNode,
  position: Position,
): Selection {
  const node = getNodeByPath(state, position.path);
  if (!node) return createSelection(position, position);

  const content = getTextContent(node);
  if (content.length === 0) return createSelection(position, position);

  // Find the word segment containing the offset
  for (const seg of wordSegmenter.segment(content)) {
    const segEnd = seg.index + seg.segment.length;
    if (seg.isWordLike && seg.index <= position.offset && segEnd >= position.offset) {
      const anchor = createPosition(position.path, seg.index);
      const focus = createPosition(position.path, segEnd);
      return createSelection(anchor, focus);
    }
  }

  // Offset is on whitespace/punctuation — select the preceding word if any
  let lastWord: { index: number; length: number } | null = null;
  for (const seg of wordSegmenter.segment(content)) {
    if (seg.isWordLike && seg.index + seg.segment.length <= position.offset) {
      lastWord = { index: seg.index, length: seg.segment.length };
    }
  }
  if (lastWord) {
    const anchor = createPosition(position.path, lastWord.index);
    const focus = createPosition(position.path, lastWord.index + lastWord.length);
    return createSelection(anchor, focus);
  }

  // No preceding word — try the next word
  for (const seg of wordSegmenter.segment(content)) {
    if (seg.isWordLike && seg.index >= position.offset) {
      const anchor = createPosition(position.path, seg.index);
      const focus = createPosition(position.path, seg.index + seg.segment.length);
      return createSelection(anchor, focus);
    }
  }

  return createSelection(position, position);
}

/**
 * Expand a selection by moving the focus in a direction.
 * Anchor stays fixed, focus moves. Does NOT stop at virtual EOL.
 */
export function expandSelection(
  state: StateNode,
  selection: Selection,
  direction: "forward" | "backward",
): Selection {
  const moved = moveByCharacter(state, selection.focus, direction);
  return createSelection(selection.anchor, moved.focus);
}

/**
 * Expand a selection by one character with virtual EOL awareness.
 * Treats the paragraph break as an implicit character at offset `textLength + 1`.
 *
 * - Forward from textLength → textLength + 1 (virtual EOL)
 * - Forward from textLength + 1 → next text node offset 0
 * - Backward from textLength + 1 → textLength (deselect just the EOL indicator)
 * - Backward from 0 → previous text node's textLength + 1 (landing on EOL)
 * - All other cases: delegate to grapheme boundary movement
 */
export function expandSelectionByCharacter(
  state: StateNode,
  selection: Selection,
  direction: "forward" | "backward",
): Selection {
  const focus = selection.focus;
  const node = getNodeByPath(state, focus.path);
  if (!node) return selection;

  const textLength = getTextContentLength(node);

  if (direction === "forward") {
    if (focus.offset > textLength) {
      // At virtual EOL (textLength + 1) — equivalent to next node's offset 0.
      // Advance into the next node to avoid an invisible step.
      const next = findNextTextNode(state, focus.path);
      if (!next) return selection;
      const nextNode = getNodeByPath(state, next)!;
      const nextLength = getTextContentLength(nextNode);
      if (nextLength === 0) {
        // Empty next node — go to its virtual EOL (offset 1)
        return createSelection(selection.anchor, createPosition(next, 1));
      }
      const nextContent = getTextContent(nextNode);
      const boundary = nextGraphemeBoundary(nextContent, 0);
      return createSelection(selection.anchor, createPosition(next, boundary));
    }
    if (focus.offset === textLength) {
      // At end of text — if there's a next text node, go directly to its start.
      // Only use virtual EOL when there is no next line.
      const next = findNextTextNode(state, focus.path);
      if (next) {
        return createSelection(
          selection.anchor,
          createPosition(next, 0),
        );
      }
      return createSelection(
        selection.anchor,
        createPosition(focus.path, textLength + 1),
      );
    }
    // Within text — delegate to grapheme boundary
    const content = getTextContent(node);
    const nextBoundary = nextGraphemeBoundary(content, focus.offset);
    return createSelection(
      selection.anchor,
      createPosition(focus.path, nextBoundary),
    );
  } else {
    // backward
    if (focus.offset > textLength) {
      // At virtual EOL — go back to textLength
      return createSelection(
        selection.anchor,
        createPosition(focus.path, textLength),
      );
    }
    if (focus.offset === 0) {
      // At start of node — go to previous text node's EOL position (textLength).
      // textLength+1 (past the EOL) is the same conceptual position as this node's
      // offset 0, so landing there would be an invisible step.
      const prev = findPrevTextNode(state, focus.path);
      if (prev) {
        const prevNode = getNodeByPath(state, prev)!;
        return createSelection(
          selection.anchor,
          createPosition(prev, getTextContentLength(prevNode)),
        );
      }
      // No previous node — stay put
      return selection;
    }
    // Within text — delegate to grapheme boundary
    const content = getTextContent(node);
    const prevBoundary = prevGraphemeBoundary(content, focus.offset);
    return createSelection(
      selection.anchor,
      createPosition(focus.path, prevBoundary),
    );
  }
}

// --- Tree traversal helpers ---

/** Find the path of the next text node in document order. */
function findNextTextNode(
  root: StateNode,
  currentPath: readonly number[],
): number[] | null {
  // Walk right: try next sibling, then parent's next sibling, etc.
  const path = [...currentPath];
  while (path.length > 0) {
    const idx = path[path.length - 1] + 1;
    const parentPath = path.slice(0, -1);
    const parent = getNodeByPath(root, parentPath)!;
    if (idx < parent.children.length) {
      // Found a sibling — descend to its first text node
      path[path.length - 1] = idx;
      return descendToFirstText(root, path);
    }
    // No more siblings at this level — go up
    path.pop();
  }
  return null;
}

/** Find the path of the previous text node in document order. */
function findPrevTextNode(
  root: StateNode,
  currentPath: readonly number[],
): number[] | null {
  const path = [...currentPath];
  while (path.length > 0) {
    const idx = path[path.length - 1] - 1;
    if (idx >= 0) {
      path[path.length - 1] = idx;
      return descendToLastText(root, path);
    }
    path.pop();
  }
  return null;
}

/** Descend from a path to its first text leaf. */
function descendToFirstText(
  root: StateNode,
  path: number[],
): number[] | null {
  let node = getNodeByPath(root, path);
  if (!node) return null;
  while (node.type !== "text" && node.children.length > 0) {
    path.push(0);
    node = node.children[0];
  }
  return node.type === "text" ? path : null;
}

/** Descend from a path to its last text leaf. */
function descendToLastText(
  root: StateNode,
  path: number[],
): number[] | null {
  let node = getNodeByPath(root, path);
  if (!node) return null;
  while (node.type !== "text" && node.children.length > 0) {
    const lastIdx: number = node.children.length - 1;
    path.push(lastIdx);
    node = node.children[lastIdx];
  }
  return node.type === "text" ? path : null;
}

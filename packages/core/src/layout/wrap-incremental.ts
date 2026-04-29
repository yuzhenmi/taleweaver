import type { Token } from "./ifc";
import type { LineBox } from "./layout-box-v2";
import type { IFCState } from "./ifc-state";

/**
 * A function that wraps tokens starting from `startTokenIdx` into ONE line.
 * Returned line carries the indices of the first and last tokens it consumed
 * (via `startTokenIdx` / `endTokenIdx` fields) so the convergence detector
 * can identify reusable segments.
 *
 * Provided by the IFC; this module is agnostic to the actual line construction.
 */
export interface WrapOneLineResult {
  readonly line: LineBox;
  readonly startTokenIdx: number; // inclusive
  readonly endTokenIdx: number; // inclusive (last token consumed by this line)
  readonly availableInlineSize: number; // line width at this block-offset
}

export type WrapOneLineFn = (
  tokens: readonly Token[],
  startTokenIdx: number,
) => WrapOneLineResult;

/**
 * Compare two tokens for full content equality.
 * Compares: id, text, width, isSpace, isLineBreak, style (by reference),
 * inlineBlock (by reference), inlineAncestors (shallow array equality),
 * and inlineAncestorStyles (shallow array equality).
 */
function tokensEqual(a: Token, b: Token): boolean {
  if (a === b) return true;
  if (a.id !== b.id) return false;
  if (a.text !== b.text) return false;
  if (a.width !== b.width) return false;
  if (a.isSpace !== b.isSpace) return false;
  if (a.isLineBreak !== b.isLineBreak) return false;
  if (a.style !== b.style) return false;
  if (a.inlineBlock !== b.inlineBlock) return false;
  if (!arraysShallowEqual(a.inlineAncestors, b.inlineAncestors)) return false;
  if (!arraysShallowEqual(a.inlineAncestorStyles, b.inlineAncestorStyles)) return false;
  return true;
}

/**
 * Check if two arrays are equal by shallow reference comparison.
 */
function arraysShallowEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Find the index of the first token in `next` whose content differs from `prev[i]`,
 * or -1 if every token (up to the shorter length) matches completely.
 * This includes comparing text content, not just IDs, so same-length edits are detected.
 */
export function findChangePoint(
  prev: readonly Token[],
  next: readonly Token[],
): number {
  const len = Math.min(prev.length, next.length);
  for (let i = 0; i < len; i++) {
    if (!tokensEqual(prev[i], next[i])) return i;
  }
  if (prev.length !== next.length) return len; // tokens added/removed at end
  return -1; // identical
}

/**
 * Find the index of the line in `lines` that contains `tokenIdx`.
 * Returns the line index, or `lines.length` if past the last line.
 *
 * Each line carries metadata: `startTokenIdx` and `endTokenIdx`.
 * These are stored on the LineBox by the wrapping pass.
 */
export function findLineForToken(
  lines: readonly LineBox[],
  tokenIdx: number,
  lineMeta: WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>,
): number {
  for (let i = 0; i < lines.length; i++) {
    const meta = lineMeta.get(lines[i]);
    if (!meta) continue;
    if (tokenIdx >= meta.startTokenIdx && tokenIdx <= meta.endTokenIdx) return i;
  }
  return lines.length;
}

/**
 * Find the index of the line in `lines` that starts with the given `tokenIdx`.
 * Returns -1 if no line starts there.
 */
export function findLineByStartToken(
  lines: readonly LineBox[],
  tokenIdx: number,
  lineMeta: WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>,
): number {
  for (let i = 0; i < lines.length; i++) {
    const meta = lineMeta.get(lines[i]);
    if (!meta) continue;
    if (meta.startTokenIdx === tokenIdx) return i;
  }
  return -1;
}

/**
 * Re-wrap incrementally. If a previous wrap state exists and the available
 * inline-size hasn't changed, reuse lines that aren't affected by token changes
 * and detect convergence: when a new line's end-token is followed by a token
 * that starts a previous line at the same available-inline-size, reuse the
 * tail.
 *
 * @returns the new array of LineBoxes; some entries may be reference-equal to
 *   `prev?.lines` entries.
 */
export function rewrapIncremental(
  prev: IFCState | null,
  newTokens: readonly Token[],
  availableInlineSize: number,
  wrapOneLine: WrapOneLineFn,
  lineMeta: WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>,
): readonly LineBox[] {
  // Width changed: full re-wrap.
  if (!prev || prev.availableInlineSize !== availableInlineSize) {
    return wrapAll(newTokens, wrapOneLine, lineMeta);
  }

  const changePoint = findChangePoint(prev.tokens, newTokens);
  if (changePoint === -1) {
    // Tokens identical: full reuse.
    return prev.lines;
  }

  // Find the line that contains the change point.
  const startLineIdx = findLineForToken(prev.lines, changePoint, lineMeta);
  const reusedHead = prev.lines.slice(0, startLineIdx);
  const startMeta =
    startLineIdx < prev.lines.length
      ? lineMeta.get(prev.lines[startLineIdx])
      : undefined;
  const startTokenIdx = startMeta?.startTokenIdx ?? changePoint;

  // Re-wrap from startTokenIdx; check for convergence after each new line.
  const newLines: LineBox[] = [];
  let cursor = startTokenIdx;
  while (cursor < newTokens.length) {
    const r = wrapOneLine(newTokens, cursor);
    newLines.push(r.line);
    lineMeta.set(r.line, {
      startTokenIdx: r.startTokenIdx,
      endTokenIdx: r.endTokenIdx,
    });

    // Convergence: does any previous line start with the next token AND have
    // the same available inline-size? If so, reuse the tail.
    const nextTokenIdx = r.endTokenIdx + 1;
    const matchingPrev = findLineByStartToken(prev.lines, nextTokenIdx, lineMeta);
    if (matchingPrev !== -1) {
      const prevMeta = lineMeta.get(prev.lines[matchingPrev]);
      if (prevMeta && r.availableInlineSize === availableInlineSize) {
        // Convergence! Reuse prev.lines[matchingPrev..].
        return [...reusedHead, ...newLines, ...prev.lines.slice(matchingPrev)];
      }
    }

    cursor = r.endTokenIdx + 1;
  }

  return [...reusedHead, ...newLines];
}

function wrapAll(
  tokens: readonly Token[],
  wrapOneLine: WrapOneLineFn,
  lineMeta: WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>,
): readonly LineBox[] {
  const lines: LineBox[] = [];
  let cursor = 0;
  while (cursor < tokens.length) {
    const r = wrapOneLine(tokens, cursor);
    lines.push(r.line);
    lineMeta.set(r.line, {
      startTokenIdx: r.startTokenIdx,
      endTokenIdx: r.endTokenIdx,
    });
    cursor = r.endTokenIdx + 1;
  }
  return lines;
}

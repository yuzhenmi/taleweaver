import type { Token } from "./ifc";
import type { LineBox } from "./layout-box";
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
 * inlineAncestorStyles (shallow array equality), softBreaks (shallow array
 * equality, absent ≡ empty), and breakableBefore (absent ≡ true).
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
  // softBreaks / breakableBefore are pure derivations of the IFC source text, so
  // including them in the cache key never weakens it — it tracks the
  // already-implied source change.
  if (!arraysShallowEqual(a.softBreaks ?? EMPTY_NUM, b.softBreaks ?? EMPTY_NUM)) return false;
  if ((a.breakableBefore ?? true) !== (b.breakableBefore ?? true)) return false;
  return true;
}

/** Module-scope empty array to avoid per-call allocation in the softBreaks default. */
const EMPTY_NUM: readonly number[] = [];

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
    const a = prev[i];
    const b = next[i];
    if (a === undefined || b === undefined) {
      throw new Error(`wrap-incremental: token ${i} missing (unreachable, i < min length)`);
    }
    if (!tokensEqual(a, b)) return i;
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
  for (const [i, line] of lines.entries()) {
    const meta = lineMeta.get(line);
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
  for (const [i, line] of lines.entries()) {
    const meta = lineMeta.get(line);
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
 *
 * NOT YET WIRED into the IFC's main wrap loop (P18 — "Cascade + layout
 * incremental polish"; gated on P9 generated-content reference-equality). The
 * IFC today does all-or-nothing reuse via `findChangePoint` (identical tokens →
 * reuse the whole paragraph; any change → full re-wrap), which already delivers
 * the dominant win (every UN-edited paragraph is reused every keystroke; the
 * paragraph cache covers the large majority of the benefit). This function adds
 * PARTIAL reuse within the single edited paragraph — only material for very long
 * paragraphs. It is foundation-built-ahead (the convergence algorithm), not a
 * drop-in: wiring it CORRECTLY requires solving four integration hazards this
 * module does not yet address (doing it without them would ship a degraded,
 * incorrect partial-reuse — forbidden by the no-degraded-feature directive):
 *
 *   1. Tail vertical-repositioning. Reused tail `LineBox`es are returned BY
 *      REFERENCE, including their baked-in `y`. An edit that adds or removes a
 *      head line shifts every tail line vertically; the convergence detector
 *      matches on token boundaries, not `y`, so the reused tail would keep a
 *      stale block-offset. A correct wire-in must re-stamp the tail's `y`
 *      (and any block-offset-derived geometry) after a head line-count change.
 *   2. Float-environment gate. Convergence checks only `availableInlineSize`
 *      equality, not the float intrusion profile at the tail's NEW block offset
 *      (`effectiveLineDims` varies the line box by vertical position). A reused
 *      tail line could carry the wrong width under floats. The virtualized-
 *      layout design already makes float/`clear` docs fall back to the legacy
 *      full path for the same reason.
 *   3. Bidi-context gate. The IFC's reorder pass runs per line but depends on
 *      paragraph-level base direction / bidi runs; partial reuse must confirm
 *      the surrounding bidi context is unchanged before reusing a line.
 *   4. Fragmentation interaction. The IFC bypasses the wrap cache entirely when
 *      fragmentation is active (a cached box holds ALL lines, not a partial
 *      fragment); partial reuse must respect `IFCBreakToken` boundaries.
 *
 * Additionally, hyphenated splitting complicates the contiguous-token-range
 * invariant the convergence detector relies on.
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
  const startLine = prev.lines[startLineIdx]; // undefined when startLineIdx === length (past last line)
  const startMeta = startLine !== undefined ? lineMeta.get(startLine) : undefined;
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
    const matchingLine = matchingPrev !== -1 ? prev.lines[matchingPrev] : undefined;
    if (matchingLine !== undefined) {
      const prevMeta = lineMeta.get(matchingLine);
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

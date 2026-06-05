import type { LineLeaf, AbsoluteLineBox } from "./line-flatten";
import { collectLineLeaves } from "./line-flatten";
import type { Direction } from "../styles";
import type { TextMeasurer } from "../layout/text-measurer";

/**
 * One non-synthetic leaf of a line, paired with its LOGICAL state span and
 * resolved bidi level. `leaf` is the visual-order `LineLeaf` (carrying
 * `absoluteX`/`width`/`computedStyle`/`box`); `logStart`/`logEnd` are the
 * STATE-model offsets it owns; `level` is its UAX #9 embedding level (even =
 * LTR, odd = RTL).
 *
 * The SAME object is referenced from both `LineBidiView.visualLeaves` and
 * `.logicalLeaves` — the two arrays differ only in ORDER.
 */
export interface BidiViewLeaf {
  readonly leaf: LineLeaf;
  /** First STATE offset this leaf owns (inclusive). */
  readonly logStart: number;
  /** STATE offset just past the last this leaf owns (exclusive). */
  readonly logEnd: number;
  /** UAX #9 embedding level; even = LTR, odd = RTL. */
  readonly level: number;
}

/**
 * The per-line bidi view (P4-C.2 spec §A): the single place that knows the
 * VISUAL↔LOGICAL leaf correspondence for one line. Pure, built on demand per
 * resolved line, no persistent state.
 *
 *   - `visualLeaves`  — the leaves in COLLECTION (visual, post-reorder) order.
 *   - `logicalLeaves` — the same objects re-ordered by ascending `sourceStart`
 *                       (== logical/state order).
 *   - `paragraphDirection` — the line's resolved `direction`.
 *   - `isEmpty` — true for a strut-only line (no caret-target leaves).
 */
export interface LineBidiView {
  readonly visualLeaves: readonly BidiViewLeaf[];
  readonly logicalLeaves: readonly BidiViewLeaf[];
  readonly paragraphDirection: Direction;
  readonly isEmpty: boolean;
}

/**
 * Is this leaf a SYNTHETIC run that owns no state positions (the empty-paragraph
 * strut, the synthetic hyphen)? Such runs have `offsetLength === 0` AND no
 * `sourceStart`. They keep painting; they are simply not caret targets, so they
 * are excluded from the bidi view (spec §A "synthetic runs excluded", C-2). This
 * also avoids a `NaN`-sort hazard from comparing an `undefined` `sourceStart`.
 *
 * `InlineBlockBox` always owns one state unit (`offsetContribution === 1`,
 * `box.offsetLength` is absent) so it is never synthetic; the guard only ever
 * fires for a zero-width `TextRunBox`.
 */
function isSyntheticLeaf(leaf: LineLeaf): boolean {
  return (
    leaf.kind === "text-run" &&
    leaf.box.offsetLength === 0 &&
    leaf.box.sourceStart === undefined
  );
}

/**
 * Build the `LineBidiView` for one absolute line (P4-C.2 spec §A).
 *
 * Algorithm:
 *   1. Collect the line's leaves in VISUAL order (`collectLineLeaves`).
 *   2. EXCLUDE synthetic runs (struts/hyphens). If none remain → `isEmpty`.
 *   3. LOGICAL order = ascending `box.sourceStart` (it orders the sequence;
 *      `text-transform` changes a run's length, never its position, so source
 *      order == state order). `sourceStart` is ONLY a sort key — never added to
 *      a state offset.
 *   4. Accumulate STATE spans in LOGICAL order:
 *        `logStart(k) = inlineOffsetStart + Σ_{j<k} offsetLength(j)`,
 *        `logEnd(k)   = logStart(k) + offsetLength(k)`
 *      (`offsetContribution` is the leaf's STATE span). Entirely in STATE space.
 *   5. `level = box.bidiLevel ?? paragraphLevel`.
 */
export function buildLineBidiView(alb: AbsoluteLineBox): LineBidiView {
  const paragraphDirection = alb.line.computedStyle.direction;
  const paragraphLevel = paragraphDirection === "rtl" ? 1 : 0;

  const rawLeaves = collectLineLeaves(alb.line, alb.absoluteX);
  const contentLeaves = rawLeaves.filter((leaf) => !isSyntheticLeaf(leaf));

  if (contentLeaves.length === 0) {
    return {
      visualLeaves: [],
      logicalLeaves: [],
      paragraphDirection,
      isEmpty: true,
    };
  }

  // LOGICAL order: ascending sourceStart. We sort a COPY of the visual leaves so
  // we can accumulate state spans in logical order, then map each logical leaf
  // back to its BidiViewLeaf. A non-synthetic leaf always carries a defined
  // `sourceStart` (guaranteed by `isSyntheticLeaf` excluding the undefined-source
  // runs), so the comparator never compares `undefined`.
  const logicalOrder = contentLeaves
    .map((leaf, visualIndex) => ({ leaf, visualIndex }))
    .sort((a, b) => sourceStartOf(a.leaf) - sourceStartOf(b.leaf));

  // Accumulate STATE spans in LOGICAL order. The first logical leaf starts at the
  // line's inlineOffsetStart; each subsequent leaf starts where the previous
  // ended. `offsetContribution` is the leaf's STATE span (text-run offsetLength,
  // or 1 for an inline-block).
  const byVisualIndex = new Map<number, BidiViewLeaf>();
  let cursor = alb.line.inlineOffsetStart;
  for (const { leaf, visualIndex } of logicalOrder) {
    const logStart = cursor;
    const logEnd = logStart + leaf.offsetContribution;
    cursor = logEnd;
    const level = leaf.box.bidiLevel ?? paragraphLevel;
    byVisualIndex.set(visualIndex, { leaf, logStart, logEnd, level });
  }

  // `visualLeaves` in collection order; `logicalLeaves` in sorted order. Both
  // reference the SAME BidiViewLeaf objects.
  const visualLeaves: BidiViewLeaf[] = contentLeaves.map((_, visualIndex) => {
    const v = byVisualIndex.get(visualIndex);
    if (v === undefined) {
      // Unreachable: every visual index is populated above. Defensive throw to
      // keep the return type non-optional without a non-null assertion.
      throw new Error("buildLineBidiView: missing leaf for visual index");
    }
    return v;
  });
  const logicalLeaves: BidiViewLeaf[] = logicalOrder.map(({ visualIndex }) => {
    const v = byVisualIndex.get(visualIndex);
    if (v === undefined) {
      throw new Error("buildLineBidiView: missing leaf for logical index");
    }
    return v;
  });

  return { visualLeaves, logicalLeaves, paragraphDirection, isEmpty: false };
}

/** Non-synthetic leaves always carry a `sourceStart`; default 0 defensively. */
function sourceStartOf(leaf: LineLeaf): number {
  return leaf.box.sourceStart ?? 0;
}

/**
 * Caret X for a STATE offset within a leaf (P4-C.2 spec §B intra-leaf).
 *
 *   - text-run: convert the leaf-local STATE offset to a DISPLAY index via
 *     `sourceDisplayLengths` (1:1 when absent), measure the display prefix, then
 *     LTR → `absoluteX + w`, RTL → `absoluteX + width − w`.
 *   - inline-block: the atomic box owns one state unit; X is the leading edge
 *     at `logStart` else the trailing edge (lifted from cursor-position.ts's
 *     inline-block branch).
 *
 * `stateOffset` is clamped to `[logStart, logEnd]`.
 */
export function caretXInLeaf(
  v: BidiViewLeaf,
  stateOffset: number,
  measurer: TextMeasurer,
): number {
  const leaf = v.leaf;
  const localState = clamp(stateOffset, v.logStart, v.logEnd) - v.logStart;

  if (leaf.kind === "inline-block") {
    // Atomic embed: leading edge at logStart, trailing edge past it. Mirrors
    // cursor-position.ts's inline-block branch (`localOffset === 0 ? leading :
    // trailing`).
    return localState === 0 ? leaf.absoluteX : leaf.absoluteX + leaf.width;
  }

  // text-run. STATE → DISPLAY index via sourceDisplayLengths (mirrors
  // cursor-position.ts's state→display prefix sum). When absent, state index ===
  // display index (the 1:1 / untransformed case).
  const localDisplay = stateToDisplay(leaf.box.sourceDisplayLengths, localState, leaf.box.text.length);
  const prefix = leaf.box.text.slice(0, localDisplay);
  const w = measurer.measureWidth(prefix, leaf.computedStyle);

  if (v.level % 2 === 0) {
    // LTR leaf: prefix grows left→right.
    return leaf.absoluteX + w;
  }
  // RTL leaf: the logically-earlier prefix sits at the RIGHT edge.
  return leaf.absoluteX + leaf.width - w;
}

/**
 * Inverse of `caretXInLeaf`: the STATE offset for a LEAF-LOCAL X (`localX =
 * clickX − leaf.absoluteX`) (P4-C.2 spec §C intra-leaf).
 *
 *   - text-run: LTR → `findCharOffset(text, localX)`; RTL →
 *     `offsetLength − findCharOffset(text, width − localX)`. The display offset
 *     is reverse-mapped to STATE via `sourceDisplayLengths`, then added to
 *     `logStart`.
 *   - inline-block: `localX < width/2` → `logStart`, else `logEnd` (lifted from
 *     hit-test.ts's inline-block midpoint split).
 */
export function offsetInLeaf(
  v: BidiViewLeaf,
  localX: number,
  measurer: TextMeasurer,
): number {
  const leaf = v.leaf;

  if (leaf.kind === "inline-block") {
    // Midpoint split (lifted from hit-test.ts:185-186): left half → before the
    // embed (logStart), right half → after it (logEnd).
    const midpoint = leaf.width / 2;
    return localX >= midpoint ? v.logEnd : v.logStart;
  }

  const sdl = leaf.box.sourceDisplayLengths;
  let stateLocal: number;
  if (v.level % 2 === 0) {
    // LTR leaf: measured from the left edge.
    const displayOffset = findCharOffset(leaf.box.text, localX, leaf.computedStyle, measurer);
    stateLocal = sdl ? stateOffsetOf(sdl, displayOffset) : displayOffset;
  } else {
    // RTL leaf: `caretXInLeaf` places the logical prefix of width `w` at
    // `absoluteX + width − w`, so `w = width − localX`. `findCharOffset(text,
    // width − localX)` returns exactly that logical prefix's DISPLAY length —
    // the inverse of the caret-X formula (no extra mirroring; `text` is already
    // the LOGICAL string measured from its own start). Map display → state.
    const displayOffset = findCharOffset(
      leaf.box.text,
      leaf.width - localX,
      leaf.computedStyle,
      measurer,
    );
    stateLocal = sdl ? stateOffsetOf(sdl, displayOffset) : displayOffset;
  }
  return v.logStart + stateLocal;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(value, hi));
}

/**
 * Convert a leaf-local STATE offset to a DISPLAY-string index using the run's
 * `sourceDisplayLengths` (per-state-code-unit display-unit counts). When absent,
 * state index === display index. Clamped to the rendered text length.
 *
 * Mirrors the prefix-sum in `cursor-position.ts`'s text-run branch
 * (`sdl.slice(0, localOffset).reduce(...)`). Re-implemented here (not imported)
 * because that helper is private to `cursor-position.ts`; P4-C.2.1+ migrates the
 * consumers onto these shared helpers.
 */
function stateToDisplay(
  sdl: readonly number[] | undefined,
  localState: number,
  textLength: number,
): number {
  if (sdl === undefined) {
    return Math.min(localState, textLength);
  }
  let sum = 0;
  for (let i = 0; i < localState && i < sdl.length; i++) {
    sum += sdl[i];
  }
  return Math.min(sum, textLength);
}

/**
 * Reverse-map a DISPLAY code-unit offset `d` to a STATE offset via
 * `sourceDisplayLengths`, returning the nearest SOURCE boundary (never an
 * interior offset that would split an expanding unit like ß→SS). Lifted verbatim
 * from `hit-test.ts`'s private `stateOffsetOf` (P4-C.2.1+ will dedupe the
 * consumers onto this copy).
 */
function stateOffsetOf(sdl: readonly number[], d: number): number {
  let cum = 0;
  for (let o = 0; o < sdl.length; o++) {
    const next = cum + sdl[o];
    if (d <= cum) return o;
    if (d < next) return d - cum < next - d ? o : o + 1; // nearest boundary
    cum = next;
  }
  return sdl.length;
}

/**
 * Find the DISPLAY char offset closest to `localX` within `text` (binary search
 * on memoized prefix widths). Lifted verbatim from `hit-test.ts`'s private
 * `findCharOffset` (P4-C.2.1+ will dedupe the consumers onto this copy).
 */
function findCharOffset(
  text: string,
  localX: number,
  styles: Parameters<TextMeasurer["measureWidth"]>[1],
  measurer: TextMeasurer,
): number {
  if (localX <= 0) return 0;
  if (text.length === 0) return 0;

  const widthCache = new Map<number, number>();
  widthCache.set(0, 0);
  const widthOfPrefix = (n: number): number => {
    let v = widthCache.get(n);
    if (v === undefined) {
      v = measurer.measureWidth(text.slice(0, n), styles);
      widthCache.set(n, v);
    }
    return v;
  };

  const fullW = widthOfPrefix(text.length);
  const lastMidpoint = (widthOfPrefix(text.length - 1) + fullW) / 2;
  if (localX >= lastMidpoint) return text.length;

  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const midpoint = (widthOfPrefix(mid - 1) + widthOfPrefix(mid)) / 2;
    if (midpoint > localX) hi = mid;
    else lo = mid + 1;
  }
  return lo - 1;
}

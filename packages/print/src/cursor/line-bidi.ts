import type { LineLeaf, AbsoluteLineBox } from "./line-flatten";
import { collectLineLeaves, coordOf, sizeAlong } from "./line-flatten";
import type { Direction } from "@taleweaver/core";
import type { AxisMap } from "@taleweaver/core";
import { axisMapFor } from "@taleweaver/core";
import type { TextMeasurer } from "@taleweaver/core";
import type { CaretAffinity } from "@taleweaver/core";

// `CaretAffinity` is a pure selection-model type (a geometry-free 2-value union);
// its single declaration lives in the core selection module (`./selection`). It
// is re-exported here so this file's bidi/print consumers (which already import
// it FROM `./line-bidi`) keep working unchanged.
export type { CaretAffinity } from "@taleweaver/core";

/** Visual (physical) horizontal motion direction from the arrow key. */
export type VisualDirection = "left" | "right";

/**
 * Take exactly one grapheme-cluster step in STATE space, in the given LOGICAL
 * direction, starting at block-relative state `offset`. The caller supplies this
 * (it owns the block's inline content); `moveVisually` is otherwise pure on the
 * `LineBidiView`. `"forward"` returns the next grapheme boundary at or after
 * `offset`; `"backward"` the previous one. Must clamp at the block ends.
 */
export type GraphemeStepper = (
  offset: number,
  direction: "forward" | "backward",
) => number;

/**
 * Result of `moveVisually`: either a new in-line caret `{ offset, affinity }`,
 * or an `{ exit }` signal that the motion ran off the line's visual edge (the
 * caller moves to the visual start/end of the adjacent line).
 *
 * `exit` is the visual edge crossed; `exitLogicalDir` is the STATE-space
 * direction that continues past that edge. The two are NOT always aligned: at
 * the visual-`exit` edge the run there may be LTR or RTL, and for an RTL run the
 * logical direction is flipped (visual-left of an RTL run = logical-FORWARD).
 * The caller steps `moveByCharacter` in `exitLogicalDir` so a pure-RTL run (even
 * one embedded in an LTR paragraph) does not warp back into itself.
 */
export type MoveVisuallyResult =
  | { readonly offset: number; readonly caretAffinity: CaretAffinity }
  | { readonly exit: VisualDirection; readonly exitLogicalDir: "forward" | "backward" };

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
  /**
   * The line's axis map (`axisMapFor(line.writingMode,
   * line.computedStyle.direction)`): which physical axis each logical axis maps
   * to. Carried on the view so the caret-X / offset / selection-interval helpers
   * project the INLINE axis to the right physical letter (x for h-tb, y for
   * vertical) without re-deriving it. `direction` is sourced from
   * `computedStyle.direction` (the canonical source, M3) — the same field
   * `paragraphDirection` reads.
   */
  readonly axisMap: AxisMap;
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
  // M3: the canonical direction source is `computedStyle.direction` (same field
  // `paragraphDirection` reads); writing-mode comes off the line box.
  const axisMap = axisMapFor(alb.line.writingMode, paragraphDirection);

  const rawLeaves = collectLineLeaves(alb.line, alb.absoluteX, alb.absoluteY);
  const contentLeaves = rawLeaves.filter((leaf) => !isSyntheticLeaf(leaf));

  if (contentLeaves.length === 0) {
    return {
      visualLeaves: [],
      logicalLeaves: [],
      paragraphDirection,
      axisMap,
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

  return { visualLeaves, logicalLeaves, paragraphDirection, axisMap, isEmpty: false };
}

/** Non-synthetic leaves always carry a `sourceStart`; default 0 defensively. */
function sourceStartOf(leaf: LineLeaf): number {
  return leaf.box.sourceStart ?? 0;
}

/**
 * Caret INLINE-AXIS coordinate for a STATE offset within a leaf (P4-C.2 spec §B
 * intra-leaf, P3.5a generalized to the inline axis).
 *
 *   - text-run: convert the leaf-local STATE offset to a DISPLAY index via
 *     `sourceDisplayLengths` (1:1 when absent), measure the display prefix, then
 *     even-level → `base + w`, odd-level → `base + size − w`, where `base`/`size`
 *     are the leaf's coord/extent along the INLINE physical axis (`am.inline`).
 *   - inline-block: the atomic box owns one state unit; the coord is the leading
 *     edge at `logStart` else the trailing edge.
 *
 * The base coord + extent are projected onto the inline axis via `am`
 * (`coordOf`/`sizeAlong`), so for h-tb (`am.inline === "x"`) this returns the
 * physical X exactly as before; for vertical (`am.inline === "y"`) it returns a
 * physical-Y value (inline runs down the page).
 *
 * **C2 (load-bearing):** the `v.level % 2` parity branch is the INTRA-leaf visual
 * direction (already baked against the physicalized coords) and is UNTOUCHED.
 * `am.inlineReversed` is NOT applied here — that would double-reverse the
 * paragraph direction the box physicalization already encodes.
 *
 * `stateOffset` is clamped to `[logStart, logEnd]`.
 */
export function caretInlineCoordInLeaf(
  v: BidiViewLeaf,
  stateOffset: number,
  measurer: TextMeasurer,
  am: AxisMap,
): number {
  const leaf = v.leaf;
  const localState = clamp(stateOffset, v.logStart, v.logEnd) - v.logStart;
  const base = coordOf(leaf, am.inline);
  const size = sizeAlong(leaf, am.inline);

  if (leaf.kind === "inline-block") {
    // Atomic embed: leading edge at logStart, trailing edge past it.
    return localState === 0 ? base : base + size;
  }

  // text-run. STATE → DISPLAY index via sourceDisplayLengths (mirrors
  // cursor-position.ts's state→display prefix sum). When absent, state index ===
  // display index (the 1:1 / untransformed case).
  const localDisplay = stateToDisplay(leaf.box.sourceDisplayLengths, localState, leaf.box.text.length);
  // At the leaf's TRAILING edge (full text) the caret sits at the box's actual
  // inline extent — which can EXCEED the natural glyph width when the leaf is a
  // justification-widened space: `text-align: justify` distributes the line's
  // slack into each interior space's `box.width` (see ifc.ts `justifyUnits`), but
  // `measureWidth(" ")` returns the un-stretched advance. Using `size` here (not a
  // re-measure) lands the trailing coord on the widened box edge, so a partial
  // selection across a justified space has no gap before the next word. For an
  // un-stretched leaf `size === measureWidth(fullText)`, so this is byte-identical.
  const w =
    localDisplay >= leaf.box.text.length
      ? size
      : measurer.measureWidth(leaf.box.text.slice(0, localDisplay), leaf.computedStyle);

  if (v.level % 2 === 0) {
    // Even (LTR) leaf: prefix grows toward the inline-end.
    return base + w;
  }
  // Odd (RTL) leaf: the logically-earlier prefix sits at the far inline edge.
  return base + size - w;
}

/**
 * Inverse of `caretInlineCoordInLeaf`: the STATE offset for a LEAF-LOCAL INLINE
 * offset (`localInline = clickInline − coordOf(leaf, am.inline)`) (P4-C.2 spec §C
 * intra-leaf, P3.5a generalized to the inline axis).
 *
 *   - text-run: even-level → `findCharOffset(text, localInline)`; odd-level →
 *     measured from `size − localInline`. The display offset is reverse-mapped to
 *     STATE via `sourceDisplayLengths`, then added to `logStart`.
 *   - inline-block: `localInline < size/2` → `logStart`, else `logEnd`.
 *
 * The extent (`size`) is the leaf's INLINE-axis extent (`sizeAlong(leaf,
 * am.inline)`). For h-tb this is `leaf.width` (unchanged); for vertical it is
 * `leaf.height`. **C2:** the `v.level % 2` parity branch is UNTOUCHED;
 * `am.inlineReversed` is not applied here.
 *
 * Justify interaction: `caretInlineCoordInLeaf` now lands the leaf-trailing coord
 * on the widened `size` for a justify-stretched space (box width > natural glyph
 * width). This stays the correct INVERSE: `findCharOffset` here measures natural
 * glyph widths, so a click anywhere in the expanded region `(naturalWidth/2, size]`
 * resolves to `text.length` (its `lastMidpoint` guard fires at `naturalWidth/2`)
 * → the trailing state offset — exactly the offset whose caret coord is now
 * `base + size`. The round-trip holds; the widened space just has a larger
 * trailing hit zone.
 */
export function offsetInLeaf(
  v: BidiViewLeaf,
  localInline: number,
  measurer: TextMeasurer,
  am: AxisMap,
): number {
  const leaf = v.leaf;
  const size = sizeAlong(leaf, am.inline);

  if (leaf.kind === "inline-block") {
    // Midpoint split: first half → before the embed (logStart), second half →
    // after it (logEnd).
    const midpoint = size / 2;
    return localInline >= midpoint ? v.logEnd : v.logStart;
  }

  const sdl = leaf.box.sourceDisplayLengths;
  let stateLocal: number;
  if (v.level % 2 === 0) {
    // Even (LTR) leaf: measured from the inline-start edge.
    const displayOffset = findCharOffset(leaf.box.text, localInline, leaf.computedStyle, measurer);
    stateLocal = sdl ? stateOffsetOf(sdl, displayOffset) : displayOffset;
  } else {
    // Odd (RTL) leaf: `caretInlineCoordInLeaf` places the logical prefix of width
    // `w` at `base + size − w`, so `w = size − localInline`. `findCharOffset(text,
    // size − localInline)` returns exactly that logical prefix's DISPLAY length —
    // the inverse of the caret-coord formula (no extra mirroring; `text` is
    // already the LOGICAL string measured from its own start). Map display →
    // state.
    const displayOffset = findCharOffset(
      leaf.box.text,
      size - localInline,
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
 * The dual-caret boundary tiebreak (load-bearing — site of #500/#502/#503
 * fixes). At a bidi/run boundary an offset can be owned by the candidate ENDING
 * at it (`endingIdx`) or the candidate STARTING at it (`startingIdx`); the
 * `affinity` picks the side:
 *   - `"before"` → the ENDING candidate (the run/leaf whose `logEnd` is here).
 *   - `"after"` / undefined → the STARTING candidate (whose `logStart` is here).
 * When the preferred side is absent the other is used; a missing candidate is
 * signalled by `-1`, and `-1` is returned only when BOTH are absent (callers
 * guard that case). Shared by `findLeafOwner` (logical-order walk → leaf for
 * coord placement) and `findOwningVisualIndex` (visual-order walk → index for
 * `moveVisually` crossing) so the rule lives in exactly one place.
 */
function pickDualCaretSide(
  affinity: CaretAffinity | undefined,
  endingIdx: number,
  startingIdx: number,
): number {
  if (affinity === "before") {
    return endingIdx >= 0 ? endingIdx : startingIdx;
  }
  return startingIdx >= 0 ? startingIdx : endingIdx;
}

/**
 * Find the `BidiViewLeaf` whose STATE span owns `stateOffset`, walking
 * `logicalLeaves` (LOGICAL/state order, contiguous spans). At a leaf boundary
 * (`stateOffset === leaf.logEnd === nextLeaf.logStart`) the caret has two visual
 * positions (the bidi dual caret); `affinity` disambiguates which leaf owns it:
 *   - `"before"` → the leaf ENDING at the offset (its `logEnd`).
 *   - `"after"` / undefined → the leaf STARTING at it (its `logStart`).
 *
 * Lives in `line-bidi.ts` because `BidiViewLeaf` is defined here and the
 * dual-caret boundary rule is bidi-domain knowledge; both `cursor-position.ts`
 * (caret placement) and `selection-geometry.ts` (selection-extent endpoints)
 * depend on the SAME ownership rule, so it is shared from here.
 *
 * `logicalLeaves` is non-empty (the empty-line case is handled by callers).
 */
export function findLeafOwner(
  logicalLeaves: readonly BidiViewLeaf[],
  stateOffset: number,
  affinity?: CaretAffinity,
): BidiViewLeaf {
  for (let i = 0; i < logicalLeaves.length; i++) {
    const leaf = logicalLeaves[i];
    if (leaf === undefined) {
      throw new Error(`findLeafOwner: logicalLeaves[${i}] missing (unreachable)`);
    }
    if (stateOffset < leaf.logEnd) {
      // Strictly inside this leaf's span (or at its logStart): it owns the
      // offset. (Offsets before the first leaf's logStart can't occur — callers
      // clamp to `line.inlineOffsetStart === logicalLeaves[0].logStart`.)
      return leaf;
    }
    if (stateOffset === leaf.logEnd) {
      // Boundary. THIS leaf ends here; the NEXT leaf (if any) starts here. The
      // shared tiebreak picks the side from `affinity` ("before" → this/ending
      // leaf, "after"/undefined → the next/starting leaf when present).
      const startingIdx = i + 1 < logicalLeaves.length ? i + 1 : -1;
      const chosen = pickDualCaretSide(affinity, i, startingIdx);
      const chosenLeaf = logicalLeaves[chosen];
      if (chosenLeaf === undefined) {
        throw new Error(`findLeafOwner: logicalLeaves[${chosen}] missing (unreachable)`);
      }
      return chosenLeaf;
    }
    // Offset past this leaf's span — continue to the next leaf.
  }
  // Past the last leaf's logEnd (defensive — callers clamp to
  // `line.inlineOffsetEnd === last.logEnd`, so this is unreachable). Return the
  // last leaf so the caret pins to its trailing edge.
  const lastLeaf = logicalLeaves[logicalLeaves.length - 1];
  if (lastLeaf === undefined) {
    throw new Error("findLeafOwner: logicalLeaves is empty (unreachable)");
  }
  return lastLeaf;
}

/**
 * Resolve a `(offset, affinity)` to its VISUAL INLINE-AXIS coordinate on a line
 * — the visual position the caret/selection endpoint draws at, accounting for
 * bidi reordering. Used by the #503 selection visual-extent path: the highlight
 * is the contiguous inline interval between the anchor's and focus's resolved
 * visual coords, so each Shift+Arrow press grows it monotonically (instead of the
 * logical-range path's transient-empty collapse at a direction boundary).
 *
 * Steps:
 *   1. `findLeafOwner(view.logicalLeaves, offset, affinity)` picks the leaf that
 *      owns the offset (at a bidi boundary `offset === leafA.logEnd ===
 *      leafB.logStart` the affinity disambiguates: `"before"` → the leaf ENDING
 *      here, `"after"`/undefined → the leaf STARTING here).
 *   2. `caretInlineCoordInLeaf` computes the raw inline coord within that leaf
 *      (even-level → `base + w`, odd-level → `base + size − w`).
 *   3. Clamp to the owner leaf's own inline-axis box edges (`[leafLo, leafHi]`),
 *      the same #338-P2 clamp `selectionRectsForLineRange` applies: a CLAMPED
 *      hung trailing-space run has IFC width 0 at the content edge, but the
 *      prefix measurement still adds ~one glyph advance — clamping pins the
 *      coord to the (clamped) box edge so selection geometry and caret coord
 *      agree.
 *
 * Returns the INLINE-axis PHYSICAL coord (x for horizontal-tb, y for vertical
 * writing modes — this falls out of `caretInlineCoordInLeaf` projecting through
 * `view.axisMap.inline`, so it is never hardcoded to x).
 *
 * `view.isEmpty` (strut-only line) → returns 0 defensively; the selection-extent
 * caller's own `isEmpty` fast-path runs first, so this branch is unreachable in
 * practice (the guard keeps the return non-optional without indexing an empty
 * `logicalLeaves`).
 */
export function inlineCoordForOffset(
  view: LineBidiView,
  offset: number,
  affinity: CaretAffinity | undefined,
  measurer: TextMeasurer,
): number {
  if (view.isEmpty) return 0;
  const am = view.axisMap;
  const owner = findLeafOwner(view.logicalLeaves, offset, affinity);
  const raw = caretInlineCoordInLeaf(owner, offset, measurer, am);
  const leafLo = coordOf(owner.leaf, am.inline);
  const leafHi = leafLo + sizeAlong(owner.leaf, am.inline);
  return clamp(raw, leafLo, leafHi);
}

/**
 * One VISUAL highlight interval `[xLo, xHi]` (xLo <= xHi) for a selection
 * segment, paired with the embedding `level` of the run that produced it (used
 * by `selectionRectsForLineRange` to coalesce ONLY physically-adjacent
 * same-`level` runs — never across a direction boundary).
 */
interface VisualInterval {
  xLo: number;
  xHi: number;
  level: number;
}

/** Two x-coords are physically the same point if within this epsilon (px). */
const X_EPSILON = 1e-6;

/**
 * Segment a line-local LOGICAL selection range `[rangeStartOffset,
 * rangeEndOffset)` into its VISUAL highlight intervals (P4-C.2 spec §F).
 *
 * A contiguous logical range can map to MULTIPLE disjoint visual intervals
 * once the line is bidi-reordered: each leaf the range overlaps contributes one
 * interval, computed from the §B caret-X formula at BOTH clipped endpoints. For
 * an LTR leaf the logically-earlier offset is the LOWER x; for an RTL leaf the
 * endpoints SWAP (the logically-later offset sits at the LOWER x). Both are
 * emitted as `xLo <= xHi`, so a rect's width is never negative — fixing the
 * legacy `endX - startX` strip which could go negative on a reordered line.
 *
 * Coalescing: two adjacent intervals merge into one ONLY when they are
 * physically adjacent (`prev.xHi === next.xLo` within `X_EPSILON`) AND share the
 * same embedding `level` (a single maximal same-direction run). Two
 * logically-distinct runs that merely abut visually are kept SEPARATE so the
 * highlight reflects the true visual segments. Thus a pure-LTR or pure-RTL range
 * yields ONE interval; a boundary-crossing range yields >= 2.
 *
 * Walks `view.logicalLeaves` (logical order) so intervals come out in logical
 * order; coalescing is intentionally adjacency-based (not a global sort), so it
 * only fuses runs that are BOTH logically and physically contiguous.
 *
 * Empty `view` (strut line) or an empty clipped range yields `[]`.
 */
export function selectionRectsForLineRange(
  view: LineBidiView,
  rangeStartOffset: number,
  rangeEndOffset: number,
  measurer: TextMeasurer,
): VisualInterval[] {
  if (view.isEmpty || rangeEndOffset <= rangeStartOffset) return [];

  const am = view.axisMap;
  const intervals: VisualInterval[] = [];
  for (const v of view.logicalLeaves) {
    // Clip the range to this leaf's logical span.
    const a = Math.max(rangeStartOffset, v.logStart);
    const b = Math.min(rangeEndOffset, v.logEnd);
    if (b <= a) continue; // no overlap with this leaf

    const ltr = v.level % 2 === 0;
    // §B caret inline-coord at both clipped endpoints. Even-level: a → lower,
    // b → higher. Odd-level: the logically-later offset sits LOWER, so the
    // endpoints swap (b → lower, a → higher). Emit as xLo <= xHi (width never < 0).
    //
    // #338 P2 clamp (I2): pin each endpoint to the OWNING leaf's own inline-axis
    // box edges (`[coordOf(leaf, am.inline), + sizeAlong(leaf, am.inline)]`). For
    // a CLAMPED hung trailing-space run (the IFC gave it width 0 at the content
    // edge), `caretInlineCoordInLeaf`'s prefix measurement still adds ~one glyph
    // advance, which would land a selection rect PAST the content edge. Clamping
    // pins it to the (clamped) box edge — mirrors `cursor-position.ts`'s
    // identical clamp so selection geometry and caret coord agree.
    // Direction-agnostic: even-level hits the upper bound, odd-level the lower.
    // These are INLINE-axis intervals; the selection caller projects them to
    // physical in P3.5c.
    const leafLo = coordOf(v.leaf, am.inline);
    const leafHi = leafLo + sizeAlong(v.leaf, am.inline);
    const xa = clamp(caretInlineCoordInLeaf(v, a, measurer, am), leafLo, leafHi);
    const xb = clamp(caretInlineCoordInLeaf(v, b, measurer, am), leafLo, leafHi);
    const xLo = ltr ? xa : xb;
    const xHi = ltr ? xb : xa;
    intervals.push({ xLo, xHi, level: v.level });
  }

  // Coalesce ONLY physically-adjacent same-level intervals (a single maximal
  // same-direction run split across leaves). A direction boundary (different
  // level) is never merged, even if the two runs visually abut.
  const merged: VisualInterval[] = [];
  for (const cur of intervals) {
    const prev = merged[merged.length - 1];
    if (
      prev !== undefined &&
      prev.level === cur.level &&
      Math.abs(prev.xHi - cur.xLo) <= X_EPSILON
    ) {
      prev.xHi = cur.xHi;
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

// Re-export for selection-geometry's consumption.
export type { VisualInterval };

// ---------------------------------------------------------------------------
// Visual-order caret motion (P4-C.2 §E) — ArrowLeft / ArrowRight
// ---------------------------------------------------------------------------

/**
 * Move the collapsed caret ONE visual step (ArrowLeft / ArrowRight) within a
 * bidi-reordered line (P4-C.2 spec §E). Ported from the ALGORITHM of
 * CodeMirror 6's `moveVisually` (the de-facto browser-equivalent for visual
 * caret motion across bidi runs) — restructured to operate on our
 * `LineBidiView`, NOT copied verbatim.
 *
 * Visual direction maps to a LOGICAL grapheme step by the OWNING run's level
 * PARITY: in an LTR run (even level) visual-right = logical-FORWARD; in an RTL
 * run (odd level) visual-right = logical-BACKWARD (and visual-left the reverse).
 *
 * Run-crossing model:
 *   1. Resolve the OWNING run from `(offset, caretAffinity)`. At a shared
 *      logical boundary (`offset === leafA.logEnd === leafB.logStart`) the
 *      affinity disambiguates: `"before"` → the leaf ENDING at the offset,
 *      `"after"`/undefined → the leaf STARTING at it.
 *   2. If `offset` is NOT yet at the run's visual-`visualDir` edge: take one
 *      grapheme step in the within-run logical direction and stay in the run.
 *      The within-run side gives the natural affinity: stepping toward the run's
 *      visual-`visualDir` edge, the caret hugs THIS run (so at the far edge it is
 *      `"before"` for an LTR run / `"after"` for an RTL run — the side facing
 *      back into the run).
 *   3. If `offset` IS already at the run's visual-`visualDir` edge: CROSS to the
 *      visually-adjacent run on that side (the next/prev entry in
 *      `visualLeaves`). The caret lands at the ENTERED run's NEAR (facing) edge
 *      with the SAME logical `offset`, flipping `caretAffinity` to belong to the
 *      entered run — this is the dual-caret "first press flips, second advances"
 *      at a DIRECTION boundary. When the two runs share level PARITY (an ordinary
 *      word break in a uniform-direction stretch) the facing edges carry the SAME
 *      logical offset AND the step already advanced in (2) — there is no spurious
 *      flip; the caret advances immediately.
 *   4. No run on that visual side → `{ exit: visualDir }` (the caller moves to
 *      the adjacent line's visual edge).
 *
 * `view.isEmpty` (strut-only line) → always `{ exit: visualDir }` (no caret
 * targets on this line; cross to a neighbor).
 */
export function moveVisually(
  view: LineBidiView,
  offset: number,
  caretAffinity: CaretAffinity | undefined,
  visualDir: VisualDirection,
  step: GraphemeStepper,
): MoveVisuallyResult {
  if (view.isEmpty || view.visualLeaves.length === 0) {
    // Strut-only line: no runs, so visual order == logical order along the
    // line's base direction. The logical direction continuing past the visual-
    // `visualDir` edge is the physical mapping for an LTR base, flipped for RTL.
    const baseLtr = view.paragraphDirection === "ltr";
    const exitLogicalDir = (visualDir === "right") === baseLtr ? "forward" : "backward";
    return { exit: visualDir, exitLogicalDir };
  }

  const visualIndex = findOwningVisualIndex(view.visualLeaves, offset, caretAffinity);
  const run = view.visualLeaves[visualIndex];
  if (run === undefined) {
    throw new Error(`moveVisually: visualLeaves[${visualIndex}] missing (unreachable)`);
  }
  const ltr = run.level % 2 === 0;

  // Visual-right is logical-forward in an LTR run, logical-backward in an RTL
  // run; visual-left is the reverse.
  const forward = (visualDir === "right") === ltr;

  // The run's VISUAL-`visualDir` edge in STATE offsets: stepping forward heads
  // toward logEnd, backward toward logStart.
  const farEdge = forward ? run.logEnd : run.logStart;

  if (offset !== farEdge) {
    // Still room to move inside this run: one grapheme step, stay in-run.
    const next = forward ? step(offset, "forward") : step(offset, "backward");
    const clamped = forward
      ? Math.min(next, run.logEnd)
      : Math.max(next, run.logStart);
    // Affinity must keep the caret on THIS run at the (possibly boundary)
    // offset it lands on, per the boundary convention (`"before"` → the run
    // ENDING here, `"after"` → the run STARTING here). A FORWARD step heads
    // toward THIS run's `logEnd`, so to own that boundary the caret needs
    // `"before"`; a BACKWARD step heads toward `logStart`, needing `"after"`.
    // This depends on the STEP direction, not the run's LTR/RTL parity: for an
    // RTL run, visual-left is a forward step toward `logEnd` (its visual-left
    // edge), where `"before"` (not the old parity-based `"after"`) keeps the
    // caret on the RTL run rather than warping onto the next run. Interior
    // offsets are owned by a single leaf, so the value is inert there.
    const inRunAffinity: CaretAffinity = forward ? "before" : "after";
    return { offset: clamped, caretAffinity: inRunAffinity };
  }

  // At the run's visual-`visualDir` edge — cross to the visually-adjacent run.
  const nextVisualIndex = visualDir === "right" ? visualIndex + 1 : visualIndex - 1;
  if (nextVisualIndex < 0 || nextVisualIndex >= view.visualLeaves.length) {
    // No run on that visual side: leave the line. `forward` is the STATE-space
    // direction that continues past THIS run's visual-`visualDir` edge (it heads
    // toward logEnd when forward). That is exactly the logical direction the
    // caller must step to move past the line on its visual-`visualDir` side —
    // and for an RTL edge run it is the FLIP of the physical arrow, so a
    // pure-RTL run (even inside an LTR paragraph, where the paragraph base would
    // mislead) exits correctly instead of warping back into itself.
    return { exit: visualDir, exitLogicalDir: forward ? "forward" : "backward" };
  }
  const entered = view.visualLeaves[nextVisualIndex];
  if (entered === undefined) {
    throw new Error(`moveVisually: visualLeaves[${nextVisualIndex}] missing (unreachable)`);
  }
  const enteredLtr = entered.level % 2 === 0;

  // Enter at the run's NEAR (facing) edge. We moved toward `visualDir`, so we
  // enter the next run from the opposite side: entering from the LEFT when
  // moving right (its visual-left edge), from the RIGHT when moving left (its
  // visual-right edge). Visual-left edge = logStart for LTR / logEnd for RTL;
  // visual-right edge = logEnd for LTR / logStart for RTL.
  const enterAtVisualLeft = visualDir === "right";
  const enteredOffset = enteredLtr
    ? enterAtVisualLeft
      ? entered.logStart
      : entered.logEnd
    : enterAtVisualLeft
      ? entered.logEnd
      : entered.logStart;

  // Affinity so the caret belongs to the ENTERED run at that facing edge: at the
  // entered run's leading (facing-back-in) side. Entering at its visual-left
  // edge, an LTR run's caret hugs forward → `"after"` (logStart), an RTL run's
  // caret at logEnd hugs `"before"`. Entering at its visual-right edge, mirror.
  const enteredAffinity: CaretAffinity = enteredLtr
    ? enterAtVisualLeft
      ? "after"
      : "before"
    : enterAtVisualLeft
      ? "before"
      : "after";

  // DIRECTION-BOUNDARY vs SAME-PARITY discriminator (spec §E):
  //   - DIFFERENT parity (LTR↔RTL): the entered run's facing edge is its FAR
  //     logical end, so `enteredOffset !== offset` — the caret JUMPS to the other
  //     run's edge at the same VISUAL x but a different logical offset (the
  //     dual-caret flip). The NEXT press advances within the entered run.
  //   - SAME parity (ordinary word break in a uniform stretch): the entered run's
  //     facing edge carries the SAME logical offset (`enteredOffset === offset`),
  //     so crossing made NO progress. The caret must advance one grapheme into
  //     the entered run immediately — no spurious flip.
  if (enteredOffset === offset) {
    const enteredForward = (visualDir === "right") === enteredLtr;
    const stepped = enteredForward
      ? Math.min(step(offset, "forward"), entered.logEnd)
      : Math.max(step(offset, "backward"), entered.logStart);
    return { offset: stepped, caretAffinity: enteredAffinity };
  }

  return { offset: enteredOffset, caretAffinity: enteredAffinity };
}

/**
 * The index into `visualLeaves` of the run that OWNS `(offset, caretAffinity)`.
 * Interior offsets (`logStart <= offset < logEnd`) belong to exactly one run. At
 * a shared logical boundary two runs meet (`offset === a.logEnd === b.logStart`)
 * and `caretAffinity` picks the side: `"before"` → the run ENDING at the offset,
 * `"after"`/undefined → the run STARTING at it. Walks visual order; falls back to
 * the run whose state span contains the (clamped) offset.
 */
function findOwningVisualIndex(
  visualLeaves: readonly BidiViewLeaf[],
  offset: number,
  caretAffinity: CaretAffinity | undefined,
): number {
  // Boundary disambiguation first: if `offset` sits exactly between two runs in
  // STATE space, the affinity chooses which one owns it.
  let endingHere = -1; // run with logEnd === offset (the "before" choice)
  let startingHere = -1; // run with logStart === offset (the "after" choice)
  for (let i = 0; i < visualLeaves.length; i++) {
    const v = visualLeaves[i];
    if (v === undefined) {
      throw new Error(`findOwningVisualIndex: visualLeaves[${i}] missing (unreachable)`);
    }
    if (offset > v.logStart && offset < v.logEnd) {
      // Strictly interior — unambiguous owner.
      return i;
    }
    if (offset === v.logEnd) endingHere = i;
    if (offset === v.logStart) startingHere = i;
  }
  // Shared dual-caret tiebreak: `affinity` picks the ENDING vs STARTING run; a
  // `-1` result means BOTH were absent (offset out of range), handled below.
  const chosen = pickDualCaretSide(caretAffinity, endingHere, startingHere);
  if (chosen >= 0) return chosen;
  // Out-of-range (defensive): clamp to the nearest run by state span.
  const first = visualLeaves[0];
  if (first === undefined) {
    throw new Error("findOwningVisualIndex: visualLeaves is empty (unreachable)");
  }
  return offset <= first.logStart ? leftmostByState(visualLeaves) : rightmostByState(visualLeaves);
}

/** Visual index of the run with the smallest logStart (defensive clamp). */
function leftmostByState(visualLeaves: readonly BidiViewLeaf[]): number {
  let best = 0;
  for (let i = 1; i < visualLeaves.length; i++) {
    const cur = visualLeaves[i];
    const bestLeaf = visualLeaves[best];
    if (cur === undefined || bestLeaf === undefined) {
      throw new Error(`leftmostByState: visualLeaves[${i}]/[${best}] missing (unreachable)`);
    }
    if (cur.logStart < bestLeaf.logStart) best = i;
  }
  return best;
}

/** Visual index of the run with the largest logEnd (defensive clamp). */
function rightmostByState(visualLeaves: readonly BidiViewLeaf[]): number {
  let best = 0;
  for (let i = 1; i < visualLeaves.length; i++) {
    const cur = visualLeaves[i];
    const bestLeaf = visualLeaves[best];
    if (cur === undefined || bestLeaf === undefined) {
      throw new Error(`rightmostByState: visualLeaves[${i}]/[${best}] missing (unreachable)`);
    }
    if (cur.logEnd > bestLeaf.logEnd) best = i;
  }
  return best;
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
    const w = sdl[i];
    if (w === undefined) {
      throw new Error(`stateToDisplay: sourceDisplayLengths[${i}] missing (unreachable)`);
    }
    sum += w;
  }
  return Math.min(sum, textLength);
}

/**
 * Reverse-map a DISPLAY code-unit offset `d` to a STATE offset via
 * `sourceDisplayLengths`, returning the nearest SOURCE boundary (never an
 * interior offset that would split an expanding unit like ß→SS). Walks the
 * per-source display lengths, accumulating display width; when `d` falls inside
 * a source unit's span it snaps to whichever end of that span is closer.
 */
function stateOffsetOf(sdl: readonly number[], d: number): number {
  let cum = 0;
  for (let o = 0; o < sdl.length; o++) {
    const w = sdl[o];
    if (w === undefined) {
      throw new Error(`stateOffsetOf: sourceDisplayLengths[${o}] missing (unreachable)`);
    }
    const next = cum + w;
    if (d <= cum) return o;
    if (d < next) return d - cum < next - d ? o : o + 1; // nearest boundary
    cum = next;
  }
  return sdl.length;
}

/**
 * Find the DISPLAY char offset closest to `localX` within `text` (binary search
 * on prefix widths, memoizing each `measureWidth` call so a prefix is measured
 * at most once). Returns 0 for non-positive `localX` or empty `text`.
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

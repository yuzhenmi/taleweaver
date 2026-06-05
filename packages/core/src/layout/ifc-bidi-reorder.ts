import type { ParagraphBidi } from "./ifc-bidi";
import {
  createInlineBox,
  createTextRunBox,
  withInlineOffset,
  type InlineBox,
  type InlineFragmentEdge,
  type LayoutBox,
  type TextRunBox,
} from "./layout-box";

/**
 * Split a line `TextRunBox` into two single-level fragments at a DISPLAY-U16
 * boundary. Used by the P4-C bidi reorder (Task 5) which splits a run at a
 * bidi-level boundary into two boxes that are then repositioned (Task 6).
 *
 * THREE index spaces are in play (the recurring correctness theme of P4-C):
 * - **display-U16**: index into `box.text` and `box.clusterWidths` (1:1 with
 *   `text`, `length === text.length`). `splitAtDisplayU16` is in this space.
 * - **STATE**: what `box.offsetLength` counts (state-model characters). Differs
 *   from display under length-changing `text-transform` (`ß`→`SS`: one state
 *   unit → two display units) and collapsed whitespace.
 * - The per-state→display map is `box.sourceDisplayLengths` (one entry per
 *   STATE unit giving how many DISPLAY units it renders; `undefined` ⇒ display
 *   == state 1:1).
 *
 * The caller repositions each fragment's `inlineOffset` later (Task 6); here we
 * just build them at the box's current offset. Each fragment's `inlineSize` is
 * the NATURAL prefix/suffix sum of `clusterWidths` (these may exceed `inlineSize`
 * after a trim/clamp — reconciliation against the box's actual `inlineSize` is
 * the caller/paint's job per the `clusterWidths` contract, not done here).
 *
 * @param box The line `TextRunBox` to split. MUST carry `clusterWidths`.
 * @param splitAtDisplayU16 DISPLAY-U16 index into `box.text`;
 *   `0 < splitAtDisplayU16 < box.text.length`.
 * @param containingInlineSize Containing-block inline size (for RTL inversion in
 *   `createTextRunBox`).
 * @returns `[prefix, suffix]` fragments.
 * @throws if `box.clusterWidths` is absent, if `splitAtDisplayU16` is out of
 *   range, or if the split would fall INSIDE a single state unit's multi-display
 *   expansion (a bidi-level boundary is always at a source-character boundary,
 *   so this can't legitimately happen — the throw is a guard).
 */
export function splitTextRunBoxAtOffset(
  box: TextRunBox,
  splitAtDisplayU16: number,
  containingInlineSize: number,
): [TextRunBox, TextRunBox] {
  if (splitAtDisplayU16 <= 0 || splitAtDisplayU16 >= box.text.length) {
    throw new Error(
      `splitTextRunBoxAtOffset: splitAtDisplayU16 ${splitAtDisplayU16} out of range ` +
        `(0, ${box.text.length}) for text ${JSON.stringify(box.text)}`,
    );
  }

  const clusterWidths = box.clusterWidths;
  if (clusterWidths === undefined) {
    throw new Error(
      "splitTextRunBoxAtOffset: box has no clusterWidths; the splitter only " +
        "operates on line TextRunBoxes, which always carry them.",
    );
  }

  // 1. Text.
  const prefixText = box.text.slice(0, splitAtDisplayU16);
  const suffixText = box.text.slice(splitAtDisplayU16);

  // 2. Geometry: natural prefix/suffix sums of the per-display-unit advances.
  const prefixClusterWidths = clusterWidths.slice(0, splitAtDisplayU16);
  const suffixClusterWidths = clusterWidths.slice(splitAtDisplayU16);
  const sumAdvances = (widths: readonly number[]): number =>
    widths.reduce((acc, w) => acc + w, 0);
  const prefixInlineSize = sumAdvances(prefixClusterWidths);
  const suffixInlineSize = sumAdvances(suffixClusterWidths);

  // 3. STATE offsetLength split.
  const sourceDisplayLengths = box.sourceDisplayLengths;
  let prefixOffsetLength: number;
  let prefixSourceDisplayLengths: readonly number[] | undefined;
  let suffixSourceDisplayLengths: readonly number[] | undefined;
  if (sourceDisplayLengths === undefined) {
    // Display == state 1:1.
    prefixOffsetLength = splitAtDisplayU16;
    prefixSourceDisplayLengths = undefined;
    suffixSourceDisplayLengths = undefined;
  } else {
    // Walk per-state-unit display lengths until the running DISPLAY total
    // exactly reaches splitAtDisplayU16. The number of state units consumed is
    // the prefix's offsetLength.
    let displayTotal = 0;
    let stateUnitsConsumed = 0;
    while (displayTotal < splitAtDisplayU16 && stateUnitsConsumed < sourceDisplayLengths.length) {
      displayTotal += sourceDisplayLengths[stateUnitsConsumed];
      stateUnitsConsumed += 1;
    }
    if (displayTotal !== splitAtDisplayU16) {
      throw new Error(
        `splitTextRunBoxAtOffset: split at display ${splitAtDisplayU16} falls inside a ` +
          `single state unit's multi-display expansion (running total ${displayTotal}); ` +
          "a bidi-level boundary must land on a source-character boundary.",
      );
    }
    prefixOffsetLength = stateUnitsConsumed;
    prefixSourceDisplayLengths = sourceDisplayLengths.slice(0, prefixOffsetLength);
    suffixSourceDisplayLengths = sourceDisplayLengths.slice(prefixOffsetLength);
  }
  const suffixOffsetLength = box.offsetLength - prefixOffsetLength;

  // 4. sourceStart: display-U16 advance for the suffix.
  const prefixSourceStart = box.sourceStart;
  const suffixSourceStart =
    box.sourceStart === undefined ? undefined : box.sourceStart + splitAtDisplayU16;

  // 5. Keys / geometry. Both fragments keep the box's current offset/geometry;
  //    the caller repositions inlineOffset in Task 6.
  const prefix = createTextRunBox(
    box.key,
    box.inlineOffset,
    box.blockOffset,
    prefixInlineSize,
    box.blockSize,
    box.writingMode,
    box.direction,
    box.computedStyle,
    box.usedStyle,
    prefixText,
    prefixOffsetLength,
    containingInlineSize,
    prefixSourceDisplayLengths,
    prefixClusterWidths,
    prefixSourceStart,
  );
  const suffix = createTextRunBox(
    `${box.key}-bidi${splitAtDisplayU16}`,
    box.inlineOffset,
    box.blockOffset,
    suffixInlineSize,
    box.blockSize,
    box.writingMode,
    box.direction,
    box.computedStyle,
    box.usedStyle,
    suffixText,
    suffixOffsetLength,
    containingInlineSize,
    suffixSourceDisplayLengths,
    suffixClusterWidths,
    suffixSourceStart,
  );

  return [prefix, suffix];
}

/**
 * A logical-order piece of a line tagged with its single bidi embedding level.
 * Produced by {@link segmentLine}; consumed by the Task-6 reorder/reposition
 * pass, which permutes these pieces into visual order via {@link reorderRunsByLevel}.
 */
export interface BidiSegment {
  readonly box: LayoutBox;
  readonly level: number;
}

/**
 * UAX #9 segmentation of a FLAT line into maximal same-level bidi runs.
 *
 * Walks the line's `children` (in LOGICAL order) and, per child, emits one or
 * more `{ box, level }` segments — splitting any `TextRunBox` that straddles a
 * level boundary so every emitted box carries exactly one bidi level. The
 * pieces are returned in logical order; the caller (Task 6) reorders them.
 *
 * This is the FLAT case: text-runs and atomic inlines (`InlineBlockBox`,
 * defensively `MarkerBox`). `InlineBox` recursion is the NEXT task (T5b); a
 * line containing an `InlineBox` throws here.
 *
 * **Levels come ONLY from `postL1Levels`** — the post-L1 line levels the caller
 * (Task 6) computed via {@link applyL1} for the line's codepoint slice, indexed
 * RELATIVE to `lineStartCp`. We never read `bidiLevelAtSourceOffset` (which is
 * the PRE-L1 paragraph-wide level); L1 resets — trailing-whitespace and
 * segment/paragraph separators dropping to the paragraph level — change which
 * runs are same-level, so segmentation MUST observe post-L1 levels.
 *
 * The level of a character at DISPLAY-U16 absolute source offset `u16abs` is:
 * ```
 *   cp    = paragraphBidi.cpIndexAtUtf16[u16abs];   // u16abs = box.sourceStart + localDisplayU16
 *   level = postL1Levels[cp - lineStartCp];
 * ```
 * A bidi-level boundary always falls on a source-CHARACTER boundary, so the
 * forward-walk display offset `u` at which the level changes is a valid split
 * point; `splitTextRunBoxAtOffset` throws loudly if it isn't.
 *
 * @param children     the line's leaf boxes, in logical order.
 * @param paragraphBidi paragraph-wide bidi result (for `cpIndexAtUtf16`).
 * @param lineStartCp  the codepoint index of the line's first character; the
 *   offset that makes `postL1Levels` line-relative.
 * @param postL1Levels post-L1 line levels (line-relative), from `applyL1`.
 * @returns the line's boxes in logical order, each tagged with its bidi level.
 * @throws on an `InlineBox` (Task 5b), an unexpected box type, or a text-run /
 *   inline-block missing the `sourceStart` / `clusterWidths` it must carry.
 */
export function segmentLine(
  children: readonly LayoutBox[],
  paragraphBidi: ParagraphBidi,
  lineStartCp: number,
  postL1Levels: Uint8Array,
): BidiSegment[] {
  const segments: BidiSegment[] = [];
  for (const child of children) {
    segmentChild(child, paragraphBidi, lineStartCp, postL1Levels, segments);
  }
  return segments;
}

/** Level of the source character at DISPLAY-U16 absolute offset `u16abs`. */
function levelAt(
  paragraphBidi: ParagraphBidi,
  lineStartCp: number,
  postL1Levels: Uint8Array,
  u16abs: number,
): number {
  const cp = paragraphBidi.cpIndexAtUtf16[u16abs];
  return postL1Levels[cp - lineStartCp];
}

function segmentChild(
  child: LayoutBox,
  paragraphBidi: ParagraphBidi,
  lineStartCp: number,
  postL1Levels: Uint8Array,
  out: BidiSegment[],
): void {
  switch (child.type) {
    case "text-run":
      segmentTextRun(child, paragraphBidi, lineStartCp, postL1Levels, out);
      return;
    case "inline-block": {
      if (child.sourceStart === undefined) {
        throw new Error(
          "segmentLine: InlineBlockBox on a line has no sourceStart; the reorder " +
            "requires the atomic inline's OBJECT_REPLACEMENT source offset.",
        );
      }
      out.push({
        box: child,
        level: levelAt(paragraphBidi, lineStartCp, postL1Levels, child.sourceStart),
      });
      return;
    }
    case "marker": {
      // Markers don't reach lines via the reorder (they're list/footnote
      // gutters, not inline content), but handle defensively: a MarkerBox has
      // no sourceStart, so it takes the paragraph level.
      out.push({ box: child, level: paragraphBidi.paragraphLevel });
      return;
    }
    case "inline":
      throw new Error("segmentLine: InlineBox recursion is Task 5b");
    default:
      throw new Error(
        `segmentLine: unexpected box type ${JSON.stringify(child.type)} on a line`,
      );
  }
}

/**
 * Segment one `TextRunBox` into maximal same-level spans. A forward walk over
 * the box's DISPLAY-U16 positions finds the first position `u` whose level
 * differs from the span start; that `u` is the split's display offset (no
 * inverse map). Split there, emit the prefix at the span's level, then loop on
 * the suffix.
 */
function segmentTextRun(
  box: TextRunBox,
  paragraphBidi: ParagraphBidi,
  lineStartCp: number,
  postL1Levels: Uint8Array,
  out: BidiSegment[],
): void {
  if (box.sourceStart === undefined) {
    throw new Error(
      "segmentLine: line TextRunBox has no sourceStart; line text-runs always " +
        "carry it (the reorder needs each unit's absolute source offset).",
    );
  }
  if (box.clusterWidths === undefined) {
    throw new Error(
      "segmentLine: line TextRunBox has no clusterWidths; line text-runs always " +
        "carry them (the splitter needs per-display-unit advances).",
    );
  }

  let current = box;
  let currentSourceStart = box.sourceStart;
  // `currentSourceStart` tracks the suffix's absolute source offset as we peel
  // prefixes off the front; it is the display-U16 base for `current.text`.
  for (;;) {
    const spanLevel = levelAt(paragraphBidi, lineStartCp, postL1Levels, currentSourceStart);
    let boundary = -1;
    for (let u = 1; u < current.text.length; u++) {
      const level = levelAt(paragraphBidi, lineStartCp, postL1Levels, currentSourceStart + u);
      if (level !== spanLevel) {
        boundary = u;
        break;
      }
    }
    if (boundary === -1) {
      // Remainder is wholly one level — emit unchanged.
      out.push({ box: current, level: spanLevel });
      return;
    }
    const [prefix, suffix] = splitTextRunBoxAtOffset(current, boundary, current.inlineSize);
    out.push({ box: prefix, level: spanLevel });
    current = suffix;
    currentSourceStart += boundary;
  }
}

/**
 * A LEAF box of a line (never an `InlineBox`), tagged with its chain of
 * `InlineBox` ancestors. Produced by {@link flattenLineToLeaves}; the bidi
 * reorder of a line containing inline elements (`<em>`, links) segments and
 * reorders these leaves, then re-nests them back into `InlineBox` fragments
 * (later tasks).
 */
export interface FlatLeaf {
  /** A `TextRunBox | InlineBlockBox | MarkerBox` (or a defensively-passed-through
   * atomic box) — never an `InlineBox`. */
  readonly leaf: LayoutBox;
  /** The chain of `InlineBox` ancestors, ROOT-MOST first (`[]` for a top-level
   * leaf). */
  readonly ancestors: readonly InlineBox[];
}

/**
 * Flatten a line's nested child tree into a flat list of LEAF runs, each tagged
 * with its `InlineBox` ancestor chain.
 *
 * Depth-first, preserving LOGICAL (child) order. `InlineBox` children are
 * recursed into with the ancestor chain extended by the box (appended, so the
 * root-most ancestor stays FIRST); leaf boxes (`text-run` / `inline-block` /
 * `marker`) are emitted with the current chain.
 *
 * Any other box type that could appear inline is not expected on a normal line,
 * but flatten is TOTAL: rather than throw, an unrecognized box is emitted as a
 * leaf with the current chain (defensive — a line could in principle carry an
 * unexpected atomic box, and the caller's reorder handles it as an atomic
 * segment). We do NOT recurse into unknown container types, since their
 * children's relationship to the inline ancestor chain is undefined.
 *
 * Pure: inputs are not mutated; each leaf's `ancestors` array is fresh.
 *
 * @param children the line's child boxes, in logical order.
 * @returns the line's leaf boxes in logical order, each with its root-most-first
 *   `InlineBox` ancestor chain.
 */
export function flattenLineToLeaves(children: readonly LayoutBox[]): FlatLeaf[] {
  const out: FlatLeaf[] = [];
  flattenChildren(children, [], out);
  return out;
}

function flattenChildren(
  children: readonly LayoutBox[],
  ancestors: readonly InlineBox[],
  out: FlatLeaf[],
): void {
  for (const child of children) {
    if (child.type === "inline") {
      // Recurse, extending the chain by this InlineBox (append keeps root-most
      // first).
      flattenChildren(child.children, [...ancestors, child], out);
    } else {
      // text-run / inline-block / marker — and, defensively, any other atomic
      // box type that might appear inline — is a leaf at the current chain.
      out.push({ leaf: child, ancestors });
    }
  }
}

/**
 * Re-nest a line's VISUAL-ORDER leaves back into the nested `InlineBox` tree —
 * the INVERSE of the IFC's `buildLineChildrenForAncestorLevel`.
 *
 * After {@link flattenLineToLeaves} produced ancestor-tagged leaves and the
 * Task-6 reorder permuted them into VISUAL (left-to-right) order, this rebuilds
 * the line's nested top-level children. Each `InlineBox` ancestor is
 * reconstructed from its template (the original `InlineBox` carried on the
 * leaves' `ancestors`, shared by `ancestorKey`), wrapping the recursively-built
 * inner children. Geometry is packed left-to-right at every nesting level.
 *
 * **Contiguous-only grouping (the key bidi property).** Grouping at each depth
 * is over MAXIMAL CONTIGUOUS runs sharing the same `ancestors[depth].ancestorKey`
 * — mirroring the build's `j`-loop exactly. A bidi split that makes one inline's
 * pieces NON-ADJACENT in visual order therefore yields TWO separate `InlineBox`
 * fragments for that key (not one box spanning the gap). Both fragments carry the
 * element's `ancestorKey` (the cross-line `assignFragmentEdges` post-pass groups
 * by it); the 2nd+ fragment's `key` is suffixed to keep keys distinct.
 *
 * **fragmentEdge for SAME-LINE splits.** If a key produced exactly ONE fragment
 * on this line → `"only"` (the cross-line post-pass refines it across lines). If
 * it produced ≥2 fragments (a bidi split broke visual continuity), edges are
 * assigned by LOGICAL order — each fragment's logical position is the MIN
 * `sourceStart` among its leaves: logically-first → `"first"`, logically-last →
 * `"last"`, any in between → `"middle"`. (CSS puts start-side decoration on the
 * logically-first fragment, end-side on the last.)
 *
 * **Cross-line composition deferral.** A same-line-split inline that ALSO wraps
 * to another line is the wire step's concern: it composes these single-line
 * edges across lines (verified there). This function assigns ONLY the single-line
 * edges.
 *
 * Pure: inputs are not mutated; every returned box is freshly built. Returned
 * top-level children are packed from inline-offset 0; the caller shifts by the
 * line's alignment origin later (out of scope here).
 *
 * @param visualLeaves leaves in VISUAL order, each tagged with its `ancestors`
 *   (root-most first).
 * @param lineInlineSize the line's inline size — passed as `containingInlineSize`
 *   to every box on the line, at every nesting level (matching the build).
 * @returns the line's nested top-level children, packed left-to-right.
 */
export function renestLeaves(
  visualLeaves: readonly FlatLeaf[],
  lineInlineSize: number,
): LayoutBox[] {
  return renestAtDepth(visualLeaves, 0, lineInlineSize);
}

/**
 * Build the children at `depth`: leaves whose chain is shallow enough to live at
 * this depth are emitted directly; maximal contiguous runs sharing the same
 * ancestor key at this depth are wrapped in a rebuilt `InlineBox`. Children are
 * packed left-to-right (first at offset 0, each next at prev.inlineOffset +
 * prev.inlineSize).
 */
function renestAtDepth(
  leaves: readonly FlatLeaf[],
  depth: number,
  lineInlineSize: number,
): LayoutBox[] {
  const out: LayoutBox[] = [];
  // Per-ancestorKey fragment counter at THIS depth — used to suffix the 2nd+
  // fragment's `key` (distinct keys) and to decide single-vs-split fragmentEdge.
  const fragmentsForKey: Map<string, RebuiltFragment[]> = new Map();

  let cursorInlineOffset = 0;
  let i = 0;
  while (i < leaves.length) {
    const leaf = leaves[i];

    if (leaf.ancestors.length <= depth) {
      // Belongs at this depth — emit the leaf directly, repacked from the
      // running cursor (its incoming inlineOffset is the pre-reorder value).
      const repacked = withInlineOffset(leaf.leaf, cursorInlineOffset, lineInlineSize);
      out.push(repacked);
      cursorInlineOffset += repacked.inlineSize;
      i += 1;
      continue;
    }

    // Gather the maximal CONTIGUOUS run sharing the same ancestor key at `depth`.
    const tmpl = leaf.ancestors[depth];
    const ancestorKey = tmpl.ancestorKey;
    let j = i;
    while (
      j < leaves.length &&
      leaves[j].ancestors.length > depth &&
      leaves[j].ancestors[depth].ancestorKey === ancestorKey
    ) {
      j += 1;
    }
    const run = leaves.slice(i, j);

    // Recurse to build the inner children, packed from 0 RELATIVE to this box.
    const innerChildren = renestAtDepth(run, depth + 1, lineInlineSize);
    const boxInlineSize = innerChildren.reduce((acc, c) => acc + c.inlineSize, 0);

    // Record the fragment; fragmentEdge is resolved in a second pass once all
    // fragments for this key on this line are known.
    const fragments = fragmentsForKey.get(ancestorKey) ?? [];
    const fragmentIndex = fragments.length;
    // Distinct key for the 2nd+ fragment to avoid collisions; ancestorKey
    // (the element key) stays put for the cross-line post-pass.
    const fragKey = fragmentIndex === 0 ? tmpl.key : `${tmpl.key}-frag${fragmentIndex}`;
    const placeholder = createInlineBox(
      fragKey,
      cursorInlineOffset,
      tmpl.blockOffset,
      boxInlineSize,
      tmpl.blockSize,
      tmpl.writingMode,
      tmpl.direction,
      tmpl.computedStyle,
      tmpl.usedStyle,
      innerChildren,
      /* fragmentEdge — provisional, fixed up below */ "only",
      ancestorKey,
      lineInlineSize,
    );
    const outIndex = out.length;
    out.push(placeholder);
    fragments.push({ outIndex, minSourceStart: minSourceStartOf(run) });
    fragmentsForKey.set(ancestorKey, fragments);

    cursorInlineOffset += boxInlineSize;
    i = j;
  }

  // Second pass: assign fragmentEdge for keys that split into ≥2 fragments on
  // this line. A single fragment stays "only" (cross-line post-pass refines it).
  for (const fragments of fragmentsForKey.values()) {
    if (fragments.length < 2) continue;
    // Logical order = ascending minSourceStart. logically-first → "first",
    // logically-last → "last", interior → "middle".
    const byLogical = [...fragments].sort((a, b) => a.minSourceStart - b.minSourceStart);
    for (let k = 0; k < byLogical.length; k++) {
      const edge: InlineFragmentEdge =
        k === 0 ? "first" : k === byLogical.length - 1 ? "last" : "middle";
      const frag = byLogical[k];
      const box = out[frag.outIndex];
      if (box.type !== "inline") continue; // type guard; always an inline here.
      out[frag.outIndex] = createInlineBox(
        box.key,
        box.inlineOffset,
        box.blockOffset,
        box.inlineSize,
        box.blockSize,
        box.writingMode,
        box.direction,
        box.computedStyle,
        box.usedStyle,
        box.children,
        edge,
        box.ancestorKey,
        lineInlineSize,
      );
    }
  }

  return out;
}

/** Bookkeeping for an `InlineBox` fragment emitted at one depth on one line. */
interface RebuiltFragment {
  /** Index into the depth's `out` array where the fragment box lives. */
  readonly outIndex: number;
  /** The fragment's logical position — the MIN `sourceStart` over its leaves. */
  readonly minSourceStart: number;
}

/**
 * The minimum `sourceStart` over a run of leaves, recursing through any rebuilt
 * `InlineBox` children. A leaf with no `sourceStart` (e.g. the empty-paragraph
 * strut, or a MarkerBox) contributes `+Infinity` so it never falsely pulls a
 * fragment's logical position earlier; if EVERY leaf lacks one, the result is
 * `+Infinity` and the relative order among such fragments falls back to their
 * stable sort position (visual order).
 */
function minSourceStartOf(leaves: readonly FlatLeaf[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const { leaf } of leaves) {
    const s = sourceStartOfBox(leaf);
    if (s < min) min = s;
  }
  return min;
}

/** `sourceStart` of a leaf box, or `+Infinity` if it carries none. */
function sourceStartOfBox(box: LayoutBox): number {
  if (box.type === "text-run" || box.type === "inline-block") {
    return box.sourceStart ?? Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}

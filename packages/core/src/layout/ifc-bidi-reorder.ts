import { createTextRunBox, type TextRunBox } from "./layout-box";

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

/**
 * @module footnotes/numbering
 *
 * The footnote numbering engine (FN-3). Given the ordered footnote anchors
 * (`collectFootnoteAnchors`) and a numbering policy, compute each footnote's
 * raw counter value + formatted string, keyed by its `contentBlockId` (the
 * footnote's stable identity).
 *
 * Self-contained behind a clean interface so P9a's general CSS counters can
 * later re-base footnote numbering as a counter without changing consumers
 * (spec §4.3). Numbers are DERIVED here every cycle — never stored — so
 * insert/delete/reorder of anchors needs no stored-number invalidation.
 */
import type { BlockId } from "../state";
import { formatCounter } from "./format-counter";
import type {
  FootnoteAnchorRef,
  FootnoteNumber,
  FootnoteNumberingPolicy,
} from "./types";

/**
 * Compute footnote numbers for `anchors` (document order) under `policy`.
 *
 * - **continuous**: a single 1-based sequence over `anchors`; never resets.
 * - **restart-per-section**: the counter resets to 1 whenever `sectionId`
 *   changes between consecutive anchors (the implicit root section, `null`, is
 *   its own scope).
 * - **restart-per-page** (FN-6): requires `pageAssignment` (a
 *   `contentBlockId → pageIndex` map, filled in by `resolveFootnotes`). FN-3
 *   does NOT implement it: when `reset === "restart-per-page"` and no
 *   `pageAssignment` is supplied, this THROWS rather than silently degrading to
 *   continuous (a hidden degradation would be a quality regression). The
 *   `pageAssignment` parameter is accepted now so FN-6 fills in the body here
 *   without a signature change.
 *
 * Returns a `Map` keyed by each anchor's `contentBlockId`.
 */
export function footnoteNumbers(
  anchors: readonly FootnoteAnchorRef[],
  policy: FootnoteNumberingPolicy,
  pageAssignment?: ReadonlyMap<BlockId, number>,
): Map<BlockId, FootnoteNumber> {
  const result = new Map<BlockId, FootnoteNumber>();

  switch (policy.reset) {
    case "continuous": {
      let counter = 0;
      for (const anchor of anchors) {
        counter += 1;
        result.set(anchor.contentBlockId, makeNumber(counter, policy));
      }
      return result;
    }

    case "restart-per-section": {
      let counter = 0;
      let currentScope: BlockId | null | undefined = undefined;
      for (const anchor of anchors) {
        if (anchor.sectionId !== currentScope) {
          currentScope = anchor.sectionId;
          counter = 0;
        }
        counter += 1;
        result.set(anchor.contentBlockId, makeNumber(counter, policy));
      }
      return result;
    }

    case "restart-per-page": {
      // FN-6: restart-per-page numbering depends on which page each anchor
      // lands on, which is only known AFTER the `resolveFootnotes` layout pass.
      // FN-3 builds the STATE-derivable policies; per-page is sequenced behind
      // the layout dependency. Throw (don't silently fall back) so a misuse is
      // loud rather than a hidden degradation.
      if (pageAssignment === undefined) {
        throw new Error(
          "footnoteNumbers: restart-per-page requires pageAssignment (FN-6)",
        );
      }
      // FN-6 will compute per-page numbering from `pageAssignment` here.
      throw new Error(
        "footnoteNumbers: restart-per-page numbering is not implemented yet (FN-6)",
      );
    }
  }
}

/** Pair a raw counter value with its formatted string under `policy.format`. */
function makeNumber(value: number, policy: FootnoteNumberingPolicy): FootnoteNumber {
  return { value, formatted: formatCounter(value, policy.format) };
}

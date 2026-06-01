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
 * - **restart-per-page** (FN-6): the counter resets to 1 whenever the page
 *   (`pageAssignment.get(contentBlockId)`) changes between consecutive anchors.
 *   Requires `pageAssignment` (a `contentBlockId → pageIndex` map, filled in by
 *   `resolveFootnotes`): when `reset === "restart-per-page"` and no
 *   `pageAssignment` is supplied, this THROWS rather than silently degrading to
 *   continuous (a hidden degradation would be a quality regression). An anchor
 *   absent from a supplied `pageAssignment` is a real inconsistency and also
 *   THROWS (naming the `contentBlockId`).
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
      // Mirrors `restart-per-section`, keyed on pageIndex instead of sectionId.
      // Relies on `anchors` being in document order (guaranteed by
      // `collectFootnoteAnchors`) AND `pageAssignment` being monotonic
      // non-decreasing in that order (a later anchor cannot land on an earlier
      // page), so a single forward pass with a per-page counter is sufficient.
      let counter = 0;
      let currentPage: number | undefined = undefined;
      for (const anchor of anchors) {
        const page = pageAssignment.get(anchor.contentBlockId);
        if (page === undefined) {
          // Every anchor must have a page; a missing entry is a real
          // inconsistency in the caller-supplied map, not a normal case. Throw
          // loudly (don't skip) so the numbering bug surfaces immediately.
          throw new Error(
            `footnoteNumbers: restart-per-page anchor "${anchor.contentBlockId}" is missing from pageAssignment`,
          );
        }
        if (page !== currentPage) {
          currentPage = page;
          counter = 0;
        }
        counter += 1;
        result.set(anchor.contentBlockId, makeNumber(counter, policy));
      }
      return result;
    }
  }
}

/** Pair a raw counter value with its formatted string under `policy.format`. */
function makeNumber(value: number, policy: FootnoteNumberingPolicy): FootnoteNumber {
  return { value, formatted: formatCounter(value, policy.format) };
}

/**
 * FN-2/FN-6.4: the HOST blocks (the leaf carrying the anchor's `EmbedItem`)
 * whose footnote-anchor marker number changed between two numbering maps — i.e.
 * anchors whose `formatted` differs (or is newly present / absent) across
 * `fnNumbers` vs `prevFnNumbers`. Reusing those blocks' cached RenderNode would
 * paint a stale number, so the caller re-renders exactly these blocks.
 *
 * Takes the anchors directly (already collected by the caller — NOT re-walked
 * here). Used by `renderIncremental` (renumber-on-insert/delete diff) AND by
 * `rebuildTrees`'s FN-6.4 second pass (continuous-fallback → per-page diff).
 */
export function footnoteRenumberedBlocks(
  anchors: readonly FootnoteAnchorRef[],
  fnNumbers: ReadonlyMap<BlockId, FootnoteNumber>,
  prevFnNumbers: ReadonlyMap<BlockId, FootnoteNumber>,
): Set<BlockId> {
  const out = new Set<BlockId>();
  for (const anchor of anchors) {
    const now = fnNumbers.get(anchor.contentBlockId)?.formatted;
    const before = prevFnNumbers.get(anchor.contentBlockId)?.formatted;
    if (now !== before) out.add(anchor.blockId);
  }
  return out;
}

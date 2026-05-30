/**
 * @module layout/resolve-footnotes
 *
 * Pure anchor→page assignment helpers for the footnote layout pass (FN-4).
 *
 * These two functions are the side-effect-free core that FN-4.2's
 * `resolveFootnotes` composes: given the ordered footnote anchors (from
 * `collectFootnoteAnchors`) and a `PagePlan` (from `measurePass`), they decide
 * WHICH page each footnote body belongs to. They do NOT lay out or split
 * bodies — that is `resolveFootnotes`'s job, built on top of this assignment.
 *
 * Scope note (FN-4): a footnote anchor sits in a top-level leaf whose blockId
 * IS a `rootChildren` key, so a direct `Map<topLevelKey, index>` is all the
 * assignment needs. Anchors nested inside a NON-transparent container resolve
 * to `undefined` in the index and are skipped defensively here (tracked as
 * FN-4-followup-A — not in FN-4 scope).
 */
import type { ElementBox } from "../render/render-node";
import type { BlockId } from "../state";
import type { FootnoteAnchorRef } from "../footnotes";
import type { PagePlan } from "./measure-pass";
import { isDevMode } from "./dev-mode";

/**
 * Map each top-level child's `key` (its `BlockId`) → its index in
 * `rootChildren`, in one pass. `ElementBox.key` is typed `string`; a top-level
 * child's key IS a `BlockId`, so the `key as BlockId` narrowing follows the
 * established layout convention (see `section-plan.ts`, `ifc.ts`).
 *
 * FN-4.2's convergence re-collect consumes this index to filter anchors by a
 * page's `[startIndex, startIndex + childrenCount)` slice;
 * `buildFootnotePageAssignment` uses it as the skip-when-nested guard.
 */
export function buildBlockToTopLevelIndex(
  rootChildren: readonly ElementBox[],
): Map<BlockId, number> {
  const map = new Map<BlockId, number>();
  rootChildren.forEach((child, i) => {
    map.set(child.key as BlockId, i);
  });
  return map;
}

/**
 * Assign each footnote body (`anchor.contentBlockId`) to the page that carries
 * its anchor, returning `pageIndex → contentBlockIds` in document order.
 *
 * `anchors` arrive pre-ordered in document order (from `collectFootnoteAnchors`),
 * so appending each body to its page's list preserves document order within a
 * page. For an anchor whose host block SPANS multiple pages, the body is
 * assigned to the FIRST page of the span (plan decision D4) via
 * `plan.pageSpanOfBlock(...).first` — NOT `pageIndexOfBlock`, which reports the
 * last (whole-block-progress) page.
 *
 * An anchor is SKIPPED (defensively) when:
 *   1. its `blockId` is absent from `blockToIndex` (anchor nested in a
 *      non-transparent container — FN-4-followup-A, out of FN-4 scope), or
 *   2. its host block has no resolvable page span (`pageSpanOfBlock` → `null`).
 */
export function buildFootnotePageAssignment(
  anchors: readonly FootnoteAnchorRef[],
  plan: PagePlan,
  blockToIndex: ReadonlyMap<BlockId, number>,
): Map<number, BlockId[]> {
  const result = new Map<number, BlockId[]>();
  for (const anchor of anchors) {
    // (1) Anchor not a top-level child (nested in a non-transparent container).
    // A footnote silently vanishing would be a no-MVP defect, so this is a
    // dev-only throw (graceful skip in production), matching the layout
    // module's dev-assert convention (see measurePass). FN-4 handles only
    // top-level-leaf anchors; the nested case is FN-4-followup-A — when a
    // non-transparent container that can host an anchor is added, this throw
    // forces that follow-up rather than letting the footnote disappear.
    if (!blockToIndex.has(anchor.blockId)) {
      if (isDevMode()) {
        throw new Error(
          `resolveFootnotes: footnote ${anchor.contentBlockId}: anchor block ` +
            `${anchor.blockId} is not a top-level child (nested in a ` +
            `non-transparent container). FN-4 supports top-level-leaf anchors ` +
            `only — see FN-4-followup-A.`,
        );
      }
      continue;
    }
    // (2) Resolve the FIRST page of the host block's span (D4). A top-level
    // child present in `blockToIndex` should ALWAYS have a span, so a `null`
    // here signals a structural inconsistency between rootChildren and the
    // PagePlan — a programmer error, dev-only throw (graceful skip in prod).
    const span = plan.pageSpanOfBlock(anchor.blockId);
    if (span === null) {
      if (isDevMode()) {
        throw new Error(
          `resolveFootnotes: footnote ${anchor.contentBlockId}: anchor block ` +
            `${anchor.blockId} has no resolvable page span — rootChildren / ` +
            `PagePlan inconsistency.`,
        );
      }
      continue;
    }
    const pageIndex = span.first;
    const list = result.get(pageIndex);
    if (list === undefined) {
      result.set(pageIndex, [anchor.contentBlockId]);
    } else {
      list.push(anchor.contentBlockId);
    }
  }
  return result;
}

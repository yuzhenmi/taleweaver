import type { BlockId } from "@taleweaver/core";
import type { BlockParentLookup } from "@taleweaver/core";

// Re-exported for stability: existing consumers import `BlockParentLookup` from
// here. Its DEFINITION lives in `state/` (it is a core-logical structural query,
// not layout geometry) so editor + layout share it without an editor→layout edge.
export type { BlockParentLookup };

/** Minimal structural slice of the page plan this resolver needs. */
interface PageSpanIndex {
  pageSpanOfBlock(blockKey: string): { readonly first: number; readonly last: number } | null;
}

/**
 * Walk a target's ancestor chain (via the injected `parentOf`) to the nearest
 * block the page plan indexes (a top-level root child — `recordBlockMaps` indexes
 * only those). Returns that ancestor's id, or `null` if none is indexed. The
 * 1024-step guard mirrors `resolveNestedMainTreeBlockPage` (cursor-position.ts).
 */
export function nearestTopLevelIndexedAncestor(
  parentOf: BlockParentLookup,
  plan: PageSpanIndex,
  targetId: BlockId,
): BlockId | null {
  let id: BlockId | null = parentOf(targetId);
  let steps = 0;
  while (id !== null) {
    if (++steps > 1024) return null;
    if (plan.pageSpanOfBlock(id) !== null) return id;
    id = parentOf(id);
  }
  return null;
}

/**
 * The 0-based page a layout field's target is on, or `-1` (→ broken-ref):
 *  - top-level target → its own first page (exact; today's path);
 *  - nested target (not indexed) → the page where its nearest top-level-indexed
 *    ancestor BEGINS (N1 single-page ancestor = exact; N2 page-spanning ancestor =
 *    defined "container-start" — exact-intra-fragment is out of scope per the spec
 *    feature-selection test);
 *  - no `parentOf` capability, or no indexed ancestor → `-1` (today's broken-ref).
 */
export function pageOfFieldTarget(
  plan: PageSpanIndex,
  targetId: BlockId,
  parentOf?: BlockParentLookup,
): number {
  const span = plan.pageSpanOfBlock(targetId);
  if (span !== null) return span.first;
  if (parentOf === undefined) return -1;
  const ancestor = nearestTopLevelIndexedAncestor(parentOf, plan, targetId);
  if (ancestor === null) return -1;
  const ancestorSpan = plan.pageSpanOfBlock(ancestor);
  return ancestorSpan === null ? -1 : ancestorSpan.first;
}

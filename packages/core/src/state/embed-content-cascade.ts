import type { State } from "./state";
import {
  getBlock,
  getEmbedContent,
  getTemplateContent,
} from "./state";
import { STATE_INTERNAL } from "./state-internal";
import { getTreeMaps } from "./yjs-doc";
import type { BlockId } from "./block-id";
import type { InlineContent } from "./inline-content";

/**
 * Embed-content cascade-delete helpers shared by ops that drop inline
 * content (removeBlock, deleteRange, and any future op that removes
 * an EmbedItem from a leaf's items).
 *
 * Per the spec's "no orphaned blocks" invariant, an EmbedItem whose
 * `properties.contentBlockId` references a block in `state.embedContents`
 * owns that referenced subtree. When the EmbedItem is dropped (because
 * its containing block is removed, or because the inline portion holding
 * it is deleted), the referenced subtree must be cascade-deleted to
 * preserve the invariant.
 *
 * Cycle-defended: every walker uses an `out` Set as a visited marker.
 */

/**
 * Walk an embed-content subtree rooted at `rootId` and add every visited
 * id to `out`. Follows both child links (descendants of the embed-content
 * block in the embedContents map) and nested
 * `EmbedItem.properties.contentBlockId` references in this
 * embed-content's inlineContent (e.g., a footnote whose body contains
 * another footnote anchor). Cycle-defended: a block already in `out`
 * is not re-visited.
 *
 * Gracefully no-ops if `rootId` is not in `state.embedContents` — this
 * handles the case where two anchors reference the same body and one
 * has already been processed in an earlier cascade pass.
 */
export function collectEmbedContentSubtree(
  state: State,
  rootId: BlockId,
  out: Set<BlockId>,
): void {
  if (out.has(rootId)) return;
  const block = getEmbedContent(state, rootId);
  if (block === null) return;
  out.add(rootId);
  // Children of an embed-content block (if any) are themselves embed-content.
  let childId = block.firstChildId;
  while (childId !== null) {
    if (out.has(childId)) break;
    collectEmbedContentSubtree(state, childId, out);
    const child = getEmbedContent(state, childId);
    childId = child?.nextSiblingId ?? null;
  }
  // Nested embed-content references in this embed-content's inlineContent.
  if (block.inlineContent !== null) {
    collectEmbedContentSubtreeFromInlineContent(state, block.inlineContent, out);
  }
}

/**
 * Dev-mode invariant assertion (paired with `isDevMode()` at the call
 * site): check that no `EmbedItem.properties.contentBlockId` references a
 * missing embed-content root.
 *
 * On the first violation, throws an `Error` whose message includes:
 *   - `opName`, identifying which op produced the bad state;
 *   - the owning block id holding the dangling EmbedItem;
 *   - the dangling `contentBlockId` value.
 *
 * Closes the under-protection in the cascade helpers: those helpers
 * (`collectEmbedContentSubtree`, `collectEmbedContentSubtreeFromInlineContent`)
 * delete bodies when their anchors are removed, but they only run when the
 * caller op remembers to invoke them. A future op that drops an EmbedItem
 * (or a body) without going through the cascade would silently leak an
 * orphan; this assertion turns that silent leak into a loud throw in dev
 * builds.
 *
 * Scope: this is the one-directional invariant — every EmbedItem reference
 * must resolve. The reverse (every embedContent root has a referencing
 * anchor) is a SEPARATE invariant deliberately not asserted here.
 *
 * Scan strategy (inductive). When `dirtyIds` is provided:
 *   1. If every dirty id still resolves to a block (no deletions), only the
 *      dirty blocks' inline content needs scanning — by induction, the
 *      previous state was orphan-free, so a new orphan can only be introduced
 *      via a newly-written EmbedItem inside a dirty block.
 *   2. If any dirty id is no longer resolvable (a deletion — possibly of an
 *      embedContent body), fall back to the full three-tree scan: surviving
 *      anchors anywhere could reference the deleted body.
 * When `dirtyIds` is omitted (direct callers, tests), always do the full
 * three-tree scan.
 *
 * Traversal: each tree's Y.Map keys (`block.id` set) iterated directly, then
 * each block resolved via the snapshot accessor for that tree. Because each
 * block appears exactly once in its owning Y.Map, key iteration is implicitly
 * cycle-safe (no firstChild/nextSibling chain to mis-link), and visits every
 * block — including any that are unreachable from the root pointer chain —
 * so a dangling reference inside a leaked subtree still surfaces.
 *
 * Cost is dev-mode only — guarded by `isDevMode()` at the (single)
 * production call site inside `applyOperation` — so PROD pays nothing.
 * Dev-mode cost is O(dirtyIds.size) in the common no-deletion case, and
 * O(N_blocks) on ops that delete a block.
 */
export function assertNoOrphanedEmbedContent(
  state: State,
  opName: string,
  dirtyIds?: ReadonlySet<BlockId>,
): void {
  if (dirtyIds !== undefined) {
    let needsFullScan = false;
    for (const id of dirtyIds) {
      const main = getBlock(state, id);
      if (main !== null) {
        const content = main.inlineContent;
        if (content !== null) {
          assertNoOrphansInInlineContent(state, id, content, opName);
        }
        continue;
      }
      const embed = getEmbedContent(state, id);
      if (embed !== null) {
        const content = embed.inlineContent;
        if (content !== null) {
          assertNoOrphansInInlineContent(state, id, content, opName);
        }
        continue;
      }
      const template = getTemplateContent(state, id);
      if (template !== null) {
        const content = template.inlineContent;
        if (content !== null) {
          assertNoOrphansInInlineContent(state, id, content, opName);
        }
        continue;
      }
      // Dirty id is no longer in any tree — a deletion. A deleted embedContent
      // body would orphan any anchor that still references it; we can't tell
      // from the dirty set alone whether this was a body deletion, so fall back
      // to the full scan.
      needsFullScan = true;
    }
    if (!needsFullScan) return;
  }
  fullScanForOrphans(state, opName);
}

/**
 * Walk every block in all three top-level Y.Maps and check each block's
 * inline content for orphan EmbedItem references. Used by the direct entry-
 * point (no dirtyIds) and by the deletion-detected fallback path.
 */
function fullScanForOrphans(state: State, opName: string): void {
  const doc = state[STATE_INTERNAL].doc;
  const [mainMap, embedMap, templateMap] = getTreeMaps(doc);
  iterateMapForOrphans(state, mainMap, (id) => getBlock(state, id), opName);
  iterateMapForOrphans(state, embedMap, (id) => getEmbedContent(state, id), opName);
  iterateMapForOrphans(
    state,
    templateMap,
    (id) => getTemplateContent(state, id),
    opName,
  );
}

/**
 * Iterate every block id present in `map` and, for each block whose
 * `inlineContent` is non-null, scan EmbedItems for dangling references.
 *
 * `resolve` fetches the frozen Block snapshot for the named id from the
 * tree owning `map` (so the snapshot cache short-circuits per id). Y.Map
 * key iteration is the structural fast path: each block appears exactly
 * once in its owning map, no cycle defense needed at this layer.
 */
function iterateMapForOrphans(
  state: State,
  map: { keys(): IterableIterator<string> },
  resolve: (id: BlockId) => { inlineContent: InlineContent | null } | null,
  opName: string,
): void {
  for (const key of map.keys()) {
    const id = key as BlockId;
    const block = resolve(id);
    if (block === null) continue;
    const content = block.inlineContent;
    if (content === null) continue;
    assertNoOrphansInInlineContent(state, id, content, opName);
  }
}

/**
 * Scan a block's inline-content items for EmbedItems with string-typed
 * `contentBlockId` properties; throw on the first that doesn't resolve via
 * `getEmbedContent`.
 *
 * Non-string `contentBlockId` values (undefined, null, numbers) are skipped
 * — the invariant only covers reference-typed embed properties.
 */
function assertNoOrphansInInlineContent(
  state: State,
  owningBlockId: BlockId,
  content: InlineContent,
  opName: string,
): void {
  for (const item of content.items) {
    if (item.kind !== "embed") continue;
    const cbId = item.properties.contentBlockId;
    if (typeof cbId !== "string") continue;
    if (getEmbedContent(state, cbId as BlockId) === null) {
      throw new Error(
        `assertNoOrphanedEmbedContent (op: "${opName}"): EmbedItem in block ` +
          `"${owningBlockId}" references missing embedContent root "${cbId}"`,
      );
    }
  }
}

/**
 * Walk an InlineContent for `EmbedItem.properties.contentBlockId`
 * references and collect each referenced embed-content subtree into
 * `out` via `collectEmbedContentSubtree`.
 *
 * Used by `removeBlock` (every block in the removed subtree's inline
 * content) and `deleteRange` (the DELETED inline portion — anchor
 * suffix + intervening leaves + focus prefix on cross-block; or the
 * `[anchor.offset .. focus.offset)` slice on same-block).
 *
 * Cycle-defended via the shared `out` Set.
 */
export function collectEmbedContentSubtreeFromInlineContent(
  state: State,
  content: InlineContent,
  out: Set<BlockId>,
): void {
  for (const item of content.items) {
    if (item.kind !== "embed") continue;
    const cbId = item.properties.contentBlockId;
    if (typeof cbId !== "string") continue;
    collectEmbedContentSubtree(state, cbId as BlockId, out);
  }
}

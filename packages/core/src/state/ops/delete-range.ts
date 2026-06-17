import * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { Span } from "../block-position";
import {
  inlineContentLength,
  mergeAdjacentTextItems,
  splitInlineContentAtOffset,
  type InlineItem,
} from "../inline-content";
import {
  getEmbedContentsMap,
  getTreeMap,
  getYBlock,
  requireInTransaction,
  type BlockTreeKind,
} from "../yjs-doc";
import { buildYInlineContent } from "../y-block";
import { surgicallyDeleteInlineRangeInTx } from "../y-utils";
import { normalizeSpan } from "../span-iteration";
import { collectEmbedContentSubtreeFromInlineContent } from "../embed-content-cascade";
import { assertSameTree } from "../assert-same-tree";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../../cascade/attr-registry";

/**
 * Pre-computed mutation plan for `deleteRangeInTx`. Discriminated by
 * `mode`: same-block writes only the anchor block's inlineContent;
 * cross-block additionally deletes the focus block, any intervening
 * leaves, and rewires the focus's old next sibling (or the parent's
 * `lastChildId` if focus was the last child).
 *
 * `mergedItems` is the new anchor block inlineContent: the surviving
 * prefix + suffix, with run-merging already applied. `embedContentIds`
 * is the set of embed-content subtree roots to cascade-delete from
 * `state.embedContents`.
 *
 * `kind` is the owning tree of the span's blocks (resolved once during
 * planning via `resolveBlock`). `deleteRangeInTx` threads it to every
 * block-level `getTreeMap` / `getYBlock` write so a span inside a
 * header/footer body (templateContents) mutates that tree, not the main
 * `blocks` map. Main-tree spans resolve to `"block"` — the historical
 * default. NOTE: the embed-content cascade-delete writes always target the
 * `embedContents` map regardless of `kind` — they delete embed BODIES
 * referenced by dropped inline content, which are independent of the edited
 * block's own tree.
 */
export type DeleteRangePlan =
  | {
      readonly mode: "same-block";
      readonly kind: BlockTreeKind;
      readonly blockId: BlockId;
      /** Normalized deletion range, flattened offsets — drives the surgical applier. */
      readonly anchorOffset: number;
      readonly focusOffset: number;
      /** Threaded to the in-place seam-merge normalizer (registry-aware attrs equality). */
      readonly registry: AttrRegistry | undefined;
      /**
       * Post-delete normalized items. The surgical same-block applier does NOT read
       * this (it derives the in-place mutation from `anchorOffset`/`focusOffset` +
       * the live items) — but `replaceRange` DOES consume it to build the composed
       * insert plan (`planInsertTextFullReplace(..., deletePlan.mergedItems, ...)`),
       * and tests use it as the read-back oracle. Do NOT remove it.
       */
      readonly mergedItems: ReadonlyArray<InlineItem>;
      readonly embedContentIds: ReadonlySet<BlockId>;
    }
  | {
      readonly mode: "cross-block";
      readonly kind: BlockTreeKind;
      readonly anchorId: BlockId;
      readonly focusId: BlockId;
      readonly interveningIds: ReadonlyArray<BlockId>;
      readonly focusNextId: BlockId | null;
      readonly parentId: BlockId;
      readonly mergedItems: ReadonlyArray<InlineItem>;
      readonly embedContentIds: ReadonlySet<BlockId>;
    };

/**
 * Delete the inline content within a Span.
 *
 * Same-block case: the block's inlineContent becomes
 *   items[0..anchor.offset) ⊕ items[focus.offset..)
 * with a run-merging post-pass.
 *
 * Cross-block case (same parent only): the anchor block keeps its identity
 * (id, type, attrs, parentId, prevSiblingId) and absorbs:
 *   anchor.items[0..anchor.offset) ⊕ focus.items[focus.offset..)
 * with a run-merging post-pass. The focus block and any leaf blocks
 * between anchor and focus in the parent's child list are removed.
 * Anchor's nextSiblingId rewires to focus's old nextSiblingId.
 *
 * Empty-span (collapsed) is a no-op.
 *
 * Returns OperationResult with dirtyIds containing every block id whose
 * Y representation changed (captured by the Y.Doc transaction).
 *
 * Throws if:
 *   - either endpoint references a missing block,
 *   - either endpoint is a container (firstChildId !== null OR
 *     inlineContent === null),
 *   - the span crosses parents (cross-parent deleteRange not supported
 *     in this phase — action handlers compose primitives for that),
 *   - cross-context (inherited via normalizeSpan's comparePositions
 *     call which throws on no-common-ancestor),
 *   - any offset is outside [0, inlineContentLength].
 *
 * Y.Doc note: the SAME-BLOCK path mutates the anchor block's
 * `inlineContent` Y.Array IN PLACE (surgical `surgicallyDeleteInlineRangeInTx`):
 * runs OUTSIDE the deleted range — and the surviving portion of a straddled
 * run — keep their `Y.Text` CRDT identity, so a `RelativePosition` anchored
 * there survives (the foundation for within-block selection rebasing). The
 * one exception is the seam: when the prefix-end and suffix-start runs are
 * same-attrs and merge, the receiver keeps identity but the donor's migrated
 * chars are fresh (Class-2 limit — Yjs has no identity-preserving cross-`Y.Text`
 * move). Read-back is byte-identical to the old `buildYInlineContent` rebuild.
 * The CROSS-BLOCK path still fully replaces the anchor block's `inlineContent`
 * via `buildYInlineContent` (a later surgical-ops slice migrates it).
 *
 * Cascade-deletes embed-content references for the DELETED inline portion:
 * walks dropped `EmbedItem.properties.contentBlockId` references and
 * recursively removes each referenced block (plus its descendants and any
 * nested contentBlockId refs) from `state.embedContents`. The transferred
 * suffix (focus.items[focus.offset..) into anchor) is preserved, so embed
 * references that survive the operation are NOT cascade-deleted. Mirrors
 * the same invariant `removeBlock` upholds; see `embed-content-cascade.ts`.
 *
 * Cost: a same-block delete is O(1) block-writes (one anchor-block
 * inlineContent rewrite). A cross-block delete is O(K) in K = the blocks
 * the span covers — the focus block plus every intervening leaf are
 * deleted from the owning tree map, all within the single `applyOperation`
 * transaction. K is the selection width, not the document size (a typical
 * edit spans one or two blocks).
 *
 * Composition: see `deleteRangeInTx` for the in-transaction primitive
 * used by `replaceRange` to compose delete + insert in a single Y.Doc
 * transaction (T12 atomicity).
 *
 * `registry` (optional): an `AttrRegistry`; threaded to the seam-merge
 * normalizer (`mergeAdjacentTextItems`) so interpreters with a custom
 * per-key `equals` (e.g. a `comment` interpreter that ignores
 * `timestamp`) opt into custom adjacent-item compare semantics across
 * the post-delete seam. Omitted → deep-value compare.
 */
export function deleteRange(
  state: State,
  span: Span,
  registry?: AttrRegistry,
): OperationResult {
  // Empty-span no-op (collapsed-ness is normalization-invariant).
  if (
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset
  ) {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  const plan = planDeleteRange(state, span, registry);
  if (plan === null) {
    // Re-collapsed after normalization (e.g., reverse-order positions in
    // the same block at the same offset).
    return { state, dirtyIds: new Set<BlockId>() };
  }

  return applyOperation(state, (doc) => {
    deleteRangeInTx(doc, plan);
  });
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed `DeleteRangePlan`
 * to `doc`. Caller is responsible for all validation and for opening the
 * surrounding `applyOperation` / `runTransaction` (this function MUST run
 * inside an already-open transaction; it does NOT open one itself).
 *
 * Used by:
 *   - `deleteRange` (thin wrapper that validates + plans + wraps in
 *     `applyOperation`).
 *   - `replaceRange` (composes `deleteRangeInTx` + `insertTextInTx` in a
 *     single `applyOperation` transaction so collab peers can never
 *     observe the post-delete pre-insert mid-state).
 *
 * Postcondition (cross-block): after this call, the anchor block's
 * `inlineContent` is `plan.mergedItems`. Callers composing further
 * mutations (e.g., `replaceRange` calling `insertTextInTx` next) MUST
 * compute their plans against `plan.mergedItems`, NOT against the
 * pre-delete state read via `getBlock` (the snapshot cache is stale
 * until `applyOperation` mints a fresh State).
 */
export function deleteRangeInTx(doc: Y.Doc, plan: DeleteRangePlan): void {
  requireInTransaction(doc, "deleteRange");
  if (plan.mode === "same-block") {
    const yBlock = getYBlock(doc, plan.blockId, "deleteRange", plan.kind);
    // Surgical, identity-preserving in-place delete (replaces the old full-replace
    // via buildYInlineContent): runs outside the deleted range keep their Y.Text
    // CRDT identity → a RelativePosition there survives. Read-back byte-identical
    // to the old merged-items rebuild (proven by the delete-range suite).
    const yItems = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
    surgicallyDeleteInlineRangeInTx(yItems, plan.anchorOffset, plan.focusOffset, plan.registry);
    if (plan.embedContentIds.size > 0) {
      // Embed bodies always live in the embedContents map, independent of the
      // edited block's own tree (`plan.kind`) — do NOT route these by kind.
      const yEmbeds = getEmbedContentsMap(doc);
      for (const id of plan.embedContentIds) {
        yEmbeds.delete(id);
      }
    }
    return;
  }

  // Cross-block. Route block-level reads/writes/deletes to the span's owning
  // tree (`plan.kind`) — a cross-block delete inside a header/footer body
  // (templateContents) deletes the focus + intervening leaves from that tree.
  const yTree = getTreeMap(doc, plan.kind);
  const yAnchor = getYBlock(doc, plan.anchorId, "deleteRange", plan.kind);

  // Update anchor: new content + nextSiblingId rewired to focus's old next.
  yAnchor.set("inlineContent", buildYInlineContent({ items: plan.mergedItems }));
  yAnchor.set("nextSiblingId", plan.focusNextId);

  // Rewire focus's old nextSibling, if any. Else update the parent's
  // lastChildId to anchor (focus was the parent's last child).
  if (plan.focusNextId !== null) {
    getYBlock(doc, plan.focusNextId, "deleteRange", plan.kind).set(
      "prevSiblingId",
      plan.anchorId,
    );
  } else {
    getYBlock(doc, plan.parentId, "deleteRange", plan.kind).set(
      "lastChildId",
      plan.anchorId,
    );
  }

  // Delete focus + all intervening leaves last (after reads of yAnchor /
  // sibling updates are done).
  yTree.delete(plan.focusId);
  for (const id of plan.interveningIds) {
    yTree.delete(id);
  }

  // Cascade-delete embed-content subtrees referenced by the dropped
  // inline portion. Done last (after block writes/deletes) so the
  // y-doc transaction observers see a single atomic write.
  if (plan.embedContentIds.size > 0) {
    const yEmbeds = getEmbedContentsMap(doc);
    for (const id of plan.embedContentIds) {
      yEmbeds.delete(id);
    }
  }
}

/**
 * Pre-normalize existence + leaf guards for delete/replace ops.
 *
 * Runs the anchor/focus block-exists + is-leaf checks BEFORE
 * `normalizeSpan` is called. This preserves the "deleteRange:" prefixed
 * error contract — without these guards, `normalizeSpan` →
 * `compareBlocksInDocOrder`'s generic "block ... not found" message
 * would leak through and shadow the operation's stated errors.
 *
 * Shared by `planDeleteRange` (delete-range.ts) and `replaceRange`
 * (replace-range.ts), which need identical pre-normalize semantics.
 * Both operations report errors with the "deleteRange:" prefix
 * regardless of the public op name — they share the same error
 * contract because replaceRange composes delete + insert.
 *
 * Throws on missing block or container endpoint; returns void on success.
 */
export function assertDeleteRangeEndpoints(state: State, span: Span): void {
  const sameBlock = span.anchor.blockId === span.focus.blockId;
  // Map-agnostic: resolve across all three trees so a span inside a
  // header/footer body (templateContents) passes these guards rather than
  // reporting a spurious "not found" (getBlock sees only the main tree).
  const rawAnchor = resolveBlock(state, span.anchor.blockId)?.block ?? null;
  if (!rawAnchor) {
    throw new Error(
      sameBlock
        ? `deleteRange: block "${span.anchor.blockId}" not found`
        : `deleteRange: anchor block "${span.anchor.blockId}" not found`,
    );
  }
  if (!rawAnchor.inlineContent || rawAnchor.firstChildId !== null) {
    throw new Error(
      sameBlock
        ? `deleteRange: block "${span.anchor.blockId}" is a container, not a leaf`
        : `deleteRange: anchor block "${span.anchor.blockId}" is a container, not a leaf`,
    );
  }
  if (!sameBlock) {
    const rawFocus = resolveBlock(state, span.focus.blockId)?.block ?? null;
    if (!rawFocus) {
      throw new Error(`deleteRange: focus block "${span.focus.blockId}" not found`);
    }
    if (!rawFocus.inlineContent || rawFocus.firstChildId !== null) {
      throw new Error(
        `deleteRange: focus block "${span.focus.blockId}" is a container, not a leaf`,
      );
    }
  }
}

/**
 * Validate `span` against `state` and produce a `DeleteRangePlan`
 * describing the Y.Doc mutations needed. Returns `null` for the
 * post-normalization re-collapsed case (caller treats as no-op).
 *
 * All validation reads happen here, BEFORE the surrounding
 * `applyOperation` is opened — snapshot reads against the pre-mutation
 * Y.Doc state. The plan captures everything `deleteRangeInTx` needs to
 * run the mutations without further reads.
 *
 * Throws on every condition `deleteRange`'s docstring lists.
 *
 * Used by `deleteRange` and by `replaceRange` (which composes a delete
 * plan + an insert plan into a single transaction). See `deleteRangeInTx`
 * for the dual primitive.
 */
export function planDeleteRange(
  state: State,
  span: Span,
  registry?: AttrRegistry,
): DeleteRangePlan | null {
  // Pre-normalize existence + leaf guards. These run before normalizeSpan
  // so the operation's stated error contract ("anchor/focus block ... not
  // found", "... is a container") wins over compareBlocksInDocOrder's
  // generic "block ... not found" message that would otherwise leak through
  // the normalizeSpan → comparePositions path. Same architectural pattern
  // applyAttrsToRange uses for the same reason.
  assertDeleteRangeEndpoints(state, span);

  // Now normalize. comparePositions can only throw on cross-context (no
  // common ancestor) since both endpoints have been verified to exist.
  const normalized = normalizeSpan(state, span);

  // SAME-BLOCK case
  if (normalized.anchor.blockId === normalized.focus.blockId) {
    // Map-agnostic: resolve across all three trees (a header/footer body lives
    // in templateContents). `kind` is threaded onto the plan so
    // `deleteRangeInTx` writes into the owning Y.Map.
    const resolved = resolveBlock(state, normalized.anchor.blockId);
    if (!resolved) {
      throw new Error(`deleteRange: block "${normalized.anchor.blockId}" not found`);
    }
    const { block, kind } = resolved;
    if (!block.inlineContent || block.firstChildId !== null) {
      throw new Error(
        `deleteRange: block "${normalized.anchor.blockId}" is a container, not a leaf`,
      );
    }

    const totalLen = inlineContentLength(block.inlineContent);
    if (normalized.anchor.offset < 0 || normalized.anchor.offset > totalLen) {
      throw new Error(
        `deleteRange: anchor offset ${normalized.anchor.offset} out of range [0, ${totalLen}] for block "${normalized.anchor.blockId}"`,
      );
    }
    if (normalized.focus.offset < 0 || normalized.focus.offset > totalLen) {
      throw new Error(
        `deleteRange: focus offset ${normalized.focus.offset} out of range [0, ${totalLen}] for block "${normalized.anchor.blockId}"`,
      );
    }

    // After collapsed-span no-op above, normalized may still be collapsed
    // if the input had reverse-order positions in the same block at the
    // same offset. The normalized form would be identical to either input.
    // Re-check here for completeness.
    if (normalized.anchor.offset === normalized.focus.offset) {
      return null;
    }

    const [prefix, afterPrefix] = splitInlineContentAtOffset(
      block.inlineContent,
      normalized.anchor.offset,
    );
    const [, suffix] = splitInlineContentAtOffset(block.inlineContent, normalized.focus.offset);
    const merged = mergeAdjacentTextItems([...prefix, ...suffix], registry);

    // Collect embed-content ids referenced by the DELETED inline portion
    // (items[anchor.offset .. focus.offset)). Splitting afterPrefix at
    // (focus.offset - anchor.offset) yields the deleted slice as its
    // prefix. Per the "no orphaned blocks" invariant, dropped EmbedItems
    // own their referenced contentBlockId subtrees and must cascade-delete.
    const deletedLength = normalized.focus.offset - normalized.anchor.offset;
    const [deletedItems] = splitInlineContentAtOffset(
      { items: afterPrefix },
      deletedLength,
    );
    const embedContentIds = new Set<BlockId>();
    collectEmbedContentSubtreeFromInlineContent(
      state,
      { items: deletedItems },
      embedContentIds,
    );

    return {
      mode: "same-block",
      kind,
      blockId: block.id,
      anchorOffset: normalized.anchor.offset,
      focusOffset: normalized.focus.offset,
      registry,
      mergedItems: merged,
      embedContentIds,
    };
  }

  // CROSS-BLOCK case
  // Map-agnostic: resolve the anchor across all three trees and use its `kind`
  // as the span's owning tree. The cross-parent refusal below guarantees both
  // endpoints share a parent (so a single `kind` covers the whole span);
  // `assertSameTree` re-verifies the focus + neighbors before any write.
  const anchorResolved = resolveBlock(state, normalized.anchor.blockId);
  if (!anchorResolved) {
    throw new Error(`deleteRange: anchor block "${normalized.anchor.blockId}" not found`);
  }
  const { block: anchorBlock, kind } = anchorResolved;
  const focusBlock = resolveBlock(state, normalized.focus.blockId)?.block ?? null;
  if (!focusBlock) {
    throw new Error(`deleteRange: focus block "${normalized.focus.blockId}" not found`);
  }

  if (!anchorBlock.inlineContent || anchorBlock.firstChildId !== null) {
    throw new Error(
      `deleteRange: anchor block "${normalized.anchor.blockId}" is a container, not a leaf`,
    );
  }
  if (!focusBlock.inlineContent || focusBlock.firstChildId !== null) {
    throw new Error(
      `deleteRange: focus block "${normalized.focus.blockId}" is a container, not a leaf`,
    );
  }

  if (anchorBlock.parentId !== focusBlock.parentId) {
    throw new Error(
      `deleteRange: cross-parent spans are not supported in this phase ` +
      `(anchor parent="${anchorBlock.parentId}", focus parent="${focusBlock.parentId}"). ` +
      `Action handlers should decompose into per-parent operations.`,
    );
  }

  // Defensive: same-parent + cross-block implies non-null parent (siblings
  // can't span the root since the root has no siblings). Hoist into a const
  // so the non-null narrowing survives into the transaction closure (avoids
  // a non-null assertion when calling getYBlock(parentId)).
  const parentId = anchorBlock.parentId;
  if (parentId === null) {
    throw new Error(
      `deleteRange: blocks "${normalized.anchor.blockId}" and "${normalized.focus.blockId}" have null parent (state corruption)`,
    );
  }

  const anchorLen = inlineContentLength(anchorBlock.inlineContent);
  if (normalized.anchor.offset < 0 || normalized.anchor.offset > anchorLen) {
    throw new Error(
      `deleteRange: anchor offset ${normalized.anchor.offset} out of range [0, ${anchorLen}] for block "${normalized.anchor.blockId}"`,
    );
  }
  const focusLen = inlineContentLength(focusBlock.inlineContent);
  if (normalized.focus.offset < 0 || normalized.focus.offset > focusLen) {
    throw new Error(
      `deleteRange: focus offset ${normalized.focus.offset} out of range [0, ${focusLen}] for block "${normalized.focus.blockId}"`,
    );
  }

  // Walk the parent's child sibling chain from anchor to focus, collecting
  // intervening leaves. Throws if focus is not reachable (which would mean
  // anchor doesn't precede focus in the chain — impossible after normalization
  // unless state is corrupt).
  const interveningIds: BlockId[] = [];
  let cur: BlockId | null = anchorBlock.nextSiblingId;
  while (cur !== null && cur !== focusBlock.id) {
    const node = resolveBlock(state, cur)?.block ?? null;
    if (!node) {
      throw new Error(`deleteRange: intervening sibling "${cur}" not found`);
    }
    // Defensive (S-E6): the cross-block delete removes each intervening
    // sibling via a flat `yTree.delete` — which would ORPHAN a container's
    // subtree (its descendants are never visited or cascade-deleted). Refuse
    // a container in the intervening run rather than silently corrupt state;
    // action handlers must decompose such a span (the same stance as the
    // cross-parent refusal above). Leaves are `inlineContent !== null` and
    // `firstChildId === null`.
    if (node.firstChildId !== null || node.inlineContent === null) {
      throw new Error(
        `deleteRange: intervening sibling "${cur}" is a container, not a leaf; ` +
          `cross-block delete spanning a container is not supported ` +
          `(action handlers should decompose into per-block operations).`,
      );
    }
    interveningIds.push(cur);
    cur = node.nextSiblingId;
  }
  if (cur !== focusBlock.id) {
    throw new Error(
      `deleteRange: focus block "${focusBlock.id}" is not reachable from anchor "${anchorBlock.id}" in the parent's sibling chain`,
    );
  }

  // Validate the focus's old nextSibling rewire-target now (outside the
  // transaction) so the "focus block's next sibling not found" error
  // contract is preserved. Symmetric: validate the parent for the
  // last-child rewire branch.
  const focusNextId = focusBlock.nextSiblingId;
  if (focusNextId !== null) {
    if (resolveBlock(state, focusNextId) === null) {
      throw new Error(
        `deleteRange: focus block's next sibling "${focusNextId}" not found`,
      );
    }
  } else {
    if (resolveBlock(state, parentId) === null) {
      throw new Error(
        `deleteRange: parent "${parentId}" of anchor block not found`,
      );
    }
  }

  // Dev-only single-tree invariant: every block this op deletes / rewires
  // (focus, intervening leaves, focus's old next, the parent) must live in the
  // same tree as the anchor (`kind`); otherwise the kind-routed writes below
  // would corrupt state. Production no-op.
  assertSameTree(
    state,
    kind,
    [focusBlock.id, focusNextId, parentId, ...interveningIds],
    "deleteRange",
  );

  // Build merged anchor inline content (pure JS — Y materialization happens
  // inside the transaction via buildYInlineContent).
  const [anchorPrefix, anchorDeletedSuffix] = splitInlineContentAtOffset(
    anchorBlock.inlineContent,
    normalized.anchor.offset,
  );
  const [focusDeletedPrefix, focusSuffix] = splitInlineContentAtOffset(
    focusBlock.inlineContent,
    normalized.focus.offset,
  );
  const mergedItems = mergeAdjacentTextItems([...anchorPrefix, ...focusSuffix], registry);

  // Collect embed-content ids referenced by the DELETED inline portion of
  // the cross-block range. The deleted portion is:
  //   - anchor suffix: items[anchor.offset..) of anchorBlock
  //   - all intervening leaves' items
  //   - focus prefix: items[..focus.offset) of focusBlock
  // Per the "no orphaned blocks" invariant, dropped EmbedItems own their
  // referenced contentBlockId subtrees and must cascade-delete.
  const embedContentIds = new Set<BlockId>();
  collectEmbedContentSubtreeFromInlineContent(
    state,
    { items: anchorDeletedSuffix },
    embedContentIds,
  );
  for (const id of interveningIds) {
    const interveningBlock = resolveBlock(state, id)?.block ?? null;
    if (interveningBlock === null || interveningBlock.inlineContent === null) continue;
    collectEmbedContentSubtreeFromInlineContent(
      state,
      interveningBlock.inlineContent,
      embedContentIds,
    );
  }
  collectEmbedContentSubtreeFromInlineContent(
    state,
    { items: focusDeletedPrefix },
    embedContentIds,
  );

  return {
    mode: "cross-block",
    kind,
    anchorId: anchorBlock.id,
    focusId: focusBlock.id,
    interveningIds,
    focusNextId,
    parentId,
    mergedItems,
    embedContentIds,
  };
}

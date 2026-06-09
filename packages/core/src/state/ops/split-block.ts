import * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import type { Position } from "../block-position";
import {
  inlineContentLength,
  type EmbedItem,
} from "../inline-content";
import { getTreeMap, getYBlock, requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { buildYBlock, buildYInlineItem } from "../y-block";
import { yMapAsObject, cloneInlineItem, yItemLength } from "../y-utils";
import { assertNoIdCollision } from "../id-collision-check";
import { assertSameTree } from "../assert-same-tree";
import {
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  writeSuggestionRecordInTx,
  type SuggestionMintInput,
} from "../suggestions";

/**
 * Pre-computed mutation plan for `splitBlockAtPositionInTx`. Captures the
 * fully-resolved write inputs:
 *   - `blockId` / `kind` — the reference (original) block + its owning tree
 *     (resolved from `resolveBlock` at plan time so `inTx` doesn't have to
 *     re-resolve).
 *   - `parentId`, `originalNextId` — the neighbor ids the op rewires;
 *     read from the pre-mutation snapshot.
 *   - `newBlockId` — the fresh id allocated outside the transaction so the
 *     allocator is bumped exactly once even if `applyOperation` were ever
 *     made retryable.
 *   - `newType` / `newAttrs` — the NEW block's type + attrs, resolved here
 *     so `inTx` doesn't touch the snapshot. Inherits from the original when
 *     `newBlockInit` omits a field.
 *   - `offset` — the split offset, validated against
 *     `inlineContentLength(block.inlineContent)` at plan time.
 *
 * The plan is plain data — no Y types in it.
 */
export interface SplitBlockPlan {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly parentId: BlockId;
  readonly originalNextId: BlockId | null;
  readonly newBlockId: BlockId;
  readonly newType: string;
  readonly newAttrs: ReadonlyAttrs;
  readonly offset: number;
}

/**
 * Split a leaf block at `position` into two adjacent siblings under the
 * same parent.
 *
 * The original block keeps its id, type, attrs, parentId, prevSiblingId.
 * Its inlineContent becomes items in [0, offset). Its nextSiblingId is
 * rewired to the new block.
 *
 * A new block is created with a fresh id from `allocator`, carrying the
 * original block's type, attrs, parentId. Its prevSiblingId is the
 * original block's id; its nextSiblingId is the original block's
 * previous nextSiblingId. Its inlineContent is items in
 * [offset, length).
 *
 * `newBlockInit` overrides the NEW block's `type` / `attrs` (each field
 * independently; omitted fields inherit from the original). Used by the editor
 * to implement "style for the following paragraph" — e.g. Enter at the END of a
 * heading makes the new (empty) block a `paragraph` with fresh attrs rather than
 * another heading. This op stays mechanical: it sets whatever type/attrs it is
 * given; the caller is responsible for passing a shape-compatible leaf type.
 *
 * Returns OperationResult with dirtyIds containing:
 *   - the original block's id (content + nextSiblingId changed)
 *   - the new block's id (new entry)
 *   - the original's previous nextSibling, if non-null (its prevSiblingId
 *     was rewired)
 *   - the parent's id, if the original was the last child (parent's
 *     lastChildId updated)
 *
 * Throws if:
 *   - the block does not exist,
 *   - the block is a container (has firstChildId or null inlineContent),
 *   - the block is the root (parentId === null),
 *   - the offset is out of range [0, inlineContentLength].
 *
 * Y.Doc identity: the original block's content Y.Text retains identity
 * for the left half — when the split lands inside a text run, the
 * straddling Y.Text is shortened in place (not rebuilt). Only the new
 * block's suffix items are freshly materialized. No normalization
 * post-pass is needed: a clean split of normalized inline content yields
 * two halves that are each individually normalized.
 *
 * Composition: see `splitBlockAtPositionInTx` for the in-transaction
 * primitive that lets callers chain a split with other `*InTx` ops inside
 * a single Y.Doc transaction (one undo entry / one collab event).
 */
export function splitBlockAtPosition(
  state: State,
  position: Position,
  allocator: IdAllocator,
  newBlockInit?: { readonly type?: string; readonly attrs?: ReadonlyAttrs },
): OperationResult {
  const plan = planSplitBlockAtPosition(state, position, allocator, newBlockInit);
  return applyOperation(state, (doc) => {
    splitBlockAtPositionInTx(doc, plan);
  });
}

/**
 * Validate `position` against `state` and produce a `SplitBlockPlan` describing
 * the Y.Doc mutations needed. Throws on every condition `splitBlockAtPosition`'s
 * docstring lists.
 *
 * Allocates the new block id via `allocator` so the allocator is bumped exactly
 * once even if the transaction body were ever made retryable. Production
 * crypto-UUID allocators can't collide; the test counter allocators we use can,
 * so `splitBlockAtPositionInTx` still runs `assertNoIdCollision` (dev-only) on
 * `plan.newBlockId` against the live doc.
 *
 * All reads happen against the pre-mutation snapshot — `inTx` does no further
 * `state` / `getBlock` / `resolveBlock` calls.
 */
export function planSplitBlockAtPosition(
  state: State,
  position: Position,
  allocator: IdAllocator,
  newBlockInit?: { readonly type?: string; readonly attrs?: ReadonlyAttrs },
): SplitBlockPlan {
  const resolved = resolveBlock(state, position.blockId);
  if (resolved === null) {
    throw new Error(`splitBlockAtPosition: block "${position.blockId}" not found`);
  }
  const { block, kind } = resolved;
  if (block.inlineContent === null || block.firstChildId !== null) {
    throw new Error(
      `splitBlockAtPosition: block "${position.blockId}" is a container, not a leaf`,
    );
  }
  if (block.parentId === null) {
    throw new Error(
      `splitBlockAtPosition: block "${position.blockId}" is the root and has no parent to host a sibling`,
    );
  }
  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `splitBlockAtPosition: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }

  // The neighbor ids this op reads + rewires: the original's old next sibling
  // (its prevSiblingId flips to the new block) and the parent (its lastChildId
  // may flip). Both must live in the SAME tree as the reference block — a
  // cross-tree pointer would mean the kind-routed writes below corrupt state.
  // (Dev-only; production no-op.)
  assertSameTree(
    state,
    kind,
    [block.nextSiblingId, block.parentId],
    "splitBlockAtPosition",
  );

  // Allocate the new block id at plan time (OUTSIDE applyOperation) so retries
  // (if ever added) don't burn through multiple ids.
  const newBlockId = allocator.allocate();

  // Resolve the new block's type/attrs against the pre-mutation snapshot so
  // `inTx` doesn't need to read from `block` / `state` again.
  const newType = newBlockInit?.type ?? block.type;
  const newAttrs = newBlockInit?.attrs ?? block.attrs;

  return {
    blockId: position.blockId,
    kind,
    parentId: block.parentId,
    originalNextId: block.nextSiblingId,
    newBlockId,
    newType,
    newAttrs,
    offset: position.offset,
  };
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed `SplitBlockPlan`
 * to `doc`. Caller is responsible for all validation and for opening the
 * surrounding `applyOperation` / `runTransaction` (this function MUST run
 * inside an already-open transaction; it does NOT open one itself).
 *
 * Used by:
 *   - `splitBlockAtPosition` (thin wrapper that validates + plans + wraps
 *     in `applyOperation`).
 *   - Future composers (e.g., a footnote-anchor insertion that splits a
 *     paragraph and inserts text into the new half) that need to chain
 *     multiple `*InTx` calls inside ONE Y.Doc transaction for atomicity
 *     (single undo entry, single collab event).
 *
 * Reads from the LIVE Y.Doc (the original block's Y.Array<inlineContent>
 * and its child Y.Texts) are unavoidable here — preserving per-character
 * CRDT identity on the left half of a straddled text run requires
 * shortening the existing Y.Text in place, which the plan can't encode as
 * pure data. The reads are local to the original block's items, not the
 * snapshot, so they remain safe for composition (the plan's pre-mutation
 * `state` is irrelevant once the prior `*InTx` has mutated the doc).
 */
export function splitBlockAtPositionInTx(doc: Y.Doc, plan: SplitBlockPlan): void {
  requireInTransaction(doc, "splitBlockAtPosition");

  // Dev-mode defense against allocator id collision (test allocators with
  // counter-based ids can collide with seeded state; production
  // crypto.randomUUID effectively cannot). Without this, the owning-map
  // `set` below would silently overwrite the existing block of the same id.
  // Checks all three trees (BlockIds share one namespace).
  assertNoIdCollision(doc, plan.newBlockId, "splitBlockAtPosition");

  // Route every map access to the reference block's owning tree (`plan.kind`):
  // a split inside a header/footer body (templateContents) must land the
  // new sibling in templateContents, not the main `blocks` map.
  const yTree = getTreeMap(doc, plan.kind);
  const yOriginal = getYBlock(doc, plan.blockId, "splitBlockAtPosition", plan.kind);

  // Split yOriginal's inlineContent: items in [0, offset) stay; items in
  // [offset, end) move to a new block. Straddling text items split.
  const suffixItems = splitInlineContent(yOriginal, plan.offset);

  // Build new block from the plan's resolved type/attrs + neighbor links.
  const newYBlock = buildYBlock({
    type: plan.newType,
    attrs: plan.newAttrs,
    parentId: plan.parentId,
    prevSiblingId: plan.blockId,
    nextSiblingId: plan.originalNextId,
    firstChildId: null,
    lastChildId: null,
    inlineContent: null,
  });
  const newInlineContent = new Y.Array<Y.Map<unknown>>();
  if (suffixItems.length > 0) newInlineContent.push(suffixItems);
  newYBlock.set("inlineContent", newInlineContent);
  // New block inherits the reference block's map (`plan.kind`).
  yTree.set(plan.newBlockId, newYBlock);

  // Re-wire sibling pointers around the insertion.
  if (plan.originalNextId !== null) {
    getYBlock(doc, plan.originalNextId, "splitBlockAtPosition", plan.kind).set(
      "prevSiblingId",
      plan.newBlockId,
    );
  }
  yOriginal.set("nextSiblingId", plan.newBlockId);

  // Re-wire parent's lastChildId if original was the last child.
  const yParent = getYBlock(doc, plan.parentId, "splitBlockAtPosition", plan.kind);
  if (yParent.get("lastChildId") === plan.blockId) {
    yParent.set("lastChildId", plan.newBlockId);
  }
}

/**
 * Mutates `yOriginal.inlineContent` by removing items (and the trailing part
 * of any straddling text item) from `offset` onward, returning a fresh array
 * of detached Y.Map items representing the suffix. Caller owns inserting them
 * into the new block's inlineContent Y.Array.
 *
 * Straddling-text case: the original's Y.Text is shortened in-place
 * (preserving CRDT identity for the left half) and a fresh Y.Map text item
 * carrying the right half is returned in the suffix.
 *
 * Entirely-in-suffix case: items are cloned into the suffix and removed from
 * the original. (Move-without-clone isn't supported by Yjs — a Y type can
 * only belong to one parent.)
 */
function splitInlineContent(yOriginal: Y.Map<unknown>, offset: number): Y.Map<unknown>[] {
  const yItems = yOriginal.get("inlineContent") as Y.Array<Y.Map<unknown>>;
  const suffix: Y.Map<unknown>[] = [];
  let cursor = 0;
  let i = 0;
  while (i < yItems.length) {
    const yItem = yItems.get(i);
    const itemLen = yItemLength(yItem);
    const itemEnd = cursor + itemLen;

    if (itemEnd <= offset) {
      // Entirely in prefix: leave alone.
      cursor = itemEnd;
      i++;
      continue;
    }
    if (cursor >= offset) {
      // Entirely in suffix: clone into the suffix, remove from original.
      suffix.push(cloneInlineItem(yItem));
      yItems.delete(i, 1);
      // Don't advance i — yItems.delete shifts subsequent items down.
      continue;
    }
    // Straddles boundary; must be text (embed length is 1, can't straddle).
    const yText = yItem.get("text") as Y.Text;
    const within = offset - cursor;
    const after = yText.toString().slice(within);
    const attrs = yMapAsObject(yItem.get("attrs") as Y.Map<unknown>);
    if (after.length > 0) {
      yText.delete(within, after.length);
      suffix.push(buildYInlineItem({ kind: "text", text: after, attrs }));
    }
    cursor = itemEnd;
    i++;
  }
  return suffix;
}

/**
 * The Enter / paragraph-SPLIT op in Suggesting mode: perform a REAL block split AND
 * mark the new boundary as a tracked suggestion, in ONE tracked `applyOperation`
 * transaction — so the split + the boundary embed + the record land as ONE undo
 * entry and one collab event.
 *
 * A suggested split is modeled as: both paragraphs are REAL separate blocks (a
 * normal {@link splitBlockAtPosition}) PLUS a zero-width
 * {@link BLOCK_SPLIT_SUGGESTION_EMBED_TYPE} embed appended at the END of the FIRST
 * block (block N) carrying the owning `suggestionId` in its `properties`, PLUS an
 * `insertion` {@link SuggestionRecord}. The embed occupies exactly ONE `Position`
 * offset (every embed does) and serializes to "" — it is the marker the range scan
 * ({@link buildSuggestionRangeIndex}) reads to surface the suggestion's range.
 *
 * Why a REAL split (not a deferred one): the suggested-inserted break must lay out,
 * paginate, and navigate as two paragraphs immediately (Google Docs shows the split
 * the moment you press Enter in Suggesting mode), while remaining a single tracked
 * change that can be accepted or rejected later.
 *
 * Resolution (a LATER slice, NOT here): on ACCEPT the embed is removed (the split
 * stays — the break becomes permanent); on REJECT the two blocks re-merge (the
 * break is discarded). This op only CREATES the suggestion.
 *
 * `newBlockInit` overrides the NEW block's (N+1's) `type` / `attrs` — same
 * "style for the following paragraph" hook as {@link splitBlockAtPosition} (e.g.
 * Enter at the end of a heading → a `paragraph` follow-on). The embed always lands
 * on block N (the first half), regardless of `newBlockInit`.
 *
 * Composition discipline: the structural split is performed by
 * {@link splitBlockAtPositionInTx}, which writes block N's content as `[0, offset)`
 * IN PLACE (shortening N's live Y.Array — identity-preserving). This op then APPENDS
 * just the zero-width break embed to N's live `inlineContent` Y.Array. Appending —
 * rather than full-replacing N — preserves the per-character CRDT identity of N's
 * surviving text runs (the foundation the Yjs-backed state model exists to protect
 * for collab), and avoids the double-write the old full-replace incurred (it
 * discarded the split's in-place result). Block N+1 + the sibling rewiring the split
 * performed are UNTOUCHED. The embed is built as plain data PRE-transaction (pure)
 * so the tx body only mutates the live array.
 *
 * Validation (block missing / non-leaf / root / offset out of range) is delegated to
 * {@link planSplitBlockAtPosition}, which throws with its canonical messages.
 *
 * Unlike the in-place suggestion CREATE ops ({@link mintInsertion} et al.) there is
 * NO coalescing: a paragraph break is a discrete structural change — each Enter is
 * its own suggestion (mirror of the undo-coalescing model, where each structural
 * keystroke is its own entry).
 */
export function splitWithSuggestion(
  state: State,
  position: Position,
  allocator: IdAllocator,
  input: SuggestionMintInput,
  newBlockInit?: { readonly type?: string; readonly attrs?: ReadonlyAttrs },
): OperationResult {
  // Validate + plan FIRST so the canonical split errors (block missing / non-leaf /
  // root / offset out of range) win over any read below.
  const plan = planSplitBlockAtPosition(state, position, allocator, newBlockInit);

  // The zero-width break embed carrying the owning suggestion id, built as plain
  // data PRE-transaction. It is a merge BARRIER (never folded into a neighbor), so
  // it stays the LAST item of block N after the append.
  const embed: EmbedItem = Object.freeze({
    kind: "embed",
    embedType: BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
    attrs: Object.freeze({}),
    properties: Object.freeze({ suggestionId: input.id }),
  });

  return applyOperation(state, (doc) => {
    // 1. Perform the REAL structural split (block N+1 materialized, siblings rewired,
    //    block N's content set to [0, offset) IN PLACE — identity-preserving).
    splitBlockAtPositionInTx(doc, plan);
    // 2. APPEND just the break embed to block N's LIVE inlineContent Y.Array. The
    //    in-place split already left N's content normalized as [0, offset); appending
    //    the barrier embed keeps it normalized and preserves N's text-run CRDT
    //    identity (no full-replace). N+1 + the sibling rewiring stay as the split
    //    left them.
    const yN = getYBlock(doc, plan.blockId, "splitWithSuggestion", plan.kind);
    const yItems = yN.get("inlineContent") as Y.Array<Y.Map<unknown>>;
    yItems.push([buildYInlineItem(embed)]);
    // 3. Write the `insertion` record (a suggested split IS a tracked insertion of a
    //    paragraph break).
    writeSuggestionRecordInTx(doc, {
      id: input.id,
      kind: "insertion",
      author: input.author,
      createdAt: input.createdAt,
    });
  });
}

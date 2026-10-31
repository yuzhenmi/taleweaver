import type * as Y from "yjs";
import { requireBlockText } from "../block-text";
import type { Document, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import { STATE_INTERNAL } from "../state-internal";
import type { BlockId, IdAllocator } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import type { Position } from "../block-position";
import { inlineContentLength } from "../inline-content";
import { requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { inlineItemsFromYText, snapOffset } from "../y-inline";
import { assertNoIdCollision } from "../id-collision-check";
import { splitAt, writeBlockAttrs, writeBlockType } from "../flow-ops";
import { markAttrsOfRun, inclusiveKeysOf, type InclusiveKey } from "../mark-attrs";
import { splitOffsetBetweenMarkers } from "../bookmarks";
import type { InlineItem } from "../inline-content";
import { withoutOneShotAttrs } from "../one-shot-attrs";
import { writeSuggestionRecordInTx, type SuggestionMintInput } from "../suggestions";
import { INSERTION_TAG_KEY } from "../break-tags";
import { writeBreakTagInTx } from "../break-suggestions";

/**
 * Pre-computed mutation plan for `splitBlockAtPositionInTx` (plain data, read off the
 * pre-mutation snapshot):
 *   - `blockId` / `kind` — B, the block split, and its owning tree;
 *   - `newBlockId` — the HEAD's fresh id (allocated once, outside the transaction);
 *   - `headType` / `headAttrs` / `headMarkAttrs` — the head's entry: B's type + attrs
 *     (one-shot attrs per the content rule below) and its ¶'s character props;
 *   - `tail` — what is written onto B's own entry: its type / attrs after the split
 *     (`newBlockInit` at k = len, one-shot keys that moved to the head removed), or
 *     null when B's entry is unchanged;
 *   - `offset` — the split offset, validated against the content length.
 */
export interface SplitBlockPlan {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly newBlockId: BlockId;
  readonly headType: string;
  readonly headAttrs: ReadonlyAttrs;
  readonly headMarkAttrs: ReadonlyAttrs | undefined;
  readonly tail: { readonly type: string; readonly attrs: ReadonlyAttrs } | null;
  readonly offset: number;
}

/** `splitBlockAtPosition`'s result: the head's (new) id. The tail keeps B's id. */
export interface SplitBlockResult extends OperationResult {
  readonly newBlockId: BlockId;
}

/**
 * Split a leaf block B at `position` (Word / Quill): a fresh ¶ is
 * inserted at the caret. The NEW ¶ ends the HEAD [0, k), which takes the new id from
 * `allocator` and B's type + attrs; the tail [k, len) keeps ¶B — B's id, entry and
 * registry attrs. No text item moves. So Enter at offset 0 leaves the new empty
 * paragraph above, and the caret's paragraph (the tail) is always B.
 *
 * - One-shot attrs (`listCounterOverride`, host `inheritOnSplit: false`) follow the
 *   content that carried them: k > 0 (incl. k = len) → moved to the head; k = 0 on a
 *   non-empty B → they stay on B; an empty B → moved to the head (the upper paragraph).
 * - `newBlockInit` ("style for the following paragraph", Quill's header-enter / Word)
 *   applies only at k = len: it is written onto B (the empty tail); the head keeps the
 *   original type + attrs. Each field is independent; omitted fields keep B's.
 * - The head's ¶ takes the INCLUSIVE formatting at the caret (`markAttrs`, Word: the
 *   new ¶ takes the formatting at the insertion point): the inclusive keys of the run
 *   before the caret (at offset 0, after it), judged by the attr registry bound to the
 *   doc; an empty B passes its own ¶'s props. With none bound the head's ¶ gets none
 *   (no key can be judged). One-shot keys are judged by the same registry.
 *
 * Throws if the block does not exist, is a container / the root, or the offset is
 * out of range. Composition: `splitBlockAtPositionInTx` runs inside a caller's
 * transaction.
 */
export function splitBlockAtPosition(
  state: Document,
  position: Position,
  allocator: IdAllocator,
  newBlockInit?: { readonly type?: string; readonly attrs?: ReadonlyAttrs },
): SplitBlockResult {
  const plan = planSplitBlockAtPosition(state, position, allocator, newBlockInit);
  const r = applyOperation(state, (doc) => {
    splitBlockAtPositionInTx(doc, plan);
  });
  return { ...r, newBlockId: plan.newBlockId };
}

/**
 * Validate `position` against `state` and produce the {@link SplitBlockPlan}. Throws
 * on every condition `splitBlockAtPosition` lists. Allocates the head's id once.
 */
export function planSplitBlockAtPosition(
  state: Document,
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
  // Marker binding: the new ¶ goes after adjacent end markers and before
  // adjacent start markers — a bookmark / comment stays on its text.
  const k = splitOffsetBetweenMarkers(block.inlineContent.items, position.offset);
  const newBlockId = allocator.allocate();
  const doc = state[STATE_INTERNAL].doc;
  const withoutOneShot = withoutOneShotAttrs(block.attrs, doc);
  // One-shot attrs follow the content: they stay on B only at k = 0 of a non-empty B.
  const oneShotStays = k === 0 && totalLen > 0;
  const headAttrs = oneShotStays ? withoutOneShot : block.attrs;
  const init = k === totalLen ? newBlockInit : undefined;
  const tailType = init?.type ?? block.type;
  const tailAttrs = init?.attrs ?? (oneShotStays ? block.attrs : withoutOneShot);
  const tail = tailType === block.type && tailAttrs === block.attrs ? null : { type: tailType, attrs: tailAttrs };
  const isInclusive = inclusiveKeysOf(doc);
  const headMarkAttrs = totalLen === 0 ? block.markAttrs : isInclusive === undefined ? undefined : caretMarkAttrs(block.inlineContent.items, k, isInclusive);
  return { blockId: position.blockId, kind, newBlockId, headType: block.type, headAttrs, headMarkAttrs, tail, offset: k };
}

/** The inclusive formatting of the TEXT run before offset `k` (at the start: after it). */
function caretMarkAttrs(items: ReadonlyArray<InlineItem>, k: number, isInclusive: InclusiveKey): ReadonlyAttrs {
  let pos = 0;
  let before: ReadonlyAttrs | null = null;
  let after: ReadonlyAttrs | null = null;
  for (const item of items) {
    const len = item.kind === "text" ? item.text.length : 1;
    if (item.kind === "text") {
      if (pos < k) before = item.attrs;
      else if (after === null) after = item.attrs;
    }
    pos += len;
  }
  return markAttrsOfRun(before ?? after ?? {}, isInclusive);
}

/**
 * Pure Y.Doc-mutation primitive: applies a {@link SplitBlockPlan} inside an already-open
 * transaction. With `section`, the head's ¶ is that section's end item (a section break). Reads B's LIVE inline items (the cut is snapped once to a grapheme
 * boundary), so it composes after prior in-tx ops on that block.
 */
export function splitBlockAtPositionInTx(doc: Y.Doc, plan: SplitBlockPlan, opts: { readonly section?: string } = {}): void {
  requireInTransaction(doc, "splitBlockAtPosition");
  assertNoIdCollision(doc, plan.newBlockId, "splitBlockAtPosition");
  const live = inlineItemsFromYText(requireBlockText(doc, plan.blockId, "splitBlockAtPosition"));
  const at = snapOffset(live, plan.offset);
  splitAt(doc, plan.blockId, at, plan.newBlockId, { type: plan.headType, attrs: plan.headAttrs, tree: plan.kind, markAttrs: plan.headMarkAttrs }, opts);
  if (plan.tail !== null) {
    writeBlockType(doc, plan.blockId, plan.tail.type);
    writeBlockAttrs(doc, plan.blockId, plan.tail.attrs);
  }
}

/**
 * The Enter / paragraph-SPLIT op in Suggesting mode: perform a REAL block split AND
 * tag the new boundary as a tracked suggestion, in ONE tracked `applyOperation`
 * transaction (one undo entry, one collab event).
 *
 * A suggested split is a revision ON the new ¶ (Word's model): both paragraphs are
 * REAL blocks, and the new ¶ — the HEAD's, see {@link splitBlockAtPosition} — carries
 * the suggestion as `insertionSuggestionId` on its registry entry (see `break-tags.ts`)
 * plus an `insertion` {@link SuggestionRecord}. No inline item is written.
 *
 * Resolution: accept drops the key (the break stays); reject removes the new mark
 * (see `acceptSuggestion` / `rejectSuggestion`). No coalescing: each Enter is its own
 * suggestion.
 *
 * `newBlockInit` is applied as in {@link splitBlockAtPosition}. Validation is
 * delegated to {@link planSplitBlockAtPosition}.
 */
export function splitWithSuggestion(
  state: Document,
  position: Position,
  allocator: IdAllocator,
  input: SuggestionMintInput,
  newBlockInit?: { readonly type?: string; readonly attrs?: ReadonlyAttrs },
): SplitBlockResult {
  const plan = planSplitBlockAtPosition(state, position, allocator, newBlockInit);
  const r = applyOperation(state, (doc) => {
    splitBlockAtPositionInTx(doc, plan);
    writeSplitSuggestionInTx(doc, plan.newBlockId, input);
  });
  return { ...r, newBlockId: plan.newBlockId };
}

/**
 * Key a just-created mark (new block `newBlockId`) as a suggested split + write its
 * `insertion` record. MUST run inside a transaction.
 */
export function writeSplitSuggestionInTx(
  doc: Y.Doc,
  newBlockId: BlockId,
  input: SuggestionMintInput,
): void {
  writeBreakTagInTx(doc, newBlockId, INSERTION_TAG_KEY, input.id);
  writeSuggestionRecordInTx(doc, {
    id: input.id,
    kind: "insertion",
    author: input.author,
    createdAt: input.createdAt,
    order: input.order,
  });
}

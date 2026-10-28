import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import type { Position } from "../block-position";
import { requireInTransaction } from "../yjs-doc";
import { ancestorChain } from "../block-traversal";
import { insertItemsAt, writeSectionEntry } from "../flow-ops";
import { deriveBlock, readCtx } from "../flow-read";
import type { ReadonlyAttrs } from "../attrs";
import { planSplitBlockAtPosition, splitBlockAtPositionInTx, type SplitBlockPlan } from "./split-block";
import { INSERTION_TAG_KEY } from "../break-tags";
import { writeBreakTagInTx } from "../break-suggestions";
import { writeSuggestionRecordInTx, type SuggestionMintInput } from "../suggestions";

/**
 * Result of `applySectionBreak`: the caret's block after the break (the tail P of the
 * split, or the block the caret was in when the break went before a table).
 */
export interface SectionBreakResult extends OperationResult {
  readonly newCursorBlockId: BlockId;
}

/**
 * Pre-computed plan for `applySectionBreakInTx` (validation, snapshot reads and id
 * allocation done before any transaction). `sectionId` / `sectionAttrs`: the new
 * section S′, a copy of the containing section's attrs.
 *   - `split`: the caret is in a root-flow paragraph — a split whose head's ¶ ends S′;
 *   - `before`: the caret is inside a top-level object (a table cell) — S′ is ended by
 *     a fresh empty paragraph placed before that `boundary` block.
 */
export type SectionBreakPlan =
  | { readonly kind: "split"; readonly split: SplitBlockPlan; readonly sectionId: BlockId; readonly sectionAttrs: ReadonlyAttrs }
  | { readonly kind: "before"; readonly boundary: BlockId; readonly sectionId: BlockId; readonly sectionAttrs: ReadonlyAttrs };

/**
 * Insert a section break at `cursor` (Word), in ONE transaction: a
 * SPLIT of the caret's paragraph P whose new terminator is a section-end item — the
 * head H [0, k) (new id, P's type + attrs) ends the new section S′, which copies the
 * containing section's attrs (the explicit section holding P, or the final section);
 * the tail keeps P and stays in the containing section. A section therefore always
 * holds ≥ 1 paragraph; a break at a paragraph start leaves an empty paragraph carrying
 * it (Word). A caret inside a top-level object (a table cell) breaks before that block.
 */
export function applySectionBreak(
  state: State,
  cursor: Position,
  allocator: IdAllocator,
): SectionBreakResult {
  const plan = buildSectionBreakPlan(state, cursor, allocator);
  const result = applyOperation(state, (doc) => {
    applySectionBreakInTx(doc, plan);
  });
  return { state: result.state, dirtyIds: result.dirtyIds, newCursorBlockId: cursor.blockId };
}

/**
 * SECTION_BREAK in Suggesting mode (tracked): the same split as
 * {@link applySectionBreak}, plus — in the same transaction — `insertionSuggestionId`
 * on the new section-end ¶'s entry (the paragraph that ends S′) and an `insertion`
 * record. One undo entry. Reject deletes that ¶ (the paragraphs and the sections
 * merge, `deleteParagraphMarkInTx`); accept drops the key.
 */
export function applySectionBreakAsSuggestion(
  state: State,
  cursor: Position,
  allocator: IdAllocator,
  input: SuggestionMintInput,
): SectionBreakResult {
  const plan = buildSectionBreakPlan(state, cursor, allocator);
  const result = applyOperation(state, (doc) => {
    applySectionBreakInTx(doc, plan);
    // The section-end ¶'s paragraph: the split's head, or the fresh paragraph S′ holds.
    const owner = plan.kind === "split" ? plan.split.newBlockId : (deriveBlock(readCtx(doc), plan.sectionId)?.block.lastChildId ?? null);
    if (owner !== null) writeBreakTagInTx(doc, owner, INSERTION_TAG_KEY, input.id);
    writeSuggestionRecordInTx(doc, { id: input.id, kind: "insertion", author: input.author, createdAt: input.createdAt, order: input.order });
  });
  return { state: result.state, dirtyIds: result.dirtyIds, newCursorBlockId: cursor.blockId };
}

/**
 * Validate `cursor` and build the {@link SectionBreakPlan} (reads + id allocation —
 * the head first, then the section — before any transaction). Throws if the cursor
 * block is not under the document root.
 */
export function buildSectionBreakPlan(
  state: State,
  cursor: Position,
  allocator: IdAllocator,
): SectionBreakPlan {
  const chain = ancestorChain(state, cursor.blockId);
  if (!chain.includes(state.rootId)) {
    throw new Error(`applySectionBreak: cursor block "${cursor.blockId}" not under document root`);
  }
  // The top-level block holding the caret: the chain entry whose parent is a section.
  const isSection = (bid: BlockId | null): boolean => {
    const b = bid === null ? null : getBlock(state, bid);
    return b !== null && b.type === "section" && b.parentId === state.rootId;
  };
  const boundary = chain.find((bid) => isSection(getBlock(state, bid)?.parentId ?? null)) ?? null;
  const sectionOf = boundary === null ? null : (getBlock(state, boundary)?.parentId ?? null);
  if (boundary === null || sectionOf === null) {
    throw new Error(`applySectionBreak: could not resolve the top-level block holding "${cursor.blockId}"`);
  }
  const sectionAttrs = getBlock(state, sectionOf)?.attrs ?? {};
  if (boundary === cursor.blockId && getBlock(state, boundary)?.inlineContent != null) {
    const split = planSplitBlockAtPosition(state, cursor, allocator);
    return { kind: "split", split, sectionId: allocator.allocate(), sectionAttrs };
  }
  return { kind: "before", boundary, sectionId: allocator.allocate(), sectionAttrs };
}

/**
 * Pure Y.Doc-mutation primitive: applies a {@link SectionBreakPlan} inside an
 * already-open transaction.
 */
export function applySectionBreakInTx(doc: Y.Doc, plan: SectionBreakPlan): void {
  requireInTransaction(doc, "applySectionBreak");
  const section = { id: plan.sectionId, type: "section", attrs: plan.sectionAttrs, inlineContent: null, children: [] };
  if (plan.kind === "before") {
    // A fresh empty paragraph whose ¶ ends S′, right before the boundary block.
    insertItemsAt(doc, { before: plan.boundary }, [section], "block");
    return;
  }
  writeSectionEntry(doc, section);
  splitBlockAtPositionInTx(doc, plan.split, { section: plan.sectionId });
}

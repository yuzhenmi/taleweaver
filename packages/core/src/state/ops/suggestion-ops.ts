import type * as Y from "yjs";
import { requireBlockText, blockText } from "../block-text";
import { HARD_BREAK_EMBED_TYPE } from "../hard-break";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import type { Block } from "../block";
import type { Position, Span } from "../block-position";
import { createSpan, createPosition } from "../block-position";
import { spanStart, spanEnd } from "../block-compare";
import type { ReadonlyAttrs } from "../attrs";
import { attrsEqual } from "../attrs";
import {
  inlineContentLength,
  mergeAdjacentTextItems,
  splitInlineContentAtOffset,
  type InlineItem,
  type EmbedItem,
  type TextItem,
} from "../inline-content";
import {
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
  INSERTION_SUGGESTION_ATTR,
  compareSuggestionOrder,
  formattingSuggestionIds,
  formattingSuggestionKey,
  observeSuggestionOrder,
  isValidSuggestionOrder,
  resolveFormattingSuggestionTags,
  suggestionGroupOf,
  suggestionIdsOnItem,
  buildSuggestionRangeIndex,
  readSuggestionRecord,
  writeSuggestionRecordInTx,
  type SuggestionId,
  type SuggestionKind,
  type SuggestionMintInput,
  type SuggestionRecord,
} from "../suggestions";
import { iterateAllBlocksInDocumentOrder } from "../document-order";
import { clipSpanToText, type BlockRange } from "../span-iteration";
import { splitAt, deleteUnits, type ContentSpan } from "../flow-ops";
import { hasContent, bookmarksRemovedBy, unitsDeletedBy, widenOverBookmarkMarkers, type DeletedPart } from "../bookmarks";
import type { SiblingBlockInit } from "./insert-blocks-after";
import { STATE_INTERNAL } from "../state-internal";
import { getSuggestionsMap, requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import {
  attrsDiff,
  inlineItemsFromYText,
  insertInlineItems,
  snapOffset,
  snapRange,
  toYFormatDelta,
} from "../y-inline";
import { planApplyAttrsToRange, applyAttrsToRangeInTx } from "./apply-attrs";
import { planInsertText, insertTextInTx } from "./insert-text";
import {
  planInsertItemsAt,
  insertItemsInTx,
  type InsertItemsPlan,
} from "./insert-items";
import {
  planSplitBlockAtPosition,
  splitBlockAtPositionInTx,
  splitWithSuggestion,
} from "./split-block";
import { INSERTION_TAG_KEY, DELETION_TAG_KEY, type BreakTagKey } from "../break-tags";
import { blockAfter } from "../paragraph-neighbour";
import {
  writeBreakTagInTx,
  deleteTagKeys,
  tagEntriesOf,
  paragraphMarksInSpan,
  markDeletionOf,
  deleteParagraphMarkInTx,
} from "../break-suggestions";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import { attrRegistryOf } from "../mark-attrs";
import type { ResolvedBlockKind } from "../state";
import { isDevMode } from "../dev-mode";

/** An empty dirtyIds set — the identity-no-op return per the identity-no-op contract. */
const NO_DIRTY: ReadonlySet<BlockId> = new Set<BlockId>();

/**
 * Mark `span` with a formatting SUGGESTION: stamp this suggestion's own tag
 * (`formattingSuggestionKey(id)`) over the span AND write a `formatting` {@link SuggestionRecord} carrying
 * `proposedAttrs` (the format delta the action WOULD have applied, e.g.
 * `{ bold: true }`), in ONE tracked `applyOperation` transaction — so the attr +
 * record land as ONE undo entry and one collab event.
 *
 * The run's LIVE format attrs (bold/italic/color/…) are UNCHANGED: only the
 * provenance tag is added. Another formatting suggestion already on the text keeps
 * ITS tag — suggestions stack per run, each independently resolvable (preview and
 * resolution order: `resolveFormattingSuggestionTags`). The
 * proposal is applied only on ACCEPT.
 *
 * Composes the `apply-attrs` PLAN + its `*InTx` applier (NOT the public
 * `applyAttrsToRange`, which opens its own transaction) so the attr-set and the
 * record-write share one transaction. The attr write lands on a block-tree map
 * (dirty-captured), so — unlike the side-table-only comment flips — no
 * `state.rootId` surfacing is needed.
 *
 * Coalescing: if a text run IMMEDIATELY adjacent to the (normalized) span —
 * same-block only, mirroring comments — already carries a `formatting`
 * suggestion by the SAME author with an EQUAL `proposedAttrs`, this mark REUSES
 * that suggestion's id (widening its range) instead of minting a new record —
 * unless the span holds a formatting suggestion that orders AFTER it, or a span
 * character carries that id SHADOWED (in both cases reusing the id would leave the
 * new action beneath another value); a fresh, newest id is minted instead. The
 * BEFORE neighbor is preferred when both sides coalesce. No new record is written
 * in the coalescing case (the existing record already describes the proposal).
 *
 * No-op (identity — returns the SAME input `state` reference + empty dirtyIds, so
 * the editor short-circuits per the identity-no-op contract): empty `proposedAttrs`; a
 * collapsed span; or nothing to mark (the apply-attrs plan is empty). Mirrors the
 * two guards atop `applyAttrsToRange`.
 */
export function markFormatting(
  state: State,
  span: Span,
  proposedAttrs: ReadonlyAttrs,
  input: SuggestionMintInput,
): OperationResult {
  // Empty proposal = no-op (nothing to suggest). Mirrors applyAttrsToRange's
  // empty-attrs guard; must return the input State reference (identity).
  if (Object.keys(proposedAttrs).length === 0) {
    return { state, dirtyIds: NO_DIRTY };
  }

  // Collapsed span = no-op. Collapsed-ness (same block + same offset) is
  // normalization-invariant, so we check raw positions directly (mirror
  // applyAttrsToRange).
  if (
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset
  ) {
    return { state, dirtyIds: NO_DIRTY };
  }

  const plan = planApplyAttrsToRange(state, span);
  if (plan === null) {
    return { state, dirtyIds: NO_DIRTY };
  }

  // Coalesce decision is PURE and computed BEFORE opening the transaction.
  const stateDoc = state[STATE_INTERNAL].doc;
  const inSpan = formattingRecordsInSegments(plan.segments, stateDoc);
  // Never reuse an id that is shadowed on a span character (an accepted newer value
  // overrides it there, so reusing it would not show the new action), nor one that a
  // newer formatting suggestion in the span ranks above.
  const { id, reusing } = resolveCoalesce(
    state,
    span,
    input.id,
    FORMATTING_SUGGESTION_ATTR,
    (record) =>
      record.kind === "formatting" &&
      record.author === input.author &&
      attrsEqual(record.proposedAttrs ?? {}, proposedAttrs) &&
      !inSpan.shadowed.has(record.id) &&
      !inSpan.records.some((other) => other.id !== record.id && compareSuggestionOrder(other, record) > 0),
    input.noCoalesce,
  );

  // Lamport bump: a fresh mint ranks above every formatting suggestion it stacks on,
  // whatever this editor's counter says (reload, peer); the counter then moves past it.
  const stackedMax = Math.max(0, ...inSpan.records.map((r) => r.order ?? 0));
  // Clamped so it stays a valid (safe-integer) order even over a maximal stacked one.
  // An invalid input order (NaN, negative, unsafe) counts as absent.
  const inputOrder = input.order !== undefined && isValidSuggestionOrder(input.order) ? input.order : undefined;
  const order =
    inSpan.records.length === 0
      ? inputOrder
      : Math.min(Number.MAX_SAFE_INTEGER, Math.max(inputOrder ?? 0, stackedMax + 1));
  if (!reusing && order !== undefined) observeSuggestionOrder(order);

  const key = formattingSuggestionKey(id);
  return applyOperation(state, (doc) => {
    applyAttrsToRangeInTx(doc, plan, { [key]: true });
    if (!reusing) {
      writeSuggestionRecordInTx(doc, {
        id,
        kind: "formatting",
        author: input.author,
        createdAt: input.createdAt,
        order,
        proposedAttrs,
      });
    }
  });
}

/**
 * The formatting records tagged on any item inside the plan's segments, and the ids
 * whose tag carries a non-empty shadowed set on some of those items.
 */
function formattingRecordsInSegments(
  segments: ReadonlyArray<BlockRange>,
  doc: Y.Doc,
): { records: SuggestionRecord[]; shadowed: Set<SuggestionId> } {
  const ids = new Set<SuggestionId>();
  const shadowed = new Set<SuggestionId>();
  for (const seg of segments) {
    let pos = 0;
    for (const item of seg.block.inlineContent?.items ?? []) {
      const end = pos + (item.kind === "text" ? item.text.length : 1);
      if (end > seg.rangeStart && pos < seg.rangeEnd) {
        for (const id of formattingSuggestionIds(item.attrs)) {
          ids.add(id);
          if (item.attrs[formattingSuggestionKey(id)] !== true) shadowed.add(id);
        }
      }
      pos = end;
    }
  }
  const records: SuggestionRecord[] = [];
  for (const id of ids) {
    const record = readSuggestionRecord(doc, id);
    if (record !== null) records.push(record);
  }
  return { records, shadowed };
}


/**
 * Mark `span` as a SUGGESTED DELETION (Suggesting-mode soft-delete). For each
 * TEXT run (or sub-portion) inside the normalized span:
 *   - plain text (no insertion suggestion) → stamp `deletionSuggestionId = id`
 *     (merged into the run's existing attrs); the text STAYS VISIBLE until the
 *     suggestion is resolved.
 *   - a run carrying an `insertionSuggestionId` by a DIFFERENT author → also gains
 *     `deletionSuggestionId` (NESTING: it keeps its insertion id AND gains the
 *     deletion id — both shown). This is the SAME "add the deletion attr" path; it
 *     is not special-cased.
 *   - a run carrying an `insertionSuggestionId` by THIS author (the deleter's OWN
 *     pending insertion) → REMOVED FOR REAL (omitted from the rebuilt block); no
 *     deletion attr, no deletion record. (It never became real text, so
 *     un-suggesting it = removing it.)
 *
 * An OBJECT endpoint (`isObjectBlock`) is covered whole, as an object between
 * the endpoints: a table's cell text is struck, an atomic leaf has none; the object
 * itself stays in place (structural change tracking is not built).
 *
 * Embeds inside the span are not tracked here: they are preserved in
 * place, UNTAGGED. (Embed / inline-object soft-deletion is not tracked —
 * the range model scans insertion / deletion attrs only on text items, so a
 * generic embed attr would be invisible anyway.)
 *
 * Unlike {@link markFormatting} this does NOT compose `applyAttrsToRangeInTx`:
 * that applier would tag embeds too AND cannot selectively DROP the own-insertion
 * runs. Instead it plans the per-owning-block strike ranges PRE-transaction (pure
 * {@link planMarkDeletion}), then applies them IN the transaction via the surgical
 * {@link applyDeletionStrikeInTx}: whole-covered runs get the deletion attr
 * set in place — preserving their `Y.Text` CRDT identity — only a straddling run
 * splits, and own-insertion runs are deleted by index. (This replaced the original
 * per-block FULL-REPLACE rewrite, which tombstoned every run's `Y.Text`.) Block
 * writes are tree-map writes (dirty-captured), so — unlike the side-table-only
 * comment flips — no `state.rootId` surfacing is needed. The op + the optional
 * record write share ONE `applyOperation` transaction (one undo unit, one collab
 * event).
 *
 * Coalescing: a deletion coalesces into an IMMEDIATELY-adjacent (same-block) run
 * carrying a `deletionSuggestionId` whose record is a `deletion` by the SAME
 * author (no `proposedAttrs` check — deletions carry none). The BEFORE neighbor
 * is preferred; on coalesce the id is reused (no new record written).
 *
 * No-op (identity — returns the SAME input `state` reference + empty dirtyIds, so
 * the editor short-circuits per the identity-no-op contract): a collapsed span, or
 * `planApplyAttrsToRange` returns `null` (nothing inside the span). NOTE: a span
 * that is ALL own-insertions (everything removed, nothing tagged) is NOT a no-op
 * — it is a real content removal (dirtyIds captured, undoable); it just writes no
 * deletion record.
 */
export function markDeletion(
  state: State,
  span: Span,
  input: SuggestionMintInput,
): OperationResult {
  const plan = planMarkDeletion(state, span, input);
  // Collapsed span / nothing to mark / nothing would change (every run and step in
  // the span already carries a live deletion) → identity no-op (the input State
  // reference): a caret-only outcome, no history entry.
  if (plan === null || !plan.changesAny) {
    return { state, dirtyIds: NO_DIRTY };
  }

  return applyOperation(state, (d) => {
    // Surgical, identity-preserving strike per block: mutate only the
    // changed runs in place (untouched runs keep their Y.Text CRDT identity),
    // replacing the old full-replace seam.
    let anyTagged = applyDeletionStrikeInTx(d, plan.writes, plan.id, input.author, "markDeletion", plan.removedBookmarks).tagged;
    // The ¶s inside the span (after the strikes: an own-insertion removal merges a
    // paragraph into the next one).
    anyTagged = applyMarkStepsInTx(d, plan.steps, plan.id) || anyTagged;
    // Dev cross-check: the applier's runtime `tagged` must agree with the plan's
    // pre-tx `taggedAny` (both derive from the same classification over the same
    // items, so they can never legitimately disagree).
    if (isDevMode() && anyTagged !== plan.taggedAny) {
      throw new Error(
        `markDeletion strike drift: applied=${anyTagged} plan=${plan.taggedAny}`,
      );
    }
    // Write the deletion record only when ≥1 run was actually tagged AND we are
    // not reusing an existing (coalesced) record. A whole-span-was-own-insertions
    // delete tags nothing → no record (the removal is itself the change).
    if (plan.taggedAny && !plan.reusing) {
      writeSuggestionRecordInTx(d, {
        id: plan.id,
        kind: "deletion",
        author: input.author,
        createdAt: input.createdAt,
        order: input.order,
      });
    }
  });
}

/** One ¶ a suggested deletion acts on: keyed with the deletion id, or — the author's own pending insertion — removed for real. */
interface MarkDeletionStep {
  readonly id: BlockId;
  readonly remove: boolean;
}

/**
 * The ¶s a suggested deletion over `span` acts on (`paragraphMarksInSpan`: every ¶
 * inside the span that accepting would delete), minus those already deletion-keyed.
 */
function planMarkSteps(state: State, span: Span, author: string): MarkDeletionStep[] {
  const out: MarkDeletionStep[] = [];
  for (const b of paragraphMarksInSpan(state, span)) {
    const rule = markDeletionOf(state, b, author);
    if (rule !== "keep") out.push({ id: b.id, remove: rule === "remove" });
  }
  return out;
}

/**
 * Apply the ¶ steps with deletion id `id`: keys first, then the own-insertion removals
 * in REVERSE document order (a removal merges the paragraph into the one after it —
 * survivor R — so earlier ids stay valid). Run AFTER every offset write of the op.
 * Returns whether any key was written (the caller writes the record). MUST run inside
 * a transaction.
 */
function applyMarkStepsInTx(doc: Y.Doc, marks: readonly MarkDeletionStep[], id: SuggestionId): boolean {
  let wrote = false;
  for (const m of marks) {
    if (m.remove) continue;
    writeBreakTagInTx(doc, m.id, DELETION_TAG_KEY, id);
    wrote = true;
  }
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    if (m !== undefined && m.remove) deleteParagraphMarkInTx(doc, m.id);
  }
  return wrote;
}

/**
 * The pure pre-transaction plan for a suggested deletion: the per-owning-block
 * strike `writes` (each carrying the strike `rangeStart`/`rangeEnd` plus the
 * post-strike `items`), whether ≥1 run was actually TAGGED (`taggedAny` — drives
 * the record write), the resolved/coalesced deletion `id` + whether it `reusing`s
 * an existing record, and the span's owning tree `kind`.
 *
 * Extracted from {@link markDeletion} so the composite {@link replaceWithSuggestion}
 * can reuse the strike plan. The strike itself is an in-place offset write
 * ({@link applyDeletionStrikeInTx}, driven by `rangeStart`/`rangeEnd`): no character
 * outside the span is re-minted.
 *
 * Returns `null` for the no-op cases (collapsed span, or `planApplyAttrsToRange`
 * yields nothing) so the caller short-circuits with the identity contract.
 */
function planMarkDeletion(
  state: State,
  span: Span,
  input: SuggestionMintInput,
): MarkDeletionPlan | null {
  // Collapsed span = no-op. Collapsed-ness (same block + same offset) is
  // normalization-invariant, so we check raw positions directly.
  if (
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset
  ) {
    return null;
  }

  const plan = planApplyAttrsToRange(state, span);
  if (plan === null) {
    return null;
  }

  // Coalesce decision is PURE and computed BEFORE opening the transaction. A
  // deletion coalesces with a same-author `deletion` neighbor (no proposedAttrs
  // check — deletions carry none).
  const { id, reusing } = resolveCoalesce(
    state,
    span,
    input.id,
    DELETION_SUGGESTION_ATTR,
    (record) => record.kind === "deletion" && record.author === input.author,
    input.noCoalesce,
  );

  // Compute the per-owning-block rewrites + whether any run was TAGGED (vs all
  // own-insertions removed) PRE-transaction (pure) — mirror of `deleteComment`,
  // which plans writes pre-tx then applies them in the tx.
  const doc = state[STATE_INTERNAL].doc;
  const writes: MarkDeletionPlan["writes"] = [];
  let taggedAny = false;
  let changesAny = false;
  const steps = planMarkSteps(state, span, input.author);
  if (steps.length > 0) changesAny = true;
  if (steps.some((m) => !m.remove)) taggedAny = true;
  // The physical removals (the deleter's own pending insertions) are a deletion: the
  // bookmark rule judges them together (kept content between them breaks the run).
  const segs = plan.segments.flatMap((seg) => {
    const items = seg.block.inlineContent?.items;
    // Zero-width range in this block, or not a leaf (defensive — iterateSpan only yields leaves).
    if (items === undefined || seg.rangeStart >= seg.rangeEnd) return [];
    return [{ seg, items, own: ownInsertionRuns(items, seg.rangeStart, seg.rangeEnd, input.author, doc) }];
  });
  const parts: DeletedPart[] = [];
  let gap = false;
  for (const { seg, items, own } of segs) {
    for (const o of own) {
      parts.push({ items, from: o.from, to: o.to, id: seg.block.id, afterGap: gap });
      gap = false;
    }
    if (own.length === 0 && hasContent(items, seg.rangeStart, seg.rangeEnd)) gap = true;
  }
  const removedBookmarks = bookmarksRemovedBy(parts);
  for (const { seg, items, own } of segs) {
    const deletedUnits = own.flatMap((o) => unitsDeletedBy(items, o.from, o.to, removedBookmarks));
    const result = rebuildBlockForDeletion(items, seg.rangeStart, seg.rangeEnd, id, input.author, doc, new Set(deletedUnits));
    if (result.tagged) taggedAny = true;
    if (result.changed) changesAny = true;
    writes.push({
      blockId: seg.block.id,
      rangeStart: seg.rangeStart,
      rangeEnd: seg.rangeEnd,
      items: mergeAdjacentTextItems(result.items),
      deletedUnits,
    });
  }
  // The seam: where a suggested replacement goes — the start of the span's text
  // (`clipSpanToText`: after an object start), or where a removed bookmark's start
  // marker just before it was (as `bookmarkDeletionSpan`).
  const textStart = clipSpanToText(state, span).anchor;
  const startItems = resolveBlock(state, textStart.blockId)?.block.inlineContent?.items ?? [];
  const seam = widenOverBookmarkMarkers(startItems, textStart.offset, "backward", removedBookmarks);

  return { writes, steps, taggedAny, changesAny, id, reusing, kind: plan.kind, removedBookmarks, seam };
}

/** The deleter's own pending insertions in [rangeStart, rangeEnd) of `items`: the units a suggested deletion removes for real. */
function ownInsertionRuns(
  items: ReadonlyArray<InlineItem>,
  rangeStart: number,
  rangeEnd: number,
  author: string,
  doc: Y.Doc,
): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let pos = 0;
  for (const item of items) {
    if (pos >= rangeEnd) break;
    const len = item.kind === "text" ? item.text.length : 1;
    const lo = Math.max(pos, rangeStart);
    const hi = Math.min(pos + len, rangeEnd);
    if (lo < hi && isOwnInsertion(item, author, doc)) {
      const last = out[out.length - 1];
      if (last !== undefined && last.to === lo) last.to = hi;
      else out.push({ from: lo, to: hi });
    }
    pos += len;
  }
  return out;
}

/** `pos` (a pre-strike offset of a struck block) after the strike: minus the units it deletes before `pos`. */
function postStrikeOffset(write: { readonly deletedUnits: readonly number[] } | undefined, pos: number): number {
  return pos - (write?.deletedUnits.filter((u) => u < pos).length ?? 0);
}

/** The pure pre-transaction plan produced by {@link planMarkDeletion}. */
interface MarkDeletionPlan {
  /**
   * The per-owning-block strike writes. `rangeStart`/`rangeEnd` (from the
   * `iterateSpan` segment) drive the in-place {@link applyDeletionStrikeInTx};
   * `items` (the post-strike content, as the strike leaves it) is read by the
   * fragment-replace planner, which slices the start block's post-strike content
   * and records each block's expected post-write content.
   */
  readonly writes: {
    readonly blockId: BlockId;
    readonly rangeStart: number;
    readonly rangeEnd: number;
    readonly items: ReadonlyArray<InlineItem>;
    /** The block's pre-strike units the strike deletes (own insertions + the removed bookmarks' markers). */
    readonly deletedUnits: readonly number[];
  }[];
  /** The bookmarks the strike's physical removals remove (the deletion rule over all of them). */
  readonly removedBookmarks: ReadonlySet<string>;
  /**
   * The post-strike offset where a suggested replacement goes, in the block of the
   * span's text start (`clipSpanToText(span).anchor` — the span start unless it is an
   * object).
   */
  readonly seam: number;
  /** The ¶s inside the span this deletion keys or (own insertions) removes. */
  readonly steps: readonly MarkDeletionStep[];
  /** True iff ≥1 in-range run received the deletion attr or ≥1 ¶ key is written (drives the record write). */
  readonly taggedAny: boolean;
  /** True iff the op changes anything (a strike, an own-insertion removal, a ¶ key / removal). */
  readonly changesAny: boolean;
  /** The resolved (possibly coalesced) deletion id to stamp / record. */
  readonly id: SuggestionId;
  /** True iff the id coalesced into an existing record → write NO new record. */
  readonly reusing: boolean;
  /** The span's single owning tree (main / embedContents / templateContents). */
  readonly kind: ResolvedBlockKind;
}

/**
 * The INSERT_TEXT / PASTE op in Suggesting mode: instead of inserting plain text,
 * insert `text` carrying an `insertionSuggestionId` attr AND write an `insertion`
 * {@link SuggestionRecord}, in ONE tracked `applyOperation` transaction — so the
 * inserted text + record land as ONE undo entry and one collab event.
 *
 * `attrs` is the INTENDED FORMATTING of the inserted text (bold/italic/color/…,
 * the surrounding-context attrs the editor would have used for a plain insert).
 * The op stamps the insertion-provenance id on TOP of it: `insertAttrs = { ...attrs,
 * [INSERTION_SUGGESTION_ATTR]: id }`. This OVERWRITES only `insertionSuggestionId`
 * (any stale value the caller passed is replaced by the resolved/coalesced id) and
 * leaves every live format attr untouched.
 *
 * Unlike {@link markFormatting} / {@link markDeletion} (which MARK an existing
 * span) this op INSERTS: it composes `insert-text`'s PLAN + its `*InTx` applier
 * (NOT the public `insertText`, which opens its own transaction) so the insert and
 * the record-write share one transaction. The insert lands on a block-tree map
 * (dirty-captured), so — unlike the side-table-only comment flips — no
 * `state.rootId` surfacing is needed.
 *
 * Coalescing: if the run IMMEDIATELY adjacent to the insertion point already
 * carries an `insertionSuggestionId` whose record is an `insertion` by the SAME
 * author, this insertion REUSES that id (so a continuous typing run is ONE
 * suggestion) and writes NO new record. The BEFORE neighbor (the run holding
 * `position.offset - 1`) is preferred over the AFTER neighbor (the run starting at
 * `position.offset`). When coalescing AND the caller's `attrs` equal the
 * neighbor's live format, `planInsertText`'s in-place path merges the new text
 * into the neighbor's Y.Text (ONE physical run); when they differ a new run is
 * created but carries the SAME id — both correct (coalescing is about the id /
 * record, not physical run-merge).
 *
 * No-op (identity — returns the SAME input `state` reference + empty dirtyIds, so
 * the editor short-circuits per the identity-no-op contract): empty `text`. Mirrors
 * `insertText`'s empty-text guard.
 *
 * Position validation (block missing / non-leaf / offset out of range) is left to
 * `planInsertText`, which throws exactly as `insertText` does — the editor action
 * validates the caret first, so no redundant guard here.
 */
export function mintInsertion(
  state: State,
  position: Position,
  text: string,
  attrs: ReadonlyAttrs,
  input: SuggestionMintInput,
): OperationResult {
  // Empty text = no-op. Mirrors insertText's empty-text guard; must return the
  // input State reference (identity).
  if (text === "") {
    return { state, dirtyIds: NO_DIRTY };
  }

  // Coalesce decision is PURE and computed BEFORE opening the transaction. The
  // collapsed span at `position` makes `resolveCoalesce` inspect the run BEFORE
  // (`position.offset - 1`) and the run starting AT (`position.offset`) the
  // insertion point — exactly the insertion-point neighbors.
  const { id, reusing } = resolveCoalesce(
    state,
    createSpan(position, position),
    input.id,
    INSERTION_SUGGESTION_ATTR,
    (record) => record.kind === "insertion" && record.author === input.author,
    input.noCoalesce,
  );

  // Stamp the resolved (possibly coalesced) id over the intended format. This
  // OVERWRITES any `insertionSuggestionId` already in `attrs` — load-bearing: the
  // inserted text must carry the coalesced id, not a stale one.
  const insertAttrs = { ...attrs, [INSERTION_SUGGESTION_ATTR]: id };
  // Typing at (P, len) keeps ¶P's `markAttrs`; the inclusive filter keeps the
  // provenance id (and links) out of them.
  const plan = planInsertText(state, position, text, insertAttrs);

  return applyOperation(state, (doc) => {
    insertTextInTx(doc, plan);
    if (!reusing) {
      writeSuggestionRecordInTx(doc, {
        id,
        kind: "insertion",
        author: input.author,
        createdAt: input.createdAt,
        order: input.order,
      });
    }
  });
}

/**
 * Suggesting-mode soft line break (Shift+Enter): insert one inline
 * `hard-break` embed at `position` carrying `insertionSuggestionId` — an inline
 * insertion revision like a typed character (Word `\v` / GDocs `\u000b`; no ¶, no
 * paragraph attrs) — plus its `insertion` record, in ONE tracked transaction. The id
 * coalesces into the author's adjacent pending insertion as {@link mintInsertion}'s
 * does. Reject drops the break; accept strips the id. Throws as `insertLineBreak` on a
 * bad position.
 */
export function mintLineBreak(state: State, position: Position, input: SuggestionMintInput): OperationResult {
  const block = resolveBlock(state, position.blockId)?.block ?? null;
  if (block === null || block.inlineContent === null) {
    throw new Error(`mintLineBreak: block "${position.blockId}" is not a text block`);
  }
  const len = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > len) {
    throw new Error(`mintLineBreak: offset ${position.offset} out of range [0, ${len}] for block "${position.blockId}"`);
  }
  const { id, reusing } = resolveCoalesce(
    state,
    createSpan(position, position),
    input.id,
    INSERTION_SUGGESTION_ATTR,
    (record) => record.kind === "insertion" && record.author === input.author,
    input.noCoalesce,
  );
  const embed: EmbedItem = { kind: "embed", embedType: HARD_BREAK_EMBED_TYPE, attrs: { [INSERTION_SUGGESTION_ATTR]: id }, properties: {} };
  return applyOperation(state, (doc) => {
    insertInlineItems(requireBlockText(doc, position.blockId, "mintLineBreak"), position.offset, [embed]);
    if (!reusing) {
      writeSuggestionRecordInTx(doc, { id, kind: "insertion", author: input.author, createdAt: input.createdAt, order: input.order });
    }
  });
}

/**
 * Fields the host supplies when typing OVER a selection in Suggesting mode (the
 * suggestion analog of `replaceRange`). Two ids — `deletionId` (for the struck
 * selection) and `insertionId` (for the new text) — are minted host-side; each is
 * REUSED (not consumed) when its half coalesces into an adjacent same-author
 * suggestion. `author`/`createdAt` are deterministic host-injected values; the
 * SAME `createdAt` flows onto BOTH records as the render layer's "this was ONE
 * replace" grouping signal.
 */
export interface ReplaceSuggestionInput {
  readonly deletionId: SuggestionId;
  readonly insertionId: SuggestionId;
  readonly author: string;
  /** SHARED by both the insertion + deletion records — the render-layer "replace" grouping signal. */
  readonly createdAt: number;
  /** Mint sequence number, shared by both records (see `SuggestionRecord.order`). */
  readonly order?: number;
  /** Mint fresh records — never extend an adjacent suggestion (host proposals). */
  readonly noCoalesce?: boolean;
}

/**
 * TYPE OVER A SELECTION in Suggesting mode: soft-delete the selection AND insert
 * `text` at the selection start, in ONE tracked `applyOperation` transaction — the
 * suggestion analog of `replaceRange` (which composes deleteRange + insertText
 * atomically). The strike + the insert + BOTH records (an `insertion` and a
 * `deletion`) land as ONE undo entry and one collab event.
 *
 * Composes {@link planMarkDeletion} (the strike plan) with an offset insert
 * ({@link planInsertText} + {@link insertTextInTx}). Every struck block is struck
 * in place by {@link applyDeletionStrikeInTx} (`format` tags; only the author's own
 * pending insertions inside the span are deleted), so no character outside the
 * span is re-minted. The strike changes nothing before its seam (the selection start,
 * or where a bookmark start marker its own-insertion removal takes was), so the
 * suggested run is inserted there with one offset insert.
 *
 * The new run lands at the seam — BEFORE the struck selection text — and
 * carries `insertionSuggestionId`. `attrs` is its INTENDED live format (the
 * surrounding-context attrs the editor would have used); the resolved insertion id
 * is stamped on top, OVERWRITING only `insertionSuggestionId`.
 *
 * The two records share `createdAt` as the render-layer "replace" grouping signal.
 * Coalescing is per-half + independent: the insertion coalesces into an adjacent
 * same-author insertion at the start (computed against the PRE-strike state — the
 * strike never touches the run before `start`); the deletion coalesces per
 * {@link planMarkDeletion}. A coalesced half writes no new record.
 *
 * Block-write order (one transaction): strike every struck block, then insert the
 * suggested run at the seam — offset writes on each block's inline `Y.Text`; no
 * block's inline storage is rewritten.
 *
 * Degenerate delegation (the editor caller is always the expanded non-empty
 * branch, but these keep the op total):
 *   - `text === ""` → a pure {@link markDeletion} (no insertion record).
 *   - a collapsed span → a pure {@link mintInsertion} at the cursor (no deletion
 *     record).
 *   - the strike plan is `null` (nothing to strike, e.g. an all-zero-width span) →
 *     a pure {@link mintInsertion} at the span start.
 *
 * Returns `endPosition`: right after the inserted run (the editor's caret).
 *
 * Attr equality for the insert's run-merge (a custom per-key `equals`) comes from the
 * attr registry bound to the doc; none bound → deep-value compare.
 */
export function replaceWithSuggestion(
  state: State,
  rawSpan: Span,
  text: string,
  attrs: ReadonlyAttrs,
  input: ReplaceSuggestionInput,
): OperationResult & { readonly endPosition: Position } {
  const span = rawSpan;
  // The suggested text goes at the start of the span's text (after an object start):
  // a covered object stays in place (structural change tracking is not built).
  const start = clipSpanToText(state, span).anchor;
  // Degenerate: nothing to insert → a pure suggested deletion of the selection.
  if (text === "") {
    const del = markDeletion(state, span, {
      id: input.deletionId,
      author: input.author,
      createdAt: input.createdAt,
      order: input.order,
    });
    return { ...del, endPosition: start };
  }

  // Degenerate: collapsed span → nothing to strike, a pure suggested insertion.
  if (
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset
  ) {
    const ins = mintInsertion(state, span.anchor, text, attrs, {
      id: input.insertionId,
      author: input.author,
      createdAt: input.createdAt,
      order: input.order,
    });
    return { ...ins, endPosition: createPosition(span.anchor.blockId, span.anchor.offset + text.length) };
  }

  // Plan the strike (pure, pre-tx). A `null` plan means the span re-collapsed /
  // yields nothing to strike — reduce to a pure suggested insertion at the span
  // start (the document-order earliest endpoint).
  const delPlan = planMarkDeletion(state, span, {
    id: input.deletionId,
    author: input.author,
    createdAt: input.createdAt,
    order: input.order,
  });
  if (delPlan === null) {
    const ins = mintInsertion(state, start, text, attrs, {
      id: input.insertionId,
      author: input.author,
      createdAt: input.createdAt,
      order: input.order,
    });
    return { ...ins, endPosition: createPosition(start.blockId, start.offset + text.length) };
  }

  // The suggested run lands at the strike's seam — an offset insert AFTER the strike.
  // The strike changes nothing before the seam (`delPlan.seam`: the span start, or
  // where a bookmark start marker the strike removes was), so it is a pre-strike offset
  // too; `planInsertText` validates against the pre-strike state.
  const seam = createPosition(start.blockId, delPlan.seam);

  // Insertion coalesce decision — computed against the PRE-strike `state` (the
  // strike never alters the run before the seam, so a same-author insertion
  // neighbor there is still valid). Mirrors `mintInsertion`'s collapsed-span probe.
  const { id: insId, reusing: reusingIns } = resolveCoalesce(
    state,
    createSpan(seam, seam),
    input.insertionId,
    INSERTION_SUGGESTION_ATTR,
    (record) => record.kind === "insertion" && record.author === input.author,
    input.noCoalesce,
  );

  // Stamp the resolved insertion id over the intended live format. OVERWRITES only
  // `insertionSuggestionId` (any stale caller value is replaced by the resolved id).
  const insertAttrs: ReadonlyAttrs = { ...attrs, [INSERTION_SUGGESTION_ATTR]: insId };

  const insertPlan = planInsertText(state, seam, text, insertAttrs);

  const result = applyOperation(state, (d) => {
    // Strike every struck block, then insert the suggested run at the seam.
    applyDeletionStrikeInTx(d, delPlan.writes, delPlan.id, input.author, "replaceWithSuggestion", delPlan.removedBookmarks);
    // Insert at the seam BEFORE the ¶ steps: an own-insertion ¶ removal merges the
    // start block into the next one (survivor R), renaming the seam.
    insertTextInTx(d, insertPlan);
    applyMarkStepsInTx(d, delPlan.steps, delPlan.id);
    // Write the deletion record (≥1 run tagged AND not coalesced).
    if (delPlan.taggedAny && !delPlan.reusing) {
      writeSuggestionRecordInTx(d, {
        id: delPlan.id,
        kind: "deletion",
        author: input.author,
        createdAt: input.createdAt,
        order: input.order,
      });
    }
    // Write the insertion record (unless coalesced into an existing one).
    if (!reusingIns) {
      writeSuggestionRecordInTx(d, {
        id: insId,
        kind: "insertion",
        author: input.author,
        createdAt: input.createdAt,
        order: input.order,
      });
    }
  });
  return { ...result, endPosition: createPosition(start.blockId, delPlan.seam + text.length) };
}

/**
 * `span` normalized forward with its endpoints snapped OUT to grapheme boundaries
 * (start backward, end forward; a collapsed span snaps backward) — computed ONCE by a
 * planner so the strike, the cut and the insert all use the same offsets.
 */
function snapSpanOut(state: State, span: Span): Span {
  const start = spanStart(state, span);
  const end = spanEnd(state, span);
  const itemsOf = (id: BlockId): ReadonlyArray<InlineItem> => resolveBlock(state, id)?.block.inlineContent?.items ?? [];
  const s = createPosition(start.blockId, snapOffset(itemsOf(start.blockId), start.offset));
  const collapsed = start.blockId === end.blockId && start.offset === end.offset;
  const e = collapsed ? s : createPosition(end.blockId, snapOffset(itemsOf(end.blockId), end.offset, 1));
  return createSpan(s, e);
}

/**
 * ENTER (paragraph SPLIT) over a NON-COLLAPSED selection in Suggesting mode: the
 * SPLIT_NODE analog of {@link replaceWithSuggestion}. SOFT-DELETE the selection (the
 * text STAYS, struck with `deletionSuggestionId`) AND insert a suggested paragraph
 * SPLIT at the END of the selection, in ONE tracked `applyOperation` transaction — so
 * the strike, the structural split, the ¶ key, and BOTH
 * records (a `deletion` and an `insertion`) land as ONE undo entry and one collab
 * event.
 *
 * Composes {@link planMarkDeletion} (the strike plan) with the structural
 * {@link planSplitBlockAtPosition} + {@link splitBlockAtPositionInTx}, then keys the
 * new ¶ (`insertionSuggestionId` on the new head H's entry) — exactly
 * the {@link splitWithSuggestion} discipline.
 *
 * SINGLE-BLOCK scope: the editor caller guarantees `spanStart.blockId ===
 * spanEnd.blockId` (a cross-block Enter-over-selection goes through
 * {@link replaceWithSuggestedFragment}). This op stays
 * correct / non-corrupting on a same-block span; it does not attempt the multi-block
 * case.
 *
 * Post-strike-offset HAZARD (mirrors {@link replaceWithSuggestion}): the surgical
 * strike ({@link applyDeletionStrikeInTx}) — critically — REMOVES the author's OWN
 * pending insertions in-range, which SHORTENS the block. So the split offset MUST be
 * computed against the POST-strike length, not the pre-strike `end.offset`. The
 * unstruck tail `[end, preLen)` is never touched by the strike, so
 * `tailLen = preLen - end.offset` is invariant; the post-strike split offset is
 * `splitOffset = postLen - tailLen` (for the common case — striking another author's
 * text, tagged in place — `postLen === preLen` so `splitOffset === end.offset`). The
 * split's new head H takes `[0, splitOffset)` (the struck selection) and B keeps the
 * unstruck tail `[splitOffset, postLen)`.
 *
 * Append discipline: the strike writes B's inline `Y.Text` in place (`format` tags
 * on the struck text, deletes of own-insertions), so the split reads B's POST-strike
 * live content. `splitBlockAtPositionInTx` then inserts the new ¶ at `splitOffset`;
 * this op then keys it — no character of B is re-minted.
 *
 * The two records share `createdAt` as the render-layer "this was ONE replace"
 * grouping signal (like {@link replaceWithSuggestion}). The deletion record is written
 * only when ≥1 run was tagged AND not coalesced (the `markDeletion` contract); the
 * insertion record is always written (a suggested split is its OWN discrete tracked
 * insertion — NO coalescing).
 *
 * Degenerate: when {@link planMarkDeletion} returns `null` (the span
 * normalized-collapsed / nothing to strike — e.g. an all-zero-width span), this
 * reduces to a pure {@link splitWithSuggestion} at the span start (a suggested split,
 * no strike, no deletion record).
 *
 * `newBlockInit` (the heading→paragraph follow-on hook) is threaded through to
 * {@link planSplitBlockAtPosition} unchanged.
 */
export function splitWithSuggestionOverSelection(
  state: State,
  rawSpan: Span,
  allocator: IdAllocator,
  input: ReplaceSuggestionInput,
  newBlockInit?: { readonly type?: string; readonly attrs?: ReadonlyAttrs },
): OperationResult {
  // Snapped ONCE: the strike, the split offset and the split tag share one cut. The
  // split lands in the span's TEXT (`clipSpanToText`): a covered object stays in
  // place, though the strike covers a table's cell text.
  const span = snapSpanOut(state, rawSpan);
  const text = snapSpanOut(state, clipSpanToText(state, rawSpan));
  const start = text.anchor;
  const end = text.focus;
  const blockB = start.blockId; // === end.blockId for a single-block span text.

  // Plan the strike (pure, pre-tx). A `null` plan means the span re-collapsed /
  // yields nothing to strike — reduce to a pure suggested split at the span start.
  const delPlan = planMarkDeletion(state, span, {
    id: input.deletionId,
    author: input.author,
    createdAt: input.createdAt,
    order: input.order,
  });
  if (delPlan === null) {
    return splitWithSuggestion(state, start, allocator, {
      id: input.insertionId,
      author: input.author,
      createdAt: input.createdAt,
      order: input.order,
    }, newBlockInit);
  }

  const resolvedB = resolveBlock(state, blockB);
  if (resolvedB === null || resolvedB.block.inlineContent === null) {
    // Unreachable: planMarkDeletion produced a write only for a real leaf block.
    throw new Error(
      `splitWithSuggestionOverSelection: block "${blockB}" not found or not a leaf`,
    );
  }

  // B's strike write (none when the selection struck nothing IN B itself — defensive,
  // e.g. a same-block zero-width range: nothing before the end moves).
  const bWrite = delPlan.writes.find((w) => w.blockId === blockB);

  // Post-strike split offset: the selection end minus the units the strike deletes
  // before it (own insertions, the markers of a bookmark they remove). The plan
  // validates it against the PRE-strike state; it is ≤ end.offset, so it passes. The
  // plan allocates the head H's id.
  const splitOffset = postStrikeOffset(bWrite, end.offset);
  const splitPlan = planSplitBlockAtPosition(state, createPosition(blockB, splitOffset), allocator, newBlockInit);

  return applyOperation(state, (doc) => {
    // 1. Apply the strike writes (B written BEFORE the split so the split reads
    //    B's post-strike content). For a single-block span this is just B: offset
    //    `format` / `delete` writes on its inline Y.Text.
    applyDeletionStrikeInTx(doc, delPlan.writes, delPlan.id, input.author, "splitWithSuggestionOverSelection", delPlan.removedBookmarks);
    // 2. The REAL structural split: a new ¶ (H's) at splitOffset of B's post-strike
    //    content; B keeps the unstruck tail [splitOffset, postLen).
    splitBlockAtPositionInTx(doc, splitPlan);
    // 3. Key the new ¶ (the head H's) as the suggested split.
    writeBreakTagInTx(doc, splitPlan.newBlockId, INSERTION_TAG_KEY, input.insertionId);
    // 4. The deletion record (≥1 run tagged AND not coalesced).
    if (delPlan.taggedAny && !delPlan.reusing) {
      writeSuggestionRecordInTx(doc, {
        id: delPlan.id,
        kind: "deletion",
        author: input.author,
        createdAt: input.createdAt,
        order: input.order,
      });
    }
    // 5. The insertion record (a suggested split is its OWN tracked insertion — NO
    //    coalescing).
    writeSuggestionRecordInTx(doc, {
      id: input.insertionId,
      kind: "insertion",
      author: input.author,
      createdAt: input.createdAt,
      order: input.order,
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Fragment replace (paste-as-suggestion / cross-block Enter). A possibly-multi-
// block selection is replaced by a possibly-multi-block fragment as ONE tracked
// suggestion: the fragment is a suggested INSERTION (its inter-line breaks are
// tagged split boundaries), and any non-collapsed selection is SOFT-DELETED (struck)
// with the crossed paragraph boundaries tagged as suggested JOINs — so accept
// re-flows the merged paragraph and reject restores the original split.
// ───────────────────────────────────────────────────────────────────────────

/**
 * The pure structural plan for replacing `span` with a `fragment` as a tracked
 * suggestion: per-existing-block full-replace inline writes, fresh fully-linked
 * new blocks, the 0..2 suggestion records, and the post-op caret. Computed
 * entirely from the pre-tx `state` (every new block id allocated up-front), then
 * applied in ONE transaction by {@link replaceWithSuggestedFragment}.
 */
export interface ReplaceFragmentPlan {
  readonly writes: readonly ResolveWrite[];
  readonly newBlocks: readonly FragmentHead[];
  readonly records: readonly SuggestionRecord[];
  readonly endPosition: Position;
  /**
   * The start block B's insert plan: an offset `insert` of line0 at `c` against B's
   * POST-strike content. `null` ONLY for `n===0` (no insertion into B).
   */
  readonly bInsertPlan: InsertItemsPlan | null;
  /**
   * The fragment's line count `n`. B is surgical for ALL n (strike in place + offset
   * insert); for `n>1` each line but the last is split off B into a new head (a new
   * ¶ per line), so B keeps its id, its ¶ and its struck tail without any
   * character moving (a peer's concurrent typing in the tail survives).
   */
  readonly fragmentLength: number;
  /** The insertion id keying each new head's ¶ (`n>1`), else null. */
  readonly insertionId: SuggestionId | null;
  /** `n>1`: the items of lines 1..n-1, in order (each inserted at B's start). */
  readonly newLineItems: readonly (readonly InlineItem[])[];
  /** The ¶s inside the struck span this deletion keys / removes, with `joinId`. */
  readonly steps: readonly MarkDeletionStep[];
  readonly joinId: SuggestionId | null;
  /** The bookmarks the strike's own-insertion removals remove (empty without a strike). */
  readonly removedBookmarks: ReadonlySet<string>;
}

function itemsLength(items: ReadonlyArray<InlineItem>): number {
  return items.reduce((n, it) => n + (it.kind === "text" ? it.text.length : 1), 0);
}

/** Stamp the insertion-provenance id on every TEXT run (embeds untouched). */
function tagInsertionRuns(
  items: ReadonlyArray<InlineItem>,
  insId: SuggestionId,
): InlineItem[] {
  return items.map((it) =>
    it.kind === "text"
      ? { ...it, attrs: { ...it.attrs, [INSERTION_SUGGESTION_ATTR]: insId } }
      : it,
  );
}

/**
 * Returns the trackable inline items for a fragment line: content embeds
 * (image, tab, inline hard-break, …) are DROPPED — a suggested paste tracks text runs
 * only (embed insertion carriers exist solely for the typed soft line break,
 * `mintLineBreak`). Both {@link fragmentLineItems} and
 * {@link fragmentLineLength} MUST consume the output of this filter so that the
 * tagged items and the caret offset stay in sync.
 */
function filterLineContentItems(line: SiblingBlockInit): ReadonlyArray<InlineItem> {
  const raw = line.inlineContent?.items ?? [];
  return raw.filter((item) => item.kind !== "embed");
}

function fragmentLineItems(line: SiblingBlockInit, insId: SuggestionId): InlineItem[] {
  return tagInsertionRuns(filterLineContentItems(line), insId);
}
function fragmentLineLength(line: SiblingBlockInit): number {
  return inlineContentLength({ items: filterLineContentItems(line) });
}

export function planReplaceWithSuggestedFragment(
  state: State,
  rawSpan: Span,
  fragment: readonly SiblingBlockInit[],
  input: ReplaceSuggestionInput,
  allocator: IdAllocator,
): ReplaceFragmentPlan {
  // Snapped ONCE: the strike range, the prefix cut `c`, the insert and the moved tail
  // all use the same grapheme-aligned offsets. The fragment goes at the start of the
  // span's TEXT (`clipSpanToText`: after an object start) — a covered object stays in
  // place (structural change tracking is not built), though a table's cell text is struck.
  const span = snapSpanOut(state, rawSpan);
  const at = snapSpanOut(state, clipSpanToText(state, rawSpan)).anchor;
  const resolved = resolveBlock(state, at.blockId);
  if (resolved === null || resolved.block.inlineContent === null) {
    throw new Error(
      `planReplaceWithSuggestedFragment: block "${at.blockId}" not found or not a leaf`,
    );
  }
  const kind = resolved.kind;
  const n = fragment.length;

  // Plan the strike (pure, pre-tx). `null` ⇒ no strike (collapsed span / nothing to
  // strike) — the start block B keeps its plain content and the fragment is a pure
  // suggested insertion at `at` (the collapsed-selection case). A non-null plan strikes B's tail +
  // any intervening blocks + E's head and (cross-block) suggests JOINing the crossed
  // boundaries so accept re-flows the merged paragraph and reject restores the split.
  const delPlan = planMarkDeletion(state, span, {
    id: input.deletionId,
    author: input.author,
    createdAt: input.createdAt,
    order: input.order,
  });
  // The cut `c`: the strike's seam — the span start, or where a bookmark start marker
  // the strike removes was (post-strike offset; nothing before it changes).
  const c = delPlan === null ? at.offset : delPlan.seam;
  const removedBookmarks: ReadonlySet<string> = delPlan?.removedBookmarks ?? new Set();

  // The start block B's prefix [0:c] (untouched by the strike), the bundle that rides
  // into the LAST inserted block (B's struck tail + a cross-block join, or — no strike
  // — B's plain suffix), the writes for OTHER struck blocks (intervening get a join;
  // E does not), and the deletion record (when ≥1 run was tagged and not coalesced).
  let prefix: ReadonlyArray<InlineItem>;
  let tailBundle: ReadonlyArray<InlineItem>;
  const extraWrites: ResolveWrite[] = [];
  let delRecord: SuggestionRecord | null = null;
  // The start block B's surgical-strike coords. `bRangeStart < bRangeEnd` ⇒ B has a
  // strike (false in the collapsed / nothing-struck-in-B case).
  let bDeletionId: SuggestionId | null = null;
  let bRangeStart = 0;
  let bRangeEnd = 0;
  if (delPlan === null) {
    const [pfx, sfx] = splitInlineContentAtOffset(
      { items: resolved.block.inlineContent.items },
      c,
    );
    prefix = pfx;
    tailBundle = sfx;
  } else {
    const startBlockId = at.blockId;
    // B's POST-strike content (prefix [0:c] plain ++ struck tail). If the strike
    // produced no write for B (the selection struck nothing in B itself — e.g. starts
    // at end-of-B), B's live content is unchanged and `c` splits it the same way.
    const bWrite = delPlan.writes.find((w) => w.blockId === startBlockId);
    if (bWrite) {
      bRangeStart = bWrite.rangeStart;
      bRangeEnd = bWrite.rangeEnd;
    }
    bDeletionId = bWrite ? delPlan.id : null;
    const bItems = bWrite ? bWrite.items : resolved.block.inlineContent.items;
    const [pfx, afterPrefix] = splitInlineContentAtOffset({ items: bItems }, c);
    prefix = pfx;
    tailBundle = afterPrefix;
    // Every OTHER struck block (interveners + E): struck in place. The ¶s inside the
    // span are keyed from `delPlan.steps` — one deletion id names them all, resolved
    // together.
    for (const w of delPlan.writes) {
      if (w.blockId === startBlockId) continue;
      extraWrites.push({
        blockId: w.blockId,
        kind: delPlan.kind,
        items: w.items,
        rangeStart: w.rangeStart,
        rangeEnd: w.rangeEnd,
        deletionId: delPlan.id,
      });
    }
    if (delPlan.taggedAny && !delPlan.reusing) {
      delRecord = { id: delPlan.id, kind: "deletion", author: input.author, createdAt: input.createdAt, order: input.order };
    }
  }

  // The start block B's write entry (its strike coords + the full-replace `items`, now
  // read ONLY by the test equivalence oracle).
  const bWriteEntry = (items: ReadonlyArray<InlineItem>): ResolveWrite => ({
    blockId: at.blockId,
    kind,
    items,
    rangeStart: bRangeStart,
    rangeEnd: bRangeEnd,
    deletionId: bDeletionId,
  });

  // Empty fragment: a pure suggested deletion (no insertion). B' = prefix ++ tailBundle
  // (the strike writes, restored as one block); the strike record is the only one.
  if (n === 0) {
    const bItems = mergeAdjacentTextItems([...prefix, ...tailBundle]);
    return {
      writes: [bWriteEntry(bItems), ...extraWrites],
      newBlocks: [],
      records: delRecord === null ? [] : [delRecord],
      endPosition: createPosition(at.blockId, c),
      bInsertPlan: null,
      fragmentLength: n,
      steps: delPlan?.steps ?? [],
      joinId: delPlan?.id ?? null,
      newLineItems: [],
      insertionId: null,
      removedBookmarks,
    };
  }

  // Insertion id: n===1 coalesces into an adjacent same-author insertion;
  // n>1 ALWAYS mints fresh — the whole paste is ONE accept/reject unit and its split
  // embeds must NOT fold into a pre-existing insertion's id.
  let insId: SuggestionId;
  let insRecord: SuggestionRecord | null;
  if (n === 1) {
    const decision = resolveCoalesce(
      state,
      createSpan(at, at),
      input.insertionId,
      INSERTION_SUGGESTION_ATTR,
      (rec) => rec.kind === "insertion" && rec.author === input.author,
      input.noCoalesce,
    );
    insId = decision.id;
    insRecord = decision.reusing
      ? null
      : { id: insId, kind: "insertion", author: input.author, createdAt: input.createdAt, order: input.order };
  } else {
    insId = input.insertionId;
    insRecord = { id: insId, kind: "insertion", author: input.author, createdAt: input.createdAt, order: input.order };
  }
  const records: SuggestionRecord[] = [];
  if (insRecord !== null) records.push(insRecord);
  if (delRecord !== null) records.push(delRecord);

  if (n === 1) {
    const line0 = fragment[0];
    if (line0 === undefined) {
      throw new Error("planReplaceWithSuggestedFragment: n===1 but fragment[0] missing (unreachable)");
    }
    // Surgical (lockstep): after the applier strikes B in place (the block's inline Y.Text ==
    // `bStrikeItems`), offset-insert line0 at offset `c` resolved against `bStrikeItems`.
    const bInsertPlan = planInsertItemsAt(
      at.blockId,
      kind,
      c,
      fragmentLineItems(line0, insId),
    );
    // The full-replace `writes[0].items` — retained ONLY for the test equivalence oracle
    // (the live applier no longer reads it for B; the surgical `bInsertPlan` drives B).
    const bItems = mergeAdjacentTextItems([
      ...prefix,
      ...fragmentLineItems(line0, insId),
      ...tailBundle,
    ]);
    return {
      writes: [bWriteEntry(bItems), ...extraWrites],
      newBlocks: [],
      records,
      endPosition: createPosition(at.blockId, c + fragmentLineLength(line0)),
      bInsertPlan,
      fragmentLength: n,
    steps: delPlan?.steps ?? [],
    joinId: delPlan?.id ?? null,
    removedBookmarks,
      newLineItems: [],
      insertionId: null,
    };
  }

  // n > 1 (the NEW ¶ ends the head): line0 is inserted into B at `c`, then
  // B is split after it — the new head H0 holds prefix ⊕ line0 (B's type / attrs, as
  // the direct paste) — and each middle line L_i is inserted at B's start and split off
  // into a new head H_i (its own type / attrs). B keeps its id, its ¶ and the tail, and
  // holds the LAST (open) line ⊕ the tail. Every new ¶ (each H's) is keyed as the
  // suggested insertion; no character of B moves.
  const line0 = fragment[0];
  if (line0 === undefined) {
    throw new Error("planReplaceWithSuggestedFragment: n>1 but fragment[0] missing (unreachable)");
  }
  const lastLine = fragment[n - 1];
  if (lastLine === undefined) {
    throw new Error("planReplaceWithSuggestedFragment: last fragment line missing (unreachable)");
  }
  const bInsertPlan = planInsertItemsAt(at.blockId, kind, c, fragmentLineItems(line0, insId));
  const newLineItems: InlineItem[][] = [];
  for (let i = 1; i < n; i++) {
    const line = fragment[i];
    if (line === undefined) throw new Error(`planReplaceWithSuggestedFragment: fragment line ${i} missing (unreachable)`);
    newLineItems.push(fragmentLineItems(line, insId));
  }
  const newBlocks: FragmentHead[] = [];
  for (let i = 0; i < n - 1; i++) {
    const line = fragment[i];
    if (line === undefined) throw new Error(`planReplaceWithSuggestedFragment: fragment line ${i} missing (unreachable)`);
    newBlocks.push(
      i === 0
        ? { id: allocator.allocate(), kind, type: resolved.block.type, attrs: resolved.block.attrs, items: mergeAdjacentTextItems([...prefix, ...fragmentLineItems(line0, insId)]) }
        : { id: allocator.allocate(), kind, type: line.type, attrs: line.attrs ?? {}, items: newLineItems[i - 1] ?? [] },
    );
  }
  // The full-replace `writes[0].items` (test oracle only): B = the last line ⊕ the tail.
  const bItems = mergeAdjacentTextItems([...fragmentLineItems(lastLine, insId), ...tailBundle]);
  return {
    writes: [bWriteEntry(bItems), ...extraWrites],
    newBlocks,
    records,
    endPosition: createPosition(at.blockId, fragmentLineLength(lastLine)),
    bInsertPlan,
    fragmentLength: n,
    steps: delPlan?.steps ?? [],
    joinId: delPlan?.id ?? null,
    removedBookmarks,
    newLineItems,
    insertionId: insId,
  };
}

/** A new head block of a multi-line suggested fragment (`n > 1`), in document order before B. */
export interface FragmentHead {
  readonly id: BlockId;
  readonly kind: BlockTreeKind;
  readonly type: string;
  readonly attrs: ReadonlyAttrs;
  /** Its content after the op (test oracle). */
  readonly items: readonly InlineItem[];
}

/**
 * Replace `span` with a `fragment` as ONE tracked suggestion, applying the pure
 * {@link planReplaceWithSuggestedFragment} in a single `applyOperation`: the
 * per-block inline writes, the start-block / boundary sibling rewires (which the
 * pure plan does NOT carry — `ResolveWrite` is inline-content only, and
 * `insertNewBlocksInTx` writes only the new blocks), the new-block run, and the
 * records. Returns the standard `OperationResult` plus the post-op `endPosition`.
 */
export function replaceWithSuggestedFragment(
  state: State,
  span: Span,
  fragment: readonly SiblingBlockInit[],
  input: ReplaceSuggestionInput,
  allocator: IdAllocator,
): OperationResult & { readonly endPosition: Position } {
  const plan = planReplaceWithSuggestedFragment(state, span, fragment, input, allocator);
  const result = applyOperation(state, (doc) => {
    // Per-block roles. The START block is `plan.writes[0]`; every OTHER write is an
    // intervening block or E. NON-start writes are ALWAYS surgical: strike
    // in place (preserving untouched runs' Y.Text identity) + append the cross-block
    // JOIN embed for interveners. The START block is surgical for ALL n: n===0 strike-
    // only; n===1 strike + offset-insert line0 via `bInsertPlan`; n>1
    // strike, then each line is inserted and split off below. The full-replace seam (`writeBlockInlineContentInTx`) is now GONE:
    // every write in this op preserves untouched runs' Y.Text CRDT identity.
    const firstWrite = plan.writes[0];
    if (firstWrite === undefined) {
      throw new Error("replaceWithSuggestedFragment: plan has no writes (unreachable)");
    }
    const startBlockId = firstWrite.blockId;
    // Surgical for every write: strike in place (one deletion id), then the START block
    // gets its offset insert (line0) at the post-strike seam.
    const struck = plan.writes.filter((w) => w.deletionId !== null && w.rangeStart < w.rangeEnd);
    const deletionId = struck[0]?.deletionId;
    if (deletionId !== undefined && deletionId !== null) {
      applyDeletionStrikeInTx(doc, struck, deletionId, input.author, "replaceWithSuggestedFragment", plan.removedBookmarks);
    }
    if (plan.bInsertPlan !== null) insertItemsInTx(doc, plan.bInsertPlan);
    // n>1: split B after line0 (head H0), then each later line goes in at B's start; every
    // line but the last is split off into its head H_i. Each new ¶ is keyed.
    const off0 = plan.bInsertPlan !== null ? plan.bInsertPlan.offset + itemsLength(plan.bInsertPlan.items) : 0;
    plan.newBlocks.forEach((nb, i) => {
      if (i > 0) insertInlineItems(requireBlockText(doc, startBlockId, "replaceWithSuggestedFragment"), 0, plan.newLineItems[i - 1] ?? []);
      const at = i === 0 ? off0 : itemsLength(plan.newLineItems[i - 1] ?? []);
      splitAt(doc, startBlockId, at, nb.id, { type: nb.type, attrs: nb.attrs, tree: nb.kind });
      if (plan.insertionId !== null) writeBreakTagInTx(doc, nb.id, INSERTION_TAG_KEY, plan.insertionId);
    });
    const last = plan.newBlocks.length > 0 ? plan.newLineItems[plan.newBlocks.length - 1] : undefined;
    if (last !== undefined) insertInlineItems(requireBlockText(doc, startBlockId, "replaceWithSuggestedFragment"), 0, last);
    // The ¶s inside the struck span (after every offset write).
    if (plan.joinId !== null) applyMarkStepsInTx(doc, plan.steps, plan.joinId);
    for (const rec of plan.records) writeSuggestionRecordInTx(doc, rec);
  });
  return { ...result, endPosition: plan.endPosition };
}

/**
 * Insert a `fragment` (1..N lines) at a COLLAPSED position `at` as ONE tracked
 * insertion. The collapsed special case of {@link replaceWithSuggestedFragment}
 * (no strike). `deletionId` is unused on this path.
 */
export function insertFragmentAsSuggestion(
  state: State,
  at: Position,
  fragment: readonly SiblingBlockInit[],
  input: SuggestionMintInput,
  allocator: IdAllocator,
): OperationResult & { readonly endPosition: Position } {
  return replaceWithSuggestedFragment(
    state,
    createSpan(at, at),
    fragment,
    {
      deletionId: input.id,
      insertionId: input.id,
      author: input.author,
      createdAt: input.createdAt,
      order: input.order,
    },
    allocator,
  );
}

/**
 * ACCEPT one suggestion by id (Suggesting-mode resolution). Dispatches on the
 * record's {@link SuggestionKind}:
 *   - insertion  → STRIP the `insertionSuggestionId` from each tagged run (the
 *     suggested text becomes plain, permanent text).
 *   - deletion   → DROP each tagged run (the soft-deleted text is removed FOR
 *     REAL).
 *   - formatting → APPLY the record's `proposedAttrs` (minus the run's shadowed
 *     keys) to each tagged run's LIVE attrs, shadow those keys on OLDER pending
 *     formatting suggestions on the run, AND strip its tag (the proposal lands).
 * After the content rewrite the record is deleted from the `suggestions` map.
 *
 * UNDOABLE: an ordinary tracked transaction (the editor commits it as one history
 * entry; undo restores the record and the tagged runs exactly).
 *
 * Identity no-op (returns the SAME `state` reference + empty dirtyIds, per the
 * identity-no-op contract) when no record exists for `id`.
 */
export function acceptSuggestion(
  state: State,
  id: SuggestionId,
): OperationResult {
  return resolve(state, id, "accept");
}

/**
 * REJECT one suggestion by id. The inverse resolution of {@link acceptSuggestion}:
 *   - insertion  → DROP each tagged run (the suggested text never lands).
 *   - deletion   → STRIP the `deletionSuggestionId` from each tagged run (the
 *     text stays; the deletion is discarded).
 *   - formatting → STRIP its formatting tag (the proposal is discarded;
 *     the run's live attrs are unchanged).
 * After the rewrite the record is deleted from the `suggestions` map.
 *
 * Undoable, like {@link acceptSuggestion}.
 * Identity no-op when no record exists for `id`.
 */
export function rejectSuggestion(
  state: State,
  id: SuggestionId,
): OperationResult {
  return resolve(state, id, "reject");
}

/** What a resolve does to each TAGGED run of a resolved insertion / deletion. */
type ResolveAction = "strip" | "drop";

/**
 * A pre-computed per-owning-block rewrite for the fragment-replace path. Carries
 * BOTH the rebuilt `items` (the old full-replace content — now read ONLY by the test
 * equivalence oracle; the live applier drives every block surgically) AND the
 * surgical-strike coordinates so the applier can drive {@link applyDeletionStrikeInTx} directly
 * (the applier holds only the {@link ReplaceFragmentPlan}, not the planner-local
 * `delPlan`). When `deletionId === null` the write contributes no strike (the
 * collapsed / nothing-struck collapsed-selection case) and `rangeStart`/`rangeEnd` are 0.
 */
export interface ResolveWrite {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly items: ReadonlyArray<InlineItem>;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly deletionId: SuggestionId | null;
}

/**
 * A per-owning-block decision list for the resolve path. Distinct from
 * {@link ResolveWrite} (which carries rebuilt `items` and remains in use by the
 * fragment-replace create-op path): a resolve never rebuilds a block's content — it
 * applies per-item decisions as offset writes on the block's inline `Y.Text`.
 * `decisions[k]` corresponds to the pre-resolve snapshot item k.
 */
export interface ResolveDecisionWrite {
  readonly blockId: BlockId;
  /** A block whose content the resolve keeps lies between the previous write and this one. */
  readonly afterGap?: boolean;
  readonly items: ReadonlyArray<InlineItem>;
  readonly decisions: readonly ScanItemResult[];
}

/**
 * Per-item decision for the shared resolve scan ({@link resolveBlockScan}).
 *
 * EXPORTED: `applyResolveDecisionsInTx` is exported (its sibling test calls it
 * directly) and takes `ResolveDecisionWrite`s holding `ScanItemResult`s (core builds
 * with `"declaration": true`, so the referenced types must be exported too).
 */
export type ScanItemResult =
  // keep item as-is (untouched).
  | { readonly op: "keep" }
  // touched: replace ONLY this item's attrs (text/embedType/properties unchanged
  // — every resolve rewrite is attrs-only, so the applier formats the item's range
  // in place, identity-preserving).
  | { readonly op: "rewrite"; readonly attrs: ReadonlyAttrs }
  // touched: omit this run (real delete).
  | { readonly op: "drop" };

/**
 * Identity-preserving resolve applier. For each write, `decisions[k]` applies to
 * snapshot item `items[k]` (the block's pre-resolve read model) as an OFFSET write:
 *   - keep    → nothing.
 *   - rewrite → `format` the item's range with the attrs diff (old → new): the
 *               characters keep their CRDT identity.
 *   - drop    → delete the item's range.
 * Formats never shift offsets, so all rewrites run first; then every drop of every
 * block goes through ONE `deleteUnits` (document order, on the snapshots: no block
 * re-read), so the bookmark deletion rule
 * judges the resolve's whole deletion, as a direct deletion of the same text. MUST run
 * inside an already-open transaction.
 */
export function applyResolveDecisionsInTx(doc: Y.Doc, writes: readonly ResolveDecisionWrite[]): void {
  requireInTransaction(doc, "resolveSuggestion");
  const registry = attrRegistryOf(doc);
  const drops: ContentSpan[] = [];
  // `gap`: content the resolve keeps lies between the last drop and the next (bookmark rule).
  let gap = false;
  for (const w of writes) {
    const yText = blockText(doc, w.blockId);
    if (yText === null) continue; // defensive — scan only yields leaves
    gap ||= w.afterGap === true;
    const before = drops.length;
    let pos = 0;
    w.decisions.forEach((d, k) => {
      const item = w.items[k];
      if (item === undefined) return;
      const len = item.kind === "text" ? item.text.length : 1;
      if (d.op === "rewrite") {
        // A rewrite never targets a structural marker (markers carry no provenance),
        // and item boundaries are grapheme-aligned — format the item's range directly.
        const delta = toYFormatDelta(attrsDiff(item.attrs, d.attrs, registry));
        if (Object.keys(delta).length > 0) yText.format(pos, len, delta);
      } else if (d.op === "drop") {
        drops.push({ id: w.blockId, from: pos, to: pos + len, items: w.items, afterGap: gap });
        gap = false;
      }
      pos += len;
    });
    if (drops.length === before && hasContent(w.items, 0, Infinity)) gap = true;
  }
  deleteUnits(doc, { spans: drops });
}

/**
 * Shared item scan for {@link resolve} / {@link resolveAll}: walks blocks across ALL
 * THREE trees (main, then each `embedContents` body, then each `templateContents`
 * body) in document order, applies `classify` to each item, and accumulates the
 * per-owning-block {@link ResolveDecisionWrite}s (a block is touched iff any of its
 * items was not "keep"). Also returns the per-id surviving / dropped occurrence sets
 * of ids OTHER than the resolved ones (co-tenant cleanup).
 */
function resolveBlockScan(
  state: State,
  classify: (item: InlineItem) => ScanItemResult,
  resolved: (id: SuggestionId) => boolean,
): { writes: ResolveDecisionWrite[]; occ: Occurrences } {
  const writes: ResolveDecisionWrite[] = [];
  const occ: Occurrences = { survivors: new Set(), dropped: new Set() };
  let gap = false;
  for (const block of iterateAllBlocksInDocumentOrder(state)) {
    const content = block.inlineContent;
    if (content === null) continue;
    let touched = false;
    const decisions: ScanItemResult[] = [];
    for (const item of content.items) {
      const r = classify(item);
      if (r.op !== "keep") touched = true;
      for (const sid of suggestionIdsOnItem(item)) {
        if (resolved(sid)) continue;
        (r.op === "drop" ? occ.dropped : occ.survivors).add(sid);
      }
      decisions.push(r);
    }
    if (touched) {
      writes.push({
        blockId: block.id,
        afterGap: gap,
        items: content.items,
        decisions,
      });
      gap = false;
    } else if (hasContent(content.items, 0, Infinity)) {
      gap = true;
    }
  }
  return { writes, occ };
}

/** Occurrences of non-resolved suggestion ids: on content / tags that survive, or that go. */
interface Occurrences {
  readonly survivors: Set<SuggestionId>;
  readonly dropped: Set<SuggestionId>;
}

// ---------------------------------------------------------------------------
// Tracked-¶ resolution
// ---------------------------------------------------------------------------

/** One key on a ¶. */
interface BoundaryTag {
  readonly key: BreakTagKey;
  readonly id: SuggestionId;
  /** The text block whose OWN ¶ holds it. */
  readonly holder: BlockId;
}

/** What to do at one ¶, decided from the pre-resolve read model. */
type BoundaryOp =
  /** Delete only these keys (key-only resolutions; a ¶ invariant I keeps). */
  | { readonly op: "keys"; readonly tags: readonly BoundaryTag[] }
  /** Delete ¶`owner` (its keys go with its entry); when invariant I keeps it, drop `tags`. */
  | { readonly op: "mark"; readonly owner: BlockId; readonly tags: readonly BoundaryTag[] };

/** The planned ¶ ops, in document order. */
interface PlannedBoundary {
  readonly ops: readonly BoundaryOp[];
}

type Decide = (id: SuggestionId) => "accept" | "reject" | null;

/** True iff resolving `id` as `mode` deletes its ¶ (deletion accept / insertion reject). */
function deletesBoundary(doc: Y.Doc, id: SuggestionId, mode: "accept" | "reject"): boolean {
  const kind = readSuggestionRecord(doc, id)?.kind;
  return (kind === "deletion" && mode === "accept") || (kind === "insertion" && mode === "reject");
}

/**
 * True iff ¶`b` can be deleted in the current state (the `deleteUnits` check at block
 * level): a paragraph follows, or — before an object — `b` is empty and does not follow
 * an object. False at a flow's last ¶.
 */
function markDeletableNow(state: State, b: Block): boolean {
  const after = blockAfter(state, b)?.block ?? null;
  if (after === null) return false;
  if (after.inlineContent !== null) return true;
  const prev = b.prevSiblingId === null ? null : (resolveBlock(state, b.prevSiblingId)?.block ?? null);
  return b.inlineContent !== null && inlineContentLength(b.inlineContent) === 0 && (prev === null || prev.inlineContent !== null);
}

/**
 * Plan the ¶ side of a resolve (uniform): one op per keyed ¶ with a decided key.
 * Accept insertion / reject deletion → the key is deleted; reject insertion / accept
 * deletion → the ¶ is deleted (the merge rule; a section-end ¶ merges the sections), its
 * other key with it. A ¶ invariant I keeps (before an object, at a flow end — only a
 * concurrency-born key) keeps the ¶ and drops the key. Undecided keys removed with their
 * ¶ are recorded in `occ.dropped`, the others in `occ.survivors`.
 */
function planBoundaryResolution(state: State, decide: Decide, occ: Occurrences): PlannedBoundary {
  const doc = state[STATE_INTERNAL].doc;
  const ops: BoundaryOp[] = [];
  for (const b of iterateAllBlocksInDocumentOrder(state)) {
    const bs = b.breakSuggestion;
    if (b.inlineContent === null || bs === undefined) continue;
    const tags: BoundaryTag[] = [];
    if (bs.insertionId !== undefined) tags.push({ key: INSERTION_TAG_KEY, id: bs.insertionId, holder: b.id });
    if (bs.deletionId !== undefined) tags.push({ key: DELETION_TAG_KEY, id: bs.deletionId, holder: b.id });
    const decided = tags.filter((t) => decide(t.id) !== null);
    const removes = decided.some((t) => {
      const mode = decide(t.id);
      return mode !== null && deletesBoundary(doc, t.id, mode);
    });
    const gone = removes && markDeletableNow(state, b);
    for (const t of tags) if (decide(t.id) === null) (gone ? occ.dropped : occ.survivors).add(t.id);
    if (decided.length === 0) continue;
    ops.push(gone ? { op: "mark", owner: b.id, tags: decided } : { op: "keys", tags: decided });
  }
  return { ops };
}

/** Apply the planned ¶ ops in REVERSE document order (a ¶ deletion merges into the paragraph after it, survivor R). */
function applyBoundaryOpsInTx(doc: Y.Doc, plan: PlannedBoundary): void {
  for (let i = plan.ops.length - 1; i >= 0; i--) {
    const op = plan.ops[i];
    if (op === undefined) continue;
    if (op.op === "mark" && deleteParagraphMarkInTx(doc, op.owner)) continue;
    for (const t of op.tags) deleteTagKeys(tagEntriesOf(doc, t.holder), [t.key]);
  }
}

/**
 * Shared resolve engine for {@link resolve} / {@link resolveAll}: runs
 * {@link resolveBlockScan} + {@link planBoundaryResolution}, then in ONE ordinary
 * (undoable) `applyOperation` transaction:
 *   1. applies each touched block's per-item decisions as offset writes
 *      ({@link applyResolveDecisionsInTx}: rewrites `format`, drops delete — no
 *      character is re-minted);
 *   2. applies the ¶ ops (keys deleted; a ¶ whose resolution removes it deleted —
 *      exactly the keyed ¶, never a neighbour's);
 *   3. deletes the resolved records plus every co-tenant record left with no
 *      surviving occurrence, and every record that already had no live range;
 *   4. surfaces `state.rootId` when no block was touched (record-only change).
 */
function runResolve(
  state: State,
  resolvedIds: ReadonlySet<SuggestionId>,
  decide: Decide,
  classify: (item: InlineItem) => ScanItemResult,
  carriers: Carriers = carriersOf(state),
): OperationResult {
  const inSet = (id: SuggestionId): boolean => resolvedIds.has(id);
  const { writes, occ } = resolveBlockScan(state, classify, inSet);
  const boundaries = planBoundaryResolution(state, decide, occ);
  const deletes = new Set([...resolvedIds, ...[...occ.dropped].filter((c) => !occ.survivors.has(c))]);
  // Lazy cleanup: a record with NO carrier at all (no tagged char / embed, no key on
  // a live ¶: e.g. a concurrent same-key write lost by last-writer-wins, a key on a ¶ a
  // peer deleted) is deleted here.
  for (const id of carriers.carrierless) deletes.add(id);
  return applyOperation(state, (d) => {
    applyResolveDecisionsInTx(d, writes);
    applyBoundaryOpsInTx(d, boundaries);
    const map = getSuggestionsMap(d);
    for (const id of deletes) map.delete(id);
    if (writes.length === 0 && boundaries.ops.length === 0) return new Set<BlockId>([state.rootId]);
  });
}

/**
 * The shared accept/reject implementation. An insertion / deletion picks the kind's
 * provenance `attrKey` and a per-run {@link ResolveAction} from `record.kind` ×
 * `mode`, then delegates to {@link runResolve} with a single-id `classify`.
 * A FORMATTING suggestion rewrites every text run / visible embed carrying its tag
 * through `resolveFormattingSuggestionTags`.
 *
 * Tracked ¶s (a suggested paragraph / section-break insertion or deletion) are keys
 * on the ¶'s own entry (see `break-tags.ts`); {@link planBoundaryResolution} resolves
 * them uniformly: accept insertion / reject deletion deletes the key; reject insertion
 * / accept deletion deletes the ¶ (the merge rule). One id may name several ¶s (a
 * cross-block suggested replace keys every ¶ inside the span).
 *
 * Undoability + the absent-record identity no-op are documented on
 * {@link acceptSuggestion} / {@link rejectSuggestion}.
 */
function resolve(
  state: State,
  id: SuggestionId,
  mode: "accept" | "reject",
): OperationResult {
  const doc = state[STATE_INTERNAL].doc;
  const record = readSuggestionRecord(doc, id);
  // Absent record → identity no-op (return the input State reference). A carrier-less
  // record resolves to its deletion (lazy cleanup).
  if (record === null) {
    return { state, dirtyIds: NO_DIRTY };
  }
  const carriers = carriersOf(state);

  const readRecord = (sid: SuggestionId): SuggestionRecord | null => readSuggestionRecord(doc, sid);
  const tagKey = formattingSuggestionKey(id);

  const classify = (item: InlineItem): ScanItemResult => {
    if (record.kind === "formatting") {
      // A text run or VISIBLE field embed carrying this suggestion's tag.
      if (!(tagKey in item.attrs)) return { op: "keep" };
      return {
        op: "rewrite",
        attrs: resolveFormattingSuggestionTags(item.attrs, (sid) => (sid === id ? mode : null), readRecord),
      };
    }
    const attrKey = ATTR_KEY_BY_KIND[record.kind];
    // A text run, or an inline embed carrying the revision (a tracked soft line break).
    if (item.attrs[attrKey] === id) {
      return resolveAction(record.kind, mode) === "strip"
        ? { op: "rewrite", attrs: attrsWithout(item.attrs, attrKey) }
        : { op: "drop" };
    }
    // Non-matching item — keep as-is.
    return { op: "keep" };
  };

  return runResolve(state, new Set([id]), (sid) => (sid === id ? mode : null), classify, carriers);
}

export { suggestionIdsOnItem } from "../suggestions";

/** Which records are visible (≥1 live carrier) and which have no carrier at all. */
interface Carriers {
  readonly visible: ReadonlySet<SuggestionId>;
  readonly carrierless: ReadonlySet<SuggestionId>;
}

/** One O(document) pass: the record carriers (see {@link Carriers}). */
function carriersOf(state: State): Carriers {
  const visible = new Set(buildSuggestionRangeIndex(state).keys());
  const carrierless = new Set<SuggestionId>();
  for (const key of getSuggestionsMap(state[STATE_INTERNAL].doc).keys()) {
    const id = key as SuggestionId;
    if (!visible.has(id)) carrierless.add(id);
  }
  return { visible, carrierless };
}

/** The provenance attr key carrying an insertion / deletion suggestion id. */
const ATTR_KEY_BY_KIND: Record<Exclude<SuggestionKind, "formatting">, string> = {
  insertion: INSERTION_SUGGESTION_ATTR,
  deletion: DELETION_SUGGESTION_ATTR,
};

/**
 * The per-run {@link ResolveAction} for a `record.kind` × `mode` pair:
 *
 * | kind        | accept       | reject  |
 * |-------------|--------------|---------|
 * | insertion   | strip        | drop    |
 * | deletion    | drop         | strip   |
 *
 * (Formatting resolves through `resolveFormattingSuggestionTags`.)
 */
function resolveAction(kind: Exclude<SuggestionKind, "formatting">, mode: "accept" | "reject"): ResolveAction {
  return (kind === "insertion") === (mode === "accept") ? "strip" : "drop";
}

/** A copy of `attrs` with `key` omitted (the run loses its provenance id). */
function attrsWithout(attrs: ReadonlyAttrs, key: string): ReadonlyAttrs {
  const { [key]: _omit, ...rest } = attrs;
  return rest;
}

/**
 * ACCEPT EVERY suggestion in the document in ONE undoable transaction (the
 * "Accept all" command). Each TEXT run is resolved against ALL the suggestion
 * ids it carries at once (a run can be insertion-by-A + deletion-by-B +
 * formatting-by-C simultaneously), with the accept dominance order from
 * {@link acceptAllRun}: accept-deletion DROPS the run; otherwise the run is kept
 * plain (insertion id stripped) with its formatting proposals applied live. ALL
 * records are deleted. See {@link resolveAll}.
 *
 * Undoable (one history entry), exactly as {@link acceptSuggestion}. Identity no-op (same `state` ref +
 * empty dirtyIds) when the document has no suggestions.
 */
export function acceptAll(state: State): OperationResult {
  return resolveAll(state, "accept");
}

/**
 * REJECT EVERY suggestion in the document in ONE undoable transaction (the
 * "Reject all" command). The inverse of {@link acceptAll}: per run, the reject
 * dominance order from {@link rejectAllRun} applies — reject-insertion DROPS the
 * run; otherwise the run is kept (deletion + formatting ids stripped, no proposal
 * applied). ALL records are deleted. See {@link resolveAll}.
 *
 * Undoable, same identity no-op contract as {@link acceptAll}.
 */
export function rejectAll(state: State): OperationResult {
  return resolveAll(state, "reject");
}

/**
 * The outcome of resolving ONE text run against EVERY suggestion id it carries
 * under a bulk-resolve mode: `touched` = the run carried ≥1 suggestion id (so the
 * block must be rewritten); `keep` = the resolved run survives (`false` → it is
 * dropped); `item` = the rewritten run, present iff `keep`.
 */
interface AllRewrite {
  readonly touched: boolean;
  readonly keep: boolean;
  readonly item?: TextItem;
}

/** A copy of `item` with `attrs` replaced — the rewritten kept run. */
function withAttrs(item: TextItem, attrs: ReadonlyAttrs): TextItem {
  return { kind: "text", text: item.text, attrs };
}

/**
 * Resolve ONE text run for {@link acceptAll}. Dominance: a deletion id (accept-
 * deletion) DROPS the run — a char inserted-by-A AND deletion-suggested-by-B,
 * both accepted, ends up deleted. Otherwise the run is KEPT with: the insertion
 * id stripped (if present); and its resolved formatting suggestions applied live in
 * (order, createdAt, id) order via `resolveFormattingSuggestionTags` (a missing record →
 * just stripping its tag). A run carrying no resolved id is untouched
 * (`touched: false`).
 */
function acceptAllRun(item: TextItem, doc: Y.Doc, inSet: (raw: unknown) => raw is SuggestionId): AllRewrite {
  const hasInsertion = inSet(item.attrs[INSERTION_SUGGESTION_ATTR]);
  const hasDeletion = inSet(item.attrs[DELETION_SUGGESTION_ATTR]);
  const hasFormatting = formattingSuggestionIds(item.attrs).some(inSet);

  if (!hasInsertion && !hasDeletion && !hasFormatting) {
    return { touched: false, keep: true, item };
  }
  // Accept-deletion dominates → drop the run.
  if (hasDeletion) {
    return { touched: true, keep: false };
  }
  // Keep: strip the insertion id; apply the formatting proposal (if any).
  let attrs = hasInsertion ? attrsWithout(item.attrs, INSERTION_SUGGESTION_ATTR) : item.attrs;
  if (hasFormatting) attrs = resolveFormattingInSet(attrs, "accept", doc, inSet);
  return { touched: true, keep: true, item: withAttrs(item, attrs) };
}

/**
 * Resolve ONE text run for {@link rejectAll}. Dominance: an insertion id (reject-
 * insertion) DROPS the run — the suggested text never lands (so a run that is
 * BOTH insertion AND deletion is also dropped). Otherwise the run is KEPT with the
 * deletion id and the resolved formatting tags stripped (the proposals discarded).
 * A run carrying no resolved id is untouched (`touched: false`).
 */
function rejectAllRun(item: TextItem, doc: Y.Doc, inSet: (raw: unknown) => raw is SuggestionId): AllRewrite {
  const hasInsertion = inSet(item.attrs[INSERTION_SUGGESTION_ATTR]);
  const hasDeletion = inSet(item.attrs[DELETION_SUGGESTION_ATTR]);
  const hasFormatting = formattingSuggestionIds(item.attrs).some(inSet);

  if (!hasInsertion && !hasDeletion && !hasFormatting) {
    return { touched: false, keep: true, item };
  }
  // Reject-insertion dominates → drop the run.
  if (hasInsertion) {
    return { touched: true, keep: false };
  }
  // Keep: strip the deletion + formatting ids (proposal discarded).
  let attrs = item.attrs;
  if (hasDeletion) attrs = attrsWithout(attrs, DELETION_SUGGESTION_ATTR);
  if (hasFormatting) attrs = resolveFormattingInSet(attrs, "reject", doc, inSet);
  return { touched: true, keep: true, item: withAttrs(item, attrs) };
}

/** Resolve (in `mode`) every formatting suggestion of the resolved set tagged in `attrs`. */
function resolveFormattingInSet(
  attrs: ReadonlyAttrs,
  mode: "accept" | "reject",
  doc: Y.Doc,
  inSet: (raw: unknown) => raw is SuggestionId,
): ReadonlyAttrs {
  return resolveFormattingSuggestionTags(
    attrs,
    (sid) => (inSet(sid) ? mode : null),
    (sid) => readSuggestionRecord(doc, sid),
  );
}

/**
 * The shared {@link acceptAll} / {@link rejectAll} implementation. Unlike the
 * single-id {@link resolve} (which classifies per ONE id), this resolves EVERY id
 * every run carries in one combined rewrite — looping the single-id resolve would
 * re-plan each pass against the same now-stale pre-tx snapshot while the block's inline Y.Text
 * mutates underneath it, and a single run can carry insertion + deletion +
 * formatting ids at once (the per-id passes would fight over that run's attrs).
 *
 * Delegates the scan + transaction to the shared {@link runResolve} engine with an
 * all-ids `classify`: per text run {@link acceptAllRun} / {@link rejectAllRun}
 * decides keep-with-rewritten-attrs vs drop (the mode's dominance order); embeds
 * resolve their formatting tags; untouched runs are kept. Break tags (paragraph /
 * section boundaries) resolve through {@link planBoundaryResolution}. The resolved
 * records are then deleted. If the document has no (matching) suggestions → identity
 * no-op. If records exist but nothing carries their ids → {@link runResolve}
 * surfaces `state.rootId` so the record deletes still advance state.
 *
 * Walks all three trees via {@link resolveBlockScan} (same as {@link resolve} +
 * `buildSuggestionRangeIndex`), so suggestions inside embed/template bodies resolve
 * in-place in their body tree.
 */
function resolveAll(
  state: State,
  mode: "accept" | "reject",
  only: ReadonlySet<SuggestionId> | null = null,
): OperationResult {
  const doc = state[STATE_INTERNAL].doc;
  const carriers = carriersOf(state);
  // Every record (of the group, when `only`); a carrier-less one is simply deleted.
  const ids: SuggestionId[] = [...getSuggestionsMap(doc).keys()]
    .map((key) => key as SuggestionId)
    .filter((id) => only === null || only.has(id));
  // No (matching) suggestions and nothing to clean → identity no-op (the input State reference).
  if (ids.length === 0 && carriers.carrierless.size === 0) {
    return { state, dirtyIds: NO_DIRTY };
  }
  const idSet = new Set(ids);
  const inSet = (raw: unknown): raw is SuggestionId => typeof raw === "string" && idSet.has(raw as SuggestionId);

  const classify = (item: InlineItem): ScanItemResult => {
    if (item.kind === "text") {
      const rewrite = mode === "accept" ? acceptAllRun(item, doc, inSet) : rejectAllRun(item, doc, inSet);
      if (!rewrite.touched) return { op: "keep" };
      return rewrite.keep && rewrite.item !== undefined
        ? { op: "rewrite", attrs: rewrite.item.attrs }
        : { op: "drop" };
    }
    // An embed: an inline insertion revision (a tracked soft line break) resolves as a
    // run does — reject drops it, accept strips the id; then any formatting tags it
    // carries (a VISIBLE field embed in a formatting range) whose ids are resolved.
    const ins = inSet(item.attrs[INSERTION_SUGGESTION_ATTR]);
    if (ins && mode === "reject") return { op: "drop" };
    const base = ins ? attrsWithout(item.attrs, INSERTION_SUGGESTION_ATTR) : item.attrs;
    const attrs = resolveFormattingInSet(base, mode, doc, inSet);
    return attrs === item.attrs ? { op: "keep" } : { op: "rewrite", attrs };
  };
  return runResolve(state, idSet, (sid) => (idSet.has(sid) ? mode : null), classify, carriers);
}

/**
 * ACCEPT every suggestion of one GROUP (a host proposal, or a single suggestion — a group
 * of one, see `suggestionGroupOf`) in ONE transaction: one undo step. Per-run resolution
 * follows {@link acceptAll}'s dominance rules restricted to the group's ids; a co-tenant
 * suggestion outside the group survives (or is cleaned up if it loses all its content).
 * Identity no-op when the group has no records.
 */
export function acceptSuggestionGroup(state: State, groupId: string): OperationResult {
  return resolveAll(state, "accept", groupMemberIds(state, groupId));
}

/** REJECT every suggestion of one group in one transaction (inverse of {@link acceptSuggestionGroup}). */
export function rejectSuggestionGroup(state: State, groupId: string): OperationResult {
  return resolveAll(state, "reject", groupMemberIds(state, groupId));
}

/** The record ids of group `groupId` (`suggestionGroupOf(record) === groupId`). */
function groupMemberIds(state: State, groupId: string): Set<SuggestionId> {
  const doc = state[STATE_INTERNAL].doc;
  const out = new Set<SuggestionId>();
  for (const key of getSuggestionsMap(doc).keys()) {
    const record = readSuggestionRecord(doc, key as SuggestionId);
    if (record !== null && suggestionGroupOf(record) === groupId) out.add(record.id);
  }
  return out;
}

/** Outcome of {@link rebuildBlockForDeletion}: the new items + whether any run was tagged. */
interface DeletionRebuild {
  readonly items: InlineItem[];
  readonly tagged: boolean;
  /** True iff anything changes (a run tagged or an own insertion removed). */
  readonly changed: boolean;
}

/**
 * Build one block's new `InlineItem[]` for a suggested deletion over local
 * `[rangeStart, rangeEnd)`. Walks `items` with an offset cursor:
 *   - an item WHOLLY OUTSIDE the range → kept as-is.
 *   - a text item overlapping the range → split into out-before / in-range /
 *     out-after; the out-portions are reissued with the ORIGINAL attrs; the
 *     in-range portion is either DROPPED (own-insertion — it carries an
 *     `insertionSuggestionId` whose record author === `author`) or re-emitted with
 *     `deletionSuggestionId = id` merged into its attrs (everything else: plain
 *     text, or a DIFFERENT author's insertion → nesting).
 *   - an EMBED in range → kept as-is, untagged (embeds are not tracked).
 *
 * `tagged` is true iff ≥1 in-range portion received the deletion attr (drives the
 * record write — a whole-range-own-insertions delete tags nothing). Caller runs
 * `mergeAdjacentTextItems` over the returned items.
 *
 * Survives the migration to {@link applyDeletionStrikeInTx}: (a)
 * `planMarkDeletion` (shared by `markDeletion` and the composite suggesting ops)
 * builds each block's planned items with it, and (b) it is the pure-function ORACLE the equivalence tests diff the surgical
 * applier against. EXPORTED for the oracle-diff test
 * (`deletion-strike-applier.test.ts`).
 */
export function rebuildBlockForDeletion(
  items: ReadonlyArray<InlineItem>,
  rangeStart: number,
  rangeEnd: number,
  id: SuggestionId,
  author: string,
  doc: Y.Doc,
  removedMarkers: ReadonlySet<number> = new Set(),
): DeletionRebuild {
  const out: InlineItem[] = [];
  let tagged = false;
  let changed = false;
  let cursor = 0;
  for (const item of items) {
    const len = item.kind === "text" ? item.text.length : 1;
    const itemStart = cursor;
    const itemEnd = cursor + len;
    cursor = itemEnd;

    // An embed the strike deletes (`deletedUnits`): an own inserted embed, or a marker the
    // bookmark deletion rule removes with the own insertions.
    if (item.kind !== "text" && removedMarkers.has(itemStart)) {
      changed = true;
      continue;
    }

    // Wholly outside the range — keep as-is.
    if (itemEnd <= rangeStart || itemStart >= rangeEnd) {
      out.push(item);
      continue;
    }

    // An embed (always length 1, so wholly in range here): the deleter's own pending
    // inserted embed (a tracked soft line break) goes for real; any other is kept
    // untagged (embed / inline-object soft-deletion is not tracked).
    if (item.kind !== "text") {
      if (isOwnInsertion(item, author, doc)) changed = true;
      else out.push(item);
      continue;
    }

    const localStart = Math.max(0, rangeStart - itemStart);
    const localEnd = Math.min(len, rangeEnd - itemStart);
    const before = item.text.slice(0, localStart);
    const middle = item.text.slice(localStart, localEnd);
    const after = item.text.slice(localEnd);

    if (before.length > 0) {
      out.push({ kind: "text", text: before, attrs: item.attrs });
    }

    if (isOwnInsertion(item, author, doc)) {
      // The deleter's OWN pending insertion — remove the in-range portion for
      // real (omit it). It never became real text.
      changed = true;
    } else if (hasLiveDeletion(item.attrs, doc)) {
      // Already suggested for deletion (any author): left untouched, exactly like a ¶
      // that carries a live deletion (`markDeletionOf` "keep").
      out.push({ kind: "text", text: middle, attrs: item.attrs });
    } else {
      out.push({
        kind: "text",
        text: middle,
        attrs: { ...item.attrs, [DELETION_SUGGESTION_ATTR]: id },
      });
      tagged = true;
      changed = true;
    }

    if (after.length > 0) {
      out.push({ kind: "text", text: after, attrs: item.attrs });
    }
  }
  return { items: out, tagged, changed };
}

/** True iff `attrs` carry a deletion id whose record exists (a live deletion). */
function hasLiveDeletion(attrs: ReadonlyAttrs, doc: Y.Doc): boolean {
  const raw = attrs[DELETION_SUGGESTION_ATTR];
  return typeof raw === "string" && getSuggestionsMap(doc).has(raw);
}

/**
 * True iff `attrs` carries an `insertionSuggestionId` whose record is an `insertion`
 * by `author` — the deleter's OWN pending insertion, which a suggested deletion
 * removes FOR REAL rather than tagging. Attrs-level core shared by the pure
 * `rebuildBlockForDeletion` and the surgical `applyDeletionStrikeInTx`.
 */
function isOwnInsertionAttrs(
  attrs: ReadonlyAttrs,
  author: string,
  doc: Y.Doc,
): boolean {
  const raw = attrs[INSERTION_SUGGESTION_ATTR];
  if (typeof raw !== "string") return false;
  const record = readSuggestionRecord(doc, raw as SuggestionId);
  return record !== null && record.kind === "insertion" && record.author === author;
}

/** {@link isOwnInsertionAttrs} for a whole `InlineItem` (a text run or an embed revision). */
function isOwnInsertion(item: InlineItem, author: string, doc: Y.Doc): boolean {
  return isOwnInsertionAttrs(item.attrs, author, doc);
}

/**
 * Identity-preserving deletion strike over the blocks of one suggested deletion, each
 * on its `[rangeStart, rangeEnd)`, as offset writes: each in-range TEXT run is either
 * tagged with the deletion id (`format` — its characters keep their CRDT identity)
 * or, when it is the deleter's OWN pending insertion, deleted for real (an own inserted
 * embed too); other embeds in range are kept untagged. The real deletions of every
 * block go through ONE `deleteUnits` with the plan's `removedBookmarks` (the bookmark
 * deletion rule over all of them). The resulting content equals each write's planned
 * `items` (`rebuildBlockForDeletion`). Returns whether any run was TAGGED (a
 * cross-check against the plan's `taggedAny`). MUST run inside an open transaction.
 */
export function applyDeletionStrikeInTx(
  doc: Y.Doc,
  writes: readonly { readonly blockId: BlockId; readonly rangeStart: number; readonly rangeEnd: number }[],
  id: SuggestionId,
  author: string,
  opName: string,
  removedBookmarks: ReadonlySet<string>,
): { tagged: boolean } {
  requireInTransaction(doc, opName);
  let tagged = false;
  const drops: ContentSpan[] = [];
  for (const w of writes) {
    const yText = blockText(doc, w.blockId);
    if (yText === null || w.rangeStart >= w.rangeEnd) continue;
    // ONE read of the block; the range is snapped OUT to grapheme boundaries once and
    // every tag / drop below uses those offsets (formats shift nothing).
    const items = inlineItemsFromYText(yText);
    const [start, end] = snapRange(items, w.rangeStart, w.rangeEnd);
    let pos = 0;
    for (const item of items) {
      const len = item.kind === "text" ? item.text.length : 1;
      const lo = Math.max(pos, start);
      const hi = Math.min(pos + len, end);
      if (lo < hi && isOwnInsertionAttrs(item.attrs, author, doc)) {
        drops.push({ id: w.blockId, from: lo, to: hi, items });
      } else if (item.kind === "text" && lo < hi && !hasLiveDeletion(item.attrs, doc)) {
        // A run already carrying a live deletion (any author) is left untouched.
        tagged = true;
        yText.format(lo, hi - lo, { [DELETION_SUGGESTION_ATTR]: id });
      }
      pos += len;
      if (pos >= end) break;
    }
  }
  deleteUnits(doc, { spans: drops, removedBookmarks });
  return { tagged };
}

/** Outcome of the pure coalesce computation: the effective id to stamp + whether it reuses an existing record. */
interface CoalesceDecision {
  readonly id: SuggestionId;
  readonly reusing: boolean;
}

/** A record predicate parameterizing the coalesce decision per op (formatting vs deletion). */
type CoalescePredicate = (
  record: NonNullable<ReturnType<typeof readSuggestionRecord>>,
) => boolean;

/**
 * Decide whether this mark coalesces into an adjacent suggestion of the SAME
 * dimension (`attrKey`). Inspects the text run IMMEDIATELY BEFORE the normalized
 * span start and IMMEDIATELY AFTER the normalized span end, SAME-BLOCK ONLY (no
 * cross-block coalescing — mirror comments). A neighbor coalesces when it is a
 * `text` item carrying an `attrKey` id whose record satisfies `matches` (per-op:
 * same-author/same-proposal for formatting, same-author for deletion). The BEFORE
 * neighbor is preferred. On coalesce → reuse the neighbor's id (`reusing: true`);
 * otherwise → mint via `mintId` (`reusing: false`).
 */
function resolveCoalesce(
  state: State,
  span: Span,
  mintId: SuggestionId,
  attrKey: string,
  matches: CoalescePredicate,
  noCoalesce = false,
): CoalesceDecision {
  if (noCoalesce) return { id: mintId, reusing: false };
  const start = spanStart(state, span);
  const end = spanEnd(state, span);

  const beforeIds = neighborSuggestionIds(state, start.blockId, start.offset - 1, attrKey);
  const afterIds = neighborSuggestionIdsAfter(state, end.blockId, end.offset, attrKey);

  // Prefer the BEFORE neighbor when both coalesce.
  for (const candidate of [...beforeIds, ...afterIds]) {
    if (coalesces(state, candidate, matches)) {
      return { id: candidate, reusing: true };
    }
  }
  return { id: mintId, reusing: false };
}

/**
 * The `attrKey` suggestion ids of the text run CONTAINING document offset
 * `containedOffset` in `blockId`; empty when `containedOffset < 0`, the
 * block is absent/non-leaf, or the containing item is not a text run carrying the
 * attr. Used for the BEFORE neighbor (the run holding `start.offset - 1`).
 */
function neighborSuggestionIds(
  state: State,
  blockId: BlockId,
  containedOffset: number,
  attrKey: string,
): SuggestionId[] {
  if (containedOffset < 0) return [];
  const content = resolveBlock(state, blockId)?.block.inlineContent ?? null;
  if (content === null) return [];
  let cursor = 0;
  for (const item of content.items) {
    const len = item.kind === "text" ? item.text.length : 1;
    const itemStart = cursor;
    const itemEnd = cursor + len;
    if (containedOffset >= itemStart && containedOffset < itemEnd) {
      return textItemSuggestionIds(item, attrKey);
    }
    cursor = itemEnd;
  }
  return [];
}

/**
 * The `attrKey` suggestion ids of the text run that STARTS at document offset
 * `startOffset` in `blockId`; empty when no item starts there (e.g.
 * `startOffset` is at/after end-of-block, or the run there is not a text item
 * carrying the attr). Used for the AFTER neighbor (the run beginning at
 * `end.offset`).
 */
function neighborSuggestionIdsAfter(
  state: State,
  blockId: BlockId,
  startOffset: number,
  attrKey: string,
): SuggestionId[] {
  const content = resolveBlock(state, blockId)?.block.inlineContent ?? null;
  if (content === null) return [];
  let cursor = 0;
  for (const item of content.items) {
    if (cursor === startOffset) {
      return textItemSuggestionIds(item, attrKey);
    }
    cursor += item.kind === "text" ? item.text.length : 1;
    if (cursor > startOffset) break; // passed the boundary — no item starts exactly here
  }
  return [];
}

/**
 * The `attrKey`-dimension suggestion ids of a text item (empty for an embed). The
 * formatting dimension is per-id tags, so a run can hold several candidates.
 */
function textItemSuggestionIds(
  item: { readonly kind: "text" | "embed"; readonly attrs: ReadonlyAttrs },
  attrKey: string,
): SuggestionId[] {
  if (item.kind !== "text") return [];
  if (attrKey === FORMATTING_SUGGESTION_ATTR) return formattingSuggestionIds(item.attrs);
  const raw = item.attrs[attrKey];
  return typeof raw === "string" ? [raw as SuggestionId] : [];
}

/**
 * True iff the suggestion `id` resolves to a record satisfying `matches` (the
 * per-op coalesce predicate). Shared by `markFormatting` (same-author /
 * same-proposal) and `markDeletion` (same-author).
 */
function coalesces(state: State, id: SuggestionId, matches: CoalescePredicate): boolean {
  const record = readSuggestionRecord(state[STATE_INTERNAL].doc, id);
  // A grouped suggestion (a host proposal) is a closed reviewable unit: never extended.
  return record !== null && record.groupId === undefined && matches(record);
}

/**
 * Put suggestions `ids` into group `groupId` with `metadata` (host proposals). A
 * side-table-only write (the record maps), so it surfaces the root as dirty; one
 * tracked transaction. Ids without a record are skipped; identity no-op when none.
 */
export function assignSuggestionGroup(
  state: State,
  ids: ReadonlyArray<SuggestionId>,
  groupId: string,
  metadata: Readonly<Record<string, unknown>> | undefined,
  perId?: ReadonlyMap<SuggestionId, Readonly<Record<string, unknown>>>,
): OperationResult {
  const map = getSuggestionsMap(state[STATE_INTERNAL].doc);
  const present = ids.filter((id) => map.get(id) !== undefined);
  if (present.length === 0) return { state, dirtyIds: NO_DIRTY };
  return applyOperation(state, (doc) => {
    const records = getSuggestionsMap(doc);
    for (const id of present) {
      const yRecord = records.get(id);
      if (yRecord === undefined) continue;
      yRecord.set("groupId", groupId);
      const own = perId?.get(id);
      const merged = own === undefined ? metadata : { ...(metadata ?? {}), ...own };
      if (merged !== undefined) yRecord.set("metadata", merged);
    }
    return new Set<BlockId>([state.rootId]);
  });
}

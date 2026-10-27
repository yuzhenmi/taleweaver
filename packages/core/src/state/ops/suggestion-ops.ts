import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import type { Position, Span } from "../block-position";
import { createSpan, createPosition } from "../block-position";
import { spanStart, spanEnd } from "../block-compare";
import type { ReadonlyAttrs } from "../attrs";
import { attrsEqual } from "../attrs";
import {
  inlineContentLength,
  mergeAdjacentTextItems,
  splitInlineContentAtOffset,
  type EmbedItem,
  type InlineItem,
  type TextItem,
} from "../inline-content";
import {
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
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
  readSuggestionRecord,
  writeSuggestionRecordInTx,
  type SuggestionId,
  type SuggestionKind,
  type SuggestionMintInput,
  type SuggestionRecord,
} from "../suggestions";
import { iterateAllBlocksInDocumentOrder } from "../document-order";
import type { BlockRange } from "../span-iteration";
import { insertNewBlocksInTx, type NewBlockSpec } from "./insert-new-blocks";
import type { SiblingBlockInit } from "./insert-blocks-after";
import { STATE_INTERNAL } from "../state-internal";
import { getSuggestionsMap, getYBlock, requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import {
  attrsDiff,
  inlineItemsFromYText,
  insertInlineItems,
  readYInline,
  requireYInline,
  snapOffset,
  snapRange,
  toYFormatDelta,
} from "../y-inline";
import { planApplyAttrsToRange, applyAttrsToRangeInTx } from "./apply-attrs";
import { planInsertText, insertTextInTx } from "./insert-text";
import {
  planInsertItemsAt,
  planReplaceBlockTail,
  insertItemsInTx,
  type InsertItemsPlan,
} from "./insert-items";
import {
  planSplitBlockAtPosition,
  splitBlockAtPositionInTx,
  splitWithSuggestion,
} from "./split-block";
import { mergeWithNextSiblingLiveInTx } from "./merge-blocks";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../../cascade/attr-registry";
import type { ResolvedBlockKind } from "../state";
import { isDevMode } from "../dev-mode";

/** An empty dirtyIds set — the identity-no-op return per the T7 contract. */
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
 * the editor short-circuits per the T7 contract): empty `proposedAttrs`; a
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
    applyAttrsToRangeInTx(doc, plan, { [key]: true }, undefined);
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
 * Embeds inside the span are OUT OF SCOPE for this slice: they are preserved in
 * place, UNTAGGED. (Embed / inline-object soft-deletion is a named follow-up —
 * the range model scans suggestion attrs only on text items + break-embed
 * `properties`, so a generic embed attr would be invisible anyway.)
 *
 * Unlike {@link markFormatting} this does NOT compose `applyAttrsToRangeInTx`:
 * that applier would tag embeds too AND cannot selectively DROP the own-insertion
 * runs. Instead it plans the per-owning-block strike ranges PRE-transaction (pure
 * {@link planMarkDeletion}), then applies them IN the transaction via the surgical
 * {@link applyDeletionStrikeInTx} (#491): whole-covered runs get the deletion attr
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
 * the editor short-circuits per the T7 contract): a collapsed span, or
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
  // Collapsed span / nothing to mark → identity no-op (the input State reference).
  if (plan === null) {
    return { state, dirtyIds: NO_DIRTY };
  }

  return applyOperation(state, (d) => {
    // Surgical, identity-preserving strike per block (#491): mutate only the
    // changed runs in place (untouched runs keep their Y.Text CRDT identity),
    // replacing the old full-replace seam.
    let anyTagged = false;
    for (const write of plan.writes) {
      const { tagged } = applyDeletionStrikeInTx(
        d,
        write.blockId,
        plan.kind,
        write.rangeStart,
        write.rangeEnd,
        plan.id,
        input.author,
        "markDeletion",
      );
      anyTagged ||= tagged;
    }
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
  const writes: {
    blockId: BlockId;
    rangeStart: number;
    rangeEnd: number;
    items: ReadonlyArray<InlineItem>;
  }[] = [];
  let taggedAny = false;
  for (const seg of plan.segments) {
    if (seg.rangeStart >= seg.rangeEnd) continue; // zero-width range in this block
    const content = seg.block.inlineContent;
    if (content === null) continue; // defensive — iterateSpan only yields leaves
    const result = rebuildBlockForDeletion(
      content.items,
      seg.rangeStart,
      seg.rangeEnd,
      id,
      input.author,
      doc,
    );
    if (result.tagged) taggedAny = true;
    writes.push({
      blockId: seg.block.id,
      rangeStart: seg.rangeStart,
      rangeEnd: seg.rangeEnd,
      items: mergeAdjacentTextItems(result.items),
    });
  }

  return { writes, taggedAny, id, reusing, kind: plan.kind };
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
  }[];
  /** True iff ≥1 in-range run received the deletion attr (drives the record write). */
  readonly taggedAny: boolean;
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
 * the editor short-circuits per the T7 contract): empty `text`. Mirrors
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
 * span is re-minted. The strike never changes content before the selection start,
 * so the start offset is the post-strike seam and the suggested run is inserted
 * there with one offset insert.
 *
 * The new run lands at `start.offset` — BEFORE the struck selection text — and
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
 * The caller computes the resulting cursor (`start.offset + text.length`) itself —
 * that is the editor's job (the next change-tracking slice); this op only mutates
 * state.
 *
 * `registry` (optional): an `AttrRegistry`; threaded to the insert plan's run-merge
 * so interpreters with a custom per-key `equals` opt into custom adjacent-item
 * compare semantics. Omitted → deep-value compare.
 */
export function replaceWithSuggestion(
  state: State,
  span: Span,
  text: string,
  attrs: ReadonlyAttrs,
  input: ReplaceSuggestionInput,
  registry?: AttrRegistry,
): OperationResult {
  // Degenerate: nothing to insert → a pure suggested deletion of the selection.
  if (text === "") {
    return markDeletion(state, span, {
      id: input.deletionId,
      author: input.author,
      createdAt: input.createdAt,
      order: input.order,
    });
  }

  // Degenerate: collapsed span → nothing to strike, a pure suggested insertion.
  if (
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset
  ) {
    return mintInsertion(state, span.anchor, text, attrs, {
      id: input.insertionId,
      author: input.author,
      createdAt: input.createdAt,
      order: input.order,
    });
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
  const start = spanStart(state, span);
  if (delPlan === null) {
    return mintInsertion(state, start, text, attrs, {
      id: input.insertionId,
      author: input.author,
      createdAt: input.createdAt,
      order: input.order,
    });
  }

  // Insertion coalesce decision — computed against the PRE-strike `state` (the
  // strike never alters the run before `start`, so a same-author insertion
  // neighbor there is still valid). Mirrors `mintInsertion`'s collapsed-span probe.
  const { id: insId, reusing: reusingIns } = resolveCoalesce(
    state,
    createSpan(start, start),
    input.insertionId,
    INSERTION_SUGGESTION_ATTR,
    (record) => record.kind === "insertion" && record.author === input.author,
    input.noCoalesce,
  );

  // Stamp the resolved insertion id over the intended live format. OVERWRITES only
  // `insertionSuggestionId` (any stale caller value is replaced by the resolved id).
  const insertAttrs: ReadonlyAttrs = { ...attrs, [INSERTION_SUGGESTION_ATTR]: insId };

  // The suggested run lands at `start.offset` — an offset insert AFTER the strike.
  // The strike never changes content before `start` (it tags in place and only
  // removes the author's own insertions INSIDE the span), so `start.offset` is the
  // post-strike seam too. `planInsertText` validates against the pre-strike state.
  const insertPlan = planInsertText(state, start, text, insertAttrs, registry);

  return applyOperation(state, (d) => {
    // Strike every struck block, then insert the suggested run at the seam.
    for (const write of delPlan.writes) {
      applyDeletionStrikeInTx(
        d,
        write.blockId,
        delPlan.kind,
        write.rangeStart,
        write.rangeEnd,
        delPlan.id,
        input.author,
        "replaceWithSuggestion",
      );
    }
    insertTextInTx(d, insertPlan);
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
 * the strike, the structural split, the `block-split-suggestion` embed, and BOTH
 * records (a `deletion` and an `insertion`) land as ONE undo entry and one collab
 * event.
 *
 * Composes {@link planMarkDeletion} (the strike plan) with the structural
 * {@link planSplitBlockAtPosition} + {@link splitBlockAtPositionInTx}, then APPENDS a
 * zero-width {@link BLOCK_SPLIT_SUGGESTION_EMBED_TYPE} embed to block N's inline
 * `Y.Text` — exactly the {@link splitWithSuggestion} embed-append discipline.
 *
 * SINGLE-BLOCK scope: the editor caller guarantees `spanStart.blockId ===
 * spanEnd.blockId` (a cross-block Enter-over-selection needs block-JOIN suggestions
 * for the intervening paragraph breaks — the same multi-block-suggestion machinery
 * paste-as-suggestion needs — and is gated to a no-op in the caller). This op stays
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
 * split materializes N+1 from B's post-strike LIVE content `[splitOffset, postLen)`
 * (the unstruck tail), leaving the struck selection in N.
 *
 * Append discipline: the strike writes B's inline `Y.Text` in place (`format` tags
 * on the struck text, deletes of own-insertions), so the split reads B's POST-strike
 * live content. `splitBlockAtPositionInTx` then cuts B to `[0, splitOffset)` with one
 * offset delete; this op then APPENDS just the zero-width break embed (one offset
 * insert) — no surviving character of B is re-minted. N+1 + the sibling rewiring stay
 * as the split left them.
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
 * `newBlockInit` overrides N+1's `type` / `attrs` (the heading→paragraph follow-on
 * hook), threaded through to {@link planSplitBlockAtPosition} unchanged.
 */
export function splitWithSuggestionOverSelection(
  state: State,
  rawSpan: Span,
  allocator: IdAllocator,
  input: ReplaceSuggestionInput,
  newBlockInit?: { readonly type?: string; readonly attrs?: ReadonlyAttrs },
): OperationResult {
  // Snapped ONCE: the strike, the split offset and the break embed share one cut.
  const span = snapSpanOut(state, rawSpan);
  const start = spanStart(state, span);
  const end = spanEnd(state, span);
  const blockB = start.blockId; // === end.blockId for a single-block span.

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

  // The POST-strike items of B. If B has no strike write (the selection struck
  // nothing IN B itself — defensive, e.g. a same-block zero-width range), B's
  // post-strike items are its live pre-strike items.
  const bWrite = delPlan.writes.find((w) => w.blockId === blockB);
  const bItems: ReadonlyArray<InlineItem> = bWrite
    ? bWrite.items
    : resolvedB.block.inlineContent.items;

  // Post-strike split offset (robust to own-insertion removal shortening B):
  //   tailLen   = the unchanged content after the selection (the strike never
  //               touches [end, preLen)).
  //   splitOffset = postLen - tailLen.
  const preLen = inlineContentLength(resolvedB.block.inlineContent);
  const tailLen = preLen - end.offset;
  const postLen = inlineContentLength({ items: bItems });
  const splitOffset = postLen - tailLen;

  // Plan the structural split at the post-strike offset. The plan validates the
  // offset against the PRE-strike state (totalLen = preLen); since the unstruck
  // tail [end.offset, preLen) is untouched, postLen >= tailLen so splitOffset >= 0,
  // and splitOffset <= postLen <= preLen — always within [0, preLen], so it passes.
  // The plan allocates N+1's id + computes the sibling rewiring.
  const splitPlan = planSplitBlockAtPosition(
    state,
    createPosition(blockB, splitOffset),
    allocator,
    newBlockInit,
  );

  // The zero-width break embed carrying the insertion suggestion id, built as plain
  // data PRE-transaction. It is a merge BARRIER (never folded into a neighbor), so
  // after the in-place split (which leaves B's content normalized as [0, splitOffset))
  // appending it keeps B normalized and the embed stays last.
  const embed: EmbedItem = Object.freeze({
    kind: "embed",
    embedType: BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
    attrs: Object.freeze({}),
    properties: Object.freeze({ suggestionId: input.insertionId }),
  });

  return applyOperation(state, (doc) => {
    // 1. Apply the strike writes (B written BEFORE the split so the split reads
    //    B's post-strike content). For a single-block span this is just B: offset
    //    `format` / `delete` writes on its inline Y.Text.
    for (const w of delPlan.writes) {
      applyDeletionStrikeInTx(
        doc,
        w.blockId,
        delPlan.kind,
        w.rangeStart,
        w.rangeEnd,
        delPlan.id,
        input.author,
        "splitWithSuggestionOverSelection",
      );
    }
    // 2. The REAL structural split: materializes N+1 from B's now-post-strike LIVE
    //    content [splitOffset, postLen) (the unstruck tail) + rewires siblings; cuts
    //    B to [0, splitOffset) with one offset delete.
    splitBlockAtPositionInTx(doc, splitPlan);
    // 3. APPEND just the break embed to B's inline Y.Text (one offset insert). N+1 +
    //    the rewiring stay as the split left them.
    const yB = getYBlock(doc, blockB, "splitWithSuggestionOverSelection", splitPlan.kind);
    const yBText = requireYInline(yB, blockB, "splitWithSuggestionOverSelection");
    insertInlineItems(yBText, yBText.length, [embed]);
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
// block-split-suggestion embeds), and any non-collapsed selection is SOFT-DELETED
// (struck) with the crossed paragraph boundaries suggested as block-JOINs — so
// accept re-flows the merged paragraph and reject restores the original split.
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
  readonly newBlocks: readonly NewBlockSpec[];
  readonly records: readonly SuggestionRecord[];
  readonly endPosition: Position;
  /**
   * The start block B's pre-tx insert plan. Non-null for the start block whenever a line
   * is inserted into B: `n===1` (S3) is an offset `insert` of line0 at offset `c`
   * resolved against B's POST-strike content; `n>1` (S4) is a `replace-tail` against B's
   * ORIGINAL pre-strike items that keeps [0:c], drops the rest, and appends line0 +
   * split-embed (B's struck tail relocates by value into the last new block — B is NOT
   * struck in place). `null` ONLY for `n===0` (no insertion into B).
   */
  readonly bInsertPlan: InsertItemsPlan | null;
  /**
   * The fragment's line count `n`. The applier dispatches the START block on it — B is
   * surgical for ALL n: `n===0` ⇒ strike only; `n===1` ⇒ strike + offset-insert line0 via
   * `bInsertPlan`; `n>1` ⇒ `replace-tail` truncation via `bInsertPlan` (no strike, no
   * join — both relocate into the last new block).
   */
  readonly fragmentLength: number;
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

/** The zero-width block-split-suggestion embed for a fragment's internal break. */
function buildSplitSuggestionEmbed(insId: SuggestionId): EmbedItem {
  return Object.freeze({
    kind: "embed",
    embedType: BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
    attrs: Object.freeze({}),
    properties: Object.freeze({ suggestionId: insId }),
  });
}

/**
 * The zero-width block-JOIN-suggestion embed for a deletion-suggested paragraph
 * break (a crossed boundary inside a struck cross-block selection). Carries the
 * DELETION id: on accept the deletion DOES the join (the two blocks merge); on
 * reject the break is KEPT (the soft-deleted blocks stay separate). The merge
 * semantics live in {@link resolve}'s `breakMerge`.
 */
function buildJoinSuggestionEmbed(delId: SuggestionId): EmbedItem {
  return Object.freeze({
    kind: "embed",
    embedType: BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
    attrs: Object.freeze({}),
    properties: Object.freeze({ suggestionId: delId }),
  });
}

/**
 * Returns the trackable inline items for a fragment line: content embeds
 * (image, tab, inline hard-break, …) are DROPPED because the resolve layer's
 * invariant (`:1853`) only allows insertion/deletion tags on TEXT runs.
 * Block-split/join suggestion embeds minted by this op are NOT content embeds
 * and are NOT present in incoming `line.inlineContent` — but we guard with
 * {@link isBreakEmbed} to be explicit. Both {@link fragmentLineItems} and
 * {@link fragmentLineLength} MUST consume the output of this filter so that the
 * tagged items and the caret offset stay in sync.
 */
function filterLineContentItems(line: SiblingBlockInit): ReadonlyArray<InlineItem> {
  const raw = line.inlineContent?.items ?? [];
  return raw.filter((item) => item.kind !== "embed" || isBreakEmbed(item));
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
  registry?: AttrRegistry,
): ReplaceFragmentPlan {
  // Snapped ONCE: the strike range, the prefix cut `c`, the insert and the moved tail
  // all use the same grapheme-aligned offsets.
  const span = snapSpanOut(state, rawSpan);
  const at = spanStart(state, span);
  const resolved = resolveBlock(state, at.blockId);
  if (resolved === null || resolved.block.inlineContent === null) {
    throw new Error(
      `planReplaceWithSuggestedFragment: block "${at.blockId}" not found or not a leaf`,
    );
  }
  const kind = resolved.kind;
  const c = at.offset;
  const n = fragment.length;

  // Plan the strike (pure, pre-tx). `null` ⇒ no strike (collapsed span / nothing to
  // strike) — the start block B keeps its plain content and the fragment is a pure
  // suggested insertion at `at` (the PF-1 case). A non-null plan strikes B's tail +
  // any intervening blocks + E's head and (cross-block) suggests JOINing the crossed
  // boundaries so accept re-flows the merged paragraph and reject restores the split.
  const delPlan = planMarkDeletion(state, span, {
    id: input.deletionId,
    author: input.author,
    createdAt: input.createdAt,
    order: input.order,
  });

  // The start block B's prefix [0:c] (untouched by the strike), the bundle that rides
  // into the LAST inserted block (B's struck tail + a cross-block join, or — no strike
  // — B's plain suffix), the writes for OTHER struck blocks (intervening get a join;
  // E does not), and the deletion record (when ≥1 run was tagged and not coalesced).
  let prefix: ReadonlyArray<InlineItem>;
  let tailBundle: ReadonlyArray<InlineItem>;
  const extraWrites: ResolveWrite[] = [];
  let delRecord: SuggestionRecord | null = null;
  // The start block B's surgical-strike coords + whether B's END gets a cross-block
  // JOIN embed appended (used by the n===0 and n===1 appliers). `bRangeStart < bRangeEnd` ⇒ B has a strike (false in the
  // collapsed / nothing-struck-in-B case). `bDeletionId` is the id for BOTH B's strike
  // AND its cross-block join append (so it is non-null whenever `bAppendJoinEmbed`).
  let bDeletionId: SuggestionId | null = null;
  let bRangeStart = 0;
  let bRangeEnd = 0;
  let bAppendJoinEmbed = false;
  if (delPlan === null) {
    const [pfx, sfx] = splitInlineContentAtOffset(
      { items: resolved.block.inlineContent.items },
      c,
    );
    prefix = pfx;
    tailBundle = sfx;
  } else {
    const end = spanEnd(state, span);
    const startBlockId = at.blockId;
    const endBlockId = end.blockId;
    const crossBlock = startBlockId !== endBlockId;
    // B's POST-strike content (prefix [0:c] plain ++ struck tail). If the strike
    // produced no write for B (the selection struck nothing in B itself — e.g. starts
    // at end-of-B), B's live content is unchanged and `c` splits it the same way.
    const bWrite = delPlan.writes.find((w) => w.blockId === startBlockId);
    if (bWrite) {
      bRangeStart = bWrite.rangeStart;
      bRangeEnd = bWrite.rangeEnd;
    }
    bAppendJoinEmbed = crossBlock;
    // The id is needed when B is struck OR when its cross-block join is appended.
    bDeletionId = bWrite || crossBlock ? delPlan.id : null;
    const bItems = bWrite ? bWrite.items : resolved.block.inlineContent.items;
    const [pfx, afterPrefix] = splitInlineContentAtOffset({ items: bItems }, c);
    prefix = pfx;
    tailBundle = crossBlock
      ? [...afterPrefix, buildJoinSuggestionEmbed(delPlan.id)]
      : afterPrefix;
    // Every OTHER struck block: E keeps its struck head + plain tail untouched; an
    // intervening (fully-struck) block additionally carries a JOIN embed so the
    // accept cascade merges it into the flow. One deletion id thus owns k+1 join
    // embeds (k = intervening count) — resolved by `resolve`'s reverse-order merge.
    for (const w of delPlan.writes) {
      if (w.blockId === startBlockId) continue;
      const appendJoinEmbed = w.blockId !== endBlockId;
      const items = appendJoinEmbed
        ? mergeAdjacentTextItems([...w.items, buildJoinSuggestionEmbed(delPlan.id)])
        : w.items;
      extraWrites.push({
        blockId: w.blockId,
        kind: delPlan.kind,
        items,
        rangeStart: w.rangeStart,
        rangeEnd: w.rangeEnd,
        deletionId: delPlan.id,
        appendJoinEmbed,
      });
    }
    if (delPlan.taggedAny && !delPlan.reusing) {
      delRecord = { id: delPlan.id, kind: "deletion", author: input.author, createdAt: input.createdAt, order: input.order };
    }
  }

  // The start block B's write entry (its strike coords + the full-replace `items`, now
  // read ONLY by the test equivalence oracle). `appendJoinEmbed` (= cross-block) is consumed by
  // the n===0 (strike-only) and n===1 (strike + offset-insert) surgical appliers. B is
  // surgical for ALL n now; the n>1 applier truncates B via `bInsertPlan` (replace-tail)
  // and ignores these strike fields (B's struck tail relocates into the last new block).
  const bWriteEntry = (items: ReadonlyArray<InlineItem>): ResolveWrite => ({
    blockId: at.blockId,
    kind,
    items,
    rangeStart: bRangeStart,
    rangeEnd: bRangeEnd,
    deletionId: bDeletionId,
    appendJoinEmbed: bAppendJoinEmbed,
  });

  // Empty fragment: a pure suggested deletion (no insertion). B' = prefix ++ tailBundle
  // (the strike writes, restored as one block); the strike record is the only one.
  if (n === 0) {
    const bItems = mergeAdjacentTextItems([...prefix, ...tailBundle]);
    return {
      writes: [bWriteEntry(bItems), ...extraWrites],
      newBlocks: [],
      records: delRecord === null ? [] : [delRecord],
      endPosition: at,
      bInsertPlan: null,
      fragmentLength: n,
    };
  }

  // Insertion id (spec §3.4): n===1 coalesces into an adjacent same-author insertion;
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
    // Surgical (#492 lockstep): after the applier strikes B in place (the block's inline Y.Text ==
    // `bStrikeItems`), offset-insert line0 at offset `c` resolved against `bStrikeItems`.
    const bInsertPlan = planInsertItemsAt(
      at.blockId,
      kind,
      c,
      fragmentLineItems(line0, insId),
      registry,
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
    };
  }

  // n > 1: B keeps prefix + line0 + split-embed; line_1..line_{n-1} become new blocks,
  // and the tail bundle (struck B-tail + join, or plain suffix) rides into NB_{n-1}.
  const parentId = resolved.block.parentId;
  if (parentId === null) {
    throw new Error(
      `planReplaceWithSuggestedFragment: block "${at.blockId}" is a root (no parent)`,
    );
  }
  const oldNext = resolved.block.nextSiblingId;
  const line0 = fragment[0];
  if (line0 === undefined) {
    throw new Error("planReplaceWithSuggestedFragment: n>1 but fragment[0] missing (unreachable)");
  }
  const nbIds: BlockId[] = [];
  for (let i = 1; i < n; i++) nbIds.push(allocator.allocate());

  // Surgical (S4): TRUNCATE B via a `replace-tail` against B's ORIGINAL pre-strike
  // items — keep B's live [0:c] (identity-preserved; only a run straddling c splits),
  // drop [c:], append line0 + split-embed. B is NOT struck in place (Q1): its struck
  // tail + cross-block join RELOCATE BY VALUE into the LAST new block (baked into
  // `tailBundle`), so a `replace-tail` that deletes [c:] wholesale is sufficient and
  // correct. Striking B first would desync these indices (resolved vs ORIGINAL items).
  // B's [0:c] is strike-untouched, so the kept prefix == `prefix` and final B is
  // byte-identical to the old full-replace `bItems` below.
  const bInsertPlan = planReplaceBlockTail(
    at.blockId,
    kind,
    c,
    [...fragmentLineItems(line0, insId), buildSplitSuggestionEmbed(insId)],
    registry,
  );

  // The full-replace `writes[0].items` — retained ONLY for the test equivalence oracle
  // (the live applier drives B via `bInsertPlan` replace-tail; the new blocks use their own items).
  const bItems = mergeAdjacentTextItems([
    ...prefix,
    ...fragmentLineItems(line0, insId),
    buildSplitSuggestionEmbed(insId),
  ]);

  const newBlocks: NewBlockSpec[] = [];
  for (let i = 1; i < n; i++) {
    const isLast = i === n - 1;
    const fragLine = fragment[i];
    const nbId = nbIds[i - 1];
    if (fragLine === undefined || nbId === undefined) {
      throw new Error(`planReplaceWithSuggestedFragment: fragment/new-block index ${i} missing (unreachable)`);
    }
    const prevSiblingId = i === 1 ? at.blockId : nbIds[i - 2];
    const nextSiblingId = isLast ? oldNext : nbIds[i];
    if (prevSiblingId === undefined || (!isLast && nextSiblingId === undefined)) {
      throw new Error(`planReplaceWithSuggestedFragment: new-block sibling at index ${i} missing (unreachable)`);
    }
    const lineItems = fragmentLineItems(fragLine, insId);
    const blockItems = mergeAdjacentTextItems(
      isLast ? [...lineItems, ...tailBundle] : [...lineItems, buildSplitSuggestionEmbed(insId)],
    );
    newBlocks.push({
      id: nbId,
      kind,
      type: fragLine.type,
      attrs: fragLine.attrs ?? {},
      items: blockItems,
      parentId,
      prevSiblingId,
      nextSiblingId: nextSiblingId ?? null,
    });
  }

  const lastNbId = nbIds[n - 2];
  const lastFragLine = fragment[n - 1];
  if (lastNbId === undefined || lastFragLine === undefined) {
    throw new Error("planReplaceWithSuggestedFragment: last new-block/fragment missing (unreachable)");
  }
  return {
    writes: [bWriteEntry(bItems), ...extraWrites],
    newBlocks,
    records,
    endPosition: createPosition(lastNbId, fragmentLineLength(lastFragLine)),
    bInsertPlan,
    fragmentLength: n,
  };
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
  registry?: AttrRegistry,
): OperationResult & { readonly endPosition: Position } {
  const plan = planReplaceWithSuggestedFragment(state, span, fragment, input, allocator, registry);
  const result = applyOperation(state, (doc) => {
    // Per-block roles. The START block is `plan.writes[0]`; every OTHER write is an
    // intervening block or E. NON-start writes are ALWAYS surgical (#493 S2): strike
    // in place (preserving untouched runs' Y.Text identity) + append the cross-block
    // JOIN embed for interveners. The START block is surgical for ALL n: n===0 strike-
    // only; n===1 strike + offset-insert line0 via `bInsertPlan`; n>1 replace-tail
    // truncation via `bInsertPlan` (no strike — B's struck tail relocates into the last
    // new block). The full-replace seam (`writeBlockInlineContentInTx`) is now GONE:
    // every write in this op preserves untouched runs' Y.Text CRDT identity (#493).
    const firstWrite = plan.writes[0];
    if (firstWrite === undefined) {
      throw new Error("replaceWithSuggestedFragment: plan has no writes (unreachable)");
    }
    const startBlockId = firstWrite.blockId;
    for (const w of plan.writes) {
      const isStart = w.blockId === startBlockId;
      if (isStart && plan.fragmentLength > 1) {
        // n>1: B is TRUNCATED via replace-tail (keep [0:c], drop the rest, append
        // line0 + split-embed). B's struck tail + cross-block join were relocated BY
        // VALUE into the last new block (tailBundle); B itself is NOT struck in place
        // (Q1 — striking would desync the replace-tail indices computed vs the original).
        if (plan.bInsertPlan === null) {
          throw new Error("replaceWithSuggestedFragment: n>1 start block requires bInsertPlan");
        }
        insertItemsInTx(doc, plan.bInsertPlan);
        continue;
      }
      // Surgical: NON-start writes (always); the START block for n===0 (strike only)
      // and n===1 (strike + insert line0 at c). `bInsertPlan` is non-null only for the
      // n===1 start; it is `null` for n===0's start and for every NON-start write.
      const insertPlan = isStart ? plan.bInsertPlan : null;
      applySurgicalFragmentWrite(doc, w, input.author, insertPlan);
    }
    const firstNew = plan.newBlocks[0];
    const lastNew = plan.newBlocks[plan.newBlocks.length - 1];
    if (firstNew !== undefined && lastNew !== undefined) {
      const startBlockId = firstWrite.blockId;
      const kind = firstWrite.kind;
      // Rewire the start block → first new block, and the boundary past the run:
      // the old next sibling's prevSibling (when present), else the parent's
      // lastChildId (the run was appended at the parent's end).
      getYBlock(doc, startBlockId, "replaceWithSuggestedFragment", kind).set(
        "nextSiblingId",
        firstNew.id,
      );
      if (lastNew.nextSiblingId !== null) {
        getYBlock(doc, lastNew.nextSiblingId, "replaceWithSuggestedFragment", kind).set(
          "prevSiblingId",
          lastNew.id,
        );
      } else {
        getYBlock(doc, firstNew.parentId, "replaceWithSuggestedFragment", kind).set(
          "lastChildId",
          lastNew.id,
        );
      }
      insertNewBlocksInTx(doc, plan.newBlocks);
    }
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
  registry?: AttrRegistry,
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
    registry,
  );
}

/**
 * Apply ONE surgical fragment write (#493 S2/S3), in three identity-preserving steps:
 *   1. STRIKE `[w.rangeStart, w.rangeEnd)` in place via {@link applyDeletionStrikeInTx}
 *      when planned (`w.deletionId !== null` with a non-empty range) — preserving the
 *      `Y.Text` identity of every UNTOUCHED run.
 *   2. INSERT `insertPlan` (the start block B's `n===1` line0 offset insert at
 *      `c`, resolved against B's POST-strike content) via {@link insertItemsInTx}.
 *      `null` for n===0's start and every NON-start write. NOTE the n>1 start does NOT
 *      reach here — its `replace-tail` `bInsertPlan` is applied by a dedicated branch in
 *      the loop above (no strike), so this helper only ever sees `insert`-mode plans.
 *   3. APPEND the trailing block-JOIN-suggestion embed (interveners + the cross-block
 *      start block) when `w.appendJoinEmbed`.
 *
 * PF-1 (collapsed span, no strike) reaches here with `w.deletionId === null` but a
 * non-null `insertPlan` — the strike is skipped, the insert still runs.
 */
function applySurgicalFragmentWrite(
  doc: Y.Doc,
  w: ResolveWrite,
  author: string,
  insertPlan: InsertItemsPlan | null,
): void {
  // 1. Strike B's [rangeStart, rangeEnd) in place (#492 lockstep) when planned.
  if (w.deletionId !== null && w.rangeStart < w.rangeEnd) {
    applyDeletionStrikeInTx(
      doc,
      w.blockId,
      w.kind,
      w.rangeStart,
      w.rangeEnd,
      w.deletionId,
      author,
      "replaceWithSuggestedFragment",
    );
  }
  // 2. Insert the fragment's first line at the split offset (n===1 start block).
  if (insertPlan !== null) {
    insertItemsInTx(doc, insertPlan);
  }
  // 3. Append the cross-block JOIN embed at the block's end (interveners + cross-block B).
  if (w.appendJoinEmbed) {
    if (w.deletionId === null) {
      throw new Error("applySurgicalFragmentWrite: appendJoinEmbed requires a deletionId");
    }
    const yBlock = getYBlock(doc, w.blockId, "replaceWithSuggestedFragment", w.kind);
    const yText = requireYInline(yBlock, w.blockId, "replaceWithSuggestedFragment");
    insertInlineItems(yText, yText.length, [buildJoinSuggestionEmbed(w.deletionId)]);
  }
}

export type { NewBlockSpec } from "./insert-new-blocks";

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
 * T7 contract) when no record exists for `id`.
 */
export function acceptSuggestion(
  state: State,
  id: SuggestionId,
  registry?: AttrRegistry,
): OperationResult {
  return resolve(state, id, "accept", registry);
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
  registry?: AttrRegistry,
): OperationResult {
  return resolve(state, id, "reject", registry);
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
 * collapsed / nothing-struck PF-1 case) and `rangeStart`/`rangeEnd` are 0.
 * `appendJoinEmbed` is true only for an INTERVENING (fully-struck) block, whose
 * struck content gets a trailing block-JOIN-suggestion embed after the strike.
 */
export interface ResolveWrite {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly items: ReadonlyArray<InlineItem>;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly deletionId: SuggestionId | null;
  readonly appendJoinEmbed: boolean;
}

/**
 * A per-owning-block decision list for the resolve path. Distinct from
 * {@link ResolveWrite} (which carries rebuilt `items` and remains in use by the
 * fragment-replace create-op path): a resolve never rebuilds a block's content — it
 * applies per-item decisions as offset writes on the block's inline `Y.Text`.
 * `decisions[k]` corresponds to the pre-resolve snapshot item k.
 */
interface ResolveDecisionWrite {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly items: ReadonlyArray<InlineItem>;
  readonly decisions: readonly ScanItemResult[];
}

/**
 * True iff `item` is one of the two break-suggestion embeds (a zero-width
 * {@link BLOCK_SPLIT_SUGGESTION_EMBED_TYPE} / {@link BLOCK_JOIN_SUGGESTION_EMBED_TYPE}
 * appended to the END of an owning block, carrying its id on
 * `properties.suggestionId`). Centralizes the kind+embedType narrowing the resolve
 * scans need before reading `properties.suggestionId` (the type guard also narrows
 * `item` to {@link EmbedItem} for the callers).
 */
function isBreakEmbed(item: InlineItem): item is EmbedItem {
  return (
    item.kind === "embed" &&
    (item.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE ||
      item.embedType === BLOCK_JOIN_SUGGESTION_EMBED_TYPE)
  );
}

/**
 * Per-item decision for the shared resolve scan ({@link resolveBlockScan}).
 *
 * EXPORTED: Task 2's `applyResolveDecisionsInTx` is exported (its sibling test
 * calls it directly) and takes `decisions: readonly ScanItemResult[]`. Because the
 * core package's tsconfig has `"declaration": true`, an exported function
 * referencing a non-exported type fails the build with TS4023; exporting the type
 * mirrors the `apply-attrs.ts` precedent (exported `applyAttrsToRangeInTx` over the
 * exported `ApplyAttrsToRangePlan`).
 */
export type ScanItemResult =
  // keep item as-is (untouched).
  | { readonly op: "keep" }
  // touched: replace ONLY this item's attrs (text/embedType/properties unchanged
  // — every resolve rewrite is attrs-only, so the applier formats the item's range
  // in place, identity-preserving).
  | { readonly op: "rewrite"; readonly attrs: ReadonlyAttrs }
  // touched: omit this run (real delete).
  | { readonly op: "drop" }
  // touched: a break embed → drop it; `merge` ⇒ record this owner for phase-2.
  | { readonly op: "breakDrop"; readonly merge: boolean };

/**
 * Identity-preserving resolve applier (#484). `decisions[k]` applies to snapshot
 * item `items[k]` (the pre-resolve read model of the block); each is applied as an
 * OFFSET write on the block's inline `Y.Text`:
 *   - keep    → nothing.
 *   - rewrite → `format` the item's range with the attrs diff (old → new): the
 *               characters keep their CRDT identity.
 *   - drop / breakDrop → delete the item's range.
 * Formats never shift offsets, so all rewrites run first; drops then run in
 * DESCENDING offset order so each delete leaves the earlier offsets valid. MUST run
 * inside an already-open transaction.
 */
export function applyResolveDecisionsInTx(
  doc: Y.Doc,
  blockId: BlockId,
  kind: BlockTreeKind,
  items: ReadonlyArray<InlineItem>,
  decisions: readonly ScanItemResult[],
  registry: AttrRegistry | undefined,
): void {
  requireInTransaction(doc, "resolveSuggestion");
  const yBlock = getYBlock(doc, blockId, "resolveSuggestion", kind);
  const yText = readYInline(yBlock, blockId);
  if (yText === null) return; // defensive — scan only yields leaves

  const drops: { start: number; end: number }[] = [];
  let pos = 0;
  decisions.forEach((d, k) => {
    const item = items[k];
    if (item === undefined) return;
    const len = item.kind === "text" ? item.text.length : 1;
    if (d.op === "rewrite") {
      // A rewrite never targets a structural marker (markers carry no provenance),
      // and item boundaries are grapheme-aligned — format the item's range directly.
      const delta = toYFormatDelta(attrsDiff(item.attrs, d.attrs, registry));
      if (Object.keys(delta).length > 0) yText.format(pos, len, delta);
    } else if (d.op === "drop" || d.op === "breakDrop") {
      drops.push({ start: pos, end: pos + len });
    }
    pos += len;
  });
  // Item boundaries of the one snapshot read: raw deletes, no per-drop re-read.
  for (let i = drops.length - 1; i >= 0; i--) {
    const r = drops[i];
    if (r !== undefined) yText.delete(r.start, r.end - r.start);
  }
}

/**
 * Shared block-scan for {@link resolve} / {@link resolveAll}: walks blocks across
 * ALL THREE trees (main, then each `embedContents` body, then each
 * `templateContents` body) in document order via {@link iterateAllBlocksInDocumentOrder},
 * applies `classify` to each item, and accumulates the per-owning-block
 * {@link ResolveDecisionWrite}s — one per-item decision list per touched block (a
 * block is touched iff any of its items was not "keep"). {@link runResolve} applies
 * each decision list in place via the surgical {@link applyResolveDecisionsInTx}.
 * Also accumulates the break-embed merge owners. Each write carries its owning block's tree `kind`
 * (from `resolveBlock`), so a suggestion tagged in a footnote / header / footer body
 * is accepted/rejected in-place in that body tree — not left as an un-resolvable
 * zombie. The single-id and bulk resolvers differ ONLY in `classify`; this is their
 * common spine.
 *
 * `mergeOwners` is built in DOCUMENT ORDER (the iteration order); phase-2 in
 * {@link runResolve} walks it in REVERSE so a cascade of consecutive merges never
 * reads a block a prior merge removed.
 */
function resolveBlockScan(
  state: State,
  classify: (item: InlineItem) => ScanItemResult,
): {
  writes: ResolveDecisionWrite[];
  mergeOwners: { ownerId: BlockId; kind: BlockTreeKind }[];
} {
  const writes: ResolveDecisionWrite[] = [];
  const mergeOwners: { ownerId: BlockId; kind: BlockTreeKind }[] = [];
  for (const block of iterateAllBlocksInDocumentOrder(state)) {
    const content = block.inlineContent;
    if (content === null) continue;
    let touched = false;
    const decisions: ScanItemResult[] = [];
    for (const item of content.items) {
      const r = classify(item);
      if (r.op !== "keep") {
        touched = true;
        if (r.op === "breakDrop" && r.merge) {
          mergeOwners.push({
            ownerId: block.id,
            kind: resolveBlock(state, block.id)?.kind ?? "block",
          });
        }
      }
      decisions.push(r);
    }
    if (touched) {
      writes.push({
        blockId: block.id,
        kind: resolveBlock(state, block.id)?.kind ?? "block",
        items: content.items,
        decisions,
      });
    }
  }
  return { writes, mergeOwners };
}

/**
 * Shared resolve engine for {@link resolve} / {@link resolveAll}: runs
 * {@link resolveBlockScan}, then in ONE ordinary (undoable) `applyOperation`
 * transaction:
 *   1. applies each touched block's per-item decisions as offset writes on its
 *      inline `Y.Text` via {@link applyResolveDecisionsInTx} (rewrites `format`,
 *      drops delete — no character is re-minted, so a prior undoable `StackItem`
 *      stays valid across the resolve). `registry` is threaded to the applier's
 *      attrs diff so custom per-key `equals` interpreters apply (load-bearing for
 *      `comment`-bearing runs);
 *   2. runs the conditional break MERGES in REVERSE document order via the live
 *      {@link mergeWithNextSiblingLiveInTx} helper — which reads each owner's
 *      CURRENT next sibling off the Y.Doc (so a cascade reflects prior merges) and
 *      DEFENSIVELY SKIPS a no-next / moved / absent / non-leaf boundary (subsuming
 *      the old pre-planned merge-validity guard); phase-1 only dropped the embed, so
 *      N's content is embed-free and structurally unchanged before the merge;
 *   3. deletes every id in `idsToDelete` from the `suggestions` map;
 *   4. surfaces `state.rootId` when NOTHING was touched (orphaned-by-absence: the
 *      `suggestions` map is excluded from dirty-capture, so the record deletes must
 *      still advance state).
 *
 * Both resolvers feed it a per-item `classify`; the single-id resolver passes one id,
 * the bulk resolver passes all ids. The reverse-order walk of `mergeOwners` is
 * load-bearing even for a SINGLE id: a cross-block suggested replace/delete tags k+1
 * `block-join-suggestion` embeds with ONE deletion id (one per crossed boundary), so
 * accepting that id cascades k+1 merges — reverse order keeps each merge's next
 * sibling alive.
 */
function runResolve(
  state: State,
  idsToDelete: ReadonlyArray<SuggestionId>,
  classify: (item: InlineItem) => ScanItemResult,
  registry: AttrRegistry | undefined,
): OperationResult {
  const { writes, mergeOwners } = resolveBlockScan(state, classify);
  return applyOperation(
    state,
    (d) => {
      for (const write of writes) {
        applyResolveDecisionsInTx(d, write.blockId, write.kind, write.items, write.decisions, registry);
      }
      for (let i = mergeOwners.length - 1; i >= 0; i--) {
        const owner = mergeOwners[i];
        if (owner === undefined) continue;
        mergeWithNextSiblingLiveInTx(d, owner.ownerId, owner.kind);
      }
      const map = getSuggestionsMap(d);
      for (const id of idsToDelete) {
        map.delete(id);
      }
      if (writes.length === 0) return new Set<BlockId>([state.rootId]);
    },
  );
}

/**
 * The shared accept/reject implementation. An insertion / deletion picks the kind's
 * provenance `attrKey` and a per-run {@link ResolveAction} from `record.kind` ×
 * `mode` (spec §6), then delegates to the shared {@link runResolve} engine with a
 * single-id `classify`. Insertion / deletion ids tag TEXT runs only, so the classify
 * narrows to `item.kind === "text"` before testing `attrs[attrKey]`.
 *
 * Per-run {@link ResolveAction}: `strip` drops the provenance attr (the run stays
 * plain); `drop` omits the run (real delete). A FORMATTING suggestion rewrites every
 * text run / visible embed carrying its tag through
 * `resolveFormattingSuggestionTags` (accept applies the proposal minus the run's
 * shadowed keys and shadows those keys on older pending suggestions; reject removes
 * the tag; tags of missing records on the run are cleaned). Block writes are
 * tree-map writes (dirty-captured); the ORPHANED case — record present but no run in
 * ANY tree carries its id — does no block write, so {@link runResolve} surfaces
 * `state.rootId` for the record delete.
 *
 * BREAK suggestions (a suggested paragraph SPLIT or JOIN) carry their id on a
 * zero-width {@link isBreakEmbed} appended to the END of the owning block N
 * (`properties.suggestionId`), NOT a text run. The classify yields `breakDrop` for
 * it — always dropping the embed, and recording N as a merge owner when
 * `breakMerge = (insertion && reject) || (deletion && accept)` (split-reject UNDOES
 * the split, join-accept DOES the join; split-accept / join-reject keep the split).
 * {@link runResolve} performs the conditional merge via the live
 * {@link mergeWithNextSiblingLiveInTx} helper, whose defensive skip subsumes the
 * boundary-validity check. A single-id resolve can own MULTIPLE break embeds: a
 * cross-block suggested replace/delete tags one `block-join-suggestion` per crossed
 * boundary with the SAME deletion id, so accepting it merges them all (reverse order).
 *
 * Undoability + the absent-record identity no-op are documented on
 * {@link acceptSuggestion} / {@link rejectSuggestion} and {@link runResolve}.
 */
function resolve(
  state: State,
  id: SuggestionId,
  mode: "accept" | "reject",
  registry: AttrRegistry | undefined,
): OperationResult {
  const doc = state[STATE_INTERNAL].doc;
  const record = readSuggestionRecord(doc, id);
  // Absent record → identity no-op (return the input State reference).
  if (record === null) {
    return { state, dirtyIds: NO_DIRTY };
  }

  const readRecord = (sid: SuggestionId): SuggestionRecord | null => readSuggestionRecord(doc, sid);
  const tagKey = formattingSuggestionKey(id);
  // A break resolution MERGES N + N+1 when undoing a split (insertion+reject) or
  // doing a join (deletion+accept); a split-accept / join-reject keeps the split.
  const breakMerge =
    (record.kind === "insertion" && mode === "reject") ||
    (record.kind === "deletion" && mode === "accept");

  const classify = (item: InlineItem): ScanItemResult => {
    // BREAK embed carrying this id — DROP it (always); conditionally merge.
    if (isBreakEmbed(item) && item.properties.suggestionId === id) {
      return { op: "breakDrop", merge: breakMerge };
    }
    if (record.kind === "formatting") {
      // A text run or VISIBLE field embed (#478) carrying this suggestion's tag.
      if (!(tagKey in item.attrs)) return { op: "keep" };
      return {
        op: "rewrite",
        attrs: resolveFormattingSuggestionTags(item.attrs, (sid) => (sid === id ? mode : null), readRecord),
      };
    }
    const attrKey = ATTR_KEY_BY_KIND[record.kind];
    if (item.kind === "text" && item.attrs[attrKey] === id) {
      return resolveAction(record.kind, mode) === "strip"
        ? { op: "rewrite", attrs: attrsWithout(item.attrs, attrKey) }
        : { op: "drop" };
    }
    // Non-matching item (text without this id; any other embed) — keep as-is.
    return { op: "keep" };
  };

  // Delete the resolved record PLUS any co-tenant record this resolve fully
  // orphans (CT-audit BUG1): when DROPPING a run that nests another author's id
  // (insertion-by-A + deletion-by-B), the co-tenant loses its last tagged content
  // and would otherwise be left orphaned (record present, range null).
  return runResolve(state, collectResolveRecordDeletes(state, id, classify), classify, registry);
}

/**
 * The suggestion ids a single inline item carries: a text run via its insertion /
 * deletion attrs ({@link INSERTION_SUGGESTION_ATTR} / `DELETION`) and every
 * formatting tag (`formattingSuggestionIds`), a break-suggestion embed via
 * `properties.suggestionId`, a VISIBLE field embed (footnote-anchor /
 * cross-reference / page-field / tab) via its formatting tags (the only provenance
 * that reaches embeds — #478; `markFormatting` stamps them, the resolvers rewrite them).
 */
export function suggestionIdsOnItem(item: InlineItem): SuggestionId[] {
  const out: SuggestionId[] = [];
  if (item.kind === "text") {
    for (const key of [INSERTION_SUGGESTION_ATTR, DELETION_SUGGESTION_ATTR]) {
      const v = item.attrs[key];
      if (typeof v === "string") out.push(v as SuggestionId);
    }
    out.push(...formattingSuggestionIds(item.attrs));
    return out;
  }
  // item.kind === "embed" — branch on embedType WITHOUT the isBreakEmbed type-guard,
  // whose `item is EmbedItem` predicate would narrow the else-branch to `never`.
  if (
    item.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE ||
    item.embedType === BLOCK_JOIN_SUGGESTION_EMBED_TYPE
  ) {
    // break-suggestion embed (block-split / block-join) — provenance lives in
    // `properties.suggestionId`, not in attrs.
    const sid = item.properties.suggestionId;
    if (typeof sid === "string") out.push(sid as SuggestionId);
  } else {
    // visible field embed (footnote-anchor / cross-reference / page-field / tab) —
    // can carry formatting tags (#478); must be reported so
    // collectResolveRecordDeletes counts it as a co-tenant survivor.
    out.push(...formattingSuggestionIds(item.attrs));
  }
  return out;
}

/**
 * The record ids a single-id {@link resolve} must DELETE: the resolved `id`, plus
 * every CO-TENANT id this resolve fully orphans. A co-tenant is a DIFFERENT id
 * sharing a run with `id` (Google-Docs nesting — insertion-by-A + deletion-by-B on
 * one run). When the resolve DROPS that run (reject-insertion / accept-deletion),
 * the co-tenant loses its last tagged content; if NO surviving item still carries
 * it, its record is now orphaned (present, range null) and must be deleted too. A
 * co-tenant that still tags any surviving item is left untouched. `classify` is the
 * SAME callback {@link runResolve} uses, so drop-vs-survive agrees exactly.
 */
function collectResolveRecordDeletes(
  state: State,
  id: SuggestionId,
  classify: (item: InlineItem) => ScanItemResult,
): SuggestionId[] {
  const droppedCoTenants = new Set<SuggestionId>();
  const survivors = new Set<SuggestionId>();
  for (const block of iterateAllBlocksInDocumentOrder(state)) {
    const content = block.inlineContent;
    if (content === null) continue;
    for (const item of content.items) {
      const op = classify(item).op;
      const dropped = op === "drop" || op === "breakDrop";
      for (const sid of suggestionIdsOnItem(item)) {
        if (sid === id) continue; // the resolved id is always deleted
        (dropped ? droppedCoTenants : survivors).add(sid);
      }
    }
  }
  const out: SuggestionId[] = [id];
  for (const c of droppedCoTenants) {
    if (!survivors.has(c)) out.push(c);
  }
  return out;
}

/** The provenance attr key carrying an insertion / deletion suggestion id. */
const ATTR_KEY_BY_KIND: Record<Exclude<SuggestionKind, "formatting">, string> = {
  insertion: INSERTION_SUGGESTION_ATTR,
  deletion: DELETION_SUGGESTION_ATTR,
};

/**
 * The per-run {@link ResolveAction} for a `record.kind` × `mode` pair (spec §6):
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
export function acceptAll(state: State, registry?: AttrRegistry): OperationResult {
  return resolveAll(state, "accept", registry);
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
export function rejectAll(state: State, registry?: AttrRegistry): OperationResult {
  return resolveAll(state, "reject", registry);
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
 * decides keep-with-rewritten-attrs vs drop (the mode's dominance order); a BREAK
 * embed ({@link isBreakEmbed}) is always dropped and conditionally merges its owner
 * N with N+1 (`(insertion && reject) || (deletion && accept)`); other embeds +
 * untouched runs are kept. ALL records are then deleted. If the document has no
 * suggestions → identity no-op. If records exist but NO run in any tree carries any of
 * their ids (all orphaned) → {@link runResolve} surfaces `state.rootId` so the record
 * deletes still advance state.
 *
 * Walks all three trees via {@link resolveBlockScan} (same as {@link resolve} +
 * `buildSuggestionRangeIndex`), so suggestions inside embed/template bodies resolve
 * in-place in their body tree.
 */
function resolveAll(
  state: State,
  mode: "accept" | "reject",
  registry: AttrRegistry | undefined,
  only: ReadonlySet<SuggestionId> | null = null,
): OperationResult {
  const doc = state[STATE_INTERNAL].doc;
  const ids: SuggestionId[] = [...getSuggestionsMap(doc).keys()]
    .map((key) => key as SuggestionId)
    .filter((id) => only === null || only.has(id));
  // No (matching) suggestions → identity no-op (return the input State reference).
  if (ids.length === 0) {
    return { state, dirtyIds: NO_DIRTY };
  }
  const inSet = (raw: unknown): raw is SuggestionId =>
    typeof raw === "string" && (only === null || only.has(raw as SuggestionId));

  const classify = (item: InlineItem): ScanItemResult => {
    // Read before the break-embed type guard narrows the fall-through to `never`.
    const itemAttrs = item.attrs;
    // BREAK embed of a resolved id — DROP it, and decide whether the owning block N
    // merges with its next sibling. Other ids' break embeds and every other embed
    // (footnote-anchor/tab/comment) are kept.
    if (isBreakEmbed(item)) {
      const sidRaw = item.properties.suggestionId;
      if (!inSet(sidRaw)) return { op: "keep" };
      const record = readSuggestionRecord(doc, sidRaw);
      const merge =
        record !== null &&
        ((record.kind === "insertion" && mode === "reject") ||
          (record.kind === "deletion" && mode === "accept"));
      return { op: "breakDrop", merge };
    }
    if (item.kind === "text") {
      const rewrite = mode === "accept" ? acceptAllRun(item, doc, inSet) : rejectAllRun(item, doc, inSet);
      if (!rewrite.touched) return { op: "keep" };
      return rewrite.keep && rewrite.item !== undefined
        ? { op: "rewrite", attrs: rewrite.item.attrs }
        : { op: "drop" };
    }
    // A non-break embed — resolve the formatting tags it carries (#478; a VISIBLE
    // field embed in a formatting range) whose ids are resolved.
    const attrs = resolveFormattingInSet(itemAttrs, mode, doc, inSet);
    return attrs === itemAttrs ? { op: "keep" } : { op: "rewrite", attrs };
  };
  // Delete the resolved records, plus any OTHER suggestion this resolve fully orphans
  // (a co-tenant id whose only runs were dropped).
  const deletes = only === null ? ids : collectSetResolveRecordDeletes(state, new Set(ids), classify);
  return runResolve(state, deletes, classify, registry);
}

/**
 * The record ids a set resolve must delete: the resolved ids plus every co-tenant id
 * (outside the set) left with no surviving tagged item.
 */
function collectSetResolveRecordDeletes(
  state: State,
  ids: ReadonlySet<SuggestionId>,
  classify: (item: InlineItem) => ScanItemResult,
): SuggestionId[] {
  const dropped = new Set<SuggestionId>();
  const survivors = new Set<SuggestionId>();
  for (const block of iterateAllBlocksInDocumentOrder(state)) {
    const content = block.inlineContent;
    if (content === null) continue;
    for (const item of content.items) {
      const op = classify(item).op;
      const gone = op === "drop" || op === "breakDrop";
      for (const sid of suggestionIdsOnItem(item)) {
        if (ids.has(sid)) continue;
        (gone ? dropped : survivors).add(sid);
      }
    }
  }
  return [...ids, ...[...dropped].filter((c) => !survivors.has(c))];
}

/**
 * ACCEPT every suggestion of one GROUP (a host proposal, or a single suggestion — a group
 * of one, see `suggestionGroupOf`) in ONE transaction: one undo step. Per-run resolution
 * follows {@link acceptAll}'s dominance rules restricted to the group's ids; a co-tenant
 * suggestion outside the group survives (or is cleaned up if it loses all its content).
 * Identity no-op when the group has no records.
 */
export function acceptSuggestionGroup(state: State, groupId: string, registry?: AttrRegistry): OperationResult {
  return resolveAll(state, "accept", registry, groupMemberIds(state, groupId));
}

/** REJECT every suggestion of one group in one transaction (inverse of {@link acceptSuggestionGroup}). */
export function rejectSuggestionGroup(state: State, groupId: string, registry?: AttrRegistry): OperationResult {
  return resolveAll(state, "reject", registry, groupMemberIds(state, groupId));
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
 *   - an EMBED in range → kept as-is, untagged (out of scope for this slice).
 *
 * `tagged` is true iff ≥1 in-range portion received the deletion attr (drives the
 * record write — a whole-range-own-insertions delete tags nothing). Caller runs
 * `mergeAdjacentTextItems` over the returned items.
 *
 * Survives the migration to {@link applyDeletionStrikeInTx} (#491): (a)
 * `replaceWithSuggestedFragment` still uses it (its write path is deferred), and
 * (b) it is the pure-function ORACLE the equivalence tests diff the surgical
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
): DeletionRebuild {
  const out: InlineItem[] = [];
  let tagged = false;
  let cursor = 0;
  for (const item of items) {
    const len = item.kind === "text" ? item.text.length : 1;
    const itemStart = cursor;
    const itemEnd = cursor + len;
    cursor = itemEnd;

    // Wholly outside the range — keep as-is.
    if (itemEnd <= rangeStart || itemStart >= rangeEnd) {
      out.push(item);
      continue;
    }

    // An embed (always length 1, so wholly in range here) — out of scope: keep
    // untagged. (Embed / inline-object soft-deletion is a named follow-up.)
    if (item.kind !== "text") {
      out.push(item);
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
    } else {
      out.push({
        kind: "text",
        text: middle,
        attrs: { ...item.attrs, [DELETION_SUGGESTION_ATTR]: id },
      });
      tagged = true;
    }

    if (after.length > 0) {
      out.push({ kind: "text", text: after, attrs: item.attrs });
    }
  }
  return { items: out, tagged };
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

/** {@link isOwnInsertionAttrs} for a whole `InlineItem` (text only; embeds → false). */
function isOwnInsertion(item: InlineItem, author: string, doc: Y.Doc): boolean {
  if (item.kind !== "text") return false;
  return isOwnInsertionAttrs(item.attrs, author, doc);
}

/**
 * Identity-preserving deletion strike over one block's inline `Y.Text` on
 * `[rangeStart, rangeEnd)`, as offset writes: each in-range TEXT run is either
 * tagged with the deletion id (`format` — its characters keep their CRDT identity)
 * or, when it is the deleter's OWN pending insertion, deleted for real; embeds in
 * range are kept untagged. Formats run first; own-insertion deletes then run in
 * DESCENDING offset order. The resulting content equals `rebuildBlockForDeletion`.
 * Returns whether any run was TAGGED (a cross-check against the plan's
 * `taggedAny`). MUST run inside an open transaction.
 */
export function applyDeletionStrikeInTx(
  doc: Y.Doc,
  blockId: BlockId,
  kind: BlockTreeKind,
  rangeStart: number,
  rangeEnd: number,
  id: SuggestionId,
  author: string,
  opName: string,
): { tagged: boolean } {
  requireInTransaction(doc, opName);
  const yBlock = getYBlock(doc, blockId, opName, kind);
  const yText = readYInline(yBlock, blockId);
  if (yText === null || rangeStart >= rangeEnd) return { tagged: false };
  // ONE read of the block; the range is snapped OUT to grapheme boundaries once and
  // every tag / drop below uses those offsets.
  const items = inlineItemsFromYText(yText);
  const [start, end] = snapRange(items, rangeStart, rangeEnd);
  let tagged = false;
  const tags: { start: number; end: number }[] = [];
  const drops: { start: number; end: number }[] = [];
  let pos = 0;
  for (const item of items) {
    const len = item.kind === "text" ? item.text.length : 1;
    const lo = Math.max(pos, start);
    const hi = Math.min(pos + len, end);
    if (item.kind === "text" && lo < hi) {
      if (isOwnInsertionAttrs(item.attrs, author, doc)) {
        drops.push({ start: lo, end: hi });
      } else {
        tagged = true;
        // A re-strike of a run already carrying this id writes nothing (no event).
        if (item.attrs[DELETION_SUGGESTION_ATTR] !== id) tags.push({ start: lo, end: hi });
      }
    }
    pos += len;
    if (pos >= end) break;
  }
  // Every offset is a snapped endpoint or an item boundary, and text runs are never
  // markers, so tags / drops are raw `format` / `delete` (formats shift nothing;
  // drops descending so earlier offsets stay valid).
  for (const t of tags) yText.format(t.start, t.end - t.start, { [DELETION_SUGGESTION_ATTR]: id });
  for (let i = drops.length - 1; i >= 0; i--) {
    const r = drops[i];
    if (r !== undefined) yText.delete(r.start, r.end - r.start);
  }
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

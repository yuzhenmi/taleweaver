import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { Position, Span } from "../block-position";
import { createSpan } from "../block-position";
import { spanStart, spanEnd } from "../block-compare";
import type { ReadonlyAttrs } from "../attrs";
import { attrsEqual, mergeAttrs } from "../attrs";
import {
  mergeAdjacentTextItems,
  type InlineItem,
  type TextItem,
} from "../inline-content";
import {
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
  INSERTION_SUGGESTION_ATTR,
  SUGGESTION_RESOLVE_ORIGIN,
  readSuggestionRecord,
  writeSuggestionRecordInTx,
  type SuggestionId,
  type SuggestionKind,
} from "../suggestions";
import { iterateBlocksInDocumentOrder } from "../document-order";
import { STATE_INTERNAL } from "../state-internal";
import { getSuggestionsMap, getYBlock, type BlockTreeKind } from "../yjs-doc";
import { buildYInlineContent } from "../y-block";
import { planApplyAttrsToRange, applyAttrsToRangeInTx } from "./apply-attrs";
import { planInsertText, insertTextInTx, planInsertTextFullReplace } from "./insert-text";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../../cascade/attr-registry";
import type { ResolvedBlockKind } from "../state";

/** An empty dirtyIds set — the identity-no-op return per the T7 contract. */
const NO_DIRTY: ReadonlySet<BlockId> = new Set<BlockId>();

/**
 * Fields the host supplies when minting a formatting suggestion. `id` is the
 * branded `SuggestionId` (minted host-side); it is REUSED (not consumed) when an
 * adjacent same-author/same-proposal mark coalesces. `author`/`createdAt` are
 * deterministic host-injected values.
 */
export interface MarkFormattingInput {
  readonly id: SuggestionId;
  readonly author: string;
  readonly createdAt: number;
}

/**
 * Mark `span` with a formatting SUGGESTION: stamp a `formattingSuggestionId`
 * attr over the span AND write a `formatting` {@link SuggestionRecord} carrying
 * `proposedAttrs` (the format delta the action WOULD have applied, e.g.
 * `{ bold: true }`), in ONE tracked `applyOperation` transaction — so the attr +
 * record land as ONE undo entry and one collab event.
 *
 * The run's LIVE format attrs (bold/italic/color/…) are UNCHANGED: only the
 * provenance `formattingSuggestionId` attr is added (merged into existing attrs
 * by `applyAttrsToRangeInTx`). The proposal is applied only on ACCEPT (a later
 * slice).
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
 * that suggestion's id (widening its range) instead of minting a new record. The
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
  input: MarkFormattingInput,
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
  const { id, reusing } = resolveCoalesce(
    state,
    span,
    input.id,
    FORMATTING_SUGGESTION_ATTR,
    (record) =>
      record.kind === "formatting" &&
      record.author === input.author &&
      attrsEqual(record.proposedAttrs ?? {}, proposedAttrs),
  );

  return applyOperation(state, (doc) => {
    applyAttrsToRangeInTx(doc, plan, { [FORMATTING_SUGGESTION_ATTR]: id }, undefined);
    if (!reusing) {
      writeSuggestionRecordInTx(doc, {
        id,
        kind: "formatting",
        author: input.author,
        createdAt: input.createdAt,
        proposedAttrs,
      });
    }
  });
}

/**
 * Fields the host supplies when minting a deletion suggestion. `id` is the
 * branded `SuggestionId` (minted host-side); REUSED (not consumed) when an
 * adjacent same-author deletion coalesces. `author`/`createdAt` are deterministic
 * host-injected values.
 */
export interface MarkDeletionInput {
  readonly id: SuggestionId;
  readonly author: string;
  readonly createdAt: number;
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
 * runs. Instead it does a per-OWNING-BLOCK FULL-REPLACE rewrite (mirror of
 * `deleteComment`'s `planMarkerStrip`): the new `InlineItem[]` per block is
 * computed PRE-transaction (pure), then written via `getYBlock(...).set(
 * "inlineContent", buildYInlineContent(...))`. Block writes are tree-map writes
 * (dirty-captured), so — unlike the side-table-only comment flips — no
 * `state.rootId` surfacing is needed. The op + the optional record write share
 * ONE `applyOperation` transaction (one undo unit, one collab event).
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
  input: MarkDeletionInput,
): OperationResult {
  const plan = planMarkDeletion(state, span, input);
  // Collapsed span / nothing to mark → identity no-op (the input State reference).
  if (plan === null) {
    return { state, dirtyIds: NO_DIRTY };
  }

  return applyOperation(state, (d) => {
    for (const write of plan.writes) {
      getYBlock(d, write.blockId, "markDeletion", plan.kind).set(
        "inlineContent",
        buildYInlineContent({ items: write.items }),
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
      });
    }
  });
}

/**
 * The pure pre-transaction plan for a suggested deletion: the per-owning-block
 * full-replace `writes`, whether ≥1 run was actually TAGGED (`taggedAny` — drives
 * the record write), the resolved/coalesced deletion `id` + whether it `reusing`s
 * an existing record, and the span's owning tree `kind`.
 *
 * Extracted from {@link markDeletion} so the composite {@link replaceWithSuggestion}
 * can reuse the strike plan: it inspects `writes` to build the insert plan against
 * the POST-strike items of the start block (the strike full-REPLACES that block's
 * Y.Array, so an in-place insert against the pre-strike `state` would be unsafe).
 *
 * Returns `null` for the no-op cases (collapsed span, or `planApplyAttrsToRange`
 * yields nothing) so the caller short-circuits with the identity contract.
 */
function planMarkDeletion(
  state: State,
  span: Span,
  input: MarkDeletionInput,
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
  );

  // Compute the per-owning-block rewrites + whether any run was TAGGED (vs all
  // own-insertions removed) PRE-transaction (pure) — mirror of `deleteComment`,
  // which plans writes pre-tx then applies them in the tx.
  const doc = state[STATE_INTERNAL].doc;
  const writes: { blockId: BlockId; items: ReadonlyArray<InlineItem> }[] = [];
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
    writes.push({ blockId: seg.block.id, items: mergeAdjacentTextItems(result.items) });
  }

  return { writes, taggedAny, id, reusing, kind: plan.kind };
}

/** The pure pre-transaction plan produced by {@link planMarkDeletion}. */
interface MarkDeletionPlan {
  /** The per-owning-block full-replace inlineContent rewrites (post-strike items). */
  readonly writes: { blockId: BlockId; items: ReadonlyArray<InlineItem> }[];
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
 * Fields the host supplies when minting an insertion suggestion. `id` is the
 * branded `SuggestionId` (minted host-side); it is REUSED (not consumed) when the
 * insertion coalesces into an adjacent same-author insertion at the insertion
 * point (a continuous typing run → ONE suggestion). `author`/`createdAt` are
 * deterministic host-injected values.
 */
export interface MarkInsertionInput {
  readonly id: SuggestionId;
  readonly author: string;
  readonly createdAt: number;
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
  input: MarkInsertionInput,
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
}

/**
 * TYPE OVER A SELECTION in Suggesting mode: soft-delete the selection AND insert
 * `text` at the selection start, in ONE tracked `applyOperation` transaction — the
 * suggestion analog of `replaceRange` (which composes deleteRange + insertText
 * atomically). The strike + the insert + BOTH records (an `insertion` and a
 * `deletion`) land as ONE undo entry and one collab event.
 *
 * Composes {@link planMarkDeletion} (the strike plan) with
 * {@link planInsertTextFullReplace} (the insert). The KEY hazard — identical to
 * `replaceRange` — is that the strike FULL-REPLACES the start block's Y.Array
 * (each owning block is rewritten via `getYBlock(...).set("inlineContent", …)`),
 * so the insert plan MUST be built against the POST-strike items (the start
 * block's `writes` entry), NOT against the pre-strike `state` (whose snapshot is
 * still un-struck and whose Y.Text identity the strike blows away). The insert
 * therefore always uses `planInsertTextFullReplace` (mode = full-replace) when the
 * start block was struck.
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
 * Block-write discipline: the start block is written EXACTLY ONCE — by the
 * `insertTextInTx` full-replace (its `items` already include the struck-tail of
 * the start block, since the insert plan was built against the post-strike
 * `startWrite.items`); the loop writes every OTHER struck block. Writing the start
 * block in both the loop and the insert would double-write (the loop's struck-only
 * items, missing the inserted run, would land last and lose the insert).
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
    });
  }

  // Plan the strike (pure, pre-tx). A `null` plan means the span re-collapsed /
  // yields nothing to strike — reduce to a pure suggested insertion at the span
  // start (the document-order earliest endpoint).
  const delPlan = planMarkDeletion(state, span, {
    id: input.deletionId,
    author: input.author,
    createdAt: input.createdAt,
  });
  const start = spanStart(state, span);
  if (delPlan === null) {
    return mintInsertion(state, start, text, attrs, {
      id: input.insertionId,
      author: input.author,
      createdAt: input.createdAt,
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
  );

  // Stamp the resolved insertion id over the intended live format. OVERWRITES only
  // `insertionSuggestionId` (any stale caller value is replaced by the resolved id).
  const insertAttrs: ReadonlyAttrs = { ...attrs, [INSERTION_SUGGESTION_ATTR]: insId };

  // Build the insert plan against the POST-strike items of the start block (its
  // `writes` entry) — NOT `state` (still pre-strike; its Y.Text identity is blown
  // away by the strike full-replace). If the start block has no struck write (it
  // contributed no in-range text — e.g. the span starts exactly at end-of-block),
  // the start block is untouched by the strike, so an in-place plan against the
  // live `state` is safe.
  const startWrite = delPlan.writes.find((w) => w.blockId === start.blockId);
  const insertPlan = startWrite
    ? planInsertTextFullReplace(
        start.blockId,
        delPlan.kind,
        startWrite.items,
        start.offset,
        text,
        insertAttrs,
        registry,
      )
    : planInsertText(state, start, text, insertAttrs, registry);

  return applyOperation(state, (d) => {
    // Write every struck block EXCEPT the start block: the start block is written
    // once by `insertTextInTx` below (whose full-replace items already carry the
    // struck start-block tail). The branch where `startWrite` is undefined writes
    // ALL struck blocks here (the start block was never struck) and the insert is
    // an in-place mutation into the live (untouched) start block.
    for (const write of delPlan.writes) {
      if (startWrite !== undefined && write.blockId === start.blockId) continue;
      getYBlock(d, write.blockId, "replaceWithSuggestion", delPlan.kind).set(
        "inlineContent",
        buildYInlineContent({ items: write.items }),
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
      });
    }
    // Write the insertion record (unless coalesced into an existing one).
    if (!reusingIns) {
      writeSuggestionRecordInTx(d, {
        id: insId,
        kind: "insertion",
        author: input.author,
        createdAt: input.createdAt,
      });
    }
  });
}

/**
 * ACCEPT one suggestion by id (Suggesting-mode resolution). Dispatches on the
 * record's {@link SuggestionKind}:
 *   - insertion  → STRIP the `insertionSuggestionId` from each tagged run (the
 *     suggested text becomes plain, permanent text).
 *   - deletion   → DROP each tagged run (the soft-deleted text is removed FOR
 *     REAL).
 *   - formatting → APPLY the record's `proposedAttrs` to each tagged run's LIVE
 *     attrs AND strip the `formattingSuggestionId` (the proposal lands).
 * After the content rewrite the record is deleted from the `suggestions` map.
 *
 * NON-undoable: the resolve transaction is tagged with
 * {@link SUGGESTION_RESOLVE_ORIGIN}, so the History's UndoManager (tracking only
 * `null`-origin txns) fires no StackItem — accepting is a final resolution that
 * Ctrl+Z cannot revert (Google Docs convention). See {@link resolve}.
 *
 * Identity no-op (returns the SAME `state` reference + empty dirtyIds, per the
 * T7 contract) when no record exists for `id`.
 */
export function acceptSuggestion(state: State, id: SuggestionId): OperationResult {
  return resolve(state, id, "accept");
}

/**
 * REJECT one suggestion by id. The inverse resolution of {@link acceptSuggestion}:
 *   - insertion  → DROP each tagged run (the suggested text never lands).
 *   - deletion   → STRIP the `deletionSuggestionId` from each tagged run (the
 *     text stays; the deletion is discarded).
 *   - formatting → STRIP the `formattingSuggestionId` (the proposal is discarded;
 *     the run's live attrs are unchanged).
 * After the rewrite the record is deleted from the `suggestions` map.
 *
 * NON-undoable (same {@link SUGGESTION_RESOLVE_ORIGIN} txn tag as accept).
 * Identity no-op when no record exists for `id`.
 */
export function rejectSuggestion(state: State, id: SuggestionId): OperationResult {
  return resolve(state, id, "reject");
}

/** What a resolve does to each TAGGED run of the resolved suggestion. */
type ResolveAction = "strip" | "drop" | "applyStrip";

/** A pre-computed per-owning-block rewrite for a resolve. */
interface ResolveWrite {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly items: ReadonlyArray<InlineItem>;
}

/**
 * The shared accept/reject implementation. Picks the kind's provenance
 * `attrKey` and a per-run {@link ResolveAction} from `record.kind` × `mode`
 * (spec §6), then does a per-OWNING-BLOCK FULL-REPLACE rewrite (mirror of
 * {@link markDeletion} / `deleteComment`): the new `InlineItem[]` per block is
 * computed PRE-transaction (pure), then written in ONE
 * {@link SUGGESTION_RESOLVE_ORIGIN}-tagged (non-undoable) `applyOperation`
 * transaction that also deletes the record. Only TEXT runs carry suggestion ids
 * (the create ops never tag embeds), so the scan narrows to `item.kind ===
 * "text"` before testing `attrs[attrKey]`; embeds are always kept as-is.
 *
 * Block writes are tree-map writes (dirty-captured), so dirtyIds flow normally.
 * The ORPHANED case — the record is present but no MAIN-TREE run carries its id
 * (already-resolved, or an out-of-main-tree suggestion) — does no block write,
 * so it surfaces `state.rootId` (mirror of `deleteComment`'s orphaned-by-absence
 * branch) so the record-delete still advances state.
 */
function resolve(
  state: State,
  id: SuggestionId,
  mode: "accept" | "reject",
): OperationResult {
  const doc = state[STATE_INTERNAL].doc;
  const record = readSuggestionRecord(doc, id);
  // Absent record → identity no-op (return the input State reference).
  if (record === null) {
    return { state, dirtyIds: NO_DIRTY };
  }

  const attrKey = ATTR_KEY_BY_KIND[record.kind];
  const action = resolveAction(record.kind, mode);
  const proposedAttrs = record.proposedAttrs ?? {};

  // Compute the per-owning-block rewrites PRE-transaction (pure). The per-block
  // full-replace from this snapshot is inherently offset-safe (no block merges
  // happen here), so no reverse-order walk is needed.
  const writes: ResolveWrite[] = [];
  for (const block of iterateBlocksInDocumentOrder(state)) {
    const content = block.inlineContent;
    if (content === null) continue;
    let touched = false;
    const newItems: InlineItem[] = [];
    for (const item of content.items) {
      if (item.kind === "text" && item.attrs[attrKey] === id) {
        touched = true;
        switch (action) {
          case "strip":
            newItems.push({
              kind: "text",
              text: item.text,
              attrs: attrsWithout(item.attrs, attrKey),
            });
            break;
          case "drop":
            // Omit the run entirely (real delete).
            break;
          case "applyStrip":
            newItems.push({
              kind: "text",
              text: item.text,
              attrs: mergeAttrs(attrsWithout(item.attrs, attrKey), proposedAttrs),
            });
            break;
        }
        continue;
      }
      // Non-touched item (incl. every embed) — keep as-is.
      newItems.push(item);
    }
    if (touched) {
      writes.push({
        blockId: block.id,
        kind: resolveBlock(state, block.id)?.kind ?? "block",
        items: mergeAdjacentTextItems(newItems),
      });
    }
  }

  return applyOperation(
    state,
    (d) => {
      for (const write of writes) {
        getYBlock(d, write.blockId, "resolveSuggestion", write.kind).set(
          "inlineContent",
          buildYInlineContent({ items: write.items }),
        );
      }
      getSuggestionsMap(d).delete(id);
      // Orphaned-by-absence: no main-tree run carried the id, so the only
      // mutation is the record delete (the `suggestions` map is excluded from
      // dirty-capture). Surface the document root so the delete advances state.
      if (writes.length === 0) return new Set<BlockId>([state.rootId]);
    },
    { origin: SUGGESTION_RESOLVE_ORIGIN },
  );
}

/** The provenance attr key carrying a suggestion id for each {@link SuggestionKind}. */
const ATTR_KEY_BY_KIND: Record<SuggestionKind, string> = {
  insertion: INSERTION_SUGGESTION_ATTR,
  deletion: DELETION_SUGGESTION_ATTR,
  formatting: FORMATTING_SUGGESTION_ATTR,
};

/**
 * The per-run {@link ResolveAction} for a `record.kind` × `mode` pair (spec §6):
 *
 * | kind        | accept       | reject  |
 * |-------------|--------------|---------|
 * | insertion   | strip        | drop    |
 * | deletion    | drop         | strip   |
 * | formatting  | applyStrip   | strip   |
 *
 * (`applyStrip` is the ONLY action that also merges `proposedAttrs`.)
 */
function resolveAction(kind: SuggestionKind, mode: "accept" | "reject"): ResolveAction {
  switch (kind) {
    case "insertion":
      return mode === "accept" ? "strip" : "drop";
    case "deletion":
      return mode === "accept" ? "drop" : "strip";
    case "formatting":
      return mode === "accept" ? "applyStrip" : "strip";
  }
}

/** A copy of `attrs` with `key` omitted (the run loses its provenance id). */
function attrsWithout(attrs: ReadonlyAttrs, key: string): ReadonlyAttrs {
  const { [key]: _omit, ...rest } = attrs;
  return rest;
}

/**
 * ACCEPT EVERY suggestion in the document in ONE non-undoable transaction (the
 * "Accept all" command). Each TEXT run is resolved against ALL the suggestion
 * ids it carries at once (a run can be insertion-by-A + deletion-by-B +
 * formatting-by-C simultaneously), with the accept dominance order from
 * {@link acceptAllRun}: accept-deletion DROPS the run; otherwise the run is kept
 * plain (insertion id stripped) with any formatting proposal applied live. ALL
 * records are deleted. See {@link resolveAll}.
 *
 * NON-undoable ({@link SUGGESTION_RESOLVE_ORIGIN}) — Ctrl+Z cannot revert a bulk
 * accept, exactly as {@link acceptSuggestion}. Identity no-op (same `state` ref +
 * empty dirtyIds) when the document has no suggestions.
 */
export function acceptAll(state: State): OperationResult {
  return resolveAll(state, "accept");
}

/**
 * REJECT EVERY suggestion in the document in ONE non-undoable transaction (the
 * "Reject all" command). The inverse of {@link acceptAll}: per run, the reject
 * dominance order from {@link rejectAllRun} applies — reject-insertion DROPS the
 * run; otherwise the run is kept (deletion + formatting ids stripped, no proposal
 * applied). ALL records are deleted. See {@link resolveAll}.
 *
 * NON-undoable, same identity no-op contract as {@link acceptAll}.
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
 * id stripped (if present); and — if it carries a formatting id — the record's
 * `proposedAttrs` applied live (`mergeAttrs(attrsWithout(attrs, fmtKey), proposed)`,
 * a null record → just stripping the id). A run carrying none of the three ids is
 * untouched (`touched: false`).
 */
function acceptAllRun(item: TextItem, doc: Y.Doc): AllRewrite {
  const hasInsertion = typeof item.attrs[INSERTION_SUGGESTION_ATTR] === "string";
  const hasDeletion = typeof item.attrs[DELETION_SUGGESTION_ATTR] === "string";
  const fmtRaw = item.attrs[FORMATTING_SUGGESTION_ATTR];
  const hasFormatting = typeof fmtRaw === "string";

  if (!hasInsertion && !hasDeletion && !hasFormatting) {
    return { touched: false, keep: true, item };
  }
  // Accept-deletion dominates → drop the run.
  if (hasDeletion) {
    return { touched: true, keep: false };
  }
  // Keep: strip the insertion id; apply the formatting proposal (if any).
  let attrs = attrsWithout(item.attrs, INSERTION_SUGGESTION_ATTR);
  if (hasFormatting) {
    const record = readSuggestionRecord(doc, fmtRaw as SuggestionId);
    const proposed = record?.proposedAttrs ?? {};
    attrs = mergeAttrs(attrsWithout(attrs, FORMATTING_SUGGESTION_ATTR), proposed);
  }
  return { touched: true, keep: true, item: withAttrs(item, attrs) };
}

/**
 * Resolve ONE text run for {@link rejectAll}. Dominance: an insertion id (reject-
 * insertion) DROPS the run — the suggested text never lands (so a run that is
 * BOTH insertion AND deletion is also dropped). Otherwise the run is KEPT with the
 * deletion id and the formatting id stripped (the proposal discarded). A run
 * carrying none of the three ids is untouched (`touched: false`).
 */
function rejectAllRun(item: TextItem): AllRewrite {
  const hasInsertion = typeof item.attrs[INSERTION_SUGGESTION_ATTR] === "string";
  const hasDeletion = typeof item.attrs[DELETION_SUGGESTION_ATTR] === "string";
  const hasFormatting = typeof item.attrs[FORMATTING_SUGGESTION_ATTR] === "string";

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
  if (hasFormatting) attrs = attrsWithout(attrs, FORMATTING_SUGGESTION_ATTR);
  return { touched: true, keep: true, item: withAttrs(item, attrs) };
}

/**
 * The shared {@link acceptAll} / {@link rejectAll} implementation. Unlike the
 * single-id {@link resolve} (which walks blocks once PER id), this walks each
 * block ONCE and resolves EVERY id every run carries in one combined rewrite —
 * looping the single-id resolve against the same pre-tx snapshot would clobber
 * blocks (each does a full-replace), and a single run can carry insertion +
 * deletion + formatting ids at once.
 *
 * Per text run, {@link acceptAllRun} / {@link rejectAllRun} decides keep-with-
 * rewritten-attrs vs drop (with the mode's dominance order). Embeds and untouched
 * runs are kept as-is. Then ALL records are deleted in one
 * {@link SUGGESTION_RESOLVE_ORIGIN}-tagged (non-undoable) transaction. If the
 * document has no suggestions → identity no-op. If records exist but NO main-tree
 * run carries any of their ids (all orphaned) → no block is rewritten, so
 * `state.rootId` is surfaced (mirror of {@link resolve}'s orphaned branch) so the
 * record deletes still advance state.
 *
 * MAIN-TREE-ONLY scan (same as {@link resolve} + `buildSuggestionRangeIndex`);
 * resolving suggestions inside embed/template bodies is a tracked follow-up.
 */
function resolveAll(state: State, mode: "accept" | "reject"): OperationResult {
  const doc = state[STATE_INTERNAL].doc;
  const ids = [...getSuggestionsMap(doc).keys()];
  // No suggestions → identity no-op (return the input State reference).
  if (ids.length === 0) {
    return { state, dirtyIds: NO_DIRTY };
  }

  // Compute the per-block combined rewrites PRE-transaction (pure). A per-block
  // full-replace from this snapshot is offset-safe (no block merges happen here).
  const writes: ResolveWrite[] = [];
  for (const block of iterateBlocksInDocumentOrder(state)) {
    const content = block.inlineContent;
    if (content === null) continue;
    let touched = false;
    const newItems: InlineItem[] = [];
    for (const item of content.items) {
      if (item.kind === "text") {
        const rewrite =
          mode === "accept" ? acceptAllRun(item, doc) : rejectAllRun(item);
        if (rewrite.touched) touched = true;
        if (rewrite.keep && rewrite.item !== undefined) newItems.push(rewrite.item);
        continue;
      }
      // Embeds never carry inline suggestion ids (the create ops only tag text);
      // keep as-is.
      newItems.push(item);
    }
    if (touched) {
      writes.push({
        blockId: block.id,
        kind: resolveBlock(state, block.id)?.kind ?? "block",
        items: mergeAdjacentTextItems(newItems),
      });
    }
  }

  return applyOperation(
    state,
    (d) => {
      for (const write of writes) {
        getYBlock(d, write.blockId, "resolveAll", write.kind).set(
          "inlineContent",
          buildYInlineContent({ items: write.items }),
        );
      }
      const map = getSuggestionsMap(d);
      for (const id of ids) {
        map.delete(id);
      }
      // All records were orphaned (no main-tree run carried any id) — the only
      // mutation is the record deletes (the `suggestions` map is excluded from
      // dirty-capture). Surface the document root so the deletes advance state.
      if (writes.length === 0) return new Set<BlockId>([state.rootId]);
    },
    { origin: SUGGESTION_RESOLVE_ORIGIN },
  );
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
 */
function rebuildBlockForDeletion(
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
 * True iff `item` is a text run carrying an `insertionSuggestionId` whose record
 * is an `insertion` by `author` — i.e. the deleter's OWN pending insertion, which
 * a suggested deletion removes FOR REAL rather than tagging.
 */
function isOwnInsertion(
  item: InlineItem,
  author: string,
  doc: Y.Doc,
): boolean {
  if (item.kind !== "text") return false;
  const raw = item.attrs[INSERTION_SUGGESTION_ATTR];
  if (typeof raw !== "string") return false;
  const record = readSuggestionRecord(doc, raw as SuggestionId);
  return record !== null && record.kind === "insertion" && record.author === author;
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
): CoalesceDecision {
  const start = spanStart(state, span);
  const end = spanEnd(state, span);

  const beforeId = neighborSuggestionId(state, start.blockId, start.offset - 1, attrKey);
  const afterId = neighborSuggestionAfter(state, end.blockId, end.offset, attrKey);

  // Prefer the BEFORE neighbor when both coalesce.
  for (const candidate of [beforeId, afterId]) {
    if (candidate !== null && coalesces(state, candidate, matches)) {
      return { id: candidate, reusing: true };
    }
  }
  return { id: mintId, reusing: false };
}

/**
 * The `attrKey` suggestion id of the text run CONTAINING document offset
 * `containedOffset` in `blockId`, or `null` when `containedOffset < 0`, the
 * block is absent/non-leaf, or the containing item is not a text run carrying the
 * attr. Used for the BEFORE neighbor (the run holding `start.offset - 1`).
 */
function neighborSuggestionId(
  state: State,
  blockId: BlockId,
  containedOffset: number,
  attrKey: string,
): SuggestionId | null {
  if (containedOffset < 0) return null;
  const content = resolveBlock(state, blockId)?.block.inlineContent ?? null;
  if (content === null) return null;
  let cursor = 0;
  for (const item of content.items) {
    const len = item.kind === "text" ? item.text.length : 1;
    const itemStart = cursor;
    const itemEnd = cursor + len;
    if (containedOffset >= itemStart && containedOffset < itemEnd) {
      return textItemSuggestionId(item, attrKey);
    }
    cursor = itemEnd;
  }
  return null;
}

/**
 * The `attrKey` suggestion id of the text run that STARTS at document offset
 * `startOffset` in `blockId`, or `null` when no item starts there (e.g.
 * `startOffset` is at/after end-of-block, or the run there is not a text item
 * carrying the attr). Used for the AFTER neighbor (the run beginning at
 * `end.offset`).
 */
function neighborSuggestionAfter(
  state: State,
  blockId: BlockId,
  startOffset: number,
  attrKey: string,
): SuggestionId | null {
  const content = resolveBlock(state, blockId)?.block.inlineContent ?? null;
  if (content === null) return null;
  let cursor = 0;
  for (const item of content.items) {
    if (cursor === startOffset) {
      return textItemSuggestionId(item, attrKey);
    }
    cursor += item.kind === "text" ? item.text.length : 1;
    if (cursor > startOffset) break; // passed the boundary — no item starts exactly here
  }
  return null;
}

/** The `attrKey` suggestion id of a text item (a branded id after a string-typed read), or `null`. */
function textItemSuggestionId(
  item: { readonly kind: "text" | "embed"; readonly attrs: ReadonlyAttrs },
  attrKey: string,
): SuggestionId | null {
  if (item.kind !== "text") return null;
  const raw = item.attrs[attrKey];
  return typeof raw === "string" ? (raw as SuggestionId) : null;
}

/**
 * True iff the suggestion `id` resolves to a record satisfying `matches` (the
 * per-op coalesce predicate). Shared by `markFormatting` (same-author /
 * same-proposal) and `markDeletion` (same-author).
 */
function coalesces(state: State, id: SuggestionId, matches: CoalescePredicate): boolean {
  const record = readSuggestionRecord(state[STATE_INTERNAL].doc, id);
  return record !== null && matches(record);
}

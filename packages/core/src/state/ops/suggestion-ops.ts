import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { Position, Span } from "../block-position";
import { createSpan } from "../block-position";
import { spanStart, spanEnd } from "../block-compare";
import type { ReadonlyAttrs } from "../attrs";
import { attrsEqual } from "../attrs";
import {
  mergeAdjacentTextItems,
  type InlineItem,
} from "../inline-content";
import {
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
  INSERTION_SUGGESTION_ATTR,
  readSuggestionRecord,
  writeSuggestionRecordInTx,
  type SuggestionId,
} from "../suggestions";
import { STATE_INTERNAL } from "../state-internal";
import { getYBlock } from "../yjs-doc";
import { buildYInlineContent } from "../y-block";
import { planApplyAttrsToRange, applyAttrsToRangeInTx } from "./apply-attrs";
import { planInsertText, insertTextInTx } from "./insert-text";

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
  // Collapsed span = no-op. Collapsed-ness (same block + same offset) is
  // normalization-invariant, so we check raw positions directly; must return the
  // input State reference (identity).
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
  // own-insertions removed) PRE-transaction (pure); apply them in the tx — mirror
  // of `deleteComment`, which plans writes pre-tx then applies them in the tx.
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

  return applyOperation(state, (d) => {
    for (const write of writes) {
      getYBlock(d, write.blockId, "markDeletion", plan.kind).set(
        "inlineContent",
        buildYInlineContent({ items: write.items }),
      );
    }
    // Write the deletion record only when ≥1 run was actually tagged AND we are
    // not reusing an existing (coalesced) record. A whole-span-was-own-insertions
    // delete tags nothing → no record (the removal is itself the change).
    if (taggedAny && !reusing) {
      writeSuggestionRecordInTx(d, {
        id,
        kind: "deletion",
        author: input.author,
        createdAt: input.createdAt,
      });
    }
  });
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

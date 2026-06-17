import * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { Span } from "../block-position";
import type { ReadonlyAttrs } from "../attrs";
import { mergeAttrs, attrsEqual } from "../attrs";
import { iterateSpan, type BlockRange } from "../span-iteration";
import { getYBlock, requireInTransaction } from "../yjs-doc";
import { buildYAttrs, buildYInlineItem } from "../y-block";
import { yMapAsObject, mergeAdjacentSameAttrsTextItemsInPlace, yItemLength } from "../y-utils";
import { isStructuralMarkerEmbedType } from "../embed-markers";
import type { ResolvedBlockKind } from "../state";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../../cascade/attr-registry";

/**
 * Apply attrs to all inline content within a span.
 *
 * `attrs` is MERGED into each affected item's existing attrs. To remove
 * an attr, pass it with value `undefined` (e.g., `{ bold: undefined }`).
 *
 * For VISIBLE embed items intersecting the range (footnote-anchor,
 * cross-reference, page-field, tab), the merge applies to the embed's `attrs`
 * field (NOT `properties`, which holds intrinsic embed data) — so a field
 * inherits surrounding run formatting like Google Docs/Word. Zero-width
 * STRUCTURAL MARKER embeds (comment/suggestion markers — see
 * {@link isStructuralMarkerEmbedType}) are SKIPPED: they carry no formattable
 * content, and stamping a tracked-change provenance attr onto one would leave a
 * dangling reference after the suggestion resolves (#465).
 *
 * Returns OperationResult with dirtyIds = every block id whose items
 * changed.
 *
 * Behavior:
 *   - Empty incoming attrs ({}): no-op (returns original state with empty dirtyIds).
 *   - Empty span (anchor === focus, in same block at same offset): no-op.
 *   - Span is normalized first (anchor before focus in document order).
 *   - Single-block span: one block touched.
 *   - Multi-block span: each leaf block in the span is touched; the
 *     anchor block from anchor.offset to its end, intervening leaves
 *     fully, focus block from 0 to focus.offset.
 *
 * Throws via `iterateSpan`'s preconditions if endpoints are non-leaf
 * containers or different selection contexts.
 *
 * Y.Doc note: this op mutates Y types in place where possible. A text
 * item fully covered by the range has its attrs Y.Map replaced in place
 * (preserves the item's Y.Text identity, and therefore its per-character
 * CRDT identity). A partially-covered text item is split via
 * delete+insert because Yjs has no in-place split primitive on a single
 * Y.Text; the prefix and suffix are reissued as fresh items.
 *
 * After the per-item updates an IN-PLACE same-attrs merge pass
 * (`mergeAdjacentSameAttrsTextItemsInPlace`) runs over the touched block to
 * uphold the "no adjacent same-attrs text items" invariant (per
 * `inline-content.ts` mergeAdjacentTextItems contract). The merge only deletes
 * items when neighbors converge to value-equal attrs — items that stay distinct
 * keep their Y.Text identity, AND when a converging pair merges the RECEIVER
 * (lower-index run) keeps its Y.Text too (only the donor's migrated chars are
 * fresh — the Class-2 limit).
 *
 * `registry` (optional): an `AttrRegistry`; threaded to the run-merge
 * normalizer (`mergeAdjacentSameAttrsTextItemsInPlace`) so interpreters with a
 * custom per-key `equals` (e.g. a `comment` interpreter that ignores
 * `timestamp`) opt into custom adjacent-item compare semantics during
 * the post-apply merge pass. Omitted → deep-value compare.
 *
 * Composition: see `applyAttrsToRangeInTx` for the in-transaction primitive
 * (resolved via `planApplyAttrsToRange`) used to compose attr application
 * with other span/structural ops in a single Y.Doc transaction (one undo
 * entry / one collab event). Note its narrower composition scope: the
 * applier reads live Y items, so it is correct only when prior in-tx ops do
 * NOT shift this span's offsets.
 */
export function applyAttrsToRange(
  state: State,
  span: Span,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): OperationResult {
  // Empty incoming attrs = no-op. Mirrors insertText's empty-text guard
  // and avoids re-allocating items / dirtying blocks unnecessarily.
  if (Object.keys(attrs).length === 0) {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  // Empty span = no-op. Collapsed-ness (same block + same offset) is
  // normalization-invariant, so we check raw positions directly. Skips
  // iterateSpan entirely — must return the original State reference to
  // satisfy the "no-op preserves identity" contract.
  if (
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset
  ) {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  // Resolve the segments + owning tree BEFORE opening the transaction; the
  // public op then composes plan → applyOperation(InTx). iterateSpan's
  // precondition errors throw here (pre-tx) with their original messages.
  const plan = planApplyAttrsToRange(state, span);
  if (plan === null) {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  return applyOperation(state, (doc) => {
    applyAttrsToRangeInTx(doc, plan, attrs, registry);
  });
}

/**
 * Pre-computed plan for `applyAttrsToRangeInTx`. `segments` is the list of
 * per-leaf-block ranges yielded by `iterateSpan` (resolved against the
 * pre-mutation snapshot); `kind` is the span's single owning tree.
 */
export interface ApplyAttrsToRangePlan {
  readonly segments: readonly BlockRange[];
  readonly kind: ResolvedBlockKind;
}

/**
 * Validate `span` against `state` and produce an `ApplyAttrsToRangePlan`.
 *
 * All validation + snapshot reads happen here, BEFORE the surrounding
 * `applyOperation` is opened. `iterateSpan` owns precondition validation
 * (existence, leaf-block, same-selection-context) AND normalization, so its
 * precondition errors throw pre-tx with their original messages.
 *
 * Returns `null` when there is nothing to do (empty segment list — e.g. an
 * all-zero-width span). The two public-op no-ops (empty attrs; collapsed
 * span) are handled by the caller BEFORE planning, to preserve the
 * identity contract; they are not re-checked here.
 *
 * C.2c T7b: a span is confined to a single selection context (cross-context
 * spans are refused by `iterateSpan`), so all segments share one owning tree
 * — resolved ONCE from the first segment. `?? "block"` is a defensive
 * fallback (segments were just yielded by `iterateSpan`, so `resolveBlock`
 * cannot return null in correct code) that keeps the main-tree default.
 */
export function planApplyAttrsToRange(
  state: State,
  span: Span,
): ApplyAttrsToRangePlan | null {
  const segments = Array.from(iterateSpan(state, span));
  const firstSegment = segments[0];
  if (firstSegment === undefined) {
    return null;
  }
  const kind = resolveBlock(state, firstSegment.block.id)?.kind ?? "block";
  return { segments, kind };
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed
 * `ApplyAttrsToRangePlan` to `doc`. Caller is responsible for all
 * validation (via `planApplyAttrsToRange`) and for opening the surrounding
 * `applyOperation` / `runTransaction` (this MUST run inside an already-open
 * transaction; it does NOT open one itself).
 *
 * Unlike the read-free structural-write primitives (e.g. `insertBlockInTx`),
 * this applier READS live Y items by necessity: it walks the live Y.Array to
 * locate item boundaries and split partially-covered text, performing in-place
 * identity-preserving attr writes (`yItem.set("attrs", …)`) so a fully-covered
 * item keeps its Y.Text — and therefore its per-character CRDT — identity.
 *
 * Composition scope: correct for the standalone op AND for composition with
 * prior in-tx ops that do NOT shift this span's offsets. Composing it
 * atomically AFTER an offset-changing op (delete/insert) requires re-resolving
 * the span against the mid-transaction live Y state — out of scope for this
 * primitive; that re-resolution lands with the consuming feature.
 */
export function applyAttrsToRangeInTx(
  doc: Y.Doc,
  plan: ApplyAttrsToRangePlan,
  attrs: ReadonlyAttrs,
  registry: AttrRegistry | undefined,
): void {
  requireInTransaction(doc, "applyAttrsToRange");
  for (const seg of plan.segments) {
    if (seg.rangeStart >= seg.rangeEnd) continue; // zero-width range in this block
    const yBlock = getYBlock(doc, seg.block.id, "applyAttrsToRange", plan.kind);
    const yItems = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>> | null;
    if (yItems === null) continue; // defensive — iterateSpan only yields leaves
    applyAttrsToBlockRange(yItems, seg.rangeStart, seg.rangeEnd, attrs, registry);
    mergeAdjacentSameAttrsTextItemsInPlace(yItems, registry);
  }
}

/**
 * Walk one block's Y items and apply attrs to the portion overlapping
 * [start, end). Mutates `yItems` in place:
 *   - Items entirely outside the range are skipped.
 *   - VISIBLE embed items in range have their attrs Y.Map replaced; zero-width
 *     STRUCTURAL MARKER embeds are skipped entirely (#465).
 *   - Text items fully covered have their attrs Y.Map replaced (preserves
 *     Y.Text identity).
 *   - Text items partially covered are split into up to three replacement
 *     items via `yItems.delete + insert`. Yjs has no in-place Y.Text
 *     split, so the prefix and suffix portions are reissued as fresh
 *     items with the item's pre-existing attrs.
 */
function applyAttrsToBlockRange(
  yItems: Y.Array<Y.Map<unknown>>,
  start: number,
  end: number,
  newAttrs: ReadonlyAttrs,
  registry: AttrRegistry | undefined,
): void {
  if (start === end) return;

  let cursor = 0;
  let i = 0;
  while (i < yItems.length) {
    const yItem = yItems.get(i);
    const kind = yItem.get("kind") as "text" | "embed";
    const itemLen = yItemLength(yItem);
    const itemEnd = cursor + itemLen;

    // Item entirely before the range — advance.
    if (itemEnd <= start) {
      cursor = itemEnd;
      i++;
      continue;
    }
    // Item entirely after the range — done.
    if (cursor >= end) break;

    const existingAttrs = yMapAsObject(yItem.get("attrs") as Y.Map<unknown>) as ReadonlyAttrs;
    const merged = mergeAttrs(existingAttrs, newAttrs);

    if (kind === "embed") {
      // Zero-width STRUCTURAL MARKER embeds (comment-start/end, block-join/
      // split-suggestion) carry NO formattable content — their meaning lives in
      // `properties`, not text-format `attrs`. Never stamp inline-format attrs
      // onto them (#465): a `bold`/`color` is meaningless, and a tracked-change
      // provenance attr (formattingSuggestionId, via markFormatting) would
      // dangle after the suggestion record is deleted on resolve. Skip the write
      // but still advance past the marker's one cursor position. VISIBLE field
      // embeds (footnote-anchor, cross-reference, page-field, tab) fall through
      // and DO inherit run formatting, like Google Docs/Word fields.
      const embedType = yItem.get("embedType") as string;
      if (isStructuralMarkerEmbedType(embedType)) {
        cursor = itemEnd;
        i++;
        continue;
      }
      // Visible embed is one cursor position; in-range → update attrs in place.
      // No-op guard (#358): when `merged` equals the existing attrs (e.g.,
      // toggleBold over an already-bold range), the Y.Map write would still
      // fire a Yjs change event and dirty this block — cascading into
      // unnecessary re-render and re-layout. Skip the write when nothing
      // would change. (Matches setBlockAttrs's no-op guard for the single-
      // block variant.)
      if (!attrsEqual(existingAttrs, merged, registry)) {
        yItem.set("attrs", buildYAttrs(merged));
      }
      cursor = itemEnd;
      i++;
      continue;
    }

    const localStart = Math.max(0, start - cursor);
    const localEnd = Math.min(itemLen, end - cursor);

    if (localStart === 0 && localEnd === itemLen) {
      // Entire text item in range — update attrs in place (preserves Y.Text identity).
      // Same no-op guard (#358) as the embed branch above.
      if (!attrsEqual(existingAttrs, merged, registry)) {
        yItem.set("attrs", buildYAttrs(merged));
      }
      cursor = itemEnd;
      i++;
      continue;
    }

    // Partial overlap: split into [before?, middle, after?].
    const fullText = (yItem.get("text") as Y.Text).toString();
    const before = fullText.slice(0, localStart);
    const middle = fullText.slice(localStart, localEnd);
    const after = fullText.slice(localEnd);

    const replacements: Y.Map<unknown>[] = [];
    if (before.length > 0) {
      replacements.push(buildYInlineItem({ kind: "text", text: before, attrs: existingAttrs }));
    }
    replacements.push(buildYInlineItem({ kind: "text", text: middle, attrs: merged }));
    if (after.length > 0) {
      replacements.push(buildYInlineItem({ kind: "text", text: after, attrs: existingAttrs }));
    }
    yItems.delete(i, 1);
    yItems.insert(i, replacements);
    i += replacements.length;
    cursor = itemEnd;
  }
}


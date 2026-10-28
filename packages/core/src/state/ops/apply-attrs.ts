import type * as Y from "yjs";
import { blockText } from "../block-text";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { Span } from "../block-position";
import type { ReadonlyAttrs } from "../attrs";
import { iterateSpan, type BlockRange } from "../span-iteration";
import { requireInTransaction } from "../yjs-doc";
import { formatInlineRange } from "../y-inline";
import { mergeMarkAttrs } from "../flow-ops";
import { inlineContentLength } from "../inline-content";
import type { ResolvedBlockKind } from "../state";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import { attrRegistryOf } from "../mark-attrs";

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
 * dangling reference after the suggestion resolves.
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
 * Y.Doc note: one `Y.Text.format` per maximal changed, non-marker subrange of
 * each block (`formatInlineRange`). `format` never deletes or re-mints
 * characters, so every character keeps its CRDT identity — a `RelativePosition`
 * and an open undo entry survive any formatting. Items the attrs would not
 * change are not written (no-op guard: no Yjs event, no dirty block).
 * A `null` / `undefined` value removes the key (stored attrs never hold null).
 *
 * The ¶: when the span covers a paragraph's ¶ (it continues
 * past the paragraph) or ends at the paragraph's end with content selected, the
 * inclusive keys of `attrs` are merged into that ¶'s `markAttrs` (judged by the registry
 * bound to the doc).
 *
 * The attr registry bound to the doc supplies per-key `equals`, deciding whether an
 * item already holds the incoming value (custom equality, e.g. a `comment`
 * interpreter that ignores `timestamp`). None bound → deep-value compare.
 *
 * Composition: see `applyAttrsToRangeInTx` for the in-transaction primitive
 * (resolved via `planApplyAttrsToRange`) used to compose attr application
 * with other span/structural ops in a single Y.Doc transaction (one undo
 * entry / one collab event). Note its narrower composition scope: the
 * plan's offsets are pre-transaction, so it is correct only when prior in-tx
 * ops do NOT shift this span's offsets.
 */
export function applyAttrsToRange(
  state: State,
  span: Span,
  attrs: ReadonlyAttrs,
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
    applyAttrsToRangeInTx(doc, plan, attrs);
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
 * A span is confined to a single selection context (cross-context
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
 * The applier reads each block's live inline items to split the format around
 * markers and unchanged items; every write is an identity-preserving
 * `Y.Text.format`.
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
): void {
  requireInTransaction(doc, "applyAttrsToRange");
  const registry = attrRegistryOf(doc);
  const last = plan.segments[plan.segments.length - 1];
  for (const seg of plan.segments) {
    // The span covers ¶P (it continues past P) or ends at (P, len) with content
    // selected: P's ¶ is formatted too (Word / GDocs format the ¶'s rPr).
    const len = seg.block.inlineContent === null ? -1 : inlineContentLength(seg.block.inlineContent);
    const coversMark = seg.rangeEnd === len && (seg !== last || seg.rangeStart < seg.rangeEnd);
    // The text is formatted FIRST: a write to an implicit run materializes its ¶ and
    // renames it (`yText.id`), so the ¶ props then go to that same paragraph.
    const yText = seg.rangeStart < seg.rangeEnd ? blockText(doc, seg.block.id) : null;
    if (yText !== null) formatInlineRange(yText, seg.rangeStart, seg.rangeEnd, attrs, registry);
    if (coversMark) mergeMarkAttrs(doc, yText?.id ?? seg.block.id, attrs);
  }
}

import * as Y from "yjs";
import type { State, OperationResult } from "./state";
import { applyOperation, resolveBlock } from "./state";
import type { BlockId } from "./block-id";
import type { Span } from "./block-position";
import type { ReadonlyAttrs } from "./attrs";
import { mergeAttrs } from "./attrs";
import { iterateSpan } from "./span-iteration";
import { getYBlock } from "./yjs-doc";
import { buildYAttrs, buildYInlineItem } from "./y-block";
import { yMapAsObject, mergeAdjacentSameAttrsTextItems } from "./y-utils";
import { STATE_INTERNAL } from "./state-internal";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../cascade/attr-registry";

/**
 * Apply attrs to all inline content within a span.
 *
 * `attrs` is MERGED into each affected item's existing attrs. To remove
 * an attr, pass it with value `undefined` (e.g., `{ bold: undefined }`).
 *
 * For embed items intersecting the range, the merge applies to the embed's
 * `attrs` field (wrap attrs like link/comment-range — NOT `properties`,
 * which holds intrinsic embed data).
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
 * After the per-item updates a same-attrs merge pass runs over the
 * touched block to uphold the "no adjacent same-attrs text items"
 * invariant (per `inline-content.ts` mergeAdjacentTextItems contract).
 * The merge only deletes items when neighbors converge to value-equal
 * attrs — items that stay distinct keep their Y.Text identity intact.
 *
 * `registry` (optional): an `AttrRegistry`; threaded to the run-merge
 * normalizer (`mergeAdjacentSameAttrsTextItems`) so interpreters with a
 * custom per-key `equals` (e.g. a `comment` interpreter that ignores
 * `timestamp`) opt into custom adjacent-item compare semantics during
 * the post-apply merge pass. Omitted → deep-value compare.
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

  // iterateSpan owns precondition validation (existence, leaf-block,
  // same-selection-context) AND normalization. We resolve the segments
  // up-front (outside the transaction) so its precondition errors throw
  // with their original messages, before any Y.Doc mutation happens.
  const segments = Array.from(iterateSpan(state, span));

  // C.2c T7b: resolve the OWNING tree so a span inside a header/footer body
  // (templateContents) mutates the right Y.Map. A span is confined to a single
  // selection context (cross-context spans are refused by iterateSpan), so all
  // segments share one kind — resolve it ONCE, here, from the first segment.
  // Resolving BEFORE opening the transaction keeps the applier read-free,
  // matching the plan/apply pattern the rest of Layer 3 uses (deleteRange,
  // reparentChildren). `?? "block"` is a defensive fallback (segments were just
  // yielded by iterateSpan, so resolveBlock cannot return null in correct code)
  // that keeps the main-tree default.
  const kind =
    segments.length > 0
      ? resolveBlock(state, segments[0].block.id)?.kind ?? "block"
      : "block";

  return applyOperation(state, () => {
    for (const seg of segments) {
      if (seg.rangeStart >= seg.rangeEnd) continue; // zero-width range in this block
      const yBlock = getYBlock(state[STATE_INTERNAL].doc, seg.block.id, "applyAttrsToRange", kind);
      const yItems = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>> | null;
      if (yItems === null) continue; // defensive — iterateSpan only yields leaves
      applyAttrsToBlockRange(yItems, seg.rangeStart, seg.rangeEnd, attrs);
      mergeAdjacentSameAttrsTextItems(yItems, registry);
    }
  });
}

/**
 * Walk one block's Y items and apply attrs to the portion overlapping
 * [start, end). Mutates `yItems` in place:
 *   - Items entirely outside the range are skipped.
 *   - Embed items in range have their attrs Y.Map replaced.
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
): void {
  if (start === end) return;

  let cursor = 0;
  let i = 0;
  while (i < yItems.length) {
    const yItem = yItems.get(i);
    const kind = yItem.get("kind") as "text" | "embed";
    const itemLen = kind === "text" ? (yItem.get("text") as Y.Text).length : 1;
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
      // Embed is one cursor position; in-range → update attrs in place.
      yItem.set("attrs", buildYAttrs(merged));
      cursor = itemEnd;
      i++;
      continue;
    }

    const localStart = Math.max(0, start - cursor);
    const localEnd = Math.min(itemLen, end - cursor);

    if (localStart === 0 && localEnd === itemLen) {
      // Entire text item in range — update attrs in place (preserves Y.Text identity).
      yItem.set("attrs", buildYAttrs(merged));
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


import * as Y from "yjs";
import type { ReadonlyAttrs } from "./attrs";
import { attrsEqual } from "./attrs";
import { buildYInlineItem } from "./y-block";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../cascade/attr-registry";

/**
 * Assert that `value` and its nested children contain no live Yjs shared
 * types (Y.Map / Y.Array / Y.Text / etc., all subclasses of
 * `Y.AbstractType`). The state-tree contract restricts inline-item
 * `attrs` and `properties` to primitive JSON-serializable scalars (with
 * `contentBlockId` as the only mechanism for cross-block references).
 *
 * This is a defense in depth: nested Y types in attrs/properties would
 * leak as live shared-type references into "frozen" Block snapshots
 * (silently mutating post-snapshot) and, worse, would be copied across
 * Y.Docs on cross-doc paste — undefined CRDT behavior. We assert on both
 * the write path (`buildYInlineItem`) and the read path (`yMapAsObject`
 * and snapshot's `yMapToObject`) so peer-replicated data is also caught.
 */
export function assertNoNestedYTypes(value: unknown, contextPath: string): void {
  if (value instanceof Y.AbstractType) {
    throw new Error(
      `${contextPath}: nested Y types are not allowed in inline-item properties / attrs. ` +
        `Use plain JSON-serializable values. To reference another block, use contentBlockId.`,
    );
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoNestedYTypes(v, `${contextPath}[${i}]`));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      assertNoNestedYTypes(v, `${contextPath}.${k}`);
    }
  }
}

/**
 * Snapshot a Y.Map's current entries as a plain object. Used by Layer 3
 * ops to read attrs/properties Y.Maps into the value-shape that builder
 * helpers expect.
 *
 * Asserts at the leaf-value level that no nested Y types are present —
 * see `assertNoNestedYTypes`. This catches bad data already present in a
 * Y.Doc (e.g. from a collab peer that bypassed our builders).
 */
export function yMapAsObject(yMap: Y.Map<unknown>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of yMap.entries()) {
    assertNoNestedYTypes(value, key);
    obj[key] = value;
  }
  return obj;
}

/**
 * Deep-clone a Y.Map representing an inline item (TextItem or EmbedItem).
 * The clone has fresh Y.Text / Y.Map identity — does NOT share state with
 * the source. Used by ops like splitBlockAtPosition and mergeAdjacentBlocks
 * that move items between blocks.
 *
 * Returns a detached Y.Map (must be integrated into a Y.Doc before reads
 * per the y-block.ts contract).
 */
export function cloneInlineItem(src: Y.Map<unknown>): Y.Map<unknown> {
  const kind = src.get("kind") as "text" | "embed";
  if (kind === "text") {
    return buildYInlineItem({
      kind: "text",
      text: (src.get("text") as Y.Text).toString(),
      attrs: yMapAsObject(src.get("attrs") as Y.Map<unknown>),
    });
  }
  return buildYInlineItem({
    kind: "embed",
    embedType: src.get("embedType") as string,
    attrs: yMapAsObject(src.get("attrs") as Y.Map<unknown>),
    properties: yMapAsObject(src.get("properties") as Y.Map<unknown>),
  });
}

/** Cursor length of one inline item: text → its Y.Text length, embed → 1. */
export function yItemLength(yItem: Y.Map<unknown>): number {
  const kind = yItem.get("kind") as "text" | "embed";
  return kind === "text" ? (yItem.get("text") as Y.Text).length : 1;
}

/**
 * Walk `yItems` and merge any adjacent same-attrs text-item pairs, and
 * drop any zero-length text items. Items whose neighbors don't converge
 * keep their Y.Text identity intact — only the converging pairs lose
 * identity (the merged result is a fresh Y.Text holding the concatenated
 * content).
 *
 * This is the GENERAL normalizer: it is safe on a not-yet-integrated (detached)
 * `Y.Array` because it never mutates a `Y.Text` in place (it rebuilds the pair
 * via `buildYInlineItem`). Live-array post-edit APPLIERS instead use the
 * identity-preserving twin {@link mergeAdjacentSameAttrsTextItemsInPlace} (the
 * receiver keeps its `Y.Text`). This function is retained for detached-array
 * normalization and as the Y-side oracle of the JS↔Y drift property test
 * (`normalization-drift.test.ts`); the twins produce byte-identical read-back.
 *
 * Zero-length text items are dropped in-place. The drop must happen WITHIN
 * the merge loop (not as a separate pre-pass) so that an empty bridge
 * between two same-attrs neighbors does not block their merge: when an
 * empty item is removed, we step back so the now-adjacent pair is
 * re-evaluated for a same-attrs merge.
 *
 * `registry` (optional) is threaded through to `attrsEqual` so interpreters
 * with a custom per-key `equals` opt into custom run-merge equality. The
 * Y-side normalizer must mirror the JS-side one (`mergeAdjacentTextItems`)
 * to uphold the T19 drift invariant.
 *
 * Upholds two normalization invariants mirroring `mergeAdjacentTextItems`:
 *   (a) no two adjacent text items with equal attrs;
 *   (b) no zero-length text items.
 */
export function mergeAdjacentSameAttrsTextItems(
  yItems: Y.Array<Y.Map<unknown>>,
  registry?: AttrRegistry,
): void {
  let i = 0;
  while (i + 1 < yItems.length) {
    const a = yItems.get(i);
    const b = yItems.get(i + 1);
    // Drop a zero-length text item at position i. Step back so the pair
    // (i-1, i) that was previously bridged by the empty item is re-evaluated
    // for a same-attrs merge.
    if (a.get("kind") === "text" && (a.get("text") as Y.Text).toString() === "") {
      yItems.delete(i, 1);
      if (i > 0) i--;
      continue;
    }
    // Drop a zero-length text item at position i+1. Don't advance i — the
    // next item slides into position i+1 and needs evaluation against a.
    if (b.get("kind") === "text" && (b.get("text") as Y.Text).toString() === "") {
      yItems.delete(i + 1, 1);
      continue;
    }
    if (a.get("kind") !== "text" || b.get("kind") !== "text") {
      i++;
      continue;
    }
    const aAttrs = yMapAsObject(a.get("attrs") as Y.Map<unknown>) as ReadonlyAttrs;
    const bAttrs = yMapAsObject(b.get("attrs") as Y.Map<unknown>) as ReadonlyAttrs;
    if (!attrsEqual(aAttrs, bAttrs, registry)) {
      i++;
      continue;
    }
    const aText = (a.get("text") as Y.Text).toString();
    const bText = (b.get("text") as Y.Text).toString();
    yItems.delete(i, 2);
    yItems.insert(i, [buildYInlineItem({ kind: "text", text: aText + bText, attrs: aAttrs })]);
    // Don't advance i — the merged item may now be mergeable with the next.
  }
  // Trailing single empty item (length is 1 and only item is empty text)
  // is not reachable by the pairwise loop above; sweep it here.
  if (yItems.length === 1) {
    const only = yItems.get(0);
    if (only.get("kind") === "text" && (only.get("text") as Y.Text).toString() === "") {
      yItems.delete(0, 1);
    }
  }
}

/**
 * Identity-PRESERVING twin of `mergeAdjacentSameAttrsTextItems`: same normalized
 * result (no adjacent same-attrs text items; no zero-length text items; same
 * registry-aware equality) but it merges a converging pair by APPENDING the
 * donor's text into the RECEIVER's existing `Y.Text` in place (`yText.insert`) and
 * deleting the donor item — rather than replacing both with a fresh `Y.Text`. The
 * receiver keeps its CRDT identity (a `RelativePosition` into it survives); the
 * donor's migrated chars are fresh (the Class-2 limit — Yjs has no identity-
 * preserving cross-`Y.Text` move). Used by the surgical inline-mutation ops.
 */
export function mergeAdjacentSameAttrsTextItemsInPlace(
  yItems: Y.Array<Y.Map<unknown>>,
  registry?: AttrRegistry,
): void {
  let i = 0;
  while (i + 1 < yItems.length) {
    const a = yItems.get(i);
    const b = yItems.get(i + 1);
    if (a.get("kind") === "text" && (a.get("text") as Y.Text).length === 0) {
      yItems.delete(i, 1);
      if (i > 0) i--;
      continue;
    }
    if (b.get("kind") === "text" && (b.get("text") as Y.Text).length === 0) {
      yItems.delete(i + 1, 1);
      continue;
    }
    if (a.get("kind") !== "text" || b.get("kind") !== "text") {
      i++;
      continue;
    }
    const aAttrs = yMapAsObject(a.get("attrs") as Y.Map<unknown>) as ReadonlyAttrs;
    const bAttrs = yMapAsObject(b.get("attrs") as Y.Map<unknown>) as ReadonlyAttrs;
    if (!attrsEqual(aAttrs, bAttrs, registry)) {
      i++;
      continue;
    }
    // Append donor (b) into receiver (a) in place; a keeps identity, b is dropped.
    // Don't advance — the grown `a` may now merge with the following item.
    const aText = a.get("text") as Y.Text;
    const bText = b.get("text") as Y.Text;
    aText.insert(aText.length, bText.toString());
    yItems.delete(i + 1, 1);
  }
  if (yItems.length === 1) {
    const only = yItems.get(0);
    if (only.get("kind") === "text" && (only.get("text") as Y.Text).length === 0) {
      yItems.delete(0, 1);
    }
  }
}

/**
 * Delete the flattened inline range `[start, end)` from a block's live
 * `inlineContent` `Y.Array` IN PLACE — the surgical, identity-preserving
 * alternative to rebuilding via `buildYInlineContent`. Runs of text OUTSIDE the
 * deleted range (and the surviving portion of a straddled run) keep their `Y.Text`
 * CRDT identity, so a `RelativePosition` anchored there survives. Caller must run
 * inside an open transaction.
 *
 * Read-back is byte-identical to `buildYInlineContent(mergeAdjacentTextItems(...))`:
 *   - text item fully inside the range → removed;
 *   - text item partially inside → trimmed via a SINGLE `yText.delete` (one call
 *     covers straddle-start, straddle-end, or both-endpoints-in-this-item);
 *   - embed item (atomic, width 1) intersecting the range → removed;
 *   - then the seam is normalized in place (drop empties + merge adjacent
 *     same-attrs runs, receiver keeps identity) via
 *     `mergeAdjacentSameAttrsTextItemsInPlace`.
 */
export function surgicallyDeleteInlineRangeInTx(
  yItems: Y.Array<Y.Map<unknown>>,
  start: number,
  end: number,
  registry?: AttrRegistry,
): void {
  // Phase A — plan per-item mutations against the LIVE items at their pre-delete
  // flattened offsets. Trims capture the live `Y.Text` handle (index-shift-immune);
  // full-item removals are collected and applied high→low after.
  const trims: { yText: Y.Text; at: number; count: number }[] = [];
  const removeIndices: number[] = [];
  let itemStart = 0;
  for (let i = 0; i < yItems.length; i++) {
    const item = yItems.get(i);
    const len = yItemLength(item);
    const itemEnd = itemStart + len;
    const lo = Math.max(start, itemStart);
    const hi = Math.min(end, itemEnd);
    if (lo < hi) {
      if (item.get("kind") === "text" && !(lo === itemStart && hi === itemEnd)) {
        // Partial trim — ONE delete covers straddle-start / straddle-end / both.
        trims.push({ yText: item.get("text") as Y.Text, at: lo - itemStart, count: hi - lo });
      } else {
        // Text fully inside, or an embed intersecting (atomic) → remove the item.
        removeIndices.push(i);
      }
    }
    itemStart = itemEnd;
  }
  // Phase B — apply trims (live handles, order-independent), then removals high→low.
  for (const t of trims) t.yText.delete(t.at, t.count);
  removeIndices.sort((a, b) => b - a);
  for (const idx of removeIndices) yItems.delete(idx, 1);
  // Phase C — normalize the seam in place (receiver keeps identity).
  mergeAdjacentSameAttrsTextItemsInPlace(yItems, registry);
}

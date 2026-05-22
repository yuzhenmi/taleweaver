import * as Y from "yjs";
import type { ReadonlyAttrs } from "./attrs";
import { attrsEqual } from "./attrs";
import { buildYInlineItem } from "./y-block";

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

/**
 * Walk `yItems` and merge any adjacent same-attrs text-item pairs. Items
 * whose neighbors don't converge keep their Y.Text identity intact —
 * only the converging pairs lose identity (the merged result is a fresh
 * Y.Text holding the concatenated content). Upholds the
 * mergeAdjacentTextItems invariant for Layer 3 ops that may produce
 * adjacent text items with equal attrs (e.g. applyAttrsToRange after
 * attr changes, mergeAdjacentBlocks at the seam).
 */
export function mergeAdjacentSameAttrsTextItems(
  yItems: Y.Array<Y.Map<unknown>>,
): void {
  let i = 0;
  while (i + 1 < yItems.length) {
    const a = yItems.get(i);
    const b = yItems.get(i + 1);
    if (a.get("kind") !== "text" || b.get("kind") !== "text") {
      i++;
      continue;
    }
    const aAttrs = yMapAsObject(a.get("attrs") as Y.Map<unknown>) as ReadonlyAttrs;
    const bAttrs = yMapAsObject(b.get("attrs") as Y.Map<unknown>) as ReadonlyAttrs;
    if (!attrsEqual(aAttrs, bAttrs)) {
      i++;
      continue;
    }
    const aText = (a.get("text") as Y.Text).toString();
    const bText = (b.get("text") as Y.Text).toString();
    yItems.delete(i, 2);
    yItems.insert(i, [buildYInlineItem({ kind: "text", text: aText + bText, attrs: aAttrs })]);
    // Don't advance i — the merged item may now be mergeable with the next.
  }
}

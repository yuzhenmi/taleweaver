import * as Y from "yjs";
import type { ReadonlyAttrs } from "./attrs";
import { attrsEqual } from "./attrs";
import { buildYInlineItem } from "./y-block";

/**
 * Snapshot a Y.Map's current entries as a plain object. Used by Layer 3
 * ops to read attrs/properties Y.Maps into the value-shape that builder
 * helpers expect.
 */
export function yMapAsObject(yMap: Y.Map<unknown>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of yMap.entries()) obj[key] = value;
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

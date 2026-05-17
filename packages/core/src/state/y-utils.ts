import * as Y from "yjs";
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

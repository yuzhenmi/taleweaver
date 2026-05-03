import { createTextItem, createEmbedItem } from "../state/inline-content";
import type { TextItem, EmbedItem } from "../state/inline-content";
import type { ReadonlyAttrs } from "../state/attrs";

/**
 * Convenience wrappers around createTextItem / createEmbedItem for use in
 * tests. Identical behavior; shorter call sites.
 */
export function text(content: string, attrs?: ReadonlyAttrs): TextItem {
  return createTextItem(content, attrs);
}

export function embed(
  embedType: string,
  properties?: Readonly<Record<string, unknown>>,
  attrs?: ReadonlyAttrs,
): EmbedItem {
  return createEmbedItem(embedType, properties, attrs);
}

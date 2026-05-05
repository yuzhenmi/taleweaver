import type { ReadonlyAttrs } from "./attrs";
import { attrsEqual } from "./attrs";

/**
 * Inline content of a leaf block: an ordered sequence of styled text runs
 * and inline embed items. Adjacent text items with equal attrs should be
 * merged in a normalize pass after every Layer-3 operation (Phase 2).
 */
export interface InlineContent {
  readonly items: ReadonlyArray<InlineItem>;
}

export type InlineItem = TextItem | EmbedItem;

/** A run of styled text. `text` is in UTF-16 code units. */
export interface TextItem {
  readonly kind: "text";
  readonly text: string;
  readonly attrs: ReadonlyAttrs;
}

/**
 * An inline embed (image, mention, equation, footnote-anchor, hard-break, etc.).
 * Counts as exactly one cursor position. `properties` carries primitive embed
 * data inline, OR a contentBlockId reference for substantial-content embeds
 * (footnote anchors). `attrs` carries attributes that *wrap* the embed
 * (e.g., link, comment-range).
 */
export interface EmbedItem {
  readonly kind: "embed";
  readonly embedType: string;
  readonly attrs: ReadonlyAttrs;
  readonly properties: Readonly<Record<string, unknown>>;
}

const EMPTY_ATTRS: ReadonlyAttrs = Object.freeze({});

export function createTextItem(text: string, attrs: ReadonlyAttrs = EMPTY_ATTRS): TextItem {
  return Object.freeze({
    kind: "text",
    text,
    attrs: attrs === EMPTY_ATTRS ? attrs : Object.freeze({ ...attrs }),
  });
}

export function createEmbedItem(
  embedType: string,
  properties: Readonly<Record<string, unknown>> = {},
  attrs: ReadonlyAttrs = EMPTY_ATTRS,
): EmbedItem {
  return Object.freeze({
    kind: "embed",
    embedType,
    attrs: attrs === EMPTY_ATTRS ? attrs : Object.freeze({ ...attrs }),
    properties: Object.freeze({ ...properties }),
  });
}

export function createInlineContent(items: ReadonlyArray<InlineItem>): InlineContent {
  return Object.freeze({ items: Object.freeze([...items]) });
}

/**
 * Total length of inline content, in Position.offset units.
 * Each text item contributes text.length (UTF-16 code units).
 * Each embed item contributes 1 (single cursor position).
 */
export function inlineContentLength(content: InlineContent): number {
  let total = 0;
  for (const item of content.items) {
    total += item.kind === "text" ? item.text.length : 1;
  }
  return total;
}

/**
 * Locate the inline item containing `offset`. `withinItem` is the offset
 * into that item (0 for embed items, char-offset for text items).
 *
 * Returns `{ itemIndex: items.length, withinItem: 0 }` when offset equals
 * the total inline-content length (end-of-block).
 *
 * Behavior at item boundaries: when `offset` exactly equals the start of
 * an item (i.e., the cumulative length up to but not including item N),
 * returns `{ itemIndex: N, withinItem: 0 }`.
 */
export function findItemAtOffset(
  content: InlineContent,
  offset: number,
): { itemIndex: number; withinItem: number } {
  let cursor = 0;
  for (let i = 0; i < content.items.length; i++) {
    const item = content.items[i];
    const itemLen = item.kind === "text" ? item.text.length : 1;
    if (offset < cursor + itemLen) {
      return { itemIndex: i, withinItem: offset - cursor };
    }
    cursor += itemLen;
  }
  return { itemIndex: content.items.length, withinItem: 0 };
}

/**
 * Merge adjacent text items with equal attrs into a single item.
 * Embed items act as barriers and are not merged with their neighbors,
 * even if neighboring text items have identical attrs.
 *
 * Used by every Layer 3 operation that produces inline content (insertText,
 * applyAttrsToRange, splitBlockAtPosition, mergeAdjacentBlocks, etc.) to
 * uphold the normalization invariant: a block's items[] never has two
 * adjacent text items with equal attrs.
 *
 * Returns a fresh array; never mutates the input.
 */
export function mergeAdjacentTextItems(items: ReadonlyArray<InlineItem>): InlineItem[] {
  if (items.length <= 1) return [...items];
  const out: InlineItem[] = [];
  let pending: TextItem | null = null;

  for (const item of items) {
    if (item.kind === "text") {
      if (pending && attrsEqual(pending.attrs, item.attrs)) {
        pending = createTextItem(pending.text + item.text, pending.attrs);
      } else {
        if (pending) out.push(pending);
        pending = item;
      }
    } else {
      if (pending) {
        out.push(pending);
        pending = null;
      }
      out.push(item);
    }
  }
  if (pending) out.push(pending);
  return out;
}

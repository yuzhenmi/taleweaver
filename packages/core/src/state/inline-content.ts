import type { ReadonlyAttrs } from "./attrs";

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

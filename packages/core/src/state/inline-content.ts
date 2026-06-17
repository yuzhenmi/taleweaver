import type { ReadonlyAttrs } from "./attrs";
import { attrsEqual } from "./attrs";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../cascade/attr-registry";

/**
 * Inline content of a leaf block: an ordered sequence of styled text runs
 * and inline embed items. Adjacent text items with equal attrs should be
 * merged in a normalize pass after every Layer-3 operation.
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

/**
 * Embed-type discriminant for an inline image — an image that flows IN LINE with
 * text (Google Docs "In line" positioning), counting as a single cursor
 * position like any other embed. Its `properties` carry the image data
 * (e.g. `src`, `width`, `height`, `alt`). `embedType` is an open string
 * discriminant, so no central registration is needed — this constant exists so
 * call sites stamp/match the type without hardcoding the literal.
 */
export const INLINE_IMAGE_EMBED_TYPE = "inline-image" as const;

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
  // T32: out-of-range guard. Pre-T32, `offset > total` silently fell through
  // the loop and returned end-of-content — making out-of-bounds callers
  // (and the splitInlineContentAtOffset delegate) silently truncate. The
  // check is STRICTLY GREATER, not >=, because `offset === total` is a
  // legitimate end-of-block position used by end-of-block splits.
  const total = inlineContentLength(content);
  if (offset < 0 || offset > total) {
    throw new Error(
      `findItemAtOffset: offset ${offset} out of range [0, ${total}]`,
    );
  }
  let cursor = 0;
  for (let i = 0; i < content.items.length; i++) {
    const item = content.items[i];
    if (item === undefined) {
      // Unreachable: i is bounded by content.items.length, so the lookup is in range.
      throw new Error(`findItemAtOffset: items index ${i} out of range`);
    }
    const itemLen = item.kind === "text" ? item.text.length : 1;
    if (offset < cursor + itemLen) {
      return { itemIndex: i, withinItem: offset - cursor };
    }
    cursor += itemLen;
  }
  return { itemIndex: content.items.length, withinItem: 0 };
}

/**
 * The attrs of the run containing the char at `offset` (the FOLLOWING run at a
 * run boundary — `findItemAtOffset`'s boundary semantics). Used to resolve the
 * formatting a replacement should inherit: the attrs of the run the match's
 * first char sits in (Google Docs behavior).
 *
 * Falls back to `{}` when `offset` lands at end-of-content (no item there) — and
 * by extension when `content.items` is empty. (An embed item's `attrs` are
 * returned as-is; a real `findMatches` match never starts on an embed, but the
 * helper stays total.)
 */
export function attrsAtOffset(content: InlineContent, offset: number): ReadonlyAttrs {
  const { itemIndex } = findItemAtOffset(content, offset);
  return content.items[itemIndex]?.attrs ?? {};
}

/**
 * Merge adjacent text items with equal attrs into a single item, and drop
 * zero-length text items. Embed items act as barriers and are not merged
 * with their neighbors, even if neighboring text items have identical attrs.
 *
 * Zero-length text items are dropped WITHIN the merge loop (not as a
 * separate pre-pass) so that an empty bridge between two same-attrs
 * neighbors does not block their merge: e.g.
 *   [text("a", {bold}), text("", {}), text("b", {bold})]
 *     → [text("ab", {bold})]
 *
 * `registry` (optional) is threaded through to `attrsEqual` so interpreters
 * with a custom per-key `equals` (e.g. a `comment` interpreter that ignores
 * `timestamp`) can opt into custom run-merge equality. Omitted → pure
 * deep-value compare.
 *
 * Used by every Layer 3 operation that produces inline content (insertText,
 * applyAttrsToRange, splitBlockAtPosition, mergeAdjacentBlocks, etc.) to
 * uphold two normalization invariants on a block's items[]:
 *   (a) no two adjacent text items with equal attrs;
 *   (b) no zero-length text items.
 *
 * Returns a fresh array; never mutates the input.
 */
export function mergeAdjacentTextItems(
  items: ReadonlyArray<InlineItem>,
  registry?: AttrRegistry,
): InlineItem[] {
  const out: InlineItem[] = [];
  let pending: TextItem | null = null;

  for (const item of items) {
    if (item.kind === "text") {
      // Drop zero-length text items. We treat them as if they weren't there
      // — pending stays pending, so two same-attrs neighbors separated only
      // by empty items still merge.
      if (item.text.length === 0) continue;
      if (pending && attrsEqual(pending.attrs, item.attrs, registry)) {
        pending = Object.freeze({
          kind: "text" as const,
          text: pending.text + item.text,
          attrs: pending.attrs,
        });
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

/**
 * Partition `content.items` at `offset` into [leftItems, rightItems].
 *
 * - Clean boundary (offset falls between items, or at start/end of content):
 *   pure array slice, no item splitting.
 * - Mid-text (offset falls inside a text item): split that item into its
 *   left and right halves; both halves preserve the original item's attrs.
 * - Mid-embed: unreachable per findItemAtOffset's contract (embeds count
 *   as one cursor position; offsets at embed boundaries return withinItem=0).
 *   Throws defensively.
 *
 * Used by Layer 3 operations that slice inline content at a position
 * (splitBlockAtPosition, deleteRange, etc.).
 */
export function splitInlineContentAtOffset(
  content: InlineContent,
  offset: number,
): [InlineItem[], InlineItem[]] {
  const items = content.items;
  const { itemIndex, withinItem } = findItemAtOffset(content, offset);

  if (withinItem === 0) {
    return [items.slice(0, itemIndex), items.slice(itemIndex)];
  }

  const straddle = items[itemIndex];
  if (straddle === undefined) {
    // Unreachable: withinItem !== 0 means findItemAtOffset returned an INTERIOR
    // position (not the end-of-content sentinel itemIndex === items.length, which
    // always yields withinItem 0), so itemIndex is a valid in-bounds item index.
    throw new Error(
      `splitInlineContentAtOffset: items index ${itemIndex} out of range`,
    );
  }
  if (straddle.kind !== "text") {
    throw new Error(
      `splitInlineContentAtOffset: offset falls inside non-text item at index ${itemIndex} (kind="${straddle.kind}")`,
    );
  }
  const leftHead: TextItem = Object.freeze({
    kind: "text",
    text: straddle.text.slice(0, withinItem),
    attrs: straddle.attrs,
  });
  const rightHead: TextItem = Object.freeze({
    kind: "text",
    text: straddle.text.slice(withinItem),
    attrs: straddle.attrs,
  });
  return [
    [...items.slice(0, itemIndex), leftHead],
    [rightHead, ...items.slice(itemIndex + 1)],
  ];
}

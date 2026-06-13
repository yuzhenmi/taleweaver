import type { State } from "./state";
import type { Span } from "./block-position";
import { iterateSpan } from "./span-iteration";
import type { InlineItem, EmbedItem } from "./inline-content";
import { COMMENT_START_EMBED_TYPE, COMMENT_END_EMBED_TYPE } from "./comments";
import { PAGE_FIELD_EMBED_TYPE } from "./page-field";
import { HARD_BREAK_EMBED_TYPE } from "./hard-break";
import {
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  itemVisibleInView,
  blockBoundaryMergesInView,
} from "./suggestions";
import type { SuggestionView } from "./suggestions";

/** Object Replacement Character — represents an embed in extracted text. */
const EMBED_CHAR = "￼";

/**
 * Per-embed serializer used by {@link extractText} to convert an embed
 * item to its plain-text representation. Default behavior maps every
 * embed to U+FFFC (Object Replacement Character); callers that need
 * meaningful plain text (clipboard, find/replace) should pass
 * {@link builtinEmbedSerializer} or a custom function.
 */
export type EmbedSerializer = (item: EmbedItem) => string;

/**
 * Default embed serializer: maps every embed to U+FFFC.
 * Preserves the legacy contract for callers that don't specify a serializer.
 */
const defaultEmbedSerializer: EmbedSerializer = () => EMBED_CHAR;

/**
 * Built-in embed serializer for clipboard / find-replace use cases.
 * Maps:
 *   - hard-break → "\n"
 *   - tab        → "\t"
 *   - other embed types → U+FFFC (fallback)
 *
 * Exported so callers can opt-in by passing `builtinEmbedSerializer` as
 * the `embedSerializer` argument to {@link extractText}.
 */
export const builtinEmbedSerializer: EmbedSerializer = (item) => {
  switch (item.embedType) {
    case HARD_BREAK_EMBED_TYPE:
      return "\n";
    case "tab":
      return "\t";
    case COMMENT_START_EMBED_TYPE:
    case COMMENT_END_EMBED_TYPE:
    case BLOCK_JOIN_SUGGESTION_EMBED_TYPE:
    case BLOCK_SPLIT_SUGGESTION_EMBED_TYPE:
      // Comment-range markers AND change-tracking break-suggestion embeds are
      // zero-width anchors — they must NOT emit the U+FFFC EMBED_CHAR into
      // extractText / getWordCount / clipboard. They still occupy one Position
      // offset in the document model (handled by the cursor path), but
      // contribute no extracted text and no word count.
      return "";
    case PAGE_FIELD_EMBED_TYPE:
      // A page-field's value depends on PAGINATED layout (the page it lands on /
      // the total count), which layout-independent text extraction cannot know.
      // Serialize to "" (1 Position offset, 0 chars) — same outcome as the
      // zero-width markers above, but for a different reason (value-not-yet-known,
      // not zero-width). A layout-aware text export is a separate concern.
      return "";
    default:
      return EMBED_CHAR;
  }
};

/**
 * Embed serializer for human-readable CAPTION / DISPLAY text — a block's inline
 * content shown as clean, single-line text (a cross-reference field's resolved
 * caption, a document-outline entry's heading text). Unlike
 * {@link builtinEmbedSerializer} (clipboard / find-replace, which preserves
 * `\n` / `\t` and emits U+FFFC for content-bearing embeds), this collapses a
 * structural break (hard-break / tab) to a single space and drops EVERY embed
 * (zero-width markers, footnote anchors, nested cross-references, images, page
 * fields) to `""`, so the caption never leaks `\n` / `\t` / U+FFFC into the
 * place it is displayed inline.
 */
export const captionEmbedSerializer: EmbedSerializer = (item) => {
  switch (item.embedType) {
    case HARD_BREAK_EMBED_TYPE:
    case "tab":
      return " ";
    default:
      return "";
  }
};

/**
 * Extract plain text from a span.
 *
 * Each leaf block contributes a substring of its inline-content items
 * over the per-block range. Embed items are converted via the optional
 * `embedSerializer` argument — by default, every embed becomes a single
 * OBJECT REPLACEMENT CHARACTER (U+FFFC), matching the Apple TextKit
 * convention. Pass {@link builtinEmbedSerializer} (or a custom
 * {@link EmbedSerializer}) when meaningful plain text is required, e.g.
 * clipboard and find/replace, where hard-break embeds should become
 * `"\n"` and tab embeds should become `"\t"`.
 *
 * Multi-block spans are joined with `\n` between blocks.
 *
 * The optional `view` ({@link SuggestionView}, default `"suggesting"`) projects
 * pending tracked changes: `"final"` extracts the text as if all suggestions
 * were ACCEPTED (deletion runs omitted, insertions kept), `"original"` as if all
 * were REJECTED (insertion runs omitted, deletions kept). A filtered-out item
 * still occupies its literal offsets (the span is in literal-document offsets) —
 * only its text contribution is dropped. The block-boundary STRUCTURAL projection
 * (slice 5c-structural) is also applied: across a boundary that MERGES in `view`
 * (an accepted join / rejected split — the prior block's trailing break embed is
 * resolved away, per {@link blockBoundaryMergesInView}) the inter-block "\n" is
 * SUPPRESSED, so the two blocks' text concatenates exactly as the real
 * `mergeAdjacentBlocksInTx` would (no separator, no space).
 *
 * Used by clipboard, find/replace, accessibility.
 */
export function extractText(
  state: State,
  span: Span,
  embedSerializer: EmbedSerializer = defaultEmbedSerializer,
  view: SuggestionView = "suggesting",
): string {
  const parts: string[] = [];
  let prevItems: ReadonlyArray<InlineItem> | null = null;
  for (const { block, rangeStart, rangeEnd } of iterateSpan(state, span)) {
    if (prevItems !== null) {
      // 5c-structural: a merging boundary (accepted join / rejected split on the
      // PRIOR block's trailing break embed) suppresses the inter-block "\n".
      parts.push(blockBoundaryMergesInView(prevItems, view) ? "" : "\n");
    }
    const items = block.inlineContent?.items ?? EMPTY_ITEMS;
    if (block.inlineContent) {
      parts.push(extractTextFromBlock(items, rangeStart, rangeEnd, embedSerializer, view));
    }
    prevItems = items;
  }
  return parts.join("");
}

/** Shared empty item list — the boundary marker for a non-leaf/empty block (which
 *  carries no trailing break embed, so its boundary never merges). */
const EMPTY_ITEMS: ReadonlyArray<InlineItem> = Object.freeze([]);

function extractTextFromBlock(
  items: ReadonlyArray<InlineItem>,
  rangeStart: number,
  rangeEnd: number,
  embedSerializer: EmbedSerializer,
  view: SuggestionView,
): string {
  if (rangeStart >= rangeEnd) return "";
  const out: string[] = [];
  let cursor = 0;
  for (const item of items) {
    if (cursor >= rangeEnd) break;
    const itemLen = item.kind === "text" ? item.text.length : 1;
    const itemStart = cursor;
    const itemEnd = cursor + itemLen;
    cursor = itemEnd;
    if (itemEnd <= rangeStart) continue;
    // Preview-view projection: a run/embed resolved AWAY in this view contributes
    // no text, but its offsets were already counted into `cursor` above (the span
    // is in literal-document offsets, so the projection never shifts them).
    if (!itemVisibleInView(item, view)) continue;
    // Overlap: [max(itemStart, rangeStart), min(itemEnd, rangeEnd)] within this item.
    const subStart = Math.max(itemStart, rangeStart) - itemStart;
    const subEnd = Math.min(itemEnd, rangeEnd) - itemStart;
    if (item.kind === "text") {
      out.push(item.text.slice(subStart, subEnd));
    } else {
      // Embed item is one position; if any of [0,1) overlaps the range, include it.
      if (subStart < 1 && subEnd > 0) out.push(embedSerializer(item));
    }
  }
  return out.join("");
}

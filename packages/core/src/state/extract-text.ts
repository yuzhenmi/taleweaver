import type { State } from "./state";
import type { Span } from "./block-position";
import { iterateSpan } from "./span-iteration";
import type { InlineItem, EmbedItem } from "./inline-content";
import { COMMENT_START_EMBED_TYPE, COMMENT_END_EMBED_TYPE } from "./comments";
import {
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
} from "./suggestions";

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
    case "hard-break":
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
    default:
      return EMBED_CHAR;
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
 * Used by clipboard, find/replace, accessibility.
 */
export function extractText(
  state: State,
  span: Span,
  embedSerializer: EmbedSerializer = defaultEmbedSerializer,
): string {
  const parts: string[] = [];
  let isFirst = true;
  for (const { block, rangeStart, rangeEnd } of iterateSpan(state, span)) {
    if (!isFirst) parts.push("\n");
    isFirst = false;
    if (!block.inlineContent) continue;
    parts.push(
      extractTextFromBlock(block.inlineContent.items, rangeStart, rangeEnd, embedSerializer),
    );
  }
  return parts.join("");
}

function extractTextFromBlock(
  items: ReadonlyArray<InlineItem>,
  rangeStart: number,
  rangeEnd: number,
  embedSerializer: EmbedSerializer,
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

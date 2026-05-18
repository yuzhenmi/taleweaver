import type { State } from "./state";
import type { Span } from "./block-position";
import { iterateSpan } from "./span-iteration";
import type { InlineItem } from "./inline-content";

/** Object Replacement Character — represents an embed in extracted text. */
const EMBED_CHAR = "￼";

/**
 * Extract plain text from a span.
 *
 * Each leaf block contributes a substring of its inline-content items
 * over the per-block range. Embed items become a single OBJECT
 * REPLACEMENT CHARACTER (U+FFFC) — same convention as Apple TextKit.
 * Multi-block spans are joined with `\n` between blocks.
 *
 * Used by clipboard, find/replace, accessibility.
 */
export function extractText(state: State, span: Span): string {
  const parts: string[] = [];
  let isFirst = true;
  for (const { block, rangeStart, rangeEnd } of iterateSpan(state, span)) {
    if (!isFirst) parts.push("\n");
    isFirst = false;
    if (!block.inlineContent) continue;
    parts.push(extractTextFromBlock(block.inlineContent.items, rangeStart, rangeEnd));
  }
  return parts.join("");
}

function extractTextFromBlock(
  items: ReadonlyArray<InlineItem>,
  rangeStart: number,
  rangeEnd: number,
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
      if (subStart < 1 && subEnd > 0) out.push(EMBED_CHAR);
    }
  }
  return out.join("");
}

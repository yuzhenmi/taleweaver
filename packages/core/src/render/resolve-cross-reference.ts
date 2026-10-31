import type { BlockId, BookmarkRange, Document, SuggestionView } from "../state";
import { createSpan, extractText, captionEmbedSerializer, BROKEN_CROSS_REFERENCE_TEXT } from "../state";
import type { CounterValue } from "../numbering";

/**
 * The text rendered when a cross-reference cannot resolve its target — the target
 * was deleted, is the wrong kind for the mode (e.g. a `number` ref to an unnumbered
 * block), or is not inline-bearing. A dangling reference is a LEGAL user state, not a
 * corruption. Word's exact wording; Google Docs' broken-reference UX is less defined,
 * so this is a single constant flagged for in-browser confirmation against Google Docs
 * (the `browser-confirm` convention). Kept in ONE place so the wording is a 1-line change.
 */
export { BROKEN_CROSS_REFERENCE_TEXT };

/**
 * Resolve a cross-reference field to its displayed string, at RENDER time. Pure:
 * given the current `document` + the render pass's already-computed list `numbering`
 * map (`computeCounters` result, keyed by the list-item's own blockId), produces the
 * text the field shows.
 *
 *  - `"number"` → the formatted counter of the paragraph holding the bookmark START
 *    (Word). Not a numbered list-item → broken-ref.
 *  - `"text"` → the bookmarked range's text (`extractText` over [start, end], under
 *    {@link captionEmbedSerializer} so embeds don't leak into the caption). An empty
 *    bookmark resolves to `""` (it exists — not broken).
 *
 * A broken bookmark (start or end gone) never reaches here: the caller renders
 * {@link BROKEN_CROSS_REFERENCE_TEXT}.
 *
 * `view` ({@link SuggestionView}) projects pending tracked changes for `"text"`
 * mode: a `"final"`/`"original"` preview must resolve the caption against the
 * SAME projection the target is rendered under, else the reference text goes
 * stale relative to the previewed document. `"number"` mode is view-independent
 * (counters are computed once per render pass, already view-correct).
 *
 * Targets the MAIN BODY tree only (resolved via `getBlock`, not `resolveBlock`).
 */
export function resolveCrossReference(
  document: Document,
  numbering: ReadonlyMap<BlockId, CounterValue>,
  props: { readonly range: BookmarkRange; readonly refMode: "number" | "text" },
  view: SuggestionView = "suggesting",
): string {
  const { range, refMode } = props;
  if (refMode === "number") {
    // Word: the list counter of the paragraph holding the bookmark START.
    const counter = numbering.get(range.start.blockId);
    return counter === undefined ? BROKEN_CROSS_REFERENCE_TEXT : counter.formatted;
  }
  // `text`: the bookmarked range's text (Word's REF), in the current view.
  if (range.start.blockId === range.end.blockId && range.start.offset >= range.end.offset) return "";
  return extractText(document, createSpan(range.start, range.end), captionEmbedSerializer, view);
}

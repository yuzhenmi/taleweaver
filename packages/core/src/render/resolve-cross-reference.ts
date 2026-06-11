import type { BlockId, State, SuggestionView } from "../state";
import {
  getBlock,
  createPosition,
  createSpan,
  inlineContentLength,
  extractText,
  captionEmbedSerializer,
  type CrossReferenceMode,
} from "../state";
import type { CounterValue } from "../numbering";

/**
 * The text rendered when a cross-reference cannot resolve its target — the target
 * was deleted, is the wrong kind for the mode (e.g. a `number` ref to an unnumbered
 * block), or is not inline-bearing. A dangling reference is a LEGAL user state, not a
 * corruption. Word's exact wording; Google Docs' broken-reference UX is less defined,
 * so this is a single constant flagged for in-browser confirmation against Google Docs
 * (the `browser-confirm` convention). Kept in ONE place so the wording is a 1-line change.
 */
export const BROKEN_CROSS_REFERENCE_TEXT = "Error! Reference source not found."; // browser-confirm vs Google Docs

/**
 * Resolve a cross-reference field to its displayed string, at RENDER time. Pure:
 * given the current `state` + the render pass's already-computed list `numbering`
 * map (`computeCounters` result, keyed by the list-item's own blockId), produces the
 * text the field shows.
 *
 *  - `"number"` → the target's formatted counter (`numbering.get(targetId).formatted`).
 *    A target that is not a numbered list-item (or was deleted) is absent from the
 *    map → broken-ref.
 *  - `"text"` → the target block's full text (`extractText` over its whole inline
 *    content, under {@link captionEmbedSerializer} so embeds don't leak into the
 *    caption). A missing or non-inline-bearing target → broken-ref. An EMPTY
 *    target resolves to `""` (the target exists — not broken).
 *
 * `view` ({@link SuggestionView}) projects pending tracked changes for `"text"`
 * mode: a `"final"`/`"original"` preview must resolve the caption against the
 * SAME projection the target is rendered under, else the reference text goes
 * stale relative to the previewed document. `"number"` mode is view-independent
 * (counters are computed once per render pass, already view-correct).
 *
 * v1 targets the MAIN BODY tree (resolved via `getBlock`, not `resolveBlock`).
 */
export function resolveCrossReference(
  state: State,
  numbering: ReadonlyMap<BlockId, CounterValue>,
  props: { readonly targetId: BlockId; readonly refMode: CrossReferenceMode },
  view: SuggestionView = "suggesting",
): string {
  const { targetId, refMode } = props;

  if (refMode === "number") {
    const counter = numbering.get(targetId);
    return counter === undefined ? BROKEN_CROSS_REFERENCE_TEXT : counter.formatted;
  }

  // refMode === "text"
  const block = getBlock(state, targetId);
  if (block === null || block.inlineContent === null) {
    return BROKEN_CROSS_REFERENCE_TEXT;
  }
  const length = inlineContentLength(block.inlineContent);
  // Mirror outline.ts: short-circuit an empty target to "" before building a span,
  // so this never depends on extractText's zero-length-span behaviour.
  if (length === 0) return "";
  const span = createSpan(createPosition(targetId, 0), createPosition(targetId, length));
  return extractText(state, span, captionEmbedSerializer, view);
}

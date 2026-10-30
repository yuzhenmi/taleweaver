import type { EditorConfig } from "../../editor-config";
import { applyAttrsToRange, markFormatting, spanStart, type State, type Span, type ReadonlyAttrs, type OperationResult } from "../../../state";
import { suggestionInputForBlock } from "./suggestion-input-for-block";

/**
 * Apply the `incoming` attr delta over the `span` — really (direct editing)
 * via `applyAttrsToRange`, or as a tracked FORMATTING SUGGESTION (suggesting
 * mode) via `markFormatting`. In suggesting mode the run's LIVE format attrs
 * (bold/color/…) stay UNCHANGED; only a `formattingSuggestionId:<id>` provenance
 * attr is stamped over the span + a `formatting` record carrying `incoming` as
 * its `proposedAttrs` is written — the proposal lands on the live attrs only on
 * ACCEPT. Both return an `OperationResult`; the caller's cursor/commit/rebuild
 * is identical (an attr-only change leaves content length untouched, so the
 * selection is invariant exactly as for `applyAttrsToRange`). `markFormatting`
 * is a normal undoable op, so the caller `history.commit`s exactly as for the
 * direct path.
 *
 * `incoming` may be a toggle-OFF delta (`{ bold: undefined }`) or the clear-all
 * delta (every inline-format key set to `undefined`) — both are valid
 * `proposedAttrs` (the suggestion proposes a REMOVAL), and both are no-ops only
 * when there is nothing to suggest (empty delta / collapsed span), matching
 * `markFormatting`'s own guards.
 *
 * It falls back to the direct `applyAttrsToRange` branch only when the span's
 * start block resolves to no editing context (see `suggestionInputForBlock`).
 */
export function applyAttrsOrSuggest(
  state: State,
  span: Span,
  incoming: ReadonlyAttrs,
  config: EditorConfig,
): OperationResult {
  const input = suggestionInputForBlock(state, spanStart(state, span).blockId, config);
  return input === null
    ? applyAttrsToRange(state, span, incoming)
    : markFormatting(state, span, incoming, input);
}

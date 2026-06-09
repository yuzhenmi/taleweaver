import type { EditorConfig } from "../editor-state";
import {
  newSuggestionId,
  deleteRange,
  markDeletion,
  applyAttrsToRange,
  markFormatting,
  type SuggestionId,
  type ReplaceSuggestionInput,
  type State,
  type Span,
  type ReadonlyAttrs,
  type OperationResult,
} from "../../state";

/** The create-op `input` for a new suggestion in suggesting mode, or `null` when not
 *  suggesting (direct editing). Every suggesting-mode create-branch builds its op
 *  input via this helper: a fresh `newSuggestionId()`, the configured author, and the
 *  injected timestamp. */
export function newSuggestionInput(
  config: EditorConfig,
): { id: SuggestionId; author: string; createdAt: number } | null {
  const author = config.suggestingAuthor ?? null;
  if (author === null) return null;
  return { id: newSuggestionId(), author, createdAt: (config.now ?? Date.now)() };
}

/** The create-op `input` for a TYPE-OVER-A-SELECTION suggestion (the suggestion
 *  analog of `replaceRange`), or `null` when not suggesting (direct editing). Mints
 *  TWO ids — `deletionId` for the struck selection + `insertionId` for the new run —
 *  the configured author, and the injected timestamp (SHARED by both records as the
 *  render-layer "this was ONE replace" grouping signal). */
export function newReplaceSuggestionInput(
  config: EditorConfig,
): ReplaceSuggestionInput | null {
  const author = config.suggestingAuthor ?? null;
  if (author === null) return null;
  return {
    deletionId: newSuggestionId(),
    insertionId: newSuggestionId(),
    author,
    createdAt: (config.now ?? Date.now)(),
  };
}

/**
 * Delete the `span` — really (direct editing) or as a tracked SUGGESTION
 * (suggesting mode). In suggesting mode the text is kept and stamped with a
 * `deletionSuggestionId` (struck-through) via `markDeletion`; in direct mode it
 * is removed via `deleteRange`. Both return an `OperationResult`; the caller's
 * cursor/commit/rebuild is identical (for BACKWARD deletes the caret = span
 * start, which is correct for a soft delete too). `markDeletion` is a normal
 * undoable op, so the caller `history.commit`s exactly as for `deleteRange`.
 */
export function deleteRangeOrSuggest(
  state: State,
  span: Span,
  config: EditorConfig,
): OperationResult {
  const input = newSuggestionInput(config);
  return input === null ? deleteRange(state, span) : markDeletion(state, span, input);
}

/**
 * Apply the `incoming` attr delta over the `span` — really (direct editing)
 * via `applyAttrsToRange`, or as a tracked FORMATTING SUGGESTION (suggesting
 * mode) via `markFormatting`. In suggesting mode the run's LIVE format attrs
 * (bold/color/…) stay UNCHANGED; only a `formattingSuggestionId` provenance
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
 */
export function applyAttrsOrSuggest(
  state: State,
  span: Span,
  incoming: ReadonlyAttrs,
  config: EditorConfig,
): OperationResult {
  const input = newSuggestionInput(config);
  return input === null
    ? applyAttrsToRange(state, span, incoming)
    : markFormatting(state, span, incoming, input);
}

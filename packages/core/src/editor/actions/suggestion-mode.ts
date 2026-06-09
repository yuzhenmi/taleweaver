import type { EditorConfig } from "../editor-state";
import {
  newSuggestionId,
  deleteRange,
  markDeletion,
  type SuggestionId,
  type State,
  type Span,
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

import type { EditorState } from "../../editor-state";
import { newSuggestionId, nextSuggestionOrder, type SuggestionMintInput } from "../../../state";

/** The create-op `input` for a new suggestion in suggesting mode, or `null` when not
 *  suggesting (direct editing). Every suggesting-mode create-branch builds its op
 *  input via this helper: a fresh `newSuggestionId()`, the configured author, and the
 *  injected timestamp. */
export function newSuggestionInput(
  { config }: EditorState,
): SuggestionMintInput | null {
  const author = config.suggestingAuthor ?? null;
  if (author === null) return null;
  return { id: newSuggestionId(), author, createdAt: (config.now ?? Date.now)(), order: nextSuggestionOrder() };
}

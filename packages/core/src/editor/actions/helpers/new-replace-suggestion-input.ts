import type { EditorConfig } from "../../editor-config";
import { newSuggestionId, nextSuggestionOrder, type ReplaceSuggestionInput } from "../../../state";

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
    order: nextSuggestionOrder(),
  };
}

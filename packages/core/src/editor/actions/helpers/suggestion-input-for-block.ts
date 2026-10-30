import type { EditorConfig } from "../../editor-config";
import { selectionContextOf, type SuggestionMintInput, type State, type BlockId } from "../../../state";
import { newSuggestionInput } from "./new-suggestion-input";

/**
 * The create-op `input` for a suggestion at `blockId`, or `null` when NOT
 * suggesting OR `blockId` does not resolve to any editing context.
 *
 * Change-tracking tracks suggestions in EVERY editing context — the main body
 * AND footnote / header / footer / template bodies (which live in the
 * embedContents / templateContents trees). The full resolve machinery walks all
 * three trees (`buildSuggestionRangeIndex` + `resolveBlockScan`), and the create
 * ops are tree-`kind`-dispatched, so a body suggestion is tagged, surfaced, and
 * accepted/rejected in-place in its own tree. `selectionContextOf` returns the
 * block's context root (main `state.rootId` or a body root); it returns `null`
 * ONLY for a block that exists in no tree — the one case where there is no valid
 * context to attach a suggestion to, so the caller falls back to its direct branch.
 *
 * Prefer this over the bare `newSuggestionInput` at every suggesting-mode seam;
 * `newSuggestionInput` remains for the rare site where the context is already known.
 */
export function suggestionInputForBlock(
  state: State,
  blockId: BlockId,
  config: EditorConfig,
): SuggestionMintInput | null {
  if (selectionContextOf(state, blockId) === null) return null;
  return newSuggestionInput(config);
}

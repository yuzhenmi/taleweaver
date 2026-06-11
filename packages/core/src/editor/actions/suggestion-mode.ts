import type { EditorConfig } from "../editor-state";
import {
  newSuggestionId,
  deleteRange,
  markDeletion,
  applyAttrsToRange,
  markFormatting,
  selectionContextOf,
  spanStart,
  type SuggestionMintInput,
  type ReplaceSuggestionInput,
  type State,
  type Span,
  type BlockId,
  type ReadonlyAttrs,
  type OperationResult,
} from "../../state";

/** The create-op `input` for a new suggestion in suggesting mode, or `null` when not
 *  suggesting (direct editing). Every suggesting-mode create-branch builds its op
 *  input via this helper: a fresh `newSuggestionId()`, the configured author, and the
 *  injected timestamp. */
export function newSuggestionInput(
  config: EditorConfig,
): SuggestionMintInput | null {
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

/**
 * The replace (two-id) create-op `input` for a type-over edit at `blockId`, or
 * `null` when NOT suggesting OR `blockId` resolves to no editing context (same
 * rule as `suggestionInputForBlock`).
 */
export function replaceSuggestionInputForBlock(
  state: State,
  blockId: BlockId,
  config: EditorConfig,
): ReplaceSuggestionInput | null {
  if (selectionContextOf(state, blockId) === null) return null;
  return newReplaceSuggestionInput(config);
}

/** True iff an edit at `blockId` is in suggesting mode AND resolves to a valid
 *  editing context — i.e. it will be tracked as a suggestion. Use this for
 *  caret-placement decisions that depend on whether a delete was a soft-delete
 *  (text kept, caret skips it) vs a direct delete (text removed).
 *  (See `suggestionInputForBlock` for the all-context tracking rule.) */
export function isSuggestingInBlock(state: State, blockId: BlockId, config: EditorConfig): boolean {
  if ((config.suggestingAuthor ?? null) === null) return false;
  return selectionContextOf(state, blockId) !== null;
}

/**
 * Delete the `span` — really (direct editing) or as a tracked SUGGESTION
 * (suggesting mode). In suggesting mode the text is kept and stamped with a
 * `deletionSuggestionId` (struck-through) via `markDeletion`; in direct mode it
 * is removed via `deleteRange`. Both return an `OperationResult`; the caller's
 * cursor/commit/rebuild is identical (for BACKWARD deletes the caret = span
 * start, which is correct for a soft delete too). `markDeletion` is a normal
 * undoable op, so the caller `history.commit`s exactly as for `deleteRange`.
 * It falls back to the direct `deleteRange` branch only when the span's start
 * block resolves to no editing context (see `suggestionInputForBlock`).
 */
export function deleteRangeOrSuggest(
  state: State,
  span: Span,
  config: EditorConfig,
): OperationResult {
  const input = suggestionInputForBlock(state, spanStart(state, span).blockId, config);
  return input === null
    ? deleteRange(state, span)
    : markDeletion(state, span, input, config.attrRegistry);
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

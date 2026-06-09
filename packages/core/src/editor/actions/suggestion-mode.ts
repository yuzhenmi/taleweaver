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
 * suggesting OR `blockId` is OUTSIDE the MAIN body.
 *
 * Change-tracking tracks suggestions in the MAIN body only (the resolve scan
 * walks the main block tree). Footnote / header / footer / template bodies live
 * in the embedContents / templateContents trees — `selectionContextOf` returns
 * THEIR body root, not `state.rootId`, for those blocks. Returning `null` there
 * routes the caller to its DIRECT (untracked) branch, so a body edit still
 * happens but creates no suggestion the main-tree resolve scan could never see
 * (which would otherwise be an un-resolvable zombie after accept/reject-all).
 * Full multi-tree change-tracking is a separately-tracked follow-up.
 *
 * Prefer this over the bare `newSuggestionInput` at every suggesting-mode seam;
 * `newSuggestionInput` remains for the rare site where the block is already
 * known to be main-body.
 */
export function suggestionInputForBlock(
  state: State,
  blockId: BlockId,
  config: EditorConfig,
): SuggestionMintInput | null {
  if (selectionContextOf(state, blockId) !== state.rootId) return null;
  return newSuggestionInput(config);
}

/**
 * The replace (two-id) create-op `input` for a type-over edit at `blockId`, or
 * `null` when NOT suggesting OR `blockId` is OUTSIDE the MAIN body (same v1 rule
 * as `suggestionInputForBlock` — a body type-over falls back to direct
 * `replaceRange`).
 */
export function replaceSuggestionInputForBlock(
  state: State,
  blockId: BlockId,
  config: EditorConfig,
): ReplaceSuggestionInput | null {
  if (selectionContextOf(state, blockId) !== state.rootId) return null;
  return newReplaceSuggestionInput(config);
}

/** True iff an edit at `blockId` is BOTH in suggesting mode AND in the main body —
 *  i.e. it will be tracked as a suggestion rather than falling back to direct
 *  editing. Use this for caret-placement decisions that depend on whether a delete
 *  was a soft-delete (text kept, caret skips it) vs a direct delete (text removed).
 *  (See `suggestionInputForBlock` for the v1 main-body-only rule.) */
export function isSuggestingInBlock(state: State, blockId: BlockId, config: EditorConfig): boolean {
  if ((config.suggestingAuthor ?? null) === null) return false;
  return selectionContextOf(state, blockId) === state.rootId;
}

/**
 * Delete the `span` — really (direct editing) or as a tracked SUGGESTION
 * (suggesting mode). In suggesting mode the text is kept and stamped with a
 * `deletionSuggestionId` (struck-through) via `markDeletion`; in direct mode it
 * is removed via `deleteRange`. Both return an `OperationResult`; the caller's
 * cursor/commit/rebuild is identical (for BACKWARD deletes the caret = span
 * start, which is correct for a soft delete too). `markDeletion` is a normal
 * undoable op, so the caller `history.commit`s exactly as for `deleteRange`.
 * It also falls back to the direct `deleteRange` branch when the span's start
 * block is OUTSIDE the main body (see `suggestionInputForBlock`).
 */
export function deleteRangeOrSuggest(
  state: State,
  span: Span,
  config: EditorConfig,
): OperationResult {
  const input = suggestionInputForBlock(state, spanStart(state, span).blockId, config);
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
 *
 * It also falls back to the direct `applyAttrsToRange` branch when the span's
 * start block is OUTSIDE the main body (see `suggestionInputForBlock`).
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

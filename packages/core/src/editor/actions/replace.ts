import type { EditorState, EditorConfig } from "../editor-state";
import {
  replaceRange,
  planReplaceMatches,
  applyReplaceAllPlan,
  resolveBlock,
  attrsAtOffset,
  createPosition,
  createSpan,
} from "../../state";
import type { TextMatch, ReadonlyAttrs } from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * Resolve the formatting the replacement text should take: the attrs of the run
 * containing the match's FIRST char (Google Docs behavior). Shares the
 * `attrsAtOffset` helper with `planReplaceMatches` (REPLACE_ALL) — at a run
 * boundary it returns the FOLLOWING run (the run the match starts in). Falls
 * back to `{}` when the block can't be resolved or the offset lands at
 * end-of-content / on an embed (unreachable for a real `TextMatch`).
 */
function attrsAtMatchStart(editor: EditorState, match: TextMatch): ReadonlyAttrs {
  const resolved = resolveBlock(editor.state, match.blockId);
  const inline = resolved?.block.inlineContent ?? null;
  if (inline === null) return {};
  return attrsAtOffset(inline, match.start);
}

/**
 * REPLACE_MATCH — replace ONE find match with `replacement`. Builds the match's
 * span, resolves the replacement formatting from the run at `match.start`, and
 * calls the public `replaceRange` (one transaction, one undo step). The cursor
 * lands at the seam (replaceRange's contract: end of the inserted text).
 *
 * The HOST recomputes find matches afterward (offsets shifted) and advances the
 * active index — that find-session bookkeeping is the host's job (brief D7), not
 * the engine's.
 */
export function handleReplaceMatch(
  editor: EditorState,
  match: TextMatch,
  replacement: string,
  config: EditorConfig,
): EditorState {
  const selectionBefore = editor.selection;
  const span = createSpan(
    createPosition(match.blockId, match.start),
    createPosition(match.blockId, match.end),
  );
  const attrs = attrsAtMatchStart(editor, match);
  const result = replaceRange(editor.state, span, replacement, attrs);

  // No-op identity contract (#141): a no-op op returns the same state reference.
  if (result.state === editor.state) return editor;

  // Cursor at the seam: start offset + replacement length (replaceRange's
  // post-op cursor).
  const newCursor = createPosition(match.blockId, match.start + replacement.length);
  const newSelection = createSpan(newCursor, newCursor);

  editor.history.commit(result, { before: selectionBefore, after: newSelection });

  return rebuildTrees(
    { ...editor, state: result.state, selection: newSelection },
    editor,
    config,
    result.dirtyIds,
  );
}

/**
 * REPLACE_ALL — replace EVERY match in `matches` with `replacement` in ONE undo
 * step (brief D5). Plans the per-block batch (`planReplaceMatches`), applies it
 * in a single `applyOperation` (`applyReplaceAllPlan`), and collapses the cursor
 * to the start of the first affected block's first replacement (deterministic +
 * always valid).
 *
 * Empty `matches` → no-op (returns `editor` unchanged, identity preserved).
 */
export function handleReplaceAll(
  editor: EditorState,
  matches: TextMatch[],
  replacement: string,
  config: EditorConfig,
): EditorState {
  if (matches.length === 0) return editor;

  const selectionBefore = editor.selection;
  const plan = planReplaceMatches(editor.state, matches, replacement);
  const result = applyReplaceAllPlan(editor.state, plan);

  // No-op identity contract (#141).
  if (result.state === editor.state) return editor;

  // Cursor: collapse to the start of the FIRST affected block's first
  // replacement (the document-first block in `blockWrites`, which preserves
  // first-seen block order from the document-ordered `matches`). The first
  // match in that block has the smallest start (matches are ascending), so the
  // seam is its `start`.
  // `matches.length > 0` (guarded above) and a non-no-op result mean the plan
  // wrote to at least one block, so the first block-write is always present.
  const firstWrite = plan.blockWrites[0];
  if (firstWrite === undefined) {
    throw new Error(
      "handleReplaceAll: applyReplaceAllPlan mutated state but produced no block-writes (invariant violation)",
    );
  }
  const firstBlockId = firstWrite.blockId;
  const firstMatchStart = matches.find((m) => m.blockId === firstBlockId)?.start ?? 0;
  const newCursor = createPosition(firstBlockId, firstMatchStart);
  const newSelection = createSpan(newCursor, newCursor);

  editor.history.commit(result, { before: selectionBefore, after: newSelection });

  return rebuildTrees(
    { ...editor, state: result.state, selection: newSelection },
    editor,
    config,
    result.dirtyIds,
  );
}

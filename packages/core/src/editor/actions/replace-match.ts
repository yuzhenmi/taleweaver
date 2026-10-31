import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { replaceRange, resolveBlock, attrsAtOffset, createPosition, createSpan } from "../../state";
import type { TextMatch, ReadonlyAttrs } from "../../state";
import type { ActionOf } from "../editor-action";

/**
 * Resolve the formatting the replacement text should take: the attrs of the run
 * containing the match's FIRST char (Google Docs behavior). Shares the
 * `attrsAtOffset` helper with `planReplaceMatches` (REPLACE_ALL) — at a run
 * boundary it returns the FOLLOWING run (the run the match starts in). Falls
 * back to `{}` when the block can't be resolved or the offset lands at
 * end-of-content / on an embed (unreachable for a real `TextMatch`).
 */
function attrsAtMatchStart(editor: EditorState, match: TextMatch): ReadonlyAttrs {
  const resolved = resolveBlock(editor.document, match.blockId);
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
 * active index — that find-session bookkeeping is the host's job, not
 * the engine's.
 */
export function handleReplaceMatch(
  editor: EditorState,
  { match, replacement }: ActionOf<"REPLACE_MATCH">,
): Edit | null {
  const span = createSpan(
    createPosition(match.blockId, match.start),
    createPosition(match.blockId, match.end),
  );
  const attrs = attrsAtMatchStart(editor, match);
  const result = replaceRange(editor.document, span, replacement, attrs);

  // No-op identity contract: a no-op op returns the same state reference.
  if (result.document === editor.document) return null;

  // Cursor at the seam: start offset + replacement length (replaceRange's
  // post-op cursor).
  const newCursor = createPosition(match.blockId, match.start + replacement.length);
  const newSelection = createSpan(newCursor, newCursor);

  return { change: result, selection: newSelection };
}

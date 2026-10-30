import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import {
  createPosition,
  createSpan,
  inlineContentLength,
  selectionContextOf,
  firstLeafBlock,
  lastLeafBlock,
  resolveBlock,
} from "../../state";
import type { BlockId } from "../../state";
import { findFirstContentBlock, findLastContentBlock } from "./helpers";

/**
 * SELECT_ALL — context-aware. A header/footer body is an ISOLATED editing
 * context (same principle as line-navigation isolation and
 * cross-context refusal): select-all highlights ONLY the context the caret is
 * in — the MAIN body OR the one header/footer body the caret sits in. A body
 * select-all must NOT spill into the header/footer; a header/footer select-all
 * must NOT spill into the body.
 *
 * The caret's context is `selectionContextOf(state, focus.blockId)`, which is
 * `state.rootId` for a main-body block, or the header/footer body's CONTAINER
 * ROOT for a template block (`selectionContextOf` is tree-aware).
 *
 * - Main body (`ctxRoot === state.rootId`): span the first→last CONTENT-bearing
 *   leaf via `findFirstContentBlock`/`findLastContentBlock` (skips
 *   container-only leaves; unchanged behavior).
 * - Header/footer body: span the first→last LEAF within that body via
 *   `firstLeafBlock`/`lastLeafBlock(state, ctxRoot)` (tree-agnostic).
 */
export function handleSelectAll(editor: EditorState): Edit | null {
  const ctxRoot = selectionContextOf(editor.state, editor.selection.focus.blockId);
  if (ctxRoot === null) return null;

  const firstId =
    ctxRoot === editor.state.rootId
      ? findFirstContentBlock(editor.state)
      : firstLeafBlock(editor.state, ctxRoot);
  const lastId =
    ctxRoot === editor.state.rootId
      ? findLastContentBlock(editor.state)
      : lastLeafBlock(editor.state, ctxRoot);
  if (firstId === null || lastId === null) return null;

  return spanForRange(editor, firstId, lastId);
}

/**
 * Build the editor with selection = (start of `firstId`) → (end of `lastId`).
 * The end offset is `lastId`'s inline-content length (0 for a container leaf
 * with no inline content). `lastId` may live in the main map OR a
 * header/footer body, so it is resolved tree-aware via `resolveBlock`.
 */
function spanForRange(
  editor: EditorState,
  firstId: BlockId,
  lastId: BlockId,
): Edit | null {
  const last = resolveBlock(editor.state, lastId);
  if (last === null) return null;
  const endOffset =
    last.block.inlineContent === null
      ? 0
      : inlineContentLength(last.block.inlineContent);
  const anchor = createPosition(firstId, 0);
  const focus = createPosition(lastId, endOffset);
  return { selection: createSpan(anchor, focus) };
}

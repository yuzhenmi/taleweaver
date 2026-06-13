import type { EditorState } from "../editor-state";
import {
  createPosition,
  createSpan,
  inlineContentLength,
  resolveBlock,
  selectionContextOf,
  firstLeafBlock,
  lastLeafBlock,
} from "../../state";
import type { BlockId, State } from "../../state";
import { findFirstContentBlock, findLastContentBlock } from "./helpers";

/**
 * EXPAND_DOCUMENT_BOUNDARY (Ctrl+Shift+Home / Ctrl+Shift+End) — CONTEXT-AWARE,
 * mirroring `handleSelectAll`. The anchor stays put; the focus moves to the
 * document boundary WITHIN the caret's current selection context (the main
 * document tree, OR the one footnote/embed body, OR the one header/footer
 * template body the caret sits in). Resolving in-context is load-bearing: a
 * main-tree-only resolution from inside a footnote body would leave the anchor
 * in the footnote and push the focus into the main tree — a CROSS-CONTEXT span
 * that `iterateSpan` (and every span consumer) rejects. Keeping the focus in the
 * same context guarantees the resulting span is iterable.
 *
 * The caret's context is `selectionContextOf(state, focus.blockId)`:
 * `state.rootId` for a main-body block, or the footnote/header/footer body's
 * CONTAINER ROOT for a body block.
 */
export function handleExpandDocumentBoundary(
  editor: EditorState,
  boundary: "start" | "end",
): EditorState {
  const ctxRoot = selectionContextOf(editor.state, editor.selection.focus.blockId);
  if (ctxRoot === null) return editor;

  const targetId =
    boundary === "start"
      ? firstBoundaryBlock(editor.state, ctxRoot)
      : lastBoundaryBlock(editor.state, ctxRoot);
  if (targetId === null) return editor;

  const offset = boundary === "start" ? 0 : endOffsetOf(editor.state, targetId);
  if (offset === null) return editor;

  const focus = createPosition(targetId, offset);
  return {
    ...editor,
    selection: createSpan(editor.selection.anchor, focus),
  };
}

/**
 * The first boundary block within `ctxRoot`. Main body → the first
 * CONTENT-bearing leaf (`findFirstContentBlock`, which skips container-only
 * leaves). A footnote/header/footer body → the first leaf within that body
 * (`firstLeafBlock`). Mirrors `handleSelectAll`.
 */
function firstBoundaryBlock(state: State, ctxRoot: BlockId): BlockId | null {
  return ctxRoot === state.rootId
    ? findFirstContentBlock(state)
    : firstLeafBlock(state, ctxRoot);
}

/** Symmetric to `firstBoundaryBlock` for the document END. */
function lastBoundaryBlock(state: State, ctxRoot: BlockId): BlockId | null {
  return ctxRoot === state.rootId
    ? findLastContentBlock(state)
    : lastLeafBlock(state, ctxRoot);
}

/**
 * The end (last) offset of `blockId` — its inline-content length, or 0 for a
 * container leaf with no inline content. Resolved tree-aware via `resolveBlock`
 * so a footnote/header/footer body block is read from its own tree. Returns null
 * if the block is unresolvable.
 */
function endOffsetOf(state: State, blockId: BlockId): number | null {
  const resolved = resolveBlock(state, blockId);
  if (resolved === null) return null;
  return resolved.block.inlineContent === null
    ? 0
    : inlineContentLength(resolved.block.inlineContent);
}

export { firstBoundaryBlock, lastBoundaryBlock, endOffsetOf };

import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, mergeBlockAttrs } from "../../state";
import type { BlockId } from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * `SET_IMAGE_SIZE` handler (#P11.4) — the engine half of image resize. Merges
 * `width`/`height` (pixels) onto the target `image` block's attrs, which
 * `imageComponent` already reads (an absent dimension means intrinsic "auto").
 *
 * The target is an explicit `blockId`, NOT the selection focus: an `image` is an
 * atomic-leaf (`inlineContent === null`) that holds no cursor positions, so it
 * can never be a `Selection` focus. The (browser-gated) resize-handle
 * interaction knows which image was clicked and supplies its id. See the design
 * doc's Resolution log R1.
 *
 * No-op (returns the input `editor` unchanged, never calling `history.commit`):
 *  - the target block is missing or is not an `image` (only images carry size);
 *  - either dimension is non-finite or ≤ 0 (defensive — resize sends real px);
 *  - the merge is a no-op (the image already has these dimensions) — the
 *    `mergeBlockAttrs` identity short-circuit returns the same state ref.
 *
 * Selection is UNCHANGED: resizing is a block-geometry edit, not a caret move.
 * One undo entry (`"command"` coalesce class).
 */
export function handleSetImageSize(
  editor: EditorState,
  blockId: BlockId,
  width: number,
  height: number,
  config: EditorConfig,
): EditorState {
  const block = getBlock(editor.state, blockId);
  if (block === null || block.type !== "image") return editor;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return editor;
  }

  const result = mergeBlockAttrs(
    editor.state,
    blockId,
    { width, height },
    config.attrRegistry,
  );
  if (result.state === editor.state) return editor;

  editor.history.commit(result, {
    before: editor.selection,
    after: editor.selection,
  });
  return rebuildTrees(
    { ...editor, state: result.state },
    editor,
    config,
    result.dirtyIds,
  );
}

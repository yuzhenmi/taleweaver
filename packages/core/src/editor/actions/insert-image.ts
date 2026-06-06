import type { EditorState, EditorConfig } from "../editor-state";
import {
  getBlock,
  insertBlocksAfter,
  productionAllocator,
  createPosition,
  createSpan,
} from "../../state";
import type { ReadonlyAttrs } from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * INSERT_IMAGE — insert an image (Google Docs Insert ▸ Image) as a block-level
 * atomic leaf immediately AFTER the caret's block, followed by a fresh empty
 * paragraph so the caret has an editable landing spot below it (mirrors
 * INSERT_HORIZONTAL_LINE / Google Docs). One undo entry.
 *
 * `src` is required; `width`/`height` are optional — when omitted the image
 * sizes intrinsically (`imageComponent` maps a MISSING dimension to `"auto"`;
 * the loaded image's natural size is supplied browser-side by the ImageCache).
 *
 * No-op (same `editor` reference, no commit) when the focus block is missing, is
 * the root, or is in a non-main tree (header/footer/footnote body —
 * `insertBlocksAfter`/`getBlock` are main-tree-only, per design D3).
 */
export function handleInsertImage(
  editor: EditorState,
  src: string,
  width: number | undefined,
  height: number | undefined,
  config: EditorConfig,
): EditorState {
  const focus = getBlock(editor.state, editor.selection.focus.blockId);
  if (focus === null || focus.parentId === null) return editor;

  // Only set width/height when provided, so an omitted dimension stays "auto"
  // (intrinsic) rather than being pinned to a value.
  const imageAttrs: ReadonlyAttrs = {
    src,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };

  const result = insertBlocksAfter(
    editor.state,
    focus.id,
    [
      { type: "image", attrs: imageAttrs },
      { type: "paragraph", inlineContent: { items: [] } },
    ],
    productionAllocator,
  );
  if (result.state === editor.state) return editor;

  // newBlockIds = [image, paragraph]; caret lands in the paragraph.
  const paragraphId = result.newBlockIds[1];
  if (paragraphId === undefined) return editor; // defensive: both always inserted

  const caret = createPosition(paragraphId, 0);
  const after = createSpan(caret, caret);
  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after },
  );
  return rebuildTrees(
    { ...editor, state: result.state, selection: after },
    editor,
    config,
    result.dirtyIds,
  );
}

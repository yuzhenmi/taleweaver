import type { EditorState, EditorConfig } from "../editor-state";
import type { ReadonlyAttrs } from "../../state";
import { insertAtomicBlockAfterFocus } from "./atomic-edits";

/**
 * INSERT_IMAGE — insert an image (Google Docs Insert ▸ Image) as a block-level
 * atomic leaf immediately AFTER the caret's block, followed by a fresh empty
 * paragraph so the caret has an editable landing spot below it (mirrors
 * INSERT_HORIZONTAL_LINE / Google Docs). One undo entry. See
 * `insertAtomicBlockAfterFocus` for the shared insert + caret + no-op semantics.
 *
 * `src` is required; `width`/`height` are optional — when omitted the image
 * sizes intrinsically (`imageComponent` maps a MISSING dimension to `"auto"`;
 * the loaded image's natural size is supplied browser-side by the ImageCache).
 */
export function handleInsertImage(
  editor: EditorState,
  src: string,
  width: number | undefined,
  height: number | undefined,
  config: EditorConfig,
): EditorState {
  // Only set width/height when provided, so an omitted dimension stays "auto"
  // (intrinsic) rather than being pinned to a value.
  const imageAttrs: ReadonlyAttrs = {
    src,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };

  return insertAtomicBlockAfterFocus(editor, config, {
    type: "image",
    attrs: imageAttrs,
  });
}

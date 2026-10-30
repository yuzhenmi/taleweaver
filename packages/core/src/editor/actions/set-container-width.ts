import type { EditorState } from "../editor-state";
import type { ActionOf } from "../editor-action";

export function handleSetContainerWidth(
  editor: EditorState,
  { width }: ActionOf<"SET_CONTAINER_WIDTH">,
): EditorState {
  if (width === editor.containerWidth) return editor;
  // Core is geometry-free. A resize records the new `containerWidth`
  // and signals a FULL rebuild (`lastDirtyIds: null`); the backend layout-driver
  // re-paginates against the new width (reusing the prior cascaded tree, so a
  // tall header re-paginates with the grown insets).
  return { ...editor, containerWidth: width, lastDirtyIds: null };
}

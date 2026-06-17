import type { EditorState, EditorConfig } from "../editor-state";

export function handleSetContainerWidth(
  editor: EditorState,
  width: number,
  _config: EditorConfig,
): EditorState {
  if (width === editor.containerWidth) return editor;
  // Phase 0b: core is geometry-free. A resize records the new `containerWidth`
  // and signals a FULL rebuild (`lastDirtyIds: null`); the backend layout-driver
  // re-paginates against the new width (reusing the prior cascaded tree, so a
  // tall header re-paginates with the grown insets).
  return { ...editor, containerWidth: width, lastDirtyIds: null };
}

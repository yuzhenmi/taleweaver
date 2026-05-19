import type { EditorState, EditorConfig } from "../editor-state";
import { layoutTree } from "../../layout/dispatch";

export function handleSetContainerWidth(
  editor: EditorState,
  width: number,
  config: EditorConfig,
): EditorState {
  if (width === editor.containerWidth) return editor;
  const layout = layoutTree(
    editor.renderTree,
    width,
    config.measurer,
    config.pageConfig,
  );
  return { ...editor, containerWidth: width, layoutTree: layout };
}

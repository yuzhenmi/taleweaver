import type { EditorState, EditorConfig } from "../editor-state";
import { layoutTree } from "../../layout/layout-engine";

export function handleSetContainerWidth(
  editor: EditorState,
  width: number,
  config: EditorConfig,
): EditorState {
  if (width === editor.containerWidth) return editor;
  const layout = layoutTree(editor.renderTree, width, config.measurer, config.pageHeight, config.pageMargins);
  return { ...editor, containerWidth: width, layoutTree: layout };
}

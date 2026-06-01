import type { EditorState, EditorConfig } from "../editor-state";
import { layoutTree } from "../../layout/dispatch";

export function handleSetContainerWidth(
  editor: EditorState,
  width: number,
  config: EditorConfig,
): EditorState {
  if (width === editor.containerWidth) return editor;
  const layout = layoutTree(
    // Pass the already-cascaded root so the resize re-uses the cascaded tree
    // (and so a tall header re-paginates with the GROWN insets — see below).
    editor.cascadedRoot,
    width,
    config.measurer,
    config.pageConfig,
    // #328 (C1): thread the cascaded header/footer bodies through the FULL-build
    // resize path too. Without this, a window resize would re-paginate a
    // tall-header doc as if the header fit the margin (body jumps up, overflow
    // re-clipped). `editor.cascadedTemplateContents` is the same map the
    // incremental path threads via `rebuildTrees`.
    editor.cascadedTemplateContents,
  );
  return { ...editor, containerWidth: width, layoutTree: layout };
}

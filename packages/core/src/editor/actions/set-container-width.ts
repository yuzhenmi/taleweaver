import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import type { ActionOf } from "../editor-action";

export function handleSetContainerWidth(
  editor: EditorState,
  { width }: ActionOf<"SET_CONTAINER_WIDTH">,
): Edit | null {
  // Core is geometry-free. A resize records the new `containerWidth` (with no
  // document change, `lastDirtyIds` stays null: a FULL rebuild); the backend
  // layout-driver re-paginates against the new width (reusing the prior cascaded tree,
  // so a tall header re-paginates with the grown insets).
  return width === editor.containerWidth ? null : { containerWidth: width };
}

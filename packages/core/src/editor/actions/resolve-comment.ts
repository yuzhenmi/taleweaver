import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { resolveComment } from "../../state";
import type { ActionOf } from "../editor-action";

/**
 * `RESOLVE_COMMENT` handler — flips the thread record's `resolved` flag to
 * `true` (a tracked side-table write; the `comments` map is in the
 * UndoManager's scopes, so this is undoable). Identity no-op (returns the editor
 * UNCHANGED) when the comment is absent or already resolved — the op returns the
 * same `document` reference per the identity-no-op contract.
 *
 * The selection is unaffected (this touches only the comments side-table — or
 * surfaces `rootId` as its dirtyId — never inline content), so the `after`
 * selection equals the `before` selection.
 */
export function handleResolveComment(editor: EditorState, { id }: ActionOf<"RESOLVE_COMMENT">): Edit | null {
  return { change: resolveComment(editor.document, id) };
}

import type { BlockId } from "../../../state";
import type { EditorState } from "../../editor-state";
import type { EditorConfig } from "../../editor-config";
import { recordChange } from "../../document-change";

/**
 * Core is geometry-free. `rebuildTrees` no longer runs the
 * render → cascade → layout pipeline (that lives in the print backend's
 * layout-driver now). It only RECORDS what changed — the set of dirty block
 * ids — onto `EditorState.lastDirtyIds`, the per-dispatch incremental hint the
 * backend consumes to rebuild layout incrementally (reusing unchanged subtrees
 * by reference). `dirtyIds === undefined` records `null` (a full rebuild).
 *
 * `oldEditor` is the handler's input (the pre-action editor): its `state` is what
 * `lastChange.from` records, so position mapping knows which State `dirtyIds` is relative
 * to. `_config` is retained in the signature but no longer read.
 */
export function rebuildTrees(
  newEditor: EditorState,
  oldEditor: EditorState,
  _config: EditorConfig,
  dirtyIds?: ReadonlySet<BlockId>,
): EditorState {
  return {
    ...newEditor,
    lastDirtyIds: dirtyIds ?? null,
    lastChange: dirtyIds !== undefined ? recordChange(oldEditor.lastChange, oldEditor.state, dirtyIds) : null,
  };
}

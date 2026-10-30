import type { EditorState } from "../../editor-state";
import type { EditorConfig } from "../../editor-config";
import type { Edit } from "../../edit";
import type { Span, BlockId, ReadonlyAttrs } from "../../../state";
import { applyAttrsOrSuggest } from "./apply-attrs-or-suggest";

/** Apply each `[span, attrs]` delta in turn, as one edit (one undo step). */
export function applyDeltas(
  editor: EditorState,
  deltas: ReadonlyArray<readonly [Span, ReadonlyAttrs]>,
  config: EditorConfig,
): Edit | null {
  let state = editor.state;
  const dirtyIds = new Set<BlockId>();
  for (const [span, attrs] of deltas) {
    const r = applyAttrsOrSuggest(state, span, attrs, config);
    state = r.state;
    for (const id of r.dirtyIds) dirtyIds.add(id);
  }
  // An attr-only edit shifts no offsets: the selection is kept as-is (direction too).
  return state === editor.state ? null : { change: { state, dirtyIds } };
}

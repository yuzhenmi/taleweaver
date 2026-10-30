import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { markInstanceKey } from "../../cascade/attr-registry";
import type { ActionOf } from "../editor-action";
import { applyDeltas } from "./helpers/apply-deltas";
import { usableSpan } from "./helpers/usable-span";
import { isNonExclusive } from "./helpers/is-non-exclusive";

/**
 * SET_MARK: put mark `key` = `value` on the span (default: the selection). An
 * exclusive mark writes `key` (replacing any other value there); a non-exclusive
 * mark adds an instance under its own key, so it overlaps existing instances.
 * `replace` (non-exclusive only) names an existing instance to swap out: its
 * removal and the new instance form ONE delta — one undo step, one formatting
 * suggestion. Formatting attrs on the runs are untouched (merge semantics).
 */
export function handleSetMark(
  editor: EditorState,
  { key, value, replace, span }: ActionOf<"SET_MARK">,
): Edit | null {
  const { config } = editor;
  const target = usableSpan(editor, span);
  if (target === null || value === undefined) return null;
  if (!isNonExclusive(key, config)) return applyDeltas(editor, [[target, { [key]: value }]], config);
  const delta: Record<string, unknown> = {};
  if (replace !== undefined) delta[markInstanceKey(key, replace)] = undefined;
  delta[markInstanceKey(key, value)] = value; // after the removal: replace === value keeps it
  return applyDeltas(editor, [[target, delta]], config);
}

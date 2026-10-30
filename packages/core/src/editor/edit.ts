import type { OperationResult, ReadonlyAttrs, Selection } from "../state";
import type { EditorState } from "./editor-state";
import { rebuildTrees } from "./actions/helpers";
import { rebaseSelection } from "./foreign-change";

/**
 * What a document-editing action did, for the reducer to apply (`applyEdit`). An edit
 * handler computes its `Edit` (or `null` when the action changes nothing) and never
 * touches history or the change record itself, so committing is uniform: one undo entry
 * per changing action, carrying the selection before → after.
 */
export interface Edit {
  /** The document change — one undo entry. Omitted: the document is unchanged. */
  readonly change?: OperationResult;
  /**
   * The selection after the action. `"rebase"` maps the prior selection through
   * `change` (for an edit that does not place the caret itself, e.g. resolving a
   * suggestion). Omitted: unchanged.
   */
  readonly selection?: Selection | "rebase";
  /** New pending typing attrs (a format command at a collapsed caret). */
  readonly storedAttrs?: ReadonlyAttrs;
  /**
   * An `EditorState` shares `selection` / `storedAttrs`, so without this it would be
   * assignable to `Edit` — a handler returning a whole state would silently lose its change.
   */
  readonly state?: never;
}

/**
 * Apply `edit` to `editor`: record the change (`lastDirtyIds` / `lastChange`), commit it
 * as one undo entry with the selection before → after, and set the selection and typing
 * attrs. `null` — and a change that leaves the document as it was — commit nothing.
 */
export function applyEdit(editor: EditorState, edit: Edit | null): EditorState {
  if (edit === null) return editor;
  const change = edit.change !== undefined && edit.change.state !== editor.state ? edit.change : undefined;
  let next =
    change === undefined
      ? editor
      : rebuildTrees({ ...editor, state: change.state }, editor, editor.config, change.dirtyIds);
  const selection =
    edit.selection === "rebase" ? rebaseSelection(editor, next) : (edit.selection ?? editor.selection);
  if (change !== undefined) editor.history.commit(change, { before: editor.selection, after: selection });
  if (selection !== next.selection) next = { ...next, selection };
  if (edit.storedAttrs !== undefined) next = { ...next, storedAttrs: edit.storedAttrs };
  return next;
}

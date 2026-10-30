import type { BlockId, OperationResult, ReadonlyAttrs, Selection } from "../state";
import type { CaretAffinity } from "../cursor/selection";
import type { EditorState } from "./editor-state";
import type { ProposalOutcome } from "./proposals";
import { recordChange } from "./document-change";
import { rebaseSelection } from "./foreign-change";

/**
 * The view hints a selection carries, set exactly as given (see `SET_SELECTION`): an
 * absent `caretPageHint` / `caretAffinity` / `anchorAffinity` clears it, an absent
 * `targetX` leaves it.
 */
export interface SelectionView {
  readonly caretPageHint?: number;
  readonly caretAffinity?: CaretAffinity;
  readonly anchorAffinity?: CaretAffinity;
  readonly targetX?: number | null;
}

/**
 * What an action did, for the reducer to apply (`applyEdit`). Every action handler
 * computes its `Edit` (or `null` when the action changes nothing) and never touches
 * history or the change record itself.
 */
export interface Edit {
  /**
   * The document change: one, or several steps in order (each recorded as its own
   * change, keeping its exact position mapping). Omitted: the document is unchanged.
   */
  readonly change?: OperationResult | readonly OperationResult[];
  /**
   * The selection after the action. `"rebase"` maps the prior selection through
   * `change` (for an edit that does not place the caret itself, e.g. resolving a
   * suggestion or a peer's change). Omitted: unchanged.
   */
  readonly selection?: Selection | "rebase";
  /** The view hints to set with the selection. Omitted: the current ones stay. */
  readonly view?: SelectionView;
  /** New pending typing attrs (a format command at a collapsed caret). */
  readonly storedAttrs?: ReadonlyAttrs;
  /**
   * `false`: the change is not an undo step of this editor — undo / redo themselves, a
   * peer's change, another author's proposal. History follows it instead of recording it.
   */
  readonly undoable?: false;
  /** A proposal's verdict (`EditorState.lastProposal`). */
  readonly proposal?: ProposalOutcome;
  /** A new container width (`SET_CONTAINER_WIDTH`). */
  readonly containerWidth?: number;
  /**
   * An `EditorState` shares `selection` / `storedAttrs`, so without this it would be
   * assignable to `Edit` — a handler returning a whole state would silently lose its change.
   */
  readonly state?: never;
}

/**
 * Apply `edit` to `editor`: record the change (`lastDirtyIds` / `lastChange`), commit it
 * as one undo entry with the selection before → after — or, when not `undoable`, advance
 * history past it — then set the selection, its view hints and the other fields. `null`,
 * and a change that leaves the document as it was, record and commit nothing.
 */
export function applyEdit(editor: EditorState, edit: Edit | null): EditorState {
  if (edit === null) return editor;
  const steps = edit.change === undefined ? [] : "state" in edit.change ? [edit.change] : edit.change;
  let state = editor.state;
  let lastChange = editor.lastChange;
  let dirtyIds: ReadonlySet<BlockId> | null = null;
  for (const step of steps) {
    if (step.state === state) continue;
    lastChange = recordChange(lastChange, state, step.dirtyIds);
    dirtyIds = dirtyIds === null ? step.dirtyIds : new Set([...dirtyIds, ...step.dirtyIds]);
    state = step.state;
  }
  let next = dirtyIds === null ? editor : { ...editor, state, lastDirtyIds: dirtyIds, lastChange };
  const selection =
    edit.selection === "rebase" ? rebaseSelection(editor, next) : (edit.selection ?? editor.selection);
  if (dirtyIds !== null) {
    if (edit.undoable === false) editor.history.advanceState(state);
    else editor.history.commit({ state, dirtyIds }, { before: editor.selection, after: selection });
  }
  if (selection !== next.selection) next = { ...next, selection };
  if (edit.view !== undefined) {
    const { caretPageHint, caretAffinity, anchorAffinity, targetX } = edit.view;
    next = { ...next, caretPageHint, caretAffinity, anchorAffinity };
    if (targetX !== undefined) next = { ...next, targetX };
  }
  if (edit.storedAttrs !== undefined) next = { ...next, storedAttrs: edit.storedAttrs };
  if (edit.proposal !== undefined) next = { ...next, lastProposal: edit.proposal };
  if (edit.containerWidth !== undefined) next = { ...next, containerWidth: edit.containerWidth };
  return next;
}

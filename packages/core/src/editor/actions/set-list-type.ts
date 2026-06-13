import type { EditorState, EditorConfig } from "../editor-state";
import {
  getBlock,
  setListType,
  getListDefsForState,
  classifyListDef,
  iterateBlocksInSpan,
  positionsEqual,
} from "../../state";
import type { Block, BlockId, State } from "../../state";
import { rebuildTrees } from "./helpers";

type ListType = "ordered" | "unordered";

/**
 * SET_LIST_TYPE — change the numbering type (ordered ⇄ unordered) of the list(s)
 * the selection touches (Google Docs: changing a list's type changes ALL its
 * items). Distinct from TOGGLE_LIST: this never adds/removes list membership, it
 * only rewrites the shared `ListDef` of an existing list.
 *
 * Targets the distinct `listId`s of the list-items in the selection — the focus
 * block's list for a collapsed caret, or every list a range covers. A list whose
 * current type already equals `listType` is skipped (no redundant def rewrite /
 * history entry). Each change goes through the state op `setListType`, whose
 * dirty-union returns the affected items so they re-render. A selection with no
 * list-items, or one where every touched list already matches, is a no-op
 * returning the same `editor` reference.
 */
export function handleSetListType(
  editor: EditorState,
  listType: ListType,
  config: EditorConfig,
): EditorState {
  const listIds = distinctSelectedListIds(editor);
  if (listIds.size === 0) return editor;

  const defs = getListDefsForState(editor.state);
  const currentType = (listId: string): ListType | undefined => {
    const def = defs.get(listId);
    return def === undefined ? undefined : classifyListDef(def);
  };

  let state: State = editor.state;
  const dirtyIds = new Set<BlockId>();
  for (const listId of listIds) {
    // Skip lists already of the requested type — avoids a redundant def rewrite
    // (which would otherwise produce a no-op history entry, since the def write
    // always mutates the Y.Doc even with identical content).
    if (currentType(listId) === listType) continue;
    const result = setListType(state, listId, listType);
    state = result.state;
    for (const id of result.dirtyIds) dirtyIds.add(id);
  }

  if (state === editor.state) return editor;

  editor.history.commit(
    { state, dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees({ ...editor, state }, editor, config, dirtyIds);
}

/** The distinct `listId`s of list-items the selection touches. */
function distinctSelectedListIds(editor: EditorState): Set<string> {
  const { state, selection } = editor;
  const ids = new Set<string>();
  const addFrom = (block: Block | null): void => {
    if (block !== null && block.type === "list-item") {
      const v = block.attrs.listId;
      if (typeof v === "string") ids.add(v);
    }
  };

  if (positionsEqual(selection.anchor, selection.focus)) {
    addFrom(getBlock(state, selection.focus.blockId));
    return ids;
  }
  for (const block of iterateBlocksInSpan(state, selection)) addFrom(block);
  return ids;
}

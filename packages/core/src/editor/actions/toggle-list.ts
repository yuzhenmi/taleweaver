import type { EditorState, EditorConfig } from "../editor-state";
import {
  getBlock,
  setBlockType,
  mergeBlockAttrs,
  setListType,
  getListDefsForState,
  classifyListDef,
  iterateBlocksInSpan,
  positionsEqual,
  newListId,
} from "../../state";
import type { Block, BlockId, State, OperationResult } from "../../state";
import { rebuildTrees } from "./helpers";

type ListType = "ordered" | "unordered";

/**
 * Toggle list formatting over the selection (Google Docs numbered/bulleted-list
 * control) in the FLAT list model (D1/D6).
 *
 * A "list" is a maximal document-order run of `list-item` leaves sharing a
 * `listId`; nesting is the per-item `listLevel`. There is no `list` container.
 * Toggling is therefore a local attribute edit, not tree surgery:
 *
 *   - **Unified toggle (Google Docs):** if EVERY eligible target is already a
 *     list-item of the requested type, the control turns the whole selection
 *     OFF (back to paragraphs, clearing `listId`/`listLevel`/`listCounterOverride`).
 *     Otherwise it turns everything ON — converting paragraphs (and list-items
 *     of the other type) into list-items of the requested type.
 *   - **Adjacent-join:** when turning ON, the run reuses the `listId` of an
 *     immediately-adjacent same-type list (the sibling before the first target
 *     or after the last) so a toggled paragraph continues its neighbour's
 *     numbering. With no same-type neighbour, a fresh `listId` is allocated and
 *     its def written via `setListType` (whose dirty-union re-renders the items).
 *
 * Eligible targets are text leaves (paragraph or list-item): the focus block for
 * a collapsed caret, or every such leaf the span covers. A non-text-leaf (e.g. a
 * container) is skipped. No eligible target, or a write that changes nothing,
 * is a no-op returning the same `editor` reference (never calling
 * `history.commit`).
 */
export function handleToggleList(
  editor: EditorState,
  listType: ListType,
  config: EditorConfig,
): EditorState {
  const targets = eligibleTargets(editor);
  if (targets.length === 0) return editor;

  // Classify against the PRE-edit defs (they only change when we write one,
  // which this handler controls). Fetch the map once rather than per lookup.
  const defs = getListDefsForState(editor.state);
  const typeOfList = (listId: string): ListType | undefined => {
    const def = defs.get(listId);
    return def === undefined ? undefined : classifyListDef(def);
  };

  // A target counts as "already this type" only when it is a list-item whose
  // def resolves to exactly `listType`. A list-item with no `listId`, or a valid
  // `listId` whose def is missing (corrupt / partial state), does NOT count — so
  // the toggle CONVERTS it (writing a proper def of the requested type) rather
  // than silently removing the list. The unified Google-Docs toggle turns the
  // whole selection OFF only when EVERY target already matches.
  const isAlreadyThisType = (b: Block): boolean => {
    if (b.type !== "list-item") return false;
    const id = listIdOf(b);
    return id !== undefined && typeOfList(id) === listType;
  };
  const turningOff = targets.every(isAlreadyThisType);

  let state: State = editor.state;
  const dirtyIds = new Set<BlockId>();
  const apply = (r: OperationResult): void => {
    state = r.state;
    for (const id of r.dirtyIds) dirtyIds.add(id);
  };

  if (turningOff) {
    for (const t of targets) {
      apply(setBlockType(state, t.id, "paragraph", config.componentRegistry));
      apply(
        mergeBlockAttrs(
          state,
          t.id,
          { listId: undefined, listLevel: undefined, listCounterOverride: undefined },
          config.attrRegistry,
        ),
      );
    }
  } else {
    // `targets.length === 0` is guarded at the top of the handler, so the first
    // and last targets always exist.
    const firstTarget = targets[0];
    const lastTarget = targets[targets.length - 1];
    if (firstTarget === undefined || lastTarget === undefined) {
      throw new Error(
        "handleToggleList: empty targets reached the turning-on branch (invariant violation)",
      );
    }
    const joinId = adjacentSameTypeListId(
      editor.state,
      firstTarget,
      lastTarget,
      listType,
      typeOfList,
    );
    // List ids are a plain-string namespace distinct from block ids; mint one
    // (no brand cast) when not joining a neighbour.
    const listId = joinId ?? newListId();

    for (const t of targets) {
      if (t.type !== "list-item") {
        apply(setBlockType(state, t.id, "list-item", config.componentRegistry));
      }
      // Assign the run's listId. `listLevel`/`listCounterOverride` are left
      // untouched: a fresh paragraph has neither (renders at level 0), and a
      // converted list-item keeps its existing nesting (Google Docs preserves
      // the indent level across a numbered↔bulleted conversion).
      apply(mergeBlockAttrs(state, t.id, { listId }, config.attrRegistry));
    }

    if (joinId === undefined) {
      // New list: write its def. ORDERING CONSTRAINT — this MUST run AFTER the
      // assignment loop above: `setListType` collects its dirty ids by walking
      // the (now-mutated) document for items whose `listId` matches, and the def
      // write itself captures no block dirty ids. Calling it before the loop
      // would find zero items, returning an empty dirty set and silently
      // skipping the re-render of the newly-assigned items.
      apply(setListType(state, listId, listType));
    }
  }

  if (state === editor.state) return editor;

  editor.history.commit(
    { state, dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees({ ...editor, state }, editor, config, dirtyIds);
}

/** The text-leaf blocks the toggle applies to (paragraph or list-item). */
function eligibleTargets(editor: EditorState): Block[] {
  const { state, selection } = editor;
  if (positionsEqual(selection.anchor, selection.focus)) {
    const focus = getBlock(state, selection.focus.blockId);
    return focus !== null && isEligible(focus) ? [focus] : [];
  }
  const out: Block[] = [];
  for (const block of iterateBlocksInSpan(state, selection)) {
    if (isEligible(block)) out.push(block);
  }
  return out;
}

function isEligible(block: Block): boolean {
  return block.type === "paragraph" || block.type === "list-item";
}

function listIdOf(block: Block): string | undefined {
  const v = block.attrs.listId;
  return typeof v === "string" ? v : undefined;
}

/**
 * The `listId` of an immediately-adjacent list of `listType`, for join-on-toggle:
 * the sibling before the first target, else the sibling after the last. `null`
 * sibling links (run ends) and other-type / def-less neighbours don't join.
 *
 * Tie-break: when BOTH neighbours qualify but belong to DIFFERENT same-type
 * lists, the BEFORE neighbour wins — the toggled items append to the prior run
 * rather than prepend to the next. The flat model does not auto-coalesce the two
 * runs into one (no automatic list merging), matching Google Docs, which leaves
 * a paragraph toggled between two lists attached to the one above it.
 */
function adjacentSameTypeListId(
  state: State,
  first: Block,
  last: Block,
  listType: ListType,
  typeOfList: (listId: string) => ListType | undefined,
): string | undefined {
  const before =
    first.prevSiblingId !== null ? getBlock(state, first.prevSiblingId) : null;
  if (before !== null && before.type === "list-item") {
    const id = listIdOf(before);
    if (id !== undefined && typeOfList(id) === listType) return id;
  }
  const after =
    last.nextSiblingId !== null ? getBlock(state, last.nextSiblingId) : null;
  if (after !== null && after.type === "list-item") {
    const id = listIdOf(after);
    if (id !== undefined && typeOfList(id) === listType) return id;
  }
  return undefined;
}

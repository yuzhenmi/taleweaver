/**
 * `SET_LIST_TYPE` / `handleSetListType` + `SET_LIST_RESTART` / `handleSetListRestart`
 * — the Google Docs "change list type" control and "restart / continue numbering"
 * control, in the FLAT list model.
 *
 * SET_LIST_TYPE rewrites the shared `ListDef` of the list(s) the selection
 * touches (all items of a list change together); SET_LIST_RESTART sets/clears a
 * single item's `listCounterOverride`, after which the following items in the run
 * renumber. Both are verified end-to-end against the numbering engine
 * (`computeCounters` over `collectListEvents`).
 */
import { describe, it, expect } from "vitest";
import {
  config,
  reduceEditor,
  createPosition,
  createSpan,
} from "./test-helpers";
import type { EditorState } from "../editor-state";
import {
  getBlock,
  createHistory,
  setListType,
  getListDefsForState,
  classifyListDef,
} from "../../state";
import type { BlockId, State } from "../../state";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";
import { collectListEvents } from "../../numbering/list-collector";
import { computeCounters } from "../../numbering/compute-counters";

// Phase 0b: core's `EditorState` is geometry-free — these state-level action
// tests build only the geometry-free fields (the handler reads no layout).
function makeEditor(state: State, selection: EditorState["selection"]): EditorState {
  return {
    state,
    selection,
    history: createHistory(state),
    lastDirtyIds: null,
    containerWidth: config.containerWidth,
    targetX: null,
  };
}

/** A list's classified type (ordered/unordered), or undefined if it has no def. */
function listKind(state: State, listId: string): "ordered" | "unordered" | undefined {
  const def = getListDefsForState(state).get(listId);
  return def === undefined ? undefined : classifyListDef(def);
}

/** Numbering value for a block id, via the render-time numbering engine. */
function counterValue(state: State, blockId: string): number | undefined {
  const events = collectListEvents(state);
  const counters = computeCounters(events, getListDefsForState(state));
  return counters.get(blockId as BlockId)?.value;
}

/** A three-item ordered list (i0,i1,i2 share listId L1). */
function buildOrderedList(): State {
  let state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "i0", lastChildId: "i2" }),
      buildBlock({
        id: "i0",
        type: "list-item",
        parentId: "doc",
        nextSiblingId: "i1",
        attrs: { listId: "L1" },
        inlineContent: inlineContent([text("a")]),
      }),
      buildBlock({
        id: "i1",
        type: "list-item",
        parentId: "doc",
        prevSiblingId: "i0",
        nextSiblingId: "i2",
        attrs: { listId: "L1" },
        inlineContent: inlineContent([text("b")]),
      }),
      buildBlock({
        id: "i2",
        type: "list-item",
        parentId: "doc",
        prevSiblingId: "i1",
        attrs: { listId: "L1" },
        inlineContent: inlineContent([text("c")]),
      }),
    ],
  });
  return setListType(state, "L1", "ordered").state;
}

describe("handleSetListType — SET_LIST_TYPE (#L15)", () => {
  it("changes the whole list's type (def rewritten to unordered)", () => {
    const state = buildOrderedList();
    expect(listKind(state, "L1")).toBe("ordered");

    const editor = makeEditor(state, {
      anchor: createPosition("i1" as BlockId, 0),
      focus: createPosition("i1" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "SET_LIST_TYPE", listType: "unordered" }, config);

    // The single shared def flipped — affects ALL items, not just the focus item.
    expect(listKind(next.state, "L1")).toBe("unordered");
  });

  it("no-op when the list is already the requested type (same editor reference)", () => {
    const state = buildOrderedList();
    const editor = makeEditor(state, {
      anchor: createPosition("i0" as BlockId, 0),
      focus: createPosition("i0" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "SET_LIST_TYPE", listType: "ordered" }, config);
    expect(next).toBe(editor);
  });

  it("no-op when the caret is not in a list-item", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("plain")]),
        }),
      ],
    });
    const editor = makeEditor(state, {
      anchor: createPosition("p" as BlockId, 0),
      focus: createPosition("p" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "SET_LIST_TYPE", listType: "ordered" }, config);
    expect(next).toBe(editor);
  });

  it("undo restores the prior list type", () => {
    const state = buildOrderedList();
    const editor = makeEditor(state, {
      anchor: createPosition("i1" as BlockId, 0),
      focus: createPosition("i1" as BlockId, 0),
    });
    const changed = reduceEditor(editor, { type: "SET_LIST_TYPE", listType: "unordered" }, config);
    expect(listKind(changed.state, "L1")).toBe("unordered");

    const undone = reduceEditor(changed, { type: "UNDO" }, config);
    expect(listKind(undone.state, "L1")).toBe("ordered");
  });

  it("range selection spanning two lists changes BOTH lists' types", () => {
    // L1 (i0,i1) ordered, then L2 (j0) ordered; select across both → unordered.
    let state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "i0", lastChildId: "j0" }),
        buildBlock({
          id: "i0",
          type: "list-item",
          parentId: "doc",
          nextSiblingId: "i1",
          attrs: { listId: "L1" },
          inlineContent: inlineContent([text("a")]),
        }),
        buildBlock({
          id: "i1",
          type: "list-item",
          parentId: "doc",
          prevSiblingId: "i0",
          nextSiblingId: "j0",
          attrs: { listId: "L1" },
          inlineContent: inlineContent([text("b")]),
        }),
        buildBlock({
          id: "j0",
          type: "list-item",
          parentId: "doc",
          prevSiblingId: "i1",
          attrs: { listId: "L2" },
          inlineContent: inlineContent([text("c")]),
        }),
      ],
    });
    state = setListType(state, "L1", "ordered").state;
    state = setListType(state, "L2", "ordered").state;

    const editor = makeEditor(
      state,
      createSpan(createPosition("i0" as BlockId, 0), createPosition("j0" as BlockId, 1)),
    );
    const next = reduceEditor(editor, { type: "SET_LIST_TYPE", listType: "unordered" }, config);

    expect(listKind(next.state, "L1")).toBe("unordered");
    expect(listKind(next.state, "L2")).toBe("unordered");
  });
});

describe("handleSetListRestart — SET_LIST_RESTART (#L15)", () => {
  it("sets the override on the focus item and the following item renumbers from it", () => {
    const state = buildOrderedList();
    // Natural numbering: i0=1, i1=2, i2=3.
    expect(counterValue(state, "i1")).toBe(2);
    expect(counterValue(state, "i2")).toBe(3);

    const editor = makeEditor(state, {
      anchor: createPosition("i1" as BlockId, 0),
      focus: createPosition("i1" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "SET_LIST_RESTART", value: 5 }, config);

    // The attr is written on the focus item.
    expect(getBlock(next.state, "i1" as BlockId)?.attrs.listCounterOverride).toBe(5);
    // i1 restarts at 5 and i2 (the following item) renumbers to 6.
    expect(counterValue(next.state, "i1")).toBe(5);
    expect(counterValue(next.state, "i2")).toBe(6);
  });

  it("value null clears the override (item resumes the natural sequence)", () => {
    let state = buildOrderedList();
    state = reduceEditor(
      makeEditor(state, {
        anchor: createPosition("i1" as BlockId, 0),
        focus: createPosition("i1" as BlockId, 0),
      }),
      { type: "SET_LIST_RESTART", value: 5 },
      config,
    ).state;
    expect(counterValue(state, "i1")).toBe(5);

    const editor = makeEditor(state, {
      anchor: createPosition("i1" as BlockId, 0),
      focus: createPosition("i1" as BlockId, 0),
    });
    const cleared = reduceEditor(editor, { type: "SET_LIST_RESTART", value: null }, config);

    expect(getBlock(cleared.state, "i1" as BlockId)?.attrs.listCounterOverride).toBeUndefined();
    // Back to the natural sequence: i1=2, i2=3.
    expect(counterValue(cleared.state, "i1")).toBe(2);
    expect(counterValue(cleared.state, "i2")).toBe(3);
  });

  it("no-op when the caret is not in a list-item", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("plain")]),
        }),
      ],
    });
    const editor = makeEditor(state, {
      anchor: createPosition("p" as BlockId, 0),
      focus: createPosition("p" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "SET_LIST_RESTART", value: 3 }, config);
    expect(next).toBe(editor);
  });

  it("no-op when the override is already the requested value (same editor reference)", () => {
    let state = buildOrderedList();
    state = reduceEditor(
      makeEditor(state, {
        anchor: createPosition("i1" as BlockId, 0),
        focus: createPosition("i1" as BlockId, 0),
      }),
      { type: "SET_LIST_RESTART", value: 5 },
      config,
    ).state;

    const editor = makeEditor(state, {
      anchor: createPosition("i1" as BlockId, 0),
      focus: createPosition("i1" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "SET_LIST_RESTART", value: 5 }, config);
    expect(next).toBe(editor);
  });
});

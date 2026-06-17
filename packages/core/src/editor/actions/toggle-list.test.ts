/**
 * `TOGGLE_LIST` / `handleToggleList` — the Google Docs numbered/bulleted-list
 * toolbar control, in the FLAT list model (D1/D6).
 *
 * Toggling ON assigns a `listId` (a fresh one with its def written via
 * `setListType`, or the id of an adjacent same-type list — join-on-toggle) and
 * makes the block a `list-item`; toggling OFF clears `listId`/`listLevel`/
 * `listCounterOverride` and reverts to `paragraph`. "Same type" is the unified
 * Google Docs toggle: the control turns the selection OFF only when every target
 * is already a list-item of the requested type, else it turns everything ON. The
 * block id and its inlineContent survive the round-trip. There is no `listType`
 * attr and no `list` container — both were removed in the flat migration.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  createInitialEditorState,
  reduceEditor,
  firstChildId,
  createPosition,
  createSpan,
} from "./test-helpers";
import type { EditorState } from "../editor-state";
import {
  getBlock,
  createHistory,
  setListType,
  getListDefsForState,
} from "../../state";
import type { BlockId, State } from "../../state";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";

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

/** Classify a listId's def via the level-0 marker style (test mirror of the handler). */
function listKindOf(state: State, listId: string): "ordered" | "unordered" | undefined {
  const def = getListDefsForState(state).get(listId);
  const level0 = def?.levels[0];
  if (level0 === undefined) return undefined;
  const style = level0.style;
  return style === "disc" || style === "circle" || style === "square"
    ? "unordered"
    : "ordered";
}

describe("handleToggleList — flat list model (#L14)", () => {
  it("(a) paragraph → list-item: assigns a listId at level 0 + writes a list def", () => {
    const initial = createInitialEditorState(config);
    const paraId = firstChildId(initial.state) as BlockId;
    expect(getBlock(initial.state, paraId)?.type).toBe("paragraph");

    const next = reduceEditor(
      initial,
      { type: "TOGGLE_LIST", listType: "unordered" },
      config,
    );

    const block = getBlock(next.state, paraId);
    expect(block?.type).toBe("list-item");
    const listId = block?.attrs.listId;
    expect(typeof listId).toBe("string");
    // Level 0 → no listLevel attr; no legacy listType attr.
    expect(block?.attrs.listLevel).toBeUndefined();
    expect(block?.attrs.listType).toBeUndefined();
    // A def was written and classifies as unordered.
    expect(listKindOf(next.state, listId as string)).toBe("unordered");
  });

  it("(b) toggling a paragraph adjacent to a same-type list JOINS it (shared listId)", () => {
    // li(L1, unordered) followed by a plain paragraph p.
    let state: State = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "p" }),
        buildBlock({
          id: "li",
          type: "list-item",
          parentId: "doc",
          nextSiblingId: "p",
          attrs: { listId: "L1" },
          inlineContent: inlineContent([text("one")]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "li",
          inlineContent: inlineContent([text("two")]),
        }),
      ],
    });
    // Establish L1's def so the handler can classify it as unordered.
    state = setListType(state, "L1", "unordered").state;

    const editor = makeEditor(state, {
      anchor: createPosition("p" as BlockId, 0),
      focus: createPosition("p" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "TOGGLE_LIST", listType: "unordered" }, config);

    const p = getBlock(next.state, "p" as BlockId);
    expect(p?.type).toBe("list-item");
    // Joined the neighbour's list — same listId, no new list allocated.
    expect(p?.attrs.listId).toBe("L1");
  });

  it("(c) list-item → paragraph: clears listId/listLevel", () => {
    let state: State = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "li" }),
        buildBlock({
          id: "li",
          type: "list-item",
          parentId: "doc",
          attrs: { listId: "L1", listLevel: 2 },
          inlineContent: inlineContent([text("hello")]),
        }),
      ],
    });
    state = setListType(state, "L1", "unordered").state;

    const editor = makeEditor(state, {
      anchor: createPosition("li" as BlockId, 0),
      focus: createPosition("li" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "TOGGLE_LIST", listType: "unordered" }, config);

    const block = getBlock(next.state, "li" as BlockId);
    expect(block?.type).toBe("paragraph");
    expect(block?.attrs.listId).toBeUndefined();
    expect(block?.attrs.listLevel).toBeUndefined();
  });

  it("(d) multi-block selection toggles every eligible block into one list", () => {
    const state: State = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p1" }),
        buildBlock({
          id: "p0",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p1",
          inlineContent: inlineContent([text("one")]),
        }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p0",
          inlineContent: inlineContent([text("two")]),
        }),
      ],
    });
    const editor = makeEditor(
      state,
      createSpan(createPosition("p0" as BlockId, 0), createPosition("p1" as BlockId, 3)),
    );

    const next = reduceEditor(editor, { type: "TOGGLE_LIST", listType: "ordered" }, config);

    const b0 = getBlock(next.state, "p0" as BlockId);
    const b1 = getBlock(next.state, "p1" as BlockId);
    expect(b0?.type).toBe("list-item");
    expect(b1?.type).toBe("list-item");
    // Both share ONE freshly-allocated ordered list.
    expect(typeof b0?.attrs.listId).toBe("string");
    expect(b0?.attrs.listId).toBe(b1?.attrs.listId);
    expect(listKindOf(next.state, b0?.attrs.listId as string)).toBe("ordered");
  });

  it("cross-type: clicking ordered on an unordered item converts it (new ordered list)", () => {
    let state: State = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "li" }),
        buildBlock({
          id: "li",
          type: "list-item",
          parentId: "doc",
          attrs: { listId: "L1" },
          inlineContent: inlineContent([text("hello")]),
        }),
      ],
    });
    state = setListType(state, "L1", "unordered").state;

    const editor = makeEditor(state, {
      anchor: createPosition("li" as BlockId, 0),
      focus: createPosition("li" as BlockId, 0),
    });
    // Requesting ordered on an unordered item → NOT turning off → convert.
    const next = reduceEditor(editor, { type: "TOGGLE_LIST", listType: "ordered" }, config);

    const block = getBlock(next.state, "li" as BlockId);
    expect(block?.type).toBe("list-item");
    const newId = block?.attrs.listId as string;
    expect(newId).not.toBe("L1");
    expect(listKindOf(next.state, newId)).toBe("ordered");
  });

  it("cross-type adjacent to a same-(requested-)type list joins it (reuses neighbour id)", () => {
    // ord(L1 ordered) then a bulleted item li(L2). Clicking ORDERED on li → it
    // is not already ordered → ON; its before-sibling is an ordered list → join L1.
    let state: State = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "ord", lastChildId: "li" }),
        buildBlock({
          id: "ord",
          type: "list-item",
          parentId: "doc",
          nextSiblingId: "li",
          attrs: { listId: "L1" },
          inlineContent: inlineContent([text("one")]),
        }),
        buildBlock({
          id: "li",
          type: "list-item",
          parentId: "doc",
          prevSiblingId: "ord",
          attrs: { listId: "L2" },
          inlineContent: inlineContent([text("two")]),
        }),
      ],
    });
    state = setListType(state, "L1", "ordered").state;
    state = setListType(state, "L2", "unordered").state;

    const editor = makeEditor(state, {
      anchor: createPosition("li" as BlockId, 0),
      focus: createPosition("li" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "TOGGLE_LIST", listType: "ordered" }, config);

    // Joined the adjacent ordered list rather than allocating a new one.
    expect(getBlock(next.state, "li" as BlockId)?.attrs.listId).toBe("L1");
  });

  it("tie-break: a paragraph between two same-type but different lists joins the BEFORE one", () => {
    let state: State = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "a", lastChildId: "b" }),
        buildBlock({
          id: "a",
          type: "list-item",
          parentId: "doc",
          nextSiblingId: "p",
          attrs: { listId: "L1" },
          inlineContent: inlineContent([text("a")]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "a",
          nextSiblingId: "b",
          inlineContent: inlineContent([text("p")]),
        }),
        buildBlock({
          id: "b",
          type: "list-item",
          parentId: "doc",
          prevSiblingId: "p",
          attrs: { listId: "L2" },
          inlineContent: inlineContent([text("b")]),
        }),
      ],
    });
    state = setListType(state, "L1", "unordered").state;
    state = setListType(state, "L2", "unordered").state;

    const editor = makeEditor(state, {
      anchor: createPosition("p" as BlockId, 0),
      focus: createPosition("p" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "TOGGLE_LIST", listType: "unordered" }, config);

    // Both neighbours qualify → the BEFORE list (L1) wins.
    expect(getBlock(next.state, "p" as BlockId)?.attrs.listId).toBe("L1");
  });

  it("cross-type conversion preserves an existing nesting level", () => {
    let state: State = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "li" }),
        buildBlock({
          id: "li",
          type: "list-item",
          parentId: "doc",
          attrs: { listId: "L1", listLevel: 2 },
          inlineContent: inlineContent([text("nested")]),
        }),
      ],
    });
    state = setListType(state, "L1", "unordered").state;

    const editor = makeEditor(state, {
      anchor: createPosition("li" as BlockId, 0),
      focus: createPosition("li" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "TOGGLE_LIST", listType: "ordered" }, config);

    const block = getBlock(next.state, "li" as BlockId);
    expect(block?.type).toBe("list-item");
    expect(listKindOf(next.state, block?.attrs.listId as string)).toBe("ordered");
    // Nesting level survives the numbered↔bulleted conversion (Google Docs).
    expect(block?.attrs.listLevel).toBe(2);
  });

  it("preserves the block id and inlineContent across the toggle", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "hello" }, config);
    const paraId = firstChildId(s.state) as BlockId;

    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    const after = getBlock(s.state, paraId);
    expect(after?.id).toBe(paraId);
    expect(after?.type).toBe("list-item");
    expect(after?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello" });
  });

  it("round-trip: toggling twice with the same type returns to paragraph", () => {
    let s = createInitialEditorState(config);
    const paraId = firstChildId(s.state) as BlockId;

    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "ordered" }, config);
    expect(getBlock(s.state, paraId)?.type).toBe("list-item");

    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "ordered" }, config);
    expect(getBlock(s.state, paraId)?.type).toBe("paragraph");
    expect(getBlock(s.state, paraId)?.attrs).toEqual({});
  });
});

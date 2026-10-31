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
import { createEditorStateFromDocument, type EditorState } from "../editor-state";
import {
  getBlock,
  setListType,
  getListDefsForDocument,
  classifyListDef,
} from "../../state";
import type { BlockId, Document } from "../../state";
import { buildDocument, buildBlock, inlineContent, text } from "../../test-utils/document-builders";
import { collectListEvents } from "../../numbering/list-collector";
import { computeCounters } from "../../numbering/compute-counters";

// Phase 0b: core's `EditorState` is geometry-free — these state-level action
// tests build only the geometry-free fields (the handler reads no layout).
function makeEditor(document: Document, selection: EditorState["selection"]): EditorState {
  return createEditorStateFromDocument(document, selection, config);
}

/** A list's classified type (ordered/unordered), or undefined if it has no def. */
function listKind(document: Document, listId: string): "ordered" | "unordered" | undefined {
  const def = getListDefsForDocument(document).get(listId);
  return def === undefined ? undefined : classifyListDef(def);
}

/** Numbering value for a block id, via the render-time numbering engine. */
function counterValue(document: Document, blockId: string): number | undefined {
  const events = collectListEvents(document);
  const counters = computeCounters(events, getListDefsForDocument(document));
  return counters.get(blockId as BlockId)?.value;
}

/** A three-item ordered list (i0,i1,i2 share listId L1). */
function buildOrderedList(): Document {
  let document = buildDocument({
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
  return setListType(document, "L1", "ordered").document;
}

describe("handleSetListType — SET_LIST_TYPE (#L15)", () => {
  it("changes the whole list's type (def rewritten to unordered)", () => {
    const document = buildOrderedList();
    expect(listKind(document, "L1")).toBe("ordered");

    const editor = makeEditor(document, {
      anchor: createPosition("i1" as BlockId, 0),
      focus: createPosition("i1" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "SET_LIST_TYPE", listType: "unordered" });

    // The single shared def flipped — affects ALL items, not just the focus item.
    expect(listKind(next.document, "L1")).toBe("unordered");
  });

  it("no-op when the list is already the requested type (same editor reference)", () => {
    const document = buildOrderedList();
    const editor = makeEditor(document, {
      anchor: createPosition("i0" as BlockId, 0),
      focus: createPosition("i0" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "SET_LIST_TYPE", listType: "ordered" });
    expect(next).toBe(editor);
  });

  it("no-op when the caret is not in a list-item", () => {
    const document = buildDocument({
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
    const editor = makeEditor(document, {
      anchor: createPosition("p" as BlockId, 0),
      focus: createPosition("p" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "SET_LIST_TYPE", listType: "ordered" });
    expect(next).toBe(editor);
  });

  it("undo restores the prior list type", () => {
    const document = buildOrderedList();
    const editor = makeEditor(document, {
      anchor: createPosition("i1" as BlockId, 0),
      focus: createPosition("i1" as BlockId, 0),
    });
    const changed = reduceEditor(editor, { type: "SET_LIST_TYPE", listType: "unordered" });
    expect(listKind(changed.document, "L1")).toBe("unordered");

    const undone = reduceEditor(changed, { type: "UNDO" });
    expect(listKind(undone.document, "L1")).toBe("ordered");
  });

  it("range selection spanning two lists changes BOTH lists' types", () => {
    // L1 (i0,i1) ordered, then L2 (j0) ordered; select across both → unordered.
    let document = buildDocument({
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
    document = setListType(document, "L1", "ordered").document;
    document = setListType(document, "L2", "ordered").document;

    const editor = makeEditor(
      document,
      createSpan(createPosition("i0" as BlockId, 0), createPosition("j0" as BlockId, 1)),
    );
    const next = reduceEditor(editor, { type: "SET_LIST_TYPE", listType: "unordered" });

    expect(listKind(next.document, "L1")).toBe("unordered");
    expect(listKind(next.document, "L2")).toBe("unordered");
  });
});

describe("handleSetListRestart — SET_LIST_RESTART (#L15)", () => {
  it("sets the override on the focus item and the following item renumbers from it", () => {
    const document = buildOrderedList();
    // Natural numbering: i0=1, i1=2, i2=3.
    expect(counterValue(document, "i1")).toBe(2);
    expect(counterValue(document, "i2")).toBe(3);

    const editor = makeEditor(document, {
      anchor: createPosition("i1" as BlockId, 0),
      focus: createPosition("i1" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "SET_LIST_RESTART", value: 5 });

    // The attr is written on the focus item.
    expect(getBlock(next.document, "i1" as BlockId)?.attrs.listCounterOverride).toBe(5);
    // i1 restarts at 5 and i2 (the following item) renumbers to 6.
    expect(counterValue(next.document, "i1")).toBe(5);
    expect(counterValue(next.document, "i2")).toBe(6);
  });

  it("value null clears the override (item resumes the natural sequence)", () => {
    let document = buildOrderedList();
    document = reduceEditor(
      makeEditor(document, {
        anchor: createPosition("i1" as BlockId, 0),
        focus: createPosition("i1" as BlockId, 0),
      }),
      { type: "SET_LIST_RESTART", value: 5 },
    ).document;
    expect(counterValue(document, "i1")).toBe(5);

    const editor = makeEditor(document, {
      anchor: createPosition("i1" as BlockId, 0),
      focus: createPosition("i1" as BlockId, 0),
    });
    const cleared = reduceEditor(editor, { type: "SET_LIST_RESTART", value: null });

    expect(getBlock(cleared.document, "i1" as BlockId)?.attrs.listCounterOverride).toBeUndefined();
    // Back to the natural sequence: i1=2, i2=3.
    expect(counterValue(cleared.document, "i1")).toBe(2);
    expect(counterValue(cleared.document, "i2")).toBe(3);
  });

  it("no-op when the caret is not in a list-item", () => {
    const document = buildDocument({
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
    const editor = makeEditor(document, {
      anchor: createPosition("p" as BlockId, 0),
      focus: createPosition("p" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "SET_LIST_RESTART", value: 3 });
    expect(next).toBe(editor);
  });

  it("no-op when the override is already the requested value (same editor reference)", () => {
    let document = buildOrderedList();
    document = reduceEditor(
      makeEditor(document, {
        anchor: createPosition("i1" as BlockId, 0),
        focus: createPosition("i1" as BlockId, 0),
      }),
      { type: "SET_LIST_RESTART", value: 5 },
    ).document;

    const editor = makeEditor(document, {
      anchor: createPosition("i1" as BlockId, 0),
      focus: createPosition("i1" as BlockId, 0),
    });
    const next = reduceEditor(editor, { type: "SET_LIST_RESTART", value: 5 });
    expect(next).toBe(editor);
  });
});

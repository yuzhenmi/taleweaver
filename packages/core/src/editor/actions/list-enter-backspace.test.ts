/**
 * List Enter-exit + Backspace-outdent (#L16) — Google Docs list editing keys, in
 * the FLAT list model.
 *
 * Enter on an EMPTY list-item exits the list (nested → outdent, top-level →
 * paragraph) instead of creating another empty item; Enter on a NON-empty item
 * splits normally and the new item inherits the listId + level. Backspace at the
 * START of a list-item outdents (nested) or un-lists (top-level) rather than
 * merging into the previous block.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  reduceEditor,
  createPosition,
} from "./test-helpers";
import type { EditorState } from "../editor-state";
import { getBlock, createHistory, setListType } from "../../state";
import type { BlockId, State } from "../../state";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";

// Phase 0b: core's `EditorState` is geometry-free — these list-editing handlers
// read no layout, so build only the geometry-free fields.
function makeEditor(state: State, focusId: string, offset: number): EditorState {
  const caret = createPosition(focusId as BlockId, offset);
  return {
    state,
    selection: { anchor: caret, focus: caret },
    history: createHistory(state),
    lastDirtyIds: null,
    containerWidth: config.containerWidth,
    targetX: null,
  };
}

/** A single list-item `li` (listId L1) as the document's only block. */
function buildLoneItemDoc(content: string): State {
  const state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "li" }),
      buildBlock({
        id: "li",
        type: "list-item",
        parentId: "doc",
        attrs: { listId: "L1" },
        inlineContent: content === "" ? inlineContent([]) : inlineContent([text(content)]),
      }),
    ],
  });
  return setListType(state, "L1", "unordered").state;
}

/** One list-item `li` (listId L1, given level + content) preceded by a paragraph `p0`. */
function buildDoc(opts: { level?: number; content: string }): State {
  const attrs: Record<string, unknown> =
    opts.level !== undefined && opts.level > 0
      ? { listId: "L1", listLevel: opts.level }
      : { listId: "L1" };
  let state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "li" }),
      buildBlock({
        id: "p0",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "li",
        inlineContent: inlineContent([text("before")]),
      }),
      buildBlock({
        id: "li",
        type: "list-item",
        parentId: "doc",
        prevSiblingId: "p0",
        attrs,
        inlineContent: opts.content === "" ? inlineContent([]) : inlineContent([text(opts.content)]),
      }),
    ],
  });
  return setListType(state, "L1", "unordered").state;
}

describe("Enter-exit on an empty list-item (#L16)", () => {
  it("(a) Enter on an EMPTY level-0 list-item → becomes a paragraph (list attrs cleared)", () => {
    const state = buildDoc({ content: "" });
    const editor = makeEditor(state, "li", 0);

    const next = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    const block = getBlock(next.state, "li" as BlockId);
    expect(block?.type).toBe("paragraph");
    expect(block?.attrs.listId).toBeUndefined();
    expect(block?.attrs.listLevel).toBeUndefined();
    // No new block was created (still p0 + li).
    expect(getBlock(next.state, "li" as BlockId)?.nextSiblingId).toBeNull();
  });

  it("(b) Enter on an EMPTY level>0 list-item → outdents one level, stays a list-item", () => {
    const state = buildDoc({ level: 2, content: "" });
    const editor = makeEditor(state, "li", 0);

    const next = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    const block = getBlock(next.state, "li" as BlockId);
    expect(block?.type).toBe("list-item");
    expect(block?.attrs.listLevel).toBe(1);
    expect(block?.attrs.listId).toBe("L1");
  });

  it("(a') Enter on an empty level-0 list-item that is the doc's ONLY block → paragraph", () => {
    const state = buildLoneItemDoc("");
    const editor = makeEditor(state, "li", 0);

    const next = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    const block = getBlock(next.state, "li" as BlockId);
    expect(block?.type).toBe("paragraph");
    expect(block?.attrs.listId).toBeUndefined();
    // No sibling created — still the only block.
    expect(block?.nextSiblingId).toBeNull();
    expect(block?.prevSiblingId).toBeNull();
  });

  it("(c) Enter on a NON-empty list-item → splits; new item inherits listId + level", () => {
    const state = buildDoc({ level: 1, content: "hello" });
    // Caret in the middle ("hel|lo").
    const editor = makeEditor(state, "li", 3);

    const next = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    const original = getBlock(next.state, "li" as BlockId);
    expect(original?.type).toBe("list-item");
    const newId = original?.nextSiblingId;
    expect(newId).not.toBeNull();
    const newBlock = newId !== null && newId !== undefined ? getBlock(next.state, newId) : null;
    expect(newBlock?.type).toBe("list-item");
    expect(newBlock?.attrs.listId).toBe("L1");
    expect(newBlock?.attrs.listLevel).toBe(1);
  });
});

describe("Backspace-outdent at the start of a list-item (#L16)", () => {
  it("(d) Backspace at offset 0 of a level>0 list-item → outdents (no merge)", () => {
    const state = buildDoc({ level: 2, content: "item" });
    const editor = makeEditor(state, "li", 0);

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    const block = getBlock(next.state, "li" as BlockId);
    expect(block?.type).toBe("list-item");
    expect(block?.attrs.listLevel).toBe(1);
    // Not merged into p0 — both blocks still present.
    expect(getBlock(next.state, "p0" as BlockId)?.type).toBe("paragraph");
  });

  it("(e) Backspace at offset 0 of a level-0 list-item → un-lists to a paragraph (no merge)", () => {
    const state = buildDoc({ content: "item" });
    const editor = makeEditor(state, "li", 0);

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    const block = getBlock(next.state, "li" as BlockId);
    expect(block?.type).toBe("paragraph");
    expect(block?.attrs.listId).toBeUndefined();
    expect(block?.attrs.listLevel).toBeUndefined();
    // Content preserved; not merged into p0.
    expect(block?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "item" });
    expect(getBlock(next.state, "p0" as BlockId)?.type).toBe("paragraph");
  });

  it("(e') Backspace at start of a level-0 list-item that is the doc's ONLY block → paragraph", () => {
    const state = buildLoneItemDoc("item");
    const editor = makeEditor(state, "li", 0);

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    // Un-lists rather than no-op'ing at doc start (the list-item branch fires
    // before the doc-start cross-block guard).
    const block = getBlock(next.state, "li" as BlockId);
    expect(block?.type).toBe("paragraph");
    expect(block?.attrs.listId).toBeUndefined();
    expect(block?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "item" });
  });

  it("Backspace mid-item (offset>0) is a normal grapheme delete, not an outdent", () => {
    const state = buildDoc({ level: 2, content: "ab" });
    const editor = makeEditor(state, "li", 2);

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    const block = getBlock(next.state, "li" as BlockId);
    // Level unchanged; one char removed.
    expect(block?.attrs.listLevel).toBe(2);
    expect(block?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "a" });
  });
});

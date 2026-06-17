/**
 * `LIST_INDENT` / `LIST_OUTDENT` actions + `handleListIndent` (the Google Docs
 * list increase/decrease-nesting control — Tab / Shift+Tab inside a list).
 *
 * In the FLAT list model (D4) nesting is the per-item `listLevel` attr (0–8), NOT
 * tree surgery: indent steps `listLevel` by +1, outdent by −1, clamped to
 * [0, MAX_LIST_LEVEL]. Level 0 CLEARS the attr (a top-level item carries no
 * redundant `listLevel: 0`). Only `list-item` leaves are targets — a non-list-item
 * in the selection (or a collapsed caret in a plain paragraph) is a no-op. This
 * mirrors `indent.test.ts` but on `listLevel` rather than `marginInlineStart`.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  reduceEditor,
  createPosition,
  createSpan,
} from "./test-helpers";
import { MAX_LIST_LEVEL } from "./list-indent";
import type { EditorState } from "../editor-state";
import { getBlock, createHistory } from "../../state";
import type { BlockId } from "../../state";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";
import type { State } from "../../state";

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

/** A doc with two list-item leaves (l0, l1) sharing listId "L1" + a trailing plain paragraph. */
function buildListDoc(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "l0", lastChildId: "p" }),
      buildBlock({
        id: "l0",
        type: "list-item",
        parentId: "doc",
        nextSiblingId: "l1",
        attrs: { listId: "L1" },
        inlineContent: inlineContent([text("one")]),
      }),
      buildBlock({
        id: "l1",
        type: "list-item",
        parentId: "doc",
        prevSiblingId: "l0",
        nextSiblingId: "p",
        attrs: { listId: "L1" },
        inlineContent: inlineContent([text("two")]),
      }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "l1",
        inlineContent: inlineContent([text("para")]),
      }),
    ],
  });
}

describe("handleListIndent — LIST_INDENT / LIST_OUTDENT actions", () => {
  it("LIST_INDENT on a level-0 list-item: sets listLevel to 1", () => {
    const state = buildListDoc();
    const editor = makeEditor(state, {
      anchor: createPosition("l0" as BlockId, 0),
      focus: createPosition("l0" as BlockId, 0),
    });

    expect(getBlock(editor.state, "l0" as BlockId)?.attrs.listLevel).toBeUndefined();

    const next = reduceEditor(editor, { type: "LIST_INDENT" }, config);

    expect(getBlock(next.state, "l0" as BlockId)?.attrs.listLevel).toBe(1);
    expect(next.state).not.toBe(editor.state);
  });

  it("LIST_INDENT caps at MAX_LIST_LEVEL (8)", () => {
    const state = buildListDoc();
    let editor = makeEditor(state, {
      anchor: createPosition("l0" as BlockId, 0),
      focus: createPosition("l0" as BlockId, 0),
    });

    // Indent well past the cap.
    for (let i = 0; i < 12; i++) {
      editor = reduceEditor(editor, { type: "LIST_INDENT" }, config);
    }
    expect(getBlock(editor.state, "l0" as BlockId)?.attrs.listLevel).toBe(MAX_LIST_LEVEL);
    expect(MAX_LIST_LEVEL).toBe(8);
  });

  it("LIST_OUTDENT from level 1: clears the attr (back to undefined)", () => {
    const state = buildListDoc();
    let editor = makeEditor(state, {
      anchor: createPosition("l0" as BlockId, 0),
      focus: createPosition("l0" as BlockId, 0),
    });

    editor = reduceEditor(editor, { type: "LIST_INDENT" }, config);
    expect(getBlock(editor.state, "l0" as BlockId)?.attrs.listLevel).toBe(1);

    editor = reduceEditor(editor, { type: "LIST_OUTDENT" }, config);
    // Level 0 clears the attr (renders like a never-nested top-level item).
    expect(getBlock(editor.state, "l0" as BlockId)?.attrs.listLevel).toBeUndefined();
  });

  it("LIST_OUTDENT from level 0: no-op (clamped — same editor reference)", () => {
    const state = buildListDoc();
    const editor = makeEditor(state, {
      anchor: createPosition("l0" as BlockId, 0),
      focus: createPosition("l0" as BlockId, 0),
    });

    const next = reduceEditor(editor, { type: "LIST_OUTDENT" }, config);

    expect(next).toBe(editor);
  });

  it("collapsed caret in a non-list-item paragraph: no-op", () => {
    const state = buildListDoc();
    const editor = makeEditor(state, {
      anchor: createPosition("p" as BlockId, 0),
      focus: createPosition("p" as BlockId, 0),
    });

    const next = reduceEditor(editor, { type: "LIST_INDENT" }, config);

    expect(next).toBe(editor);
    expect(getBlock(next.state, "p" as BlockId)?.attrs.listLevel).toBeUndefined();
  });

  it("range selection over only non-list-items: no-op (same editor reference)", () => {
    const state = buildListDoc();
    // Span covers only the plain paragraph "p" — no list-items in range.
    const editor = makeEditor(
      state,
      createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 4)),
    );

    const next = reduceEditor(editor, { type: "LIST_INDENT" }, config);

    expect(next).toBe(editor);
  });

  it("range selection over both list-items: each list-item indents (paragraph untouched)", () => {
    const state = buildListDoc();
    const editor = makeEditor(
      state,
      createSpan(createPosition("l0" as BlockId, 0), createPosition("p" as BlockId, 4)),
    );

    const next = reduceEditor(editor, { type: "LIST_INDENT" }, config);

    expect(getBlock(next.state, "l0" as BlockId)?.attrs.listLevel).toBe(1);
    expect(getBlock(next.state, "l1" as BlockId)?.attrs.listLevel).toBe(1);
    // The plain paragraph in the span is NOT a list-item → untouched.
    expect(getBlock(next.state, "p" as BlockId)?.attrs.listLevel).toBeUndefined();
  });

  it("preserves the selection (level change does not move the caret)", () => {
    const state = buildListDoc();
    const selection = createSpan(
      createPosition("l0" as BlockId, 0),
      createPosition("l0" as BlockId, 3),
    );
    const editor = makeEditor(state, selection);

    const next = reduceEditor(editor, { type: "LIST_INDENT" }, config);

    expect(next.selection).toEqual(selection);
  });

  it("undo restores the prior level", () => {
    const state = buildListDoc();
    let editor = makeEditor(state, {
      anchor: createPosition("l0" as BlockId, 0),
      focus: createPosition("l0" as BlockId, 0),
    });

    editor = reduceEditor(editor, { type: "LIST_INDENT" }, config);
    const indented = reduceEditor(editor, { type: "LIST_INDENT" }, config);
    expect(getBlock(indented.state, "l0" as BlockId)?.attrs.listLevel).toBe(2);

    const undone = reduceEditor(indented, { type: "UNDO" }, config);
    expect(getBlock(undone.state, "l0" as BlockId)?.attrs.listLevel).toBe(1);
  });
});

/**
 * T2: `INSERT_TABLE` editor action + handler — the keystone create-entry-point
 * for the tables subsystem. Dispatching INSERT_TABLE creates a fresh rows×cols
 * table at the caret's block boundary and lands the caret in cell (0,0).
 *
 * Behavior-level tests through `reduceEditor`: insertion semantics (empty doc /
 * mid-paragraph split), one-undo-step, body-context refusal, and range-replace.
 */
import { finalSectionOf } from "../../test-utils/state-builders";
import { describe, it, expect } from "vitest";
import {
  config,
  reduceEditor,
  createInitialEditorState,
  getTextOf,
  type EditorState,
} from "./test-helpers";
import { getBlock, resolveBlock, createPosition, createSpan } from "../../state";
import type { BlockId } from "../../state";

/** The id of the first body paragraph under the document root. */
function bodyParaId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, finalSectionOf(editor.state)); // the root holds sections
  const id = root?.firstChildId;
  if (id === undefined || id === null) throw new Error("document root has no first child");
  return id;
}

/** The ordered block types of the document root's direct children. */
function topLevelTypes(editor: EditorState): string[] {
  const out: string[] = [];
  const root = getBlock(editor.state, finalSectionOf(editor.state)); // the root holds sections
  for (let id = root?.firstChildId ?? null; id !== null; id = getBlock(editor.state, id)?.nextSiblingId ?? null) {
    out.push(getBlock(editor.state, id)?.type ?? "?");
  }
  return out;
}

/** Walk parentId from `blockId` up to the root, collecting block types. */
function ancestorTypes(editor: EditorState, blockId: BlockId): string[] {
  const out: string[] = [];
  let id: BlockId | null = blockId;
  while (id !== null) {
    const b = getBlock(editor.state, id);
    if (b === null) break;
    out.push(b.type);
    id = b.parentId;
  }
  return out;
}

/** The single table block among the root's children (throws if not exactly one). */
function theTableId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, finalSectionOf(editor.state)); // the root holds sections
  let found: BlockId | null = null;
  for (let id = root?.firstChildId ?? null; id !== null; id = getBlock(editor.state, id)?.nextSiblingId ?? null) {
    if (getBlock(editor.state, id)?.type === "table") {
      if (found !== null) throw new Error("more than one table");
      found = id;
    }
  }
  if (found === null) throw new Error("no table found");
  return found;
}

describe("handleInsertTable — INSERT_TABLE", () => {
  it("inserts a table in an empty doc and lands the caret in cell (0,0)", () => {
    const initial = createInitialEditorState(config);
    const paraId = bodyParaId(initial);
    // Caret at offset 0 of the (empty) body paragraph → table inserted BEFORE it.
    const placed = reduceEditor(
      initial,
      { type: "SET_SELECTION", selection: createSpan(createPosition(paraId, 0), createPosition(paraId, 0)) },
    );

    const next = reduceEditor(placed, { type: "INSERT_TABLE", rows: 2, cols: 3 });
    expect(next.state).not.toBe(placed.state);

    // table now precedes the original paragraph.
    expect(topLevelTypes(next)).toEqual(["table", "paragraph"]);
    const tableId = theTableId(next);
    expect(getBlock(next.state, tableId)?.attrs.columnWidths).toEqual([1 / 3, 1 / 3, 1 / 3]);

    // caret sits in a paragraph whose ancestry is cell → row → table.
    const caretBlock = next.selection.focus.blockId;
    expect(next.selection.focus.offset).toBe(0);
    expect(ancestorTypes(next, caretBlock).slice(0, 4)).toEqual([
      "paragraph",
      "table-cell",
      "table-row",
      "table",
    ]);
    // it is the FIRST cell of the FIRST row.
    const cell = getBlock(next.state, getBlock(next.state, caretBlock)?.parentId as BlockId);
    const row = getBlock(next.state, cell?.parentId as BlockId);
    expect(row?.firstChildId).toBe(cell?.id);
    expect(getBlock(next.state, tableId)?.firstChildId).toBe(row?.id);
  });

  it("splits a mid-paragraph caret and threads the table between the halves", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abcdef" });
    const paraId = bodyParaId(typed);
    const placed = reduceEditor(
      typed,
      { type: "SET_SELECTION", selection: createSpan(createPosition(paraId, 3), createPosition(paraId, 3)) },
    );

    const next = reduceEditor(placed, { type: "INSERT_TABLE", rows: 2, cols: 2 });
    // "abc" | table | "def". The head "abc" is the new block; the
    // caret's paragraph keeps the tail "def" (and its ¶) after the table.
    expect(topLevelTypes(next)).toEqual(["paragraph", "table", "paragraph"]);
    expect(getTextOf(next.state, paraId)).toBe("def");
    expect(getTextOf(next.state, bodyParaId(next))).toBe("abc");
    // caret in cell (0,0).
    expect(ancestorTypes(next, next.selection.focus.blockId).slice(0, 2)).toEqual([
      "paragraph",
      "table-cell",
    ]);
  });

  it("inserts the whole table as ONE undo step (undo removes it and heals the split)", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abcdef" });
    const paraId = bodyParaId(typed);
    const placed = reduceEditor(
      typed,
      { type: "SET_SELECTION", selection: createSpan(createPosition(paraId, 3), createPosition(paraId, 3)) },
    );
    const next = reduceEditor(placed, { type: "INSERT_TABLE", rows: 2, cols: 2 });
    expect(topLevelTypes(next)).toEqual(["paragraph", "table", "paragraph"]);

    const undone = reduceEditor(next, { type: "UNDO" });
    expect(topLevelTypes(undone)).toEqual(["paragraph"]);
    expect(getTextOf(undone.state, paraId)).toBe("abcdef");
  });

  it("replaces a non-collapsed selection (deletes it) before inserting, as one undo step", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abcdef" });
    const paraId = bodyParaId(typed);
    // Select "cd" (offset 2..4).
    const placed = reduceEditor(
      typed,
      { type: "SET_SELECTION", selection: createSpan(createPosition(paraId, 2), createPosition(paraId, 4)) },
    );

    const next = reduceEditor(placed, { type: "INSERT_TABLE", rows: 1, cols: 1 });
    // "cd" deleted → "ab" | table | "ef" (the head "ab" is the new block).
    expect(getTextOf(next.state, paraId)).toBe("ef");
    expect(getTextOf(next.state, bodyParaId(next))).toBe("ab");
    expect(topLevelTypes(next)).toEqual(["paragraph", "table", "paragraph"]);

    // ONE undo restores "abcdef" AND removes the table.
    const undone = reduceEditor(next, { type: "UNDO" });
    expect(getTextOf(undone.state, paraId)).toBe("abcdef");
    expect(topLevelTypes(undone)).toEqual(["paragraph"]);
  });

  it("refuses (no-op) when the caret is inside a footnote body", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" });
    // INSERT_FOOTNOTE lands the caret inside the footnote body paragraph.
    const inFootnote = reduceEditor(typed, { type: "INSERT_FOOTNOTE" });
    expect(resolveBlock(inFootnote.state, inFootnote.selection.focus.blockId)?.kind).toBe("embedContent");

    const refused = reduceEditor(inFootnote, { type: "INSERT_TABLE", rows: 2, cols: 2 });
    expect(refused.state).toBe(inFootnote.state); // identity: nothing changed
  });

  it("is a no-op for rows < 1 or cols < 1", () => {
    const initial = createInitialEditorState(config);
    const a = reduceEditor(initial, { type: "INSERT_TABLE", rows: 0, cols: 3 });
    expect(a.state).toBe(initial.state);
    const b = reduceEditor(initial, { type: "INSERT_TABLE", rows: 2, cols: 0 });
    expect(b.state).toBe(initial.state);
  });
});

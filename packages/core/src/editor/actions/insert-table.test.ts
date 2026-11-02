/**
 * T2: `INSERT_TABLE` editor action + handler — the keystone create-entry-point
 * for the tables subsystem. Dispatching INSERT_TABLE creates a fresh rows×cols
 * table at the caret's block boundary and lands the caret in cell (0,0).
 *
 * Behavior-level tests through `reduceEditor`: insertion semantics (empty doc /
 * mid-paragraph split), one-undo-step, body-context refusal, and range-replace.
 */
import { finalSectionOf } from "../../test-utils/document-builders";
import { describe, it, expect } from "vitest";
import {
  config,
  getTextOf,
  createEditor,
  type Editor,
} from "./test-helpers";
import { getBlock, resolveBlock, createPosition, createSpan } from "../../state";
import type { BlockId } from "../../state";

/** The id of the first body paragraph under the document root. */
function bodyParaId(editor: Editor): BlockId {
  const root = getBlock(editor.document, finalSectionOf(editor.document)); // the root holds sections
  const id = root?.firstChildId;
  if (id === undefined || id === null) throw new Error("document root has no first child");
  return id;
}

/** The ordered block types of the document root's direct children. */
function topLevelTypes(editor: Editor): string[] {
  const out: string[] = [];
  const root = getBlock(editor.document, finalSectionOf(editor.document)); // the root holds sections
  for (let id = root?.firstChildId ?? null; id !== null; id = getBlock(editor.document, id)?.nextSiblingId ?? null) {
    out.push(getBlock(editor.document, id)?.type ?? "?");
  }
  return out;
}

/** Walk parentId from `blockId` up to the root, collecting block types. */
function ancestorTypes(editor: Editor, blockId: BlockId): string[] {
  const out: string[] = [];
  let id: BlockId | null = blockId;
  while (id !== null) {
    const b = getBlock(editor.document, id);
    if (b === null) break;
    out.push(b.type);
    id = b.parentId;
  }
  return out;
}

/** The single table block among the root's children (throws if not exactly one). */
function theTableId(editor: Editor): BlockId {
  const root = getBlock(editor.document, finalSectionOf(editor.document)); // the root holds sections
  let found: BlockId | null = null;
  for (let id = root?.firstChildId ?? null; id !== null; id = getBlock(editor.document, id)?.nextSiblingId ?? null) {
    if (getBlock(editor.document, id)?.type === "table") {
      if (found !== null) throw new Error("more than one table");
      found = id;
    }
  }
  if (found === null) throw new Error("no table found");
  return found;
}

describe("handleInsertTable — INSERT_TABLE", () => {
  it("inserts a table in an empty doc and lands the caret in cell (0,0)", () => {
    const initial = createEditor(config);
    const paraId = bodyParaId(initial);
    // Caret at offset 0 of the (empty) body paragraph → table inserted BEFORE it.
    initial.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(paraId, 0), createPosition(paraId, 0)) });

    const before = initial.snapshot();
    initial.dispatch({ type: "INSERT_TABLE", rows: 2, cols: 3 });
    expect(initial.document).not.toBe(before.document);

    // table now precedes the original paragraph.
    expect(topLevelTypes(initial)).toEqual(["table", "paragraph"]);
    const tableId = theTableId(initial);
    expect(getBlock(initial.document, tableId)?.attrs.columnWidths).toEqual([1 / 3, 1 / 3, 1 / 3]);

    // caret sits in a paragraph whose ancestry is cell → row → table.
    const caretBlock = initial.selection.focus.blockId;
    expect(initial.selection.focus.offset).toBe(0);
    expect(ancestorTypes(initial, caretBlock).slice(0, 4)).toEqual([
      "paragraph",
      "table-cell",
      "table-row",
      "table",
    ]);
    // it is the FIRST cell of the FIRST row.
    const cell = getBlock(initial.document, getBlock(initial.document, caretBlock)?.parentId as BlockId);
    const row = getBlock(initial.document, cell?.parentId as BlockId);
    expect(row?.firstChildId).toBe(cell?.id);
    expect(getBlock(initial.document, tableId)?.firstChildId).toBe(row?.id);
  });

  it("splits a mid-paragraph caret and threads the table between the halves", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "abcdef" });
    const paraId = bodyParaId(initial);
    initial.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(paraId, 3), createPosition(paraId, 3)) });

    initial.dispatch({ type: "INSERT_TABLE", rows: 2, cols: 2 });
    // "abc" | table | "def". The head "abc" is the new block; the
    // caret's paragraph keeps the tail "def" (and its ¶) after the table.
    expect(topLevelTypes(initial)).toEqual(["paragraph", "table", "paragraph"]);
    expect(getTextOf(initial.document, paraId)).toBe("def");
    expect(getTextOf(initial.document, bodyParaId(initial))).toBe("abc");
    // caret in cell (0,0).
    expect(ancestorTypes(initial, initial.selection.focus.blockId).slice(0, 2)).toEqual([
      "paragraph",
      "table-cell",
    ]);
  });

  it("inserts the whole table as ONE undo step (undo removes it and heals the split)", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "abcdef" });
    const paraId = bodyParaId(initial);
    initial.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(paraId, 3), createPosition(paraId, 3)) });
    initial.dispatch({ type: "INSERT_TABLE", rows: 2, cols: 2 });
    expect(topLevelTypes(initial)).toEqual(["paragraph", "table", "paragraph"]);

    initial.dispatch({ type: "UNDO" });
    expect(topLevelTypes(initial)).toEqual(["paragraph"]);
    expect(getTextOf(initial.document, paraId)).toBe("abcdef");
  });

  it("replaces a non-collapsed selection (deletes it) before inserting, as one undo step", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "abcdef" });
    const paraId = bodyParaId(initial);
    // Select "cd" (offset 2..4).
    initial.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(paraId, 2), createPosition(paraId, 4)) });

    initial.dispatch({ type: "INSERT_TABLE", rows: 1, cols: 1 });
    // "cd" deleted → "ab" | table | "ef" (the head "ab" is the new block).
    expect(getTextOf(initial.document, paraId)).toBe("ef");
    expect(getTextOf(initial.document, bodyParaId(initial))).toBe("ab");
    expect(topLevelTypes(initial)).toEqual(["paragraph", "table", "paragraph"]);

    // ONE undo restores "abcdef" AND removes the table.
    initial.dispatch({ type: "UNDO" });
    expect(getTextOf(initial.document, paraId)).toBe("abcdef");
    expect(topLevelTypes(initial)).toEqual(["paragraph"]);
  });

  it("refuses (no-op) when the caret is inside a footnote body", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "abc" });
    // INSERT_FOOTNOTE lands the caret inside the footnote body paragraph.
    initial.dispatch({ type: "INSERT_FOOTNOTE" });
    expect(resolveBlock(initial.document, initial.selection.focus.blockId)?.kind).toBe("embedContent");

    const before = initial.snapshot();
    initial.dispatch({ type: "INSERT_TABLE", rows: 2, cols: 2 });
    expect(initial.document).toBe(before.document); // identity: nothing changed
  });

  it("is a no-op for rows < 1 or cols < 1", () => {
    const initial = createEditor(config);
    const before = initial.snapshot();
    initial.dispatch({ type: "INSERT_TABLE", rows: 0, cols: 3 });
    expect(initial.document).toBe(before.document);
    const before2 = initial.snapshot();
    initial.dispatch({ type: "INSERT_TABLE", rows: 2, cols: 0 });
    expect(initial.document).toBe(before2.document);
  });
});

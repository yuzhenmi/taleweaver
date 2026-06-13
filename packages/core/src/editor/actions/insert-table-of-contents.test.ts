/**
 * `INSERT_TABLE_OF_CONTENTS` / `handleInsertTableOfContents` — Google Docs Insert ▸
 * Table of contents. Inserts a `table-of-contents` atomic-leaf block immediately
 * after the caret's block, carrying `DEFAULT_TOC_ATTRS`, followed by a fresh empty
 * paragraph; the caret lands at the start of that paragraph (so the doc stays
 * editable below the TOC). One undo entry. Backspace at the start of the trailing
 * paragraph deletes the TOC as a unit (inherited atomic-leaf delete path).
 */
import { describe, it, expect } from "vitest";
import {
  config,
  createInitialEditorState,
  reduceEditor,
  firstChildId,
} from "./test-helpers";
import { getBlock } from "../../state";
import type { BlockId } from "../../state";
import { DEFAULT_TOC_ATTRS } from "../../components/table-of-contents-attrs";

describe("handleInsertTableOfContents — INSERT_TABLE_OF_CONTENTS (TOC 1.3)", () => {
  it("inserts a table-of-contents + trailing paragraph after the caret block, caret collapsed in the paragraph", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "above" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    const next = reduceEditor(editor, { type: "INSERT_TABLE_OF_CONTENTS" }, config);

    // Document order: para → toc → new paragraph.
    const tocId = getBlock(next.state, paraId)?.nextSiblingId ?? null;
    expect(tocId).not.toBeNull();
    const toc = tocId !== null ? getBlock(next.state, tocId) : null;
    expect(toc?.type).toBe("table-of-contents");

    const trailingId = toc?.nextSiblingId ?? null;
    expect(trailingId).not.toBeNull();
    const trailing = trailingId !== null ? getBlock(next.state, trailingId) : null;
    expect(trailing?.type).toBe("paragraph");

    // Caret lands collapsed at the start of the new trailing paragraph.
    expect(next.selection.focus.blockId).toBe(trailingId);
    expect(next.selection.focus.offset).toBe(0);
    expect(next.selection.anchor).toEqual(next.selection.focus);

    // The original paragraph keeps its content.
    expect(getBlock(next.state, paraId)?.inlineContent?.items[0]).toMatchObject({
      kind: "text",
      text: "above",
    });
  });

  it("propagates DEFAULT_TOC_ATTRS onto the inserted TOC block", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    const next = reduceEditor(editor, { type: "INSERT_TABLE_OF_CONTENTS" }, config);

    const tocId = getBlock(next.state, paraId)?.nextSiblingId as BlockId;
    expect(getBlock(next.state, tocId)?.attrs).toEqual(DEFAULT_TOC_ATTRS);
  });

  it("undo removes BOTH the TOC and the trailing paragraph in one step", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "y" }, config);
    const paraId = firstChildId(editor.state) as BlockId;
    // Baseline: the paragraph is the doc's only/last child.
    expect(getBlock(editor.state, paraId)?.nextSiblingId).toBeNull();

    const inserted = reduceEditor(editor, { type: "INSERT_TABLE_OF_CONTENTS" }, config);
    expect(getBlock(inserted.state, paraId)?.nextSiblingId).not.toBeNull();

    const undone = reduceEditor(inserted, { type: "UNDO" }, config);
    // Back to the paragraph being the last child — both inserted blocks gone in one undo.
    expect(getBlock(undone.state, paraId)?.nextSiblingId).toBeNull();
  });

  it("Backspace at the start of the trailing paragraph deletes the TOC as a unit", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "above" }, config);
    const paraId = firstChildId(editor.state) as BlockId;
    editor = reduceEditor(editor, { type: "INSERT_TABLE_OF_CONTENTS" }, config);
    const tocId = getBlock(editor.state, paraId)?.nextSiblingId as BlockId;
    const trailingId = getBlock(editor.state, tocId)?.nextSiblingId as BlockId;
    expect(getBlock(editor.state, tocId)?.type).toBe("table-of-contents");
    // INSERT_TABLE_OF_CONTENTS leaves the caret at the start of the trailing paragraph.
    expect(editor.selection.focus.blockId).toBe(trailingId);
    expect(editor.selection.focus.offset).toBe(0);

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    // TOC removed as a unit; the paragraph chain closes up around it.
    expect(getBlock(next.state, tocId)).toBeNull();
    expect(getBlock(next.state, paraId)?.nextSiblingId).toBe(trailingId);
    expect(getBlock(next.state, trailingId)?.prevSiblingId).toBe(paraId);
    // Caret stays at the start of the trailing paragraph.
    expect(next.selection.focus.blockId).toBe(trailingId);
    expect(next.selection.focus.offset).toBe(0);
  });
});

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
  createEditor, firstChildId } from "./test-helpers";
import { getBlock } from "../../state";
import type { BlockId } from "../../state";
import { DEFAULT_TOC_ATTRS } from "../../components/table-of-contents-attrs";

describe("handleInsertTableOfContents — INSERT_TABLE_OF_CONTENTS (TOC 1.3)", () => {
  it("inserts a table-of-contents + trailing paragraph after the caret block, caret collapsed in the paragraph", () => {
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "above" });
    const paraId = firstChildId(editor.document) as BlockId;

    editor.dispatch({ type: "INSERT_TABLE_OF_CONTENTS" });

    // Document order: para → toc → new paragraph.
    const tocId = getBlock(editor.document, paraId)?.nextSiblingId ?? null;
    expect(tocId).not.toBeNull();
    const toc = tocId !== null ? getBlock(editor.document, tocId) : null;
    expect(toc?.type).toBe("table-of-contents");

    const trailingId = toc?.nextSiblingId ?? null;
    expect(trailingId).not.toBeNull();
    const trailing = trailingId !== null ? getBlock(editor.document, trailingId) : null;
    expect(trailing?.type).toBe("paragraph");

    // Caret lands collapsed at the start of the new trailing paragraph.
    expect(editor.selection.focus.blockId).toBe(trailingId);
    expect(editor.selection.focus.offset).toBe(0);
    expect(editor.selection.anchor).toEqual(editor.selection.focus);

    // The original paragraph keeps its content.
    expect(getBlock(editor.document, paraId)?.inlineContent?.items[0]).toMatchObject({
      kind: "text",
      text: "above",
    });
  });

  it("propagates DEFAULT_TOC_ATTRS onto the inserted TOC block", () => {
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "x" });
    const paraId = firstChildId(editor.document) as BlockId;

    editor.dispatch({ type: "INSERT_TABLE_OF_CONTENTS" });

    const tocId = getBlock(editor.document, paraId)?.nextSiblingId as BlockId;
    expect(getBlock(editor.document, tocId)?.attrs).toEqual(DEFAULT_TOC_ATTRS);
  });

  it("undo removes BOTH the TOC and the trailing paragraph in one step", () => {
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "y" });
    const paraId = firstChildId(editor.document) as BlockId;
    // Baseline: the paragraph is the doc's only/last child.
    expect(getBlock(editor.document, paraId)?.nextSiblingId).toBeNull();

    editor.dispatch({ type: "INSERT_TABLE_OF_CONTENTS" });
    expect(getBlock(editor.document, paraId)?.nextSiblingId).not.toBeNull();

    editor.dispatch({ type: "UNDO" });
    // Back to the paragraph being the last child — both inserted blocks gone in one undo.
    expect(getBlock(editor.document, paraId)?.nextSiblingId).toBeNull();
  });

  it("Backspace at the start of the trailing paragraph deletes the TOC as a unit", () => {
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "above" });
    const paraId = firstChildId(editor.document) as BlockId;
    editor.dispatch({ type: "INSERT_TABLE_OF_CONTENTS" });
    const tocId = getBlock(editor.document, paraId)?.nextSiblingId as BlockId;
    const trailingId = getBlock(editor.document, tocId)?.nextSiblingId as BlockId;
    expect(getBlock(editor.document, tocId)?.type).toBe("table-of-contents");
    // INSERT_TABLE_OF_CONTENTS leaves the caret at the start of the trailing paragraph.
    expect(editor.selection.focus.blockId).toBe(trailingId);
    expect(editor.selection.focus.offset).toBe(0);

    editor.dispatch({ type: "DELETE_BACKWARD" });

    // TOC removed as a unit; the paragraph chain closes up around it.
    expect(getBlock(editor.document, tocId)).toBeNull();
    expect(getBlock(editor.document, paraId)?.nextSiblingId).toBe(trailingId);
    expect(getBlock(editor.document, trailingId)?.prevSiblingId).toBe(paraId);
    // Caret stays at the start of the trailing paragraph.
    expect(editor.selection.focus.blockId).toBe(trailingId);
    expect(editor.selection.focus.offset).toBe(0);
  });
});

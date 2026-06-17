/**
 * `INSERT_HORIZONTAL_LINE` / `handleInsertHorizontalLine` — Google Docs Insert ▸
 * Horizontal line. Inserts a `horizontal-line` atomic-leaf block immediately
 * after the caret's block, followed by a fresh empty paragraph; the caret lands
 * at the start of that paragraph (so the doc stays editable below the rule).
 * One undo entry.
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
import { getBlock } from "../../state";
import type { BlockId } from "../../state";

describe("handleInsertHorizontalLine — INSERT_HORIZONTAL_LINE (#L11.1)", () => {
  it("inserts a horizontal-line + trailing paragraph after the caret block", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "above" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    const next = reduceEditor(editor, { type: "INSERT_HORIZONTAL_LINE" }, config);

    // Document order: para → hr → new paragraph.
    const hrId = getBlock(next.state, paraId)?.nextSiblingId ?? null;
    expect(hrId).not.toBeNull();
    const hr = hrId !== null ? getBlock(next.state, hrId) : null;
    expect(hr?.type).toBe("horizontal-line");

    const trailingId = hr?.nextSiblingId ?? null;
    expect(trailingId).not.toBeNull();
    const trailing = trailingId !== null ? getBlock(next.state, trailingId) : null;
    expect(trailing?.type).toBe("paragraph");

    // The original paragraph keeps its content.
    expect(getBlock(next.state, paraId)?.inlineContent?.items[0]).toMatchObject({
      kind: "text",
      text: "above",
    });
  });

  it("places the caret at the start of the new trailing paragraph", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    const next = reduceEditor(editor, { type: "INSERT_HORIZONTAL_LINE" }, config);

    const hrId = getBlock(next.state, paraId)?.nextSiblingId ?? null;
    const trailingId = hrId !== null ? getBlock(next.state, hrId)?.nextSiblingId ?? null : null;
    expect(next.selection.focus.blockId).toBe(trailingId);
    expect(next.selection.focus.offset).toBe(0);
    // Collapsed caret.
    expect(next.selection.anchor).toEqual(next.selection.focus);
  });

  it("splices the rule + paragraph BETWEEN the focus block and its existing next sibling", () => {
    // Build two paragraphs: "a" then an empty one (Enter at end of "a").
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" }, config);
    const para1 = firstChildId(editor.state) as BlockId;
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    const para2 = getBlock(editor.state, para1)?.nextSiblingId ?? null;
    expect(para2).not.toBeNull();

    // Put the caret back in para1, then insert the rule.
    const caretInPara1 = createPosition(para1, 1);
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(caretInPara1, caretInPara1) },
      config,
    );
    const next = reduceEditor(editor, { type: "INSERT_HORIZONTAL_LINE" }, config);

    // Order: para1 → hr → trailingPara → para2 (the run is spliced between).
    const hrId = getBlock(next.state, para1)?.nextSiblingId ?? null;
    expect(getBlock(next.state, hrId as BlockId)?.type).toBe("horizontal-line");
    const trailingId = getBlock(next.state, hrId as BlockId)?.nextSiblingId ?? null;
    expect(getBlock(next.state, trailingId as BlockId)?.type).toBe("paragraph");
    expect(getBlock(next.state, trailingId as BlockId)?.nextSiblingId).toBe(para2);
    // Caret lands in the NEW trailing paragraph, not the pre-existing para2.
    expect(next.selection.focus.blockId).toBe(trailingId);
  });

  it("is a no-op when the caret is in a header body (not the main tree)", () => {
    let editor = createInitialEditorState(config);
    // INSERT_HEADER moves the caret into the header body (a templateContents
    // tree, not the main blocks tree). getBlock (main-tree-only) returns null
    // there, so INSERT_HORIZONTAL_LINE must no-op rather than throw (D3).
    editor = reduceEditor(editor, { type: "INSERT_HEADER" }, config);
    const inHeaderBody = getBlock(editor.state, editor.selection.focus.blockId) === null;
    expect(inHeaderBody).toBe(true); // precondition: caret is outside the main tree

    const next = reduceEditor(editor, { type: "INSERT_HORIZONTAL_LINE" }, config);
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.state).toBe(editor.state);
  });

  it("undo removes the rule and the trailing paragraph", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "y" }, config);
    const paraId = firstChildId(editor.state) as BlockId;
    // Baseline: the paragraph is the doc's only/last child.
    expect(getBlock(editor.state, paraId)?.nextSiblingId).toBeNull();

    const inserted = reduceEditor(editor, { type: "INSERT_HORIZONTAL_LINE" }, config);
    expect(getBlock(inserted.state, paraId)?.nextSiblingId).not.toBeNull();

    const undone = reduceEditor(inserted, { type: "UNDO" }, config);
    // Back to the paragraph being the last child — both inserted blocks gone.
    expect(getBlock(undone.state, paraId)?.nextSiblingId).toBeNull();
  });
});

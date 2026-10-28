/**
 * Behavior tests for SPLIT_NODE's follow-on block type (Enter-at-end-of-heading
 * → paragraph). Dispatched through `reduceEditor` (the real editor pipeline) so
 * the test exercises the handler + state op end-to-end, not a unit in isolation.
 *
 * Google-Docs / Word "style for following paragraph": a heading is followed by
 * Normal. The follow-on applies ONLY to the new (empty) block created by Enter
 * at the END; a mid-text split keeps both halves as the heading.
 */
import { finalSectionOf } from "../../test-utils/state-builders";
import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  getBlock,
  createPosition,
  createSpan,
  type EditorConfig,
  type EditorState,
  type BlockId,
} from "../../index";

function makeConfig(): EditorConfig {
  return {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 800,
  };
}

function firstBlockId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, finalSectionOf(editor.state)); // the root holds sections
  if (root === null || root.firstChildId === null) {
    throw new Error("test setup: no first child");
  }
  return root.firstChildId;
}

function typeString(editor: EditorState, text: string, config: EditorConfig): EditorState {
  let cur = editor;
  for (const ch of text) {
    cur = reduceEditor(cur, { type: "INSERT_TEXT", text: ch }, config);
  }
  return cur;
}

describe("SPLIT_NODE — follow-on block type (Enter at end of heading)", () => {
  it("Enter at the END of a heading creates a paragraph; the heading keeps its type + level", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const headingId = firstBlockId(editor);

    editor = reduceEditor(
      editor,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );
    editor = typeString(editor, "Title", config);
    // Cursor is at the end (offset 5) after typing.
    expect(getBlock(editor.state, headingId)?.type).toBe("heading");

    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    // (Word) the split's HEAD [0, k) is the new block; the caret's
    // block keeps the tail + its ¶. So the heading text now lives in the new head
    // (type + level intact) and the original id is the new, empty Normal paragraph.
    const created = getBlock(editor.state, headingId);
    expect(created?.type).toBe("paragraph");
    expect(created?.attrs).toEqual({});
    const headId = created?.prevSiblingId ?? null;
    expect(headId).not.toBeNull();
    const head = getBlock(editor.state, headId as BlockId);
    expect(head?.type).toBe("heading");
    expect(head?.attrs).toEqual({ level: 1 });

    // Cursor lands at the start of the new paragraph.
    expect(editor.selection.focus).toEqual(createPosition(headingId, 0));
  });

  it("Enter in the MIDDLE of a heading keeps BOTH halves as heading", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const headingId = firstBlockId(editor);

    editor = reduceEditor(
      editor,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 2 } },
      config,
    );
    editor = typeString(editor, "Title", config);
    // Move the cursor into the middle (offset 2).
    editor = {
      ...editor,
      selection: createSpan(createPosition(headingId, 2), createPosition(headingId, 2)),
    };

    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    // Mid-split: the follow-on type does NOT apply — both halves stay heading
    // (the head [0, 2) is the new block).
    const tail = getBlock(editor.state, headingId);
    expect(tail?.type).toBe("heading");
    expect(tail?.attrs).toEqual({ level: 2 });
    const headId = tail?.prevSiblingId ?? null;
    expect(headId).not.toBeNull();
    const head = getBlock(editor.state, headId as BlockId);
    expect(head?.type).toBe("heading");
    expect(head?.attrs).toEqual({ level: 2 });
  });

  it("Enter at the END of a paragraph creates a paragraph (no follow-on; unchanged)", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const paragraphId = firstBlockId(editor);

    editor = typeString(editor, "hello", config);
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    const tail = getBlock(editor.state, paragraphId);
    expect(tail?.type).toBe("paragraph");
    const headId = tail?.prevSiblingId ?? null;
    expect(headId).not.toBeNull();
    expect(getBlock(editor.state, headId as BlockId)?.type).toBe("paragraph");
  });
});

describe("SPLIT_NODE — the head's ¶ character props", () => {
  it("Enter mid bold text: the new head's markAttrs carry the inclusive props at the caret (the registry reaches the split)", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const pId = firstBlockId(editor);
    editor = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" }, config);
    editor = typeString(editor, "abcd", config);
    editor = { ...editor, selection: createSpan(createPosition(pId, 2), createPosition(pId, 2)) };

    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    const headId = getBlock(editor.state, pId)?.prevSiblingId ?? null;
    expect(headId).not.toBeNull();
    expect(getBlock(editor.state, headId as BlockId)?.markAttrs).toEqual({ bold: true });
  });
});

describe("splits made by other actions write the head's ¶ character props too", () => {
  function boldAbcd(config: EditorConfig): { editor: EditorState; pId: BlockId } {
    let editor = createInitialEditorState(config);
    const pId = firstBlockId(editor);
    editor = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" }, config);
    editor = typeString(editor, "abcd", config);
    editor = { ...editor, selection: createSpan(createPosition(pId, 2), createPosition(pId, 2)) };
    return { editor, pId };
  }

  it("SECTION_BREAK mid bold text", () => {
    const config = makeConfig();
    const { editor, pId } = boldAbcd(config);
    const next = reduceEditor(editor, { type: "SECTION_BREAK" }, config);
    const sectionA = getBlock(next.state, next.state.rootId)?.firstChildId ?? null;
    const headId = sectionA === null ? null : (getBlock(next.state, sectionA)?.lastChildId ?? null);
    expect(headId).not.toBe(pId);
    expect(getBlock(next.state, headId as BlockId)?.markAttrs).toEqual({ bold: true });
  });

  it("INSERT_TABLE mid bold text", () => {
    const config = makeConfig();
    const { editor, pId } = boldAbcd(config);
    const next = reduceEditor(editor, { type: "INSERT_TABLE", rows: 1, cols: 1 }, config);
    const tableId = getBlock(next.state, pId)?.prevSiblingId ?? null;
    const headId = tableId === null ? null : (getBlock(next.state, tableId)?.prevSiblingId ?? null);
    expect(getBlock(next.state, headId as BlockId)?.markAttrs).toEqual({ bold: true });
  });
});

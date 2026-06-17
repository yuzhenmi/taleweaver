/**
 * Behavior tests for SPLIT_NODE's follow-on block type (Enter-at-end-of-heading
 * → paragraph). Dispatched through `reduceEditor` (the real editor pipeline) so
 * the test exercises the handler + state op end-to-end, not a unit in isolation.
 *
 * Google-Docs / Word "style for following paragraph": a heading is followed by
 * Normal. The follow-on applies ONLY to the new (empty) block created by Enter
 * at the END; a mid-text split keeps both halves as the heading.
 */
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
  const root = getBlock(editor.state, editor.state.rootId);
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

    // Original block: still a heading, level intact, content intact.
    const original = getBlock(editor.state, headingId);
    expect(original?.type).toBe("heading");
    expect(original?.attrs).toEqual({ level: 1 });

    // New block: a paragraph with NO inherited heading attrs.
    const newId = original?.nextSiblingId ?? null;
    expect(newId).not.toBeNull();
    const created = getBlock(editor.state, newId as BlockId);
    expect(created?.type).toBe("paragraph");
    expect(created?.attrs).toEqual({});

    // Cursor lands at the start of the new paragraph.
    expect(editor.selection.focus).toEqual(createPosition(newId as BlockId, 0));
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

    const original = getBlock(editor.state, headingId);
    expect(original?.type).toBe("heading");
    const newId = original?.nextSiblingId as BlockId;
    const created = getBlock(editor.state, newId);
    // Mid-split: the follow-on type does NOT apply — both stay heading.
    expect(created?.type).toBe("heading");
    expect(created?.attrs).toEqual({ level: 2 });
  });

  it("Enter at the END of a paragraph creates a paragraph (no follow-on; unchanged)", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const paragraphId = firstBlockId(editor);

    editor = typeString(editor, "hello", config);
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    const original = getBlock(editor.state, paragraphId);
    expect(original?.type).toBe("paragraph");
    const created = getBlock(editor.state, original?.nextSiblingId as BlockId);
    expect(created?.type).toBe("paragraph");
  });
});

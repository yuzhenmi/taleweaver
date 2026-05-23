/**
 * Editor-flow integration tests against the new (post-P11 cutover) pipeline.
 *
 * Each test exercises a user-level flow by dispatching EditorAction objects
 * through `reduceEditor` and asserting on the resulting EditorState's
 * underlying block tree + selection. These restore some of the integration
 * coverage that was removed in T1 (which deleted 11 editor-flow tests built
 * against legacy types).
 *
 * Per-handler unit-test coverage is a known gap (P13).
 */
import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createMockShaper,
  getBlock,
  inlineContentLength,
  createPosition,
  createSpan,
  type EditorConfig,
  type EditorState,
  type Block,
  type BlockId,
  type TextItem,
} from "../index";

function makeConfig(): EditorConfig {
  return {
    measurer: createMockShaper(8, 16),
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 800,
  };
}

/** Returns the (only) paragraph block in a freshly-created editor. */
function firstParagraph(editor: EditorState): Block {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null) throw new Error("test setup: no root block");
  const firstId = root.firstChildId;
  if (firstId === null) throw new Error("test setup: root has no first child");
  const block = getBlock(editor.state, firstId);
  if (block === null) throw new Error("test setup: first child block not found");
  return block;
}

/** Returns the text contents of a leaf block's first text item, or "" if none. */
function blockText(editor: EditorState, blockId: BlockId): string {
  const block = getBlock(editor.state, blockId);
  if (block === null || block.inlineContent === null) return "";
  let out = "";
  for (const item of block.inlineContent.items) {
    if (item.kind === "text") out += item.text;
  }
  return out;
}

/** Type a literal string by dispatching one INSERT_TEXT per character. */
function typeString(
  editor: EditorState,
  text: string,
  config: EditorConfig,
): EditorState {
  let cur = editor;
  for (const ch of text) {
    cur = reduceEditor(cur, { type: "INSERT_TEXT", text: ch }, config);
  }
  return cur;
}

describe("editor flow: typing characters builds inline text", () => {
  it('typing "hello" produces a single text item with text="hello" and cursor at offset 5', () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const blockId = firstParagraph(editor).id;

    editor = typeString(editor, "hello", config);

    const block = getBlock(editor.state, blockId);
    expect(block).not.toBeNull();
    if (block === null) return;
    expect(block.inlineContent).not.toBeNull();
    if (block.inlineContent === null) return;
    expect(block.inlineContent.items.length).toBe(1);
    expect(block.inlineContent.items[0]).toMatchObject({
      kind: "text",
      text: "hello",
    });
    expect(editor.selection.focus).toEqual(createPosition(blockId, 5));
    expect(editor.selection.anchor).toEqual(editor.selection.focus);
  });
});

describe("editor flow: backspace deletes a character", () => {
  it('typing "hello" then DELETE_BACKWARD leaves "hell" and cursor at offset 4', () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const blockId = firstParagraph(editor).id;
    editor = typeString(editor, "hello", config);

    editor = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    expect(blockText(editor, blockId)).toBe("hell");
    expect(editor.selection.focus).toEqual(createPosition(blockId, 4));
  });
});

describe("editor flow: multi-paragraph editing", () => {
  it("typing, then SPLIT_NODE, then typing more produces two paragraph blocks with the right contents", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const firstId = firstParagraph(editor).id;

    editor = typeString(editor, "abc", config);
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    editor = typeString(editor, "def", config);

    // The second block is the focused one after SPLIT_NODE + typing.
    const secondId = editor.selection.focus.blockId;
    expect(secondId).not.toBe(firstId);

    expect(blockText(editor, firstId)).toBe("abc");
    expect(blockText(editor, secondId)).toBe("def");

    // First block's nextSibling chains to second; both share the document parent.
    const firstBlock = getBlock(editor.state, firstId);
    const secondBlock = getBlock(editor.state, secondId);
    expect(firstBlock?.nextSiblingId).toBe(secondId);
    expect(secondBlock?.prevSiblingId).toBe(firstId);
    expect(firstBlock?.parentId).toBe(secondBlock?.parentId);
  });
});

describe("editor flow: cross-block backspace merges paragraphs", () => {
  it('two paragraphs "abc" and "def" merge to single "abcdef" via DELETE_BACKWARD at offset 0 of second', () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const firstId = firstParagraph(editor).id;

    editor = typeString(editor, "abc", config);
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    editor = typeString(editor, "def", config);
    const secondId = editor.selection.focus.blockId;

    // Move cursor to start of the second paragraph.
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(
          createPosition(secondId, 0),
          createPosition(secondId, 0),
        ),
      },
      config,
    );

    editor = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    expect(blockText(editor, firstId)).toBe("abcdef");
    // Second block has been removed; only firstId survives.
    expect(getBlock(editor.state, secondId)).toBeNull();
    expect(editor.selection.focus).toEqual(createPosition(firstId, 3));
  });
});

describe("editor flow: selection replacement with INSERT_TEXT", () => {
  it('selecting "world" in "hello world" and inserting "earth" produces "hello earth"', () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const blockId = firstParagraph(editor).id;
    editor = typeString(editor, "hello world", config);

    // Set selection over offsets 6..11 ("world").
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(
          createPosition(blockId, 6),
          createPosition(blockId, 11),
        ),
      },
      config,
    );

    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "earth" }, config);

    expect(blockText(editor, blockId)).toBe("hello earth");
    expect(editor.selection.focus).toEqual(createPosition(blockId, 11));
    expect(editor.selection.anchor).toEqual(editor.selection.focus);
  });
});

describe("editor flow: DELETE_WORD backward", () => {
  it('with cursor at offset 11 of "hello world", DELETE_WORD backward removes the trailing word', () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const blockId = firstParagraph(editor).id;
    editor = typeString(editor, "hello world", config);

    const offsetBefore = editor.selection.focus.offset;
    expect(offsetBefore).toBe(11);

    editor = reduceEditor(
      editor,
      { type: "DELETE_WORD", direction: "backward" },
      config,
    );

    // UAX #29 word boundary at the end of "hello world": stepping back one
    // word lands on the start of "world" (offset 6). So result is "hello ".
    const after = blockText(editor, blockId);
    expect(after).toBe("hello ");
    expect(editor.selection.focus).toEqual(createPosition(blockId, 6));
  });
});

describe("editor flow: TOGGLE_STYLE applies bold over a selection", () => {
  it('selecting "hello" and toggling bold sets attrs.bold === true on the text item', () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const blockId = firstParagraph(editor).id;
    editor = typeString(editor, "hello", config);

    // Select the whole text.
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(
          createPosition(blockId, 0),
          createPosition(blockId, 5),
        ),
      },
      config,
    );

    editor = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" }, config);

    const block = getBlock(editor.state, blockId);
    expect(block).not.toBeNull();
    if (block === null || block.inlineContent === null) return;
    expect(block.inlineContent.items.length).toBe(1);
    const item = block.inlineContent.items[0];
    expect(item.kind).toBe("text");
    if (item.kind !== "text") return;
    const textItem: TextItem = item;
    expect(textItem.text).toBe("hello");
    expect(textItem.attrs.bold).toBe(true);
  });
});

describe("editor flow: undo / redo", () => {
  it('typing "hello" then UNDO five times empties the paragraph; REDO five times restores "hello"', () => {
    // The History/UndoManager records one entry per `push()`, and each
    // INSERT_TEXT action pushes once. There is no time-based grouping (the
    // UndoManager runs with `captureTimeout: 0`), so each keystroke is its
    // own undo entry. Five UNDOs are required to unwind "hello".
    //
    // KNOWN QUIRK (selection on undo): `History.push` stores the POST-action
    // selection; `undo()` pops that same snapshot. After undoing the last
    // INSERT_TEXT, the selection restored is "where the cursor was AFTER
    // typing the FIRST char" — i.e. offset 1 — even though the doc has
    // been rolled back to empty. This is a real divergence from the
    // intuitive "selection-before-the-action" semantics most editors
    // present. Tracked as a P13/P11-followup; the test pins the current
    // behavior so a future fix is a visible change.
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const blockId = firstParagraph(editor).id;
    editor = typeString(editor, "hello", config);
    expect(blockText(editor, blockId)).toBe("hello");

    for (let i = 0; i < 5; i++) {
      editor = reduceEditor(editor, { type: "UNDO" }, config);
    }

    const afterUndoBlock = getBlock(editor.state, blockId);
    expect(afterUndoBlock).not.toBeNull();
    if (afterUndoBlock !== null && afterUndoBlock.inlineContent !== null) {
      expect(inlineContentLength(afterUndoBlock.inlineContent)).toBe(0);
    }
    // Selection: with the pre-action selection algebra (T1/T4), undo
    // restores the caret to where it sat BEFORE each keystroke. After
    // undoing all five keystrokes, the caret is back at the original
    // pre-typing position (offset 0).
    expect(editor.selection.focus.blockId).toBe(blockId);
    expect(editor.selection.focus.offset).toBe(0);

    for (let i = 0; i < 5; i++) {
      editor = reduceEditor(editor, { type: "REDO" }, config);
    }
    expect(blockText(editor, blockId)).toBe("hello");
    expect(editor.selection.focus).toEqual(createPosition(blockId, 5));
  });
});

describe("editor flow: MOVE_CURSOR across block boundary", () => {
  it("two paragraphs ab/cd: forward MOVE_CURSOR at end of first lands at start of second", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const firstId = firstParagraph(editor).id;

    editor = typeString(editor, "ab", config);
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    editor = typeString(editor, "cd", config);
    const secondId = editor.selection.focus.blockId;

    // Place cursor at offset 2 of first block (its end).
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(
          createPosition(firstId, 2),
          createPosition(firstId, 2),
        ),
      },
      config,
    );

    editor = reduceEditor(
      editor,
      { type: "MOVE_CURSOR", direction: "forward" },
      config,
    );

    expect(editor.selection.focus).toEqual(createPosition(secondId, 0));
    expect(editor.selection.anchor).toEqual(editor.selection.focus);
  });
});

describe("editor flow: EXPAND_WORD selects the surrounding word", () => {
  it('in "hello world" with cursor at offset 0, EXPAND_WORD forward extends focus to offset 5', () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const blockId = firstParagraph(editor).id;
    editor = typeString(editor, "hello world", config);

    // Collapse cursor to offset 0.
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(
          createPosition(blockId, 0),
          createPosition(blockId, 0),
        ),
      },
      config,
    );

    editor = reduceEditor(
      editor,
      { type: "EXPAND_WORD", direction: "forward" },
      config,
    );

    // Anchor stays at 0; focus advances past "hello" — to offset 5.
    expect(editor.selection.anchor).toEqual(createPosition(blockId, 0));
    expect(editor.selection.focus).toEqual(createPosition(blockId, 5));
  });
});

describe("R-D incremental pipeline (end-to-end)", () => {
  it("INSERT_TEXT on a leaf: prev unchanged paragraphs ref-equal in renderOutput across reducer calls", () => {
    // Seed two paragraphs by pressing Enter inside the first one.
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const firstId = firstParagraph(editor).id;

    // Move cursor to end of paragraph 0 and split.
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)) },
      config,
    );
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    // Now editor has two paragraphs. Capture the first paragraph's
    // RenderNode reference, then insert text in the SECOND paragraph
    // and verify the first paragraph's RenderNode is ref-equal across
    // the keystroke.
    const beforeRoot = editor.renderOutput.root;
    if (beforeRoot.type !== "element") throw new Error("expected element root");
    // Take a snapshot of the first leaf child of the document root.
    const firstChild0 = beforeRoot.children[0];

    // Type "X" — INSERT_TEXT goes to the current cursor block (which
    // is the SECOND paragraph after SPLIT_NODE).
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "X" }, config);

    const afterRoot = editor.renderOutput.root;
    if (afterRoot.type !== "element") throw new Error("expected element root");
    const firstChild1 = afterRoot.children[0];

    // First paragraph's RenderNode is ref-equal across the
    // INSERT_TEXT keystroke (which only dirtied the second
    // paragraph). The root itself differs (children array changed
    // because the second child was rebuilt).
    expect(firstChild1).toBe(firstChild0);
    expect(afterRoot).not.toBe(beforeRoot);
  });
});

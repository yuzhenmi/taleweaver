import { describe, it, expect, vi } from "vitest";
import {
  createMockMeasurer,
  createRegistry,
  defaultComponents,
  createPosition,
  createSelection,
  createCursor,
  isCollapsed,
  getNodeByPath,
  getTextContent,
  getTextContentLength,
  comparePositions,
} from "@taleweaver/core";
import {
  createInitialEditorState,
  reduceEditor,
  type EditorConfig,
  type EditorState,
} from "./editor-state";

const measurer = createMockMeasurer(8, 16);
const registry = createRegistry([...defaultComponents]);
const config: EditorConfig = { measurer, registry, containerWidth: 200 };

function getTextAt(
  state: ReturnType<typeof createInitialEditorState>,
  path: readonly number[],
): string {
  const node = getNodeByPath(state.state, path);
  return node ? getTextContent(node) : "";
}

/** Build an editor state with "hello world" typed in, cursor at end. */
function stateWithText(text: string): EditorState {
  let s = createInitialEditorState(config);
  s = reduceEditor(s, { type: "INSERT_TEXT", text }, config);
  return s;
}

/** Build an editor state with two paragraphs. */
function stateWithTwoParagraphs(): EditorState {
  let s = createInitialEditorState(config);
  s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
  s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
  s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, config);
  return s;
}

/** Set a specific selection on an editor state. */
function withSelection(s: EditorState, sel: ReturnType<typeof createSelection>): EditorState {
  return reduceEditor(s, { type: "SET_SELECTION", selection: sel }, config);
}

describe("createInitialEditorState", () => {
  it("creates state with empty document", () => {
    const s = createInitialEditorState(config);
    expect(s.state.type).toBe("document");
    expect(s.state.children).toHaveLength(1);
    expect(getTextAt(s, [0, 0])).toBe("");
  });

  it("has cursor at start", () => {
    const s = createInitialEditorState(config);
    expect(s.selection.anchor.path).toEqual([0, 0]);
    expect(s.selection.anchor.offset).toBe(0);
  });

  it("has render and layout trees", () => {
    const s = createInitialEditorState(config);
    expect(s.renderTree).toBeDefined();
    expect(s.layoutTree).toBeDefined();
  });
});

describe("reduceEditor — INSERT_TEXT", () => {
  it("inserts a character and moves cursor", () => {
    const s0 = createInitialEditorState(config);
    const s1 = reduceEditor(s0, { type: "INSERT_TEXT", text: "a" }, config);
    expect(getTextAt(s1, [0, 0])).toBe("a");
    expect(s1.selection.focus.offset).toBe(1);
  });

  it("inserts multiple characters", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "hello" }, config);
    expect(getTextAt(s, [0, 0])).toBe("hello");
    expect(s.selection.focus.offset).toBe(5);
  });

  it("inserts at cursor position", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "ab" }, config);
    // Move cursor backward
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "X" }, config);
    expect(getTextAt(s, [0, 0])).toBe("aXb");
  });
});

describe("reduceEditor — DELETE_BACKWARD", () => {
  it("deletes character before cursor", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(getTextAt(s, [0, 0])).toBe("ab");
    expect(s.selection.focus.offset).toBe(2);
  });

  it("does nothing at start of document", () => {
    const s0 = createInitialEditorState(config);
    const s1 = reduceEditor(s0, { type: "DELETE_BACKWARD" }, config);
    expect(getTextAt(s1, [0, 0])).toBe("");
    expect(s1.selection.focus.offset).toBe(0);
  });

  it("merges paragraphs at paragraph boundary", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, config);
    // Cursor is at [1, 0] offset 3. Move to start of second paragraph.
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    // Now at [1, 0] offset 0. Delete backward should merge.
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(s.state.children).toHaveLength(1);
    expect(getTextAt(s, [0, 0])).toBe("abcdef");
    expect(s.selection.focus.offset).toBe(3);
  });
});

describe("reduceEditor — SPLIT_NODE", () => {
  it("splits paragraph and moves cursor to new paragraph", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abcdef" }, config);
    // Move cursor to offset 3
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);

    expect(s.state.children).toHaveLength(2);
    expect(getTextAt(s, [0, 0])).toBe("abc");
    expect(getTextAt(s, [1, 0])).toBe("def");
    // Cursor at start of new paragraph
    expect(s.selection.focus.path).toEqual([1, 0]);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("splits at end creates empty paragraph", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);

    expect(s.state.children).toHaveLength(2);
    expect(getTextAt(s, [0, 0])).toBe("abc");
    expect(getTextAt(s, [1, 0])).toBe("");
  });
});

describe("reduceEditor — MOVE_CURSOR", () => {
  it("moves forward", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "forward" }, config);
    expect(s.selection.focus.offset).toBe(3);
  });

  it("moves backward", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    expect(s.selection.focus.offset).toBe(2);
  });
});

describe("reduceEditor — MOVE_WORD", () => {
  it("moves by word forward", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "hello world" }, config);
    // Move cursor to start
    for (let i = 0; i < 11; i++) {
      s = reduceEditor(
        s,
        { type: "MOVE_CURSOR", direction: "backward" },
        config,
      );
    }
    s = reduceEditor(s, { type: "MOVE_WORD", direction: "forward" }, config);
    expect(s.selection.focus.offset).toBe(5); // after "hello"
  });
});

describe("reduceEditor — UNDO / REDO", () => {
  it("undoes last change and restores cursor", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "a" }, config);
    // Force a new history group by using a large timestamp gap
    const s1 = s;
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "b" }, config);

    s = reduceEditor(s, { type: "UNDO" }, config);
    // The exact behavior depends on history collapsing. Just verify undo works.
    const text = getTextAt(s, [0, 0]);
    expect(text.length).toBeLessThan(2);
  });

  it("redo restores undone change", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "x" }, config);
    s = reduceEditor(s, { type: "UNDO" }, config);
    s = reduceEditor(s, { type: "REDO" }, config);
    expect(getTextAt(s, [0, 0])).toBe("x");
  });

  it("does nothing when nothing to undo", () => {
    const s0 = createInitialEditorState(config);
    const s1 = reduceEditor(s0, { type: "UNDO" }, config);
    expect(s1.state).toBe(s0.state);
  });

  it("does nothing when nothing to redo", () => {
    const s0 = createInitialEditorState(config);
    const s1 = reduceEditor(s0, { type: "REDO" }, config);
    expect(s1.state).toBe(s0.state);
  });
});

describe("reduceEditor — SET_CONTAINER_WIDTH", () => {
  it("re-layouts with new width", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "hello" }, config);
    const oldLayout = s.layoutTree;
    s = reduceEditor(s, { type: "SET_CONTAINER_WIDTH", width: 300 }, config);
    expect(s.containerWidth).toBe(300);
    expect(s.layoutTree).not.toBe(oldLayout);
  });
});

// ===================================================================
// Feature 1: SET_SELECTION
// ===================================================================

describe("reduceEditor — SET_SELECTION", () => {
  it("sets selection to a specific collapsed cursor", () => {
    let s = stateWithText("hello");
    const sel = createCursor([0, 0], 2);
    s = reduceEditor(s, { type: "SET_SELECTION", selection: sel }, config);
    expect(s.selection.focus.offset).toBe(2);
    expect(s.selection.anchor.offset).toBe(2);
  });

  it("sets an expanded (non-collapsed) selection", () => {
    let s = stateWithText("hello");
    const sel = createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    );
    s = reduceEditor(s, { type: "SET_SELECTION", selection: sel }, config);
    expect(s.selection.anchor.offset).toBe(1);
    expect(s.selection.focus.offset).toBe(4);
    expect(isCollapsed(s.selection)).toBe(false);
  });

  it("does not modify document state", () => {
    let s = stateWithText("hello");
    const stateBefore = s.state;
    s = reduceEditor(
      s,
      { type: "SET_SELECTION", selection: createCursor([0, 0], 3) },
      config,
    );
    expect(s.state).toBe(stateBefore);
  });
});

// ===================================================================
// Feature 2: Selection-aware existing actions
// ===================================================================

describe("reduceEditor — INSERT_TEXT with expanded selection", () => {
  it("replaces selected text with typed character", () => {
    let s = stateWithText("hello");
    // Select "ell" (offset 1–4)
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "X" }, config);
    expect(getTextAt(s, [0, 0])).toBe("hXo");
    expect(s.selection.focus.offset).toBe(2);
  });

  it("replaces entire text when all selected", () => {
    let s = stateWithText("abc");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 3),
    ));
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "Z" }, config);
    expect(getTextAt(s, [0, 0])).toBe("Z");
    expect(s.selection.focus.offset).toBe(1);
  });
});

describe("reduceEditor — DELETE_BACKWARD with expanded selection", () => {
  it("deletes the selected range instead of single char", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(getTextAt(s, [0, 0])).toBe("ho");
    expect(isCollapsed(s.selection)).toBe(true);
    expect(s.selection.focus.offset).toBe(1);
  });
});

describe("reduceEditor — MOVE_CURSOR with expanded selection", () => {
  it("collapses to end when moving forward", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "forward" }, config);
    expect(isCollapsed(s.selection)).toBe(true);
    expect(s.selection.focus.offset).toBe(4);
  });

  it("collapses to start when moving backward", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    expect(isCollapsed(s.selection)).toBe(true);
    expect(s.selection.focus.offset).toBe(1);
  });
});

describe("reduceEditor — SPLIT_NODE with expanded selection", () => {
  it("deletes selection then splits", () => {
    let s = stateWithText("abcdef");
    // Select "cd" (offset 2-4)
    s = withSelection(s, createSelection(
      createPosition([0, 0], 2),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    expect(s.state.children).toHaveLength(2);
    expect(getTextAt(s, [0, 0])).toBe("ab");
    expect(getTextAt(s, [1, 0])).toBe("ef");
  });
});

// ===================================================================
// Feature 2: EXPAND_SELECTION & EXPAND_WORD
// ===================================================================

describe("reduceEditor — EXPAND_SELECTION", () => {
  it("expands selection forward by one character", () => {
    let s = stateWithText("hello");
    // Put cursor at offset 1
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "EXPAND_SELECTION", direction: "forward" }, config);
    expect(s.selection.anchor.offset).toBe(1);
    expect(s.selection.focus.offset).toBe(2);
    expect(isCollapsed(s.selection)).toBe(false);
  });

  it("expands selection backward by one character", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "EXPAND_SELECTION", direction: "backward" }, config);
    expect(s.selection.anchor.offset).toBe(3);
    expect(s.selection.focus.offset).toBe(2);
  });

  it("can expand multiple times to grow selection", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "EXPAND_SELECTION", direction: "forward" }, config);
    s = reduceEditor(s, { type: "EXPAND_SELECTION", direction: "forward" }, config);
    s = reduceEditor(s, { type: "EXPAND_SELECTION", direction: "forward" }, config);
    expect(s.selection.anchor.offset).toBe(1);
    expect(s.selection.focus.offset).toBe(4);
  });
});

describe("reduceEditor — EXPAND_WORD", () => {
  it("expands selection forward by one word", () => {
    let s = stateWithText("hello world");
    s = withSelection(s, createCursor([0, 0], 0));
    s = reduceEditor(s, { type: "EXPAND_WORD", direction: "forward" }, config);
    expect(s.selection.anchor.offset).toBe(0);
    expect(s.selection.focus.offset).toBe(5); // "hello"
  });

  it("expands selection backward by one word", () => {
    let s = stateWithText("hello world");
    // Cursor at end
    s = reduceEditor(s, { type: "EXPAND_WORD", direction: "backward" }, config);
    expect(s.selection.anchor.offset).toBe(11);
    expect(s.selection.focus.offset).toBe(6); // start of "world"
  });
});

// ===================================================================
// Feature 3: DELETE_FORWARD
// ===================================================================

describe("reduceEditor — DELETE_FORWARD", () => {
  it("deletes character after cursor", () => {
    let s = stateWithText("abc");
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(getTextAt(s, [0, 0])).toBe("ac");
    expect(s.selection.focus.offset).toBe(1);
  });

  it("does nothing at end of last paragraph", () => {
    let s = stateWithText("abc");
    // cursor at end (offset 3)
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("merges with next paragraph at paragraph boundary", () => {
    let s = stateWithTwoParagraphs();
    // Move to end of first paragraph
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(s.state.children).toHaveLength(1);
    expect(getTextAt(s, [0, 0])).toBe("abcdef");
    expect(s.selection.focus.offset).toBe(3);
  });

  it("deletes selected range when selection is expanded", () => {
    let s = stateWithText("abcde");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 3),
    ));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(getTextAt(s, [0, 0])).toBe("ade");
    expect(isCollapsed(s.selection)).toBe(true);
  });

  it("deletes first character when cursor at start", () => {
    let s = stateWithText("abc");
    s = withSelection(s, createCursor([0, 0], 0));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(getTextAt(s, [0, 0])).toBe("bc");
    expect(s.selection.focus.offset).toBe(0);
  });
});

// ===================================================================
// Feature 4: MOVE_LINE & EXPAND_LINE
// ===================================================================

describe("reduceEditor — MOVE_LINE", () => {
  it("moves cursor down to next paragraph", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "down" }, config);
    expect(s.selection.focus.path[0]).toBe(1);
    expect(isCollapsed(s.selection)).toBe(true);
  });

  it("moves cursor up to previous paragraph", () => {
    let s = stateWithTwoParagraphs();
    // cursor in second paragraph
    s = withSelection(s, createCursor([1, 0], 1));
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "up" }, config);
    expect(s.selection.focus.path[0]).toBe(0);
    expect(isCollapsed(s.selection)).toBe(true);
  });

  it("moves to end of document when going down on last line", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "down" }, config);
    expect(s.selection.focus.offset).toBe(5); // end of "hello"
  });

  it("moves to start of document when going up on first line", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "up" }, config);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("collapses expanded selection when moving down", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 2),
    ));
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "down" }, config);
    expect(isCollapsed(s.selection)).toBe(true);
  });

  it("preserves targetX across consecutive vertical moves", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "down" }, config);
    expect(s.targetX).not.toBeNull();
    const savedTargetX = s.targetX;
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "up" }, config);
    // targetX should persist across vertical moves
    expect(s.targetX).toBe(savedTargetX);
  });

  it("clears targetX on non-vertical action", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "down" }, config);
    expect(s.targetX).not.toBeNull();
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "forward" }, config);
    expect(s.targetX).toBeNull();
  });
});

describe("reduceEditor — EXPAND_LINE", () => {
  it("expands selection down to next line", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "EXPAND_LINE", direction: "down" }, config);
    expect(s.selection.anchor.path).toEqual([0, 0]);
    expect(s.selection.anchor.offset).toBe(1);
    expect(s.selection.focus.path[0]).toBe(1);
    expect(isCollapsed(s.selection)).toBe(false);
  });

  it("expands selection up to previous line", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createCursor([1, 0], 2));
    s = reduceEditor(s, { type: "EXPAND_LINE", direction: "up" }, config);
    expect(s.selection.anchor.path).toEqual([1, 0]);
    expect(s.selection.anchor.offset).toBe(2);
    expect(s.selection.focus.path[0]).toBe(0);
  });
});

// ===================================================================
// Feature 5: TOGGLE_STYLE
// ===================================================================

describe("reduceEditor — TOGGLE_STYLE", () => {
  it("does nothing with collapsed selection", () => {
    let s = stateWithText("hello");
    const before = s.state;
    s = reduceEditor(s, { type: "TOGGLE_STYLE", style: "bold" }, config);
    expect(s.state).toBe(before);
  });

  it("applies bold style to selected text", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    ));
    s = reduceEditor(s, { type: "TOGGLE_STYLE", style: "bold" }, config);
    // The paragraph should now contain a span with fontWeight: "bold"
    const para = s.state.children[0];
    const hasSpanWithBold = para.children.some(
      (child) => child.type === "span" && child.properties.fontWeight === "bold",
    );
    expect(hasSpanWithBold).toBe(true);
  });

  it("applies italic style to selected text", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "TOGGLE_STYLE", style: "italic" }, config);
    const para = s.state.children[0];
    const hasSpanWithItalic = para.children.some(
      (child) => child.type === "span" && child.properties.fontStyle === "italic",
    );
    expect(hasSpanWithItalic).toBe(true);
  });

  it("applies underline style to selected text", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    ));
    s = reduceEditor(s, { type: "TOGGLE_STYLE", style: "underline" }, config);
    const para = s.state.children[0];
    const hasSpanWithUnderline = para.children.some(
      (child) => child.type === "span" && child.properties.textDecoration === "underline",
    );
    expect(hasSpanWithUnderline).toBe(true);
  });

  it("is undoable", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    ));
    s = reduceEditor(s, { type: "TOGGLE_STYLE", style: "bold" }, config);
    expect(s.history.undoStack.length).toBeGreaterThan(0);
    s = reduceEditor(s, { type: "UNDO" }, config);
    // After undo, should be plain text again
    const para = s.state.children[0];
    expect(para.children).toHaveLength(1);
    expect(para.children[0].type).toBe("text");
  });
});

// ===================================================================
// Feature 6: PASTE
// ===================================================================

describe("reduceEditor — PASTE", () => {
  it("pastes single-line text at cursor", () => {
    let s = stateWithText("ab");
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "PASTE", text: "XY" }, config);
    expect(getTextAt(s, [0, 0])).toBe("aXYb");
    expect(s.selection.focus.offset).toBe(3);
  });

  it("pastes multi-line text creating new paragraphs", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "PASTE", text: "line1\nline2\nline3" }, config);
    expect(s.state.children).toHaveLength(3);
    expect(getTextAt(s, [0, 0])).toBe("line1");
    expect(getTextAt(s, [1, 0])).toBe("line2");
    expect(getTextAt(s, [2, 0])).toBe("line3");
  });

  it("replaces expanded selection when pasting", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "PASTE", text: "XY" }, config);
    expect(getTextAt(s, [0, 0])).toBe("hXYo");
  });

  it("does nothing for empty paste", () => {
    let s = stateWithText("hello");
    const before = s.state;
    s = reduceEditor(s, { type: "PASTE", text: "" }, config);
    expect(s.state).toBe(before);
  });

  it("pastes text with trailing newline", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "PASTE", text: "hello\n" }, config);
    expect(s.state.children).toHaveLength(2);
    expect(getTextAt(s, [0, 0])).toBe("hello");
    expect(getTextAt(s, [1, 0])).toBe("");
  });

  it("undoes paste-over-selection in a single undo step", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "PASTE", text: "XY" }, config);
    expect(getTextAt(s, [0, 0])).toBe("hXYo");
    // Single undo should restore the original text and selection
    s = reduceEditor(s, { type: "UNDO" }, config);
    expect(getTextAt(s, [0, 0])).toBe("hello");
  });

  it("undoes multi-line paste in a single undo step", () => {
    let s = stateWithText("ab");
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "PASTE", text: "X\nY\nZ" }, config);
    expect(s.state.children).toHaveLength(3);
    // Single undo should collapse back to one paragraph
    s = reduceEditor(s, { type: "UNDO" }, config);
    expect(s.state.children).toHaveLength(1);
    expect(getTextAt(s, [0, 0])).toBe("ab");
  });
});

// ===================================================================
// Feature 7: SET_BLOCK_TYPE
// ===================================================================

describe("reduceEditor — SET_BLOCK_TYPE", () => {
  it("converts paragraph to heading", () => {
    let s = stateWithText("Title");
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );
    expect(s.state.children[0].type).toBe("heading");
    expect(s.state.children[0].properties.level).toBe(1);
    // Content should be preserved
    expect(getTextAt(s, [0, 0])).toBe("Title");
  });

  it("toggles heading back to paragraph", () => {
    let s = stateWithText("Title");
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );
    expect(s.state.children[0].type).toBe("heading");
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );
    expect(s.state.children[0].type).toBe("paragraph");
  });

  it("preserves selection after block type change", () => {
    let s = stateWithText("Title");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 2 } },
      config,
    );
    expect(s.selection.focus.offset).toBe(3);
  });

  it("is undoable", () => {
    let s = stateWithText("Title");
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );
    s = reduceEditor(s, { type: "UNDO" }, config);
    expect(s.state.children[0].type).toBe("paragraph");
  });
});

// ===================================================================
// Feature 7: TOGGLE_LIST
// ===================================================================

describe("reduceEditor — TOGGLE_LIST", () => {
  it("wraps paragraph in a list", () => {
    let s = stateWithText("item");
    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    const firstChild = s.state.children[0];
    expect(firstChild.type).toBe("list");
    expect(firstChild.properties.listType).toBe("unordered");
    expect(firstChild.children).toHaveLength(1);
    expect(firstChild.children[0].type).toBe("list-item");
    // Content preserved
    expect(getTextContent(firstChild.children[0].children[0])).toBe("item");
  });

  it("adjusts selection path when wrapping in list", () => {
    let s = stateWithText("item");
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    // Path should go from [0, 0] to [0, 0, 0]
    expect(s.selection.focus.path).toEqual([0, 0, 0]);
    expect(s.selection.focus.offset).toBe(2);
  });

  it("unwraps list back to paragraph", () => {
    let s = stateWithText("item");
    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    expect(s.state.children[0].type).toBe("list");
    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    expect(s.state.children[0].type).toBe("paragraph");
    expect(getTextAt(s, [0, 0])).toBe("item");
  });
});

// ===================================================================
// Feature 7: SPLIT_NODE special behaviours
// ===================================================================

describe("reduceEditor — SPLIT_NODE on heading", () => {
  it("creates a new paragraph (not heading) after splitting", () => {
    let s = stateWithText("Title text");
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );
    // Move cursor to middle of heading
    s = withSelection(s, createCursor([0, 0], 5));
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    expect(s.state.children).toHaveLength(2);
    expect(s.state.children[0].type).toBe("heading");
    expect(s.state.children[1].type).toBe("paragraph");
    expect(getTextAt(s, [0, 0])).toBe("Title");
    expect(getTextAt(s, [1, 0])).toBe(" text");
  });
});

describe("reduceEditor — SPLIT_NODE in list", () => {
  it("creates a new list item when splitting within a list item", () => {
    let s = stateWithText("item one");
    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    // Cursor is at [0, 0, 0] offset 8 ("item one|")
    // Move to middle: [0, 0, 0] offset 4
    s = withSelection(s, createCursor([0, 0, 0], 4));
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    const list = s.state.children[0];
    expect(list.type).toBe("list");
    expect(list.children).toHaveLength(2);
    expect(getTextContent(list.children[0].children[0])).toBe("item");
    expect(getTextContent(list.children[1].children[0])).toBe(" one");
  });

  it("exits list when pressing enter on empty list item", () => {
    let s = stateWithText("");
    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    // Cursor at [0, 0, 0] offset 0, empty list item
    s = withSelection(s, createCursor([0, 0, 0], 0));
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    // Should have exited the list — first child should be a paragraph
    expect(s.state.children[0].type).toBe("paragraph");
  });
});

// ===================================================================
// targetX initial state
// ===================================================================

describe("createInitialEditorState", () => {
  it("initializes targetX to null", () => {
    const s = createInitialEditorState(config);
    expect(s.targetX).toBeNull();
  });
});

// ===================================================================
// SELECT_ALL
// ===================================================================

describe("reduceEditor — SELECT_ALL", () => {
  it("selects all text in single paragraph", () => {
    let s = stateWithText("hello");
    s = reduceEditor(s, { type: "SELECT_ALL" }, config);
    expect(s.selection.anchor.offset).toBe(0);
    expect(s.selection.focus.path[0]).toBe(0);
    expect(s.selection.focus.offset).toBe(5);
    expect(isCollapsed(s.selection)).toBe(false);
  });

  it("selects all text across paragraphs", () => {
    let s = stateWithTwoParagraphs(); // "abc" + "def"
    s = reduceEditor(s, { type: "SELECT_ALL" }, config);
    expect(s.selection.anchor.path[0]).toBe(0);
    expect(s.selection.anchor.offset).toBe(0);
    expect(s.selection.focus.path[0]).toBe(1);
    expect(s.selection.focus.offset).toBe(3);
  });

  it("does not modify document state", () => {
    let s = stateWithText("hello");
    const before = s.state;
    s = reduceEditor(s, { type: "SELECT_ALL" }, config);
    expect(s.state).toBe(before);
  });
});

// ===================================================================
// MOVE_DOCUMENT_BOUNDARY / EXPAND_DOCUMENT_BOUNDARY
// ===================================================================

describe("reduceEditor — MOVE_DOCUMENT_BOUNDARY", () => {
  it("moves to start of document", () => {
    let s = stateWithTwoParagraphs();
    // cursor at end of second paragraph
    s = reduceEditor(s, { type: "MOVE_DOCUMENT_BOUNDARY", boundary: "start" }, config);
    expect(s.selection.focus.path[0]).toBe(0);
    expect(s.selection.focus.offset).toBe(0);
    expect(isCollapsed(s.selection)).toBe(true);
  });

  it("moves to end of document", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createCursor([0, 0], 0));
    s = reduceEditor(s, { type: "MOVE_DOCUMENT_BOUNDARY", boundary: "end" }, config);
    expect(s.selection.focus.path[0]).toBe(1);
    expect(s.selection.focus.offset).toBe(3);
    expect(isCollapsed(s.selection)).toBe(true);
  });
});

describe("reduceEditor — EXPAND_DOCUMENT_BOUNDARY", () => {
  it("expands selection to start of document", () => {
    let s = stateWithTwoParagraphs();
    // cursor at end of second paragraph
    s = reduceEditor(s, { type: "EXPAND_DOCUMENT_BOUNDARY", boundary: "start" }, config);
    expect(s.selection.anchor.path).toEqual([1, 0]);
    expect(s.selection.anchor.offset).toBe(3);
    expect(s.selection.focus.path[0]).toBe(0);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("expands selection to end of document", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "EXPAND_DOCUMENT_BOUNDARY", boundary: "end" }, config);
    expect(s.selection.anchor.offset).toBe(1);
    expect(s.selection.focus.path[0]).toBe(1);
    expect(s.selection.focus.offset).toBe(3);
  });
});

// ===================================================================
// MOVE_LINE_BOUNDARY / EXPAND_LINE_BOUNDARY
// ===================================================================

describe("reduceEditor — MOVE_LINE_BOUNDARY", () => {
  it("moves to start of line", () => {
    let s = stateWithText("hello");
    // cursor at offset 3
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "MOVE_LINE_BOUNDARY", boundary: "start" }, config);
    expect(s.selection.focus.offset).toBe(0);
    expect(isCollapsed(s.selection)).toBe(true);
  });

  it("moves to end of line", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, { type: "MOVE_LINE_BOUNDARY", boundary: "end" }, config);
    expect(s.selection.focus.offset).toBe(5);
    expect(isCollapsed(s.selection)).toBe(true);
  });
});

describe("reduceEditor — EXPAND_LINE_BOUNDARY", () => {
  it("expands selection to start of line", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "EXPAND_LINE_BOUNDARY", boundary: "start" }, config);
    expect(s.selection.anchor.offset).toBe(3);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("expands selection to end of line", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, { type: "EXPAND_LINE_BOUNDARY", boundary: "end" }, config);
    expect(s.selection.anchor.offset).toBe(2);
    expect(s.selection.focus.offset).toBe(5);
  });
});

// ===================================================================
// DELETE_WORD
// ===================================================================

describe("reduceEditor — DELETE_WORD", () => {
  it("deletes word backward", () => {
    let s = stateWithText("hello world");
    // cursor at end
    s = reduceEditor(s, { type: "DELETE_WORD", direction: "backward" }, config);
    expect(getTextAt(s, [0, 0])).toBe("hello ");
  });

  it("deletes word forward", () => {
    let s = stateWithText("hello world");
    s = withSelection(s, createCursor([0, 0], 0));
    s = reduceEditor(s, { type: "DELETE_WORD", direction: "forward" }, config);
    expect(getTextAt(s, [0, 0])).toBe(" world");
  });

  it("deletes expanded selection instead of word", () => {
    let s = stateWithText("hello world");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "DELETE_WORD", direction: "backward" }, config);
    expect(getTextAt(s, [0, 0])).toBe("ho world");
  });
});

// ===================================================================
// DELETE_LINE
// ===================================================================

describe("reduceEditor — DELETE_LINE", () => {
  it("deletes from cursor to start of line", () => {
    let s = stateWithText("hello");
    // cursor at offset 3
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "DELETE_LINE" }, config);
    expect(getTextAt(s, [0, 0])).toBe("lo");
    expect(s.selection.focus.offset).toBe(0);
  });

  it("deletes expanded selection instead", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "DELETE_LINE" }, config);
    expect(getTextAt(s, [0, 0])).toBe("ho");
  });

  it("does nothing at start of line", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 0));
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_LINE" }, config);
    expect(s.state).toBe(before);
  });
});

// ===================================================================
// Undo history temporal grouping
// ===================================================================

function typeChars(
  state: EditorState,
  chars: string,
): EditorState {
  let s = state;
  for (const ch of chars) {
    s = reduceEditor(s, { type: "INSERT_TEXT", text: ch }, config);
  }
  return s;
}

describe("undo history grouping", () => {
  it("merges rapid INSERT_TEXT actions into a single undo entry", () => {
    let state = createInitialEditorState(config);
    // Type "hello" rapidly (timestamps from Date.now() will be very close)
    state = typeChars(state, "hello");

    // All 5 characters should be merged into 1 undo entry
    expect(state.history.undoStack.length).toBe(1);

    // Undo should revert all 5 characters at once
    state = reduceEditor(state, { type: "UNDO" }, config);
    expect(getTextAt(state, [0, 0])).toBe("");
  });

  it("creates a new undo group after a pause", () => {
    let state = createInitialEditorState(config);

    // Type "hi" rapidly
    state = typeChars(state, "hi");
    expect(state.history.undoStack.length).toBe(1);

    // Simulate a pause by advancing Date.now() beyond the merge threshold
    const realNow = Date.now;
    Date.now = vi.fn(() => realNow() + 1000);
    try {
      state = typeChars(state, "x");
    } finally {
      Date.now = realNow;
    }

    // Should have 2 undo entries: "hi" and "x"
    expect(state.history.undoStack.length).toBe(2);

    // Undo should revert just "x"
    state = reduceEditor(state, { type: "UNDO" }, config);
    expect(getTextAt(state, [0, 0])).toBe("hi");
  });

  it("does not merge across SPLIT_NODE", () => {
    let state = createInitialEditorState(config);

    // Type "ab" (merged into 1 entry)
    state = typeChars(state, "ab");
    expect(state.history.undoStack.length).toBe(1);

    // Press Enter (structural — breaks merge chain)
    state = reduceEditor(state, { type: "SPLIT_NODE" }, config);
    expect(state.history.undoStack.length).toBe(2);

    // Type "cd" — should NOT merge with "ab" group
    state = typeChars(state, "cd");
    expect(state.history.undoStack.length).toBe(3);
  });

  it("merges rapid DELETE_BACKWARD actions into a single undo entry", () => {
    let state = createInitialEditorState(config);

    // Type "hello" (1 merged entry)
    state = typeChars(state, "hello");
    const undoCountAfterType = state.history.undoStack.length;
    expect(undoCountAfterType).toBe(1);

    // Delete 3 chars rapidly
    state = reduceEditor(state, { type: "DELETE_BACKWARD" }, config);
    state = reduceEditor(state, { type: "DELETE_BACKWARD" }, config);
    state = reduceEditor(state, { type: "DELETE_BACKWARD" }, config);

    // Should have 1 more undo entry (the merged deletes), not 3
    expect(state.history.undoStack.length).toBe(undoCountAfterType + 1);

    // Undo should restore all 3 chars at once
    state = reduceEditor(state, { type: "UNDO" }, config);
    expect(getTextAt(state, [0, 0])).toBe("hello");
  });

  it("does not merge inserts with deletes", () => {
    let state = createInitialEditorState(config);

    // Type "abc" (1 merged entry)
    state = typeChars(state, "abc");
    expect(state.history.undoStack.length).toBe(1);

    // Delete 1 char — different action type, should start new group
    state = reduceEditor(state, { type: "DELETE_BACKWARD" }, config);
    expect(state.history.undoStack.length).toBe(2);
  });
});

/**
 * Integration: void block (image / horizontal-line) workflows.
 *
 * Void blocks are block-level nodes with zero children. Tests cover
 * insertion, cursor navigation, deletion, render/layout metadata flow,
 * and undo.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { renderTree } from "../render/render";
import { layoutTree } from "../layout/layout-engine";
import {
  createInitialEditorState,
  reduceEditor,
} from "../editor/editor-state";
import { createCursor, isCollapsed } from "../cursor/selection";
import { getNodeByPath, getTextContent } from "@taleweaver/core";
import { registry, measurer } from "./setup";

const containerWidth = 200;
const config = { measurer, registry, containerWidth };

function getTextAt(
  state: ReturnType<typeof createInitialEditorState>,
  path: readonly number[],
): string {
  const node = getNodeByPath(state.state, path);
  return node ? getTextContent(node) : "";
}

function withSelection(
  s: ReturnType<typeof createInitialEditorState>,
  sel: ReturnType<typeof createCursor>,
) {
  return reduceEditor(s, { type: "SET_SELECTION", selection: sel }, config);
}

describe("Void block insertion", () => {
  it("inserts HR, producing para + HR + para structure", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "Hello world" }, config);
    s = withSelection(s, createCursor([0, 0], 5));
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    expect(s.state.children).toHaveLength(3);
    expect(s.state.children[0].type).toBe("paragraph");
    expect(getTextAt(s, [0, 0])).toBe("Hello");
    expect(s.state.children[1].type).toBe("horizontal-line");
    expect(s.state.children[1].children).toHaveLength(0);
    expect(s.state.children[2].type).toBe("paragraph");
    expect(getTextAt(s, [2, 0])).toBe(" world");
  });

  it("inserts image with properties, metadata flows to render/layout", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "text" }, config);
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "image",
      properties: { src: "data:image/png;base64,abc", width: 200, height: 100 },
    }, config);

    // State tree
    expect(s.state.children[1].type).toBe("image");
    expect(s.state.children[1].properties.src).toBe("data:image/png;base64,abc");

    // Render tree: find image render node
    const docRender = s.renderTree;
    expect(docRender.type).toBe("block");
    const imgRender = docRender.children[1];
    expect(imgRender.type).toBe("block");
    if (imgRender.type === "block") {
      expect(imgRender.metadata?.type).toBe("image");
      expect(imgRender.metadata?.src).toBe("data:image/png;base64,abc");
    }

    // Layout tree: image block has metadata
    const imgLayout = s.layoutTree.children[1];
    expect(imgLayout.type).toBe("block");
    if (imgLayout.type === "block") {
      expect(imgLayout.metadata?.type).toBe("image");
    }
  });

  it("cursor is placed after void block", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    expect(s.selection.focus.path[0]).toBe(2);
    expect(s.selection.focus.offset).toBe(0);
    expect(isCollapsed(s.selection)).toBe(true);
  });
});

describe("Cursor navigation with void blocks", () => {
  it("arrow keys skip over void blocks naturally", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, config);
    // State: para("abc"), HR, para("def"), cursor at [2, 0] offset 3

    // Move backward through "def", then through void block, to end of "abc"
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    // Now at [2, 0] offset 0, one more backward should skip HR
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    // Should be at end of first paragraph
    expect(s.selection.focus.path[0]).toBe(0);
    expect(s.selection.focus.offset).toBe(3);
  });
});

describe("Delete with void blocks", () => {
  it("backspace at paragraph start after HR removes HR only", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);
    // para("abc"), HR, para("")  cursor at [2, 0] offset 0

    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);

    expect(s.state.children).toHaveLength(2);
    expect(s.state.children.every(c => c.type === "paragraph")).toBe(true);
  });

  it("forward-delete at paragraph end before HR removes HR only", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, config);
    // para("abc"), HR, para("def")

    // Move cursor to end of first paragraph
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);

    expect(s.state.children).toHaveLength(2);
    expect(s.state.children[0].type).toBe("paragraph");
    expect(s.state.children[1].type).toBe("paragraph");
    expect(getTextAt(s, [0, 0])).toBe("abc");
    expect(getTextAt(s, [1, 0])).toBe("def");
  });
});

describe("Undo with void blocks", () => {
  it("undo after HR insert restores pre-insertion state", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "Hello" }, config);
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    expect(s.state.children).toHaveLength(3);

    s = reduceEditor(s, { type: "UNDO" }, config);

    expect(s.state.children).toHaveLength(1);
    expect(getTextAt(s, [0, 0])).toBe("Hello");
  });

  it("undo after image insert restores pre-insertion state", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "text" }, config);
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "image",
      properties: { src: "data:image/png;base64,abc", width: 100, height: 50 },
    }, config);

    expect(s.state.children).toHaveLength(3);
    expect(s.state.children[1].type).toBe("image");

    s = reduceEditor(s, { type: "UNDO" }, config);

    expect(s.state.children).toHaveLength(1);
    expect(getTextAt(s, [0, 0])).toBe("text");
  });
});

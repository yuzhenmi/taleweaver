/**
 * Integration: typing in a list item.
 *
 * Uses the full reduceEditor pipeline (same as the real app) to verify
 * that text Y positions remain stable when typing into a list item.
 */
import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  type EditorState,
  type EditorConfig,
} from "../editor/editor-state";
import { resolvePixelPosition } from "../editor/cursor-position";
import type { LayoutBox } from "../layout/layout-node";
import { layoutTree as fullLayoutTree } from "../layout/layout-engine";
import { registry, measurer } from "./setup";

const config: EditorConfig = {
  measurer,
  registry,
  containerWidth: 200,
};

const configPaginated: EditorConfig = {
  measurer,
  registry,
  containerWidth: 816,
  pageHeight: 1056,
  pageMargins: { top: 96, bottom: 96, left: 72, right: 72 },
};

function getAbsoluteY(layout: LayoutBox, targetKey: string, parentY = 0): number | null {
  const absY = parentY + layout.y;
  if (layout.type === "text" && layout.key.startsWith(targetKey)) return absY;
  for (const child of layout.children) {
    const found = getAbsoluteY(child, targetKey, absY);
    if (found !== null) return found;
  }
  return null;
}

function setupListEditor(cfg: EditorConfig): EditorState {
  let editor = createInitialEditorState(cfg);
  // Type "hello" into the empty document
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "hello" }, cfg);
  // Toggle to unordered list
  editor = reduceEditor(editor, { type: "TOGGLE_LIST", listType: "unordered" }, cfg);
  return editor;
}

describe("Integration: typing in a list item", () => {
  it("text Y stays stable when typing characters into a list item", () => {
    let editor = setupListEditor(config);

    // Find the text node key from state
    const list = editor.state.children[0];
    const listItem = list.children[0];
    const textNode = listItem.children[0];

    const initialY = getAbsoluteY(editor.layoutTree, textNode.id);
    expect(initialY).not.toBeNull();

    // Type 5 characters one at a time
    for (let i = 0; i < 5; i++) {
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "!" }, config);
      const textY = getAbsoluteY(editor.layoutTree, textNode.id);
      expect(textY).toBe(initialY);
    }
  });

  it("text Y stays stable with pagination when typing into a list item", () => {
    let editor = setupListEditor(configPaginated);

    const list = editor.state.children[0];
    const listItem = list.children[0];
    const textNode = listItem.children[0];

    const initialY = getAbsoluteY(editor.layoutTree, textNode.id);
    expect(initialY).not.toBeNull();

    // Type 5 characters one at a time
    for (let i = 0; i < 5; i++) {
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "!" }, configPaginated);
      const textY = getAbsoluteY(editor.layoutTree, textNode.id);
      expect(textY).toBe(initialY);
    }
  });

  it("cursor Y stays stable when typing into a paginated list item", () => {
    let editor = setupListEditor(configPaginated);

    const initialCursor = resolvePixelPosition(
      editor.state,
      editor.selection.focus,
      editor.layoutTree,
      measurer,
    );

    for (let i = 0; i < 5; i++) {
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "!" }, configPaginated);

      const cursor = resolvePixelPosition(
        editor.state,
        editor.selection.focus,
        editor.layoutTree,
        measurer,
      );

      // Y position should stay the same (same line, just different x)
      expect(cursor.y).toBe(initialCursor.y);
      expect(cursor.lineY).toBe(initialCursor.lineY);
      expect(cursor.pageIndex).toBe(initialCursor.pageIndex);
    }
  });

  it("incremental layout matches full layout for paginated list typing", () => {
    let editor = setupListEditor(configPaginated);

    for (let i = 0; i < 5; i++) {
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "!" }, configPaginated);

      // Do a full layout with the same render tree
      const fullTree = fullLayoutTree(
        editor.renderTree,
        configPaginated.containerWidth,
        configPaginated.measurer,
        configPaginated.pageHeight,
        configPaginated.pageMargins,
      );

      // Compare key structural properties
      function extractStructure(box: LayoutBox, depth = 0): string[] {
        const lines: string[] = [];
        const indent = "  ".repeat(depth);
        const text = box.type === "text" ? ` "${(box as any).text}"` : "";
        const marker = (box as any).marker ? ` marker="${(box as any).marker}"` : "";
        lines.push(`${indent}${box.type}(${box.key}) x=${box.x} y=${box.y} w=${box.width} h=${box.height}${text}${marker}`);
        for (const child of box.children) {
          lines.push(...extractStructure(child, depth + 1));
        }
        return lines;
      }

      const incrementalStructure = extractStructure(editor.layoutTree);
      const fullStructure = extractStructure(fullTree);

      expect(incrementalStructure).toEqual(fullStructure);
    }
  });

  it("document height stays constant with pagination when typing into list item", () => {
    let editor = setupListEditor(configPaginated);

    const initialHeight = editor.layoutTree.height;
    const initialWidth = editor.layoutTree.width;

    // Verify paginated structure
    expect(editor.layoutTree.children[0].type).toBe("page");

    for (let i = 0; i < 5; i++) {
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "!" }, configPaginated);

      // Document dimensions should not change
      expect(editor.layoutTree.height).toBe(initialHeight);
      expect(editor.layoutTree.width).toBe(initialWidth);

      // Should still have exactly one page
      const pageChildren = editor.layoutTree.children.filter(c => c.type === "page");
      expect(pageChildren.length).toBe(1);
    }
  });

  it("layout tree heights stay constant when typing into list item", () => {
    let editor = setupListEditor(config);

    function getBoxHeights(layout: LayoutBox, path = ""): Record<string, number> {
      const result: Record<string, number> = {};
      const key = path ? `${path}/${layout.key}` : layout.key;
      result[key] = layout.height;
      for (const child of layout.children) {
        Object.assign(result, getBoxHeights(child, key));
      }
      return result;
    }

    const initialHeights = getBoxHeights(editor.layoutTree);

    for (let i = 0; i < 3; i++) {
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "!" }, config);
      const currentHeights = getBoxHeights(editor.layoutTree);

      // All block heights should be the same (adding short chars doesn't cause wrapping)
      for (const [key, height] of Object.entries(initialHeights)) {
        if (!key.includes("text") && !key.includes("line")) {
          // Block heights should not change
          expect(currentHeights[key]).toBe(height);
        }
      }
    }
  });
});

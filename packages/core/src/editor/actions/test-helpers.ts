/**
 * Test-only fixtures shared by `actions/*.test.ts`. Editor states are built from the new pipeline
 * (createEmptyDocument → render → layout). Tests assert against
 * `editor.document` (new Document + getBlock) rather than the legacy
 * `editor.stateLegacy`.
 */
import { createMockShaper } from "../../layout/mock-shaper";
import { createDefaultComponentRegistry } from "../../components/component-registry";
import { createDefaultAttrRegistry } from "../../cascade/attr-registry";
import { getBlock, createPosition, createSpan, inlineContentLength } from "../../state";
import { topLevelBlockIds } from "../../state/block-traversal";
import type { Document, BlockId, Selection } from "../../state";
import { createEditor, type Editor } from "../editor";
import { type EditorConfig } from "../editor-config";

export const measurer = createMockShaper(8, 16);
export const componentRegistry = createDefaultComponentRegistry();
export const attrRegistry = createDefaultAttrRegistry();
// Phase 0b: `measurer` left core's `EditorConfig` (geometry-only) for the print
// backend's `LayoutConfig`. It is still EXPORTED here because some tests build a
// layoutTree directly via core's `layoutTree(...)`/`render`+`cascadePass` to
// assert geometry. The reducer config no longer carries it.
export const config: EditorConfig = {
  componentRegistry,
  attrRegistry,
  containerWidth: 200,
};

/** Get plain text of a block (concatenation of its text-item runs). */
export function getTextOf(document: Document, blockId: BlockId): string {
  const block = getBlock(document, blockId);
  if (block === null || block.inlineContent === null) return "";
  return block.inlineContent.items
    .map((it) => (it.kind === "text" ? it.text : ""))
    .join("");
}

/** Build an editor with the given text typed in, cursor at end. */
export function stateWithText(text: string): Editor {
  const editor = createEditor(config);
  editor.dispatch({ type: "INSERT_TEXT", text });
  return editor;
}

/** Build an editor with two paragraphs: "abc" and "def". */
export function stateWithTwoParagraphs(): Editor {
  const editor = createEditor(config);
  editor.dispatch({ type: "INSERT_TEXT", text: "abc" });
  editor.dispatch({ type: "SPLIT_NODE" });
  editor.dispatch({ type: "INSERT_TEXT", text: "def" });
  return editor;
}

/** Set a specific selection on `editor` (in place; returns it). */
export function withSelection(editor: Editor, sel: Selection): Editor {
  editor.dispatch({ type: "SET_SELECTION", selection: sel });
  return editor;
}

/** Type individual characters one at a time (in place; returns `editor`). */
export function typeChars(editor: Editor, chars: string): Editor {
  for (const ch of chars) editor.dispatch({ type: "INSERT_TEXT", text: ch });
  return editor;
}

/**
 * The first top-level body block (the root's children are sections,
 * so this is the first section's first child).
 */
export function firstChildId(document: Document): BlockId | null {
  return topLevelBlockIds(document)[0] ?? null;
}

/** The top-level body blocks in document order (every section's children). */
export function bodyBlockIds(document: Document): BlockId[] {
  return topLevelBlockIds(document);
}

/** Block content length helper for cursor-end positions. */
export function blockEnd(document: Document, blockId: BlockId): number {
  const block = getBlock(document, blockId);
  if (block === null || block.inlineContent === null) return 0;
  return inlineContentLength(block.inlineContent);
}

// Re-exports tests commonly need.
export { createEditor, type Editor } from "../editor";
export { type EditorConfig } from "../editor-config";
export { createPosition, createSpan };
export type { Selection } from "../../state";

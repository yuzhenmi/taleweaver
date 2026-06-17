/**
 * Test-only fixtures shared by `actions/*.test.ts`. Re-rewritten for the
 * P11-cutover: editor states are built from the new pipeline
 * (createEmptyDocument → render → layout). Tests assert against
 * `editor.state` (new State + getBlock) rather than the legacy
 * `editor.stateLegacy`.
 */
import { createMockShaper } from "../../layout/mock-shaper";
import { createDefaultComponentRegistry } from "../../components/component-registry";
import { createDefaultAttrRegistry } from "../../cascade/attr-registry";
import { getBlock, createPosition, createSpan, inlineContentLength } from "../../state";
import type { State, BlockId, Selection } from "../../state";
import {
  createInitialEditorState,
  reduceEditor,
  type EditorConfig,
  type EditorState,
} from "../editor-state";

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
export function getTextOf(state: State, blockId: BlockId): string {
  const block = getBlock(state, blockId);
  if (block === null || block.inlineContent === null) return "";
  return block.inlineContent.items
    .map((it) => (it.kind === "text" ? it.text : ""))
    .join("");
}

/** Build an editor with the given text typed in, cursor at end. */
export function stateWithText(text: string): EditorState {
  let s = createInitialEditorState(config);
  s = reduceEditor(s, { type: "INSERT_TEXT", text }, config);
  return s;
}

/** Build an editor with two paragraphs: "abc" and "def". */
export function stateWithTwoParagraphs(): EditorState {
  let s = createInitialEditorState(config);
  s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
  s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
  s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, config);
  return s;
}

/** Set a specific selection on an editor state. */
export function withSelection(s: EditorState, sel: Selection): EditorState {
  return reduceEditor(s, { type: "SET_SELECTION", selection: sel }, config);
}

/** Type individual characters one at a time. */
export function typeChars(state: EditorState, chars: string): EditorState {
  let s = state;
  for (const ch of chars) {
    s = reduceEditor(s, { type: "INSERT_TEXT", text: ch }, config);
  }
  return s;
}

/** Get the first block id under the document root. */
export function firstChildId(state: State): BlockId | null {
  const root = getBlock(state, state.rootId);
  return root === null ? null : root.firstChildId;
}

/** Block content length helper for cursor-end positions. */
export function blockEnd(state: State, blockId: BlockId): number {
  const block = getBlock(state, blockId);
  if (block === null || block.inlineContent === null) return 0;
  return inlineContentLength(block.inlineContent);
}

// Re-exports tests commonly need.
export {
  createInitialEditorState,
  reduceEditor,
  type EditorConfig,
  type EditorState,
} from "../editor-state";
export { createPosition, createSpan };
export type { Selection } from "../../state";

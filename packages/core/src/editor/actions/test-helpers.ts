import {
  createMockMeasurer,
  createRegistry,
  defaultComponents,
  getNodeByPath,
  getTextContent,
  createPosition,
  createSelection,
  createCursor,
} from "@taleweaver/core";
import {
  createInitialEditorState,
  reduceEditor,
  type EditorConfig,
  type EditorState,
} from "../editor-state";

export const measurer = createMockMeasurer(8, 16);
export const registry = createRegistry([...defaultComponents]);
export const config: EditorConfig = { measurer, registry, containerWidth: 200 };

export function getTextAt(
  state: EditorState,
  path: readonly number[],
): string {
  const node = getNodeByPath(state.state, path);
  return node ? getTextContent(node) : "";
}

/** Build an editor state with the given text typed in, cursor at end. */
export function stateWithText(text: string): EditorState {
  let s = createInitialEditorState(config);
  s = reduceEditor(s, { type: "INSERT_TEXT", text }, config);
  return s;
}

/** Build an editor state with two paragraphs: "abc" and "def". */
export function stateWithTwoParagraphs(): EditorState {
  let s = createInitialEditorState(config);
  s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
  s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
  s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, config);
  return s;
}

/** Set a specific selection on an editor state. */
export function withSelection(
  s: EditorState,
  sel: ReturnType<typeof createSelection>,
): EditorState {
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

// Re-export things tests commonly need
export {
  createInitialEditorState,
  reduceEditor,
  type EditorConfig,
  type EditorState,
} from "../editor-state";
export {
  createPosition,
  createSelection,
  createCursor,
  isCollapsed,
  getTextContent,
  getTextContentLength,
} from "@taleweaver/core";

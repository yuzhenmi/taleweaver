import {
  isCollapsed,
  getStyleInRange,
  getNodeByPath,
  type StateNode,
} from "@taleweaver/core";
import type { EditorState } from "@taleweaver/dom";

export interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  blockType: string;
  headingLevel: number | null;
  canUndo: boolean;
  canRedo: boolean;
}

/** Check if a single text node (or its span ancestors) has the given style property */
function hasStyleAtNode(
  state: StateNode,
  path: readonly number[],
  property: "fontWeight" | "fontStyle" | "textDecoration",
): boolean {
  // Walk from root down to the text node, checking span ancestors
  let node = state;
  for (let i = 0; i < path.length; i++) {
    if (node.type === "span" && node.styles[property] !== undefined) {
      return true;
    }
    const child = node.children[path[i]];
    if (!child) return false;
    node = child;
  }
  // Check the node itself
  if (node.type === "span" && node.styles[property] !== undefined) {
    return true;
  }
  return false;
}

export function getFormatState(editorState: EditorState): FormatState {
  const { state, selection, history } = editorState;

  // Block type from focus position
  const focusPath = selection.focus.path;
  let blockType = "paragraph";
  let headingLevel: number | null = null;
  if (focusPath.length > 0) {
    const block = state.children[focusPath[0]];
    if (block) {
      blockType = block.type;
      if (block.type === "heading" && typeof block.properties.level === "number") {
        headingLevel = block.properties.level;
      }
    }
  }

  // Inline formatting
  let bold = false;
  let italic = false;
  let underline = false;

  if (isCollapsed(selection)) {
    // Collapsed: check style at cursor position
    bold = hasStyleAtNode(state, focusPath, "fontWeight");
    italic = hasStyleAtNode(state, focusPath, "fontStyle");
    underline = hasStyleAtNode(state, focusPath, "textDecoration");
  } else {
    // Expanded: use getStyleInRange
    bold = getStyleInRange(state, selection, "fontWeight") !== undefined;
    italic = getStyleInRange(state, selection, "fontStyle") !== undefined;
    underline = getStyleInRange(state, selection, "textDecoration") !== undefined;
  }

  return {
    bold,
    italic,
    underline,
    blockType,
    headingLevel,
    canUndo: history.undoStack.length > 0,
    canRedo: history.redoStack.length > 0,
  };
}

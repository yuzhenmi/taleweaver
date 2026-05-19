import {
  isCollapsed,
  getStyleInRange,
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
    if (node.type === "span" && node.style[property] !== undefined) {
      return true;
    }
    const child = node.children[path[i]];
    if (!child) return false;
    node = child;
  }
  // Check the node itself
  if (node.type === "span" && node.style[property] !== undefined) {
    return true;
  }
  return false;
}

export function getFormatState(editorState: EditorState): FormatState {
  // P11.0+ parallel window: example app still reads from the legacy
  // representation (stateLegacy, historyLegacy). Cutover at P11.4 will
  // flip these to the new state / History wrapper APIs.
  const { stateLegacy, selection, historyLegacy } = editorState;

  // Block type from focus position
  const focusPath = selection.focus.path;
  let blockType = "paragraph";
  let headingLevel: number | null = null;
  if (focusPath.length > 0) {
    const block = stateLegacy.children[focusPath[0]];
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
    bold = hasStyleAtNode(stateLegacy, focusPath, "fontWeight");
    italic = hasStyleAtNode(stateLegacy, focusPath, "fontStyle");
    underline = hasStyleAtNode(stateLegacy, focusPath, "textDecoration");
  } else {
    // Expanded: use getStyleInRange
    bold = getStyleInRange(stateLegacy, selection, "fontWeight") !== undefined;
    italic = getStyleInRange(stateLegacy, selection, "fontStyle") !== undefined;
    underline = getStyleInRange(stateLegacy, selection, "textDecoration") !== undefined;
  }

  return {
    bold,
    italic,
    underline,
    blockType,
    headingLevel,
    canUndo: historyLegacy.undoStack.length > 0,
    canRedo: historyLegacy.redoStack.length > 0,
  };
}

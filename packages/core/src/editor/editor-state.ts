import type { StateNode } from "../state/state-node";
import type { Selection } from "../cursor/selection";
import type { Change } from "../state/change";
import type { TextMeasurer } from "../layout/text-measurer";
import type { RenderNode } from "../render/render-node";
import type { LayoutBox } from "../layout/layout-node";
import type { PageMargins } from "../layout/layout-engine";
import {
  createEmptyDocument,
} from "../state/initial-state";
import {
  createCursor,
} from "../cursor/selection";
import { renderTree } from "../render/render";
import { layoutTree } from "../layout/layout-engine";
import { ComponentRegistry } from "../components";
import type { EditorAction } from "./editor-action";
import {
  handleInsertText,
  handleDeleteBackward,
  handleDeleteForward,
  handleDeleteWord,
  handleDeleteLine,
  handleSplitNode,
  handleMoveCursor,
  handleMoveWord,
  handleMoveLine,
  handleMoveLineBoundary,
  handleMoveDocumentBoundary,
  handleExpandSelection,
  handleExpandWord,
  handleExpandLine,
  handleExpandLineBoundary,
  handleExpandDocumentBoundary,
  handleSelectAll,
  handleSetSelection,
  handleSetContainerWidth,
  handleSetBlockType,
  handleToggleList,
  handleToggleStyle,
  handleUndo,
  handleRedo,
  handlePaste,
  handleInsertBlock,
  handleInsertTable,
} from "./actions";

// Re-export helpers that are part of the public API
export { findFirstTextDescendant, findLastTextDescendant } from "./actions";

// --- EditorHistory (selection-aware wrapper around core changes) ---

const MAX_HISTORY_DEPTH = 500;
const MERGE_THRESHOLD_MS = 500;

export interface EditorHistoryEntry {
  change: Change;
  selectionBefore: Selection;
  selectionAfter: Selection;
}

export interface EditorHistory {
  undoStack: readonly EditorHistoryEntry[];
  redoStack: readonly EditorHistoryEntry[];
  /** Timestamp of last mergeable edit (0 = none / chain broken). */
  lastEditTimestamp: number;
  /** Tag identifying the kind of mergeable edit (e.g. "insert", "delete"). */
  lastEditTag: string;
}

function createEditorHistory(): EditorHistory {
  return { undoStack: [], redoStack: [], lastEditTimestamp: 0, lastEditTag: "" };
}

/**
 * Push a history entry. When `mergeTag` is provided (non-empty), the entry
 * is merged with the previous one if the timestamps are within the threshold
 * and the tag matches. This groups rapid keystrokes into a single undo step.
 */
export function pushEditorChange(
  history: EditorHistory,
  entry: EditorHistoryEntry,
  mergeTag = "",
): EditorHistory {
  const now = entry.change.timestamp;

  const shouldMerge =
    mergeTag !== "" &&
    mergeTag === history.lastEditTag &&
    history.lastEditTimestamp > 0 &&
    now - history.lastEditTimestamp <= MERGE_THRESHOLD_MS &&
    history.undoStack.length > 0;

  let newStack: EditorHistoryEntry[];

  if (shouldMerge) {
    const prev = history.undoStack[history.undoStack.length - 1];
    const merged: EditorHistoryEntry = {
      change: { oldState: prev.change.oldState, newState: entry.change.newState, timestamp: now },
      selectionBefore: prev.selectionBefore,
      selectionAfter: entry.selectionAfter,
    };
    newStack = [...history.undoStack.slice(0, -1), merged];
  } else {
    newStack = [...history.undoStack, entry];
  }

  // Cap stack depth
  if (newStack.length > MAX_HISTORY_DEPTH) {
    newStack = newStack.slice(newStack.length - MAX_HISTORY_DEPTH);
  }

  return {
    undoStack: newStack,
    redoStack: [],
    lastEditTimestamp: mergeTag !== "" ? now : 0,
    lastEditTag: mergeTag,
  };
}

// --- EditorState ---

export interface EditorState {
  state: StateNode;
  selection: Selection;
  history: EditorHistory;
  renderTree: RenderNode;
  layoutTree: LayoutBox;
  containerWidth: number;
  nextId: number;
  targetX: number | null;
}

export interface EditorConfig {
  measurer: TextMeasurer;
  registry: ComponentRegistry;
  containerWidth: number;
  pageHeight?: number;
  pageMargins?: PageMargins;
}

export function createInitialEditorState(config: EditorConfig): EditorState {
  const state = createEmptyDocument();
  const selection = createCursor([0, 0], 0);
  const render = renderTree(state, config.registry);
  const layout = layoutTree(render, config.containerWidth, config.measurer, config.pageHeight, config.pageMargins);

  return {
    state,
    selection,
    history: createEditorHistory(),
    renderTree: render,
    layoutTree: layout,
    containerWidth: config.containerWidth,
    nextId: 1,
    targetX: null,
  };
}

/** Pure reducer: applies an action to EditorState and returns new state. */
export function reduceEditor(
  editor: EditorState,
  action: EditorAction,
  config: EditorConfig,
): EditorState {
  // Vertical actions preserve targetX; all others clear it
  const isVertical = action.type === "MOVE_LINE" || action.type === "EXPAND_LINE";

  let result: EditorState;
  switch (action.type) {
    case "INSERT_TEXT":
      result = handleInsertText(editor, action.text, config);
      break;
    case "DELETE_BACKWARD":
      result = handleDeleteBackward(editor, config);
      break;
    case "DELETE_FORWARD":
      result = handleDeleteForward(editor, config);
      break;
    case "SPLIT_NODE":
      result = handleSplitNode(editor, config);
      break;
    case "MOVE_CURSOR":
      result = handleMoveCursor(editor, action.direction);
      break;
    case "MOVE_WORD":
      result = handleMoveWord(editor, action.direction);
      break;
    case "UNDO":
      result = handleUndo(editor, config);
      break;
    case "REDO":
      result = handleRedo(editor, config);
      break;
    case "SET_CONTAINER_WIDTH":
      result = handleSetContainerWidth(editor, action.width, config);
      break;
    case "SET_SELECTION":
      result = handleSetSelection(editor, action.selection);
      break;
    case "EXPAND_SELECTION":
      result = handleExpandSelection(editor, action.direction);
      break;
    case "EXPAND_WORD":
      result = handleExpandWord(editor, action.direction);
      break;
    case "MOVE_LINE":
      result = handleMoveLine(editor, action.direction, config);
      break;
    case "EXPAND_LINE":
      result = handleExpandLine(editor, action.direction, config);
      break;
    case "TOGGLE_STYLE":
      result = handleToggleStyle(editor, action.style, config);
      break;
    case "PASTE":
      result = handlePaste(editor, action.text, config);
      break;
    case "SET_BLOCK_TYPE":
      result = handleSetBlockType(editor, action.blockType, action.properties ?? {}, config);
      break;
    case "TOGGLE_LIST":
      result = handleToggleList(editor, action.listType, config);
      break;
    case "MOVE_LINE_BOUNDARY":
      result = handleMoveLineBoundary(editor, action.boundary, config);
      break;
    case "EXPAND_LINE_BOUNDARY":
      result = handleExpandLineBoundary(editor, action.boundary, config);
      break;
    case "MOVE_DOCUMENT_BOUNDARY":
      result = handleMoveDocumentBoundary(editor, action.boundary);
      break;
    case "EXPAND_DOCUMENT_BOUNDARY":
      result = handleExpandDocumentBoundary(editor, action.boundary);
      break;
    case "SELECT_ALL":
      result = handleSelectAll(editor);
      break;
    case "DELETE_WORD":
      result = handleDeleteWord(editor, action.direction, config);
      break;
    case "DELETE_LINE":
      result = handleDeleteLine(editor, config);
      break;
    case "INSERT_BLOCK":
      result = handleInsertBlock(editor, action.blockType, action.properties ?? {}, config);
      break;
    case "INSERT_TABLE":
      result = handleInsertTable(editor, action.rows, action.columns, action.columnWidths, config);
      break;
    default: {
      const _exhaustive: never = action;
      result = editor;
      break;
    }
  }

  if (!isVertical && result.targetX !== null) {
    result = { ...result, targetX: null };
  }

  return result;
}

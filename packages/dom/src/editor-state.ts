import type {
  StateNode,
  Selection,
  Change,
  TextMeasurer,
  RenderNode,
  LayoutBox,
  Position,
} from "@taleweaver/core";
import {
  createEmptyDocument,
  createCursor,
  createSelection,
  createPosition,
  createSpan,
  comparePositions,
  normalizeSpan,
  isCollapsed,
  selectionStart,
  selectionEnd,
  insertText,
  deleteRange,
  replaceRange,
  splitNode,
  moveByCharacter,
  moveByWord,
  expandSelection,
  applyInlineStyle,
  removeInlineStyle,
  isFullyStyled,
  createNode,
  createTextNode,
  getNodeByPath,
  updateAtPath,
  insertChild,
  removeChild,
  getTextContent,
  getTextContentLength,
  renderTree,
  renderTreeIncremental,
  layoutTree,
  layoutTreeIncremental,
  ComponentRegistry,
} from "@taleweaver/core";
import type { EditorAction } from "./key-handler";
import { moveToLine, moveToLineBoundary } from "./line-navigation";

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
function pushEditorChange(
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
}

export function createInitialEditorState(config: EditorConfig): EditorState {
  const state = createEmptyDocument();
  const selection = createCursor([0, 0], 0);
  const render = renderTree(state, config.registry);
  const layout = layoutTree(render, config.containerWidth, config.measurer);

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

// --- Tree traversal helpers ---

/** Find the last text node descendant of a node at the given base path. */
export function findLastTextDescendant(
  node: StateNode,
  basePath: number[],
): { path: number[]; node: StateNode } | null {
  if (node.type === "text") return { path: basePath, node };
  for (let i = node.children.length - 1; i >= 0; i--) {
    const result = findLastTextDescendant(node.children[i], [...basePath, i]);
    if (result) return result;
  }
  return null;
}

/** Find the first text node descendant of a node at the given base path. */
export function findFirstTextDescendant(
  node: StateNode,
  basePath: number[],
): { path: number[]; node: StateNode } | null {
  if (node.type === "text") return { path: basePath, node };
  for (let i = 0; i < node.children.length; i++) {
    const result = findFirstTextDescendant(node.children[i], [...basePath, i]);
    if (result) return result;
  }
  return null;
}

// --- Action handlers ---

function handleInsertText(
  editor: EditorState,
  text: string,
  config: EditorConfig,
): EditorState {
  // If selection is expanded, replace the selected range
  if (!isCollapsed(editor.selection)) {
    const normalized = normalizeSpan(editor.selection);
    const change = replaceRange(editor.state, normalized, text);
    const newPos = createPosition(
      normalized.anchor.path,
      normalized.anchor.offset + text.length,
    );
    const newSelection = createCursor(newPos.path, newPos.offset);

    return rebuildTrees(
      {
        ...editor,
        state: change.newState,
        selection: newSelection,
        history: pushEditorChange(editor.history, {
          change,
          selectionBefore: editor.selection,
          selectionAfter: newSelection,
        }),
      },
      editor,
      config,
    );
  }

  const pos = editor.selection.focus;
  const change = insertText(editor.state, pos, text);
  const newPos = createPosition(pos.path, pos.offset + text.length);
  const newSelection = createCursor(newPos.path, newPos.offset);

  return rebuildTrees(
    {
      ...editor,
      state: change.newState,
      selection: newSelection,
      history: pushEditorChange(editor.history, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }, "insert"),
    },
    editor,
    config,
  );
}

function deleteSelectionRange(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const normalized = normalizeSpan(editor.selection);
  const change = deleteRange(editor.state, normalized);
  const newSelection = createCursor(
    normalized.anchor.path,
    normalized.anchor.offset,
  );

  return rebuildTrees(
    {
      ...editor,
      state: change.newState,
      selection: newSelection,
      history: pushEditorChange(editor.history, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }),
    },
    editor,
    config,
  );
}

function handleDeleteBackward(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  // If selection is expanded, delete the range
  if (!isCollapsed(editor.selection)) {
    return deleteSelectionRange(editor, config);
  }

  const pos = editor.selection.focus;

  // At very start of document — nothing to delete
  if (pos.path.every((v) => v === 0) && pos.offset === 0) {
    return editor;
  }

  if (pos.offset > 0) {
    // Delete within the same text node
    const prevSel = moveByCharacter(editor.state, pos, "backward");
    const deleteSpan = createSpan(prevSel.focus, pos);
    const change = deleteRange(editor.state, deleteSpan);
    const newSelection = createCursor(prevSel.focus.path, prevSel.focus.offset);

    return rebuildTrees(
      {
        ...editor,
        state: change.newState,
        selection: newSelection,
        history: pushEditorChange(editor.history, {
          change,
          selectionBefore: editor.selection,
          selectionAfter: newSelection,
        }, "delete"),
      },
      editor,
      config,
    );
  }

  // At start of a text node with offset 0 — merge with previous block
  // Use moveByCharacter to find previous position, which handles all nesting
  const prevSel = moveByCharacter(editor.state, pos, "backward");
  const prevPos = prevSel.focus;

  // If we didn't move (already at document start), nothing to delete
  if (
    prevPos.path.length === pos.path.length &&
    prevPos.path.every((v, i) => v === pos.path[i]) &&
    prevPos.offset === pos.offset
  ) {
    return editor;
  }

  // Find the end of the previous text node (one char forward from where moveByCharacter landed)
  const prevTextNode = getNodeByPath(editor.state, prevPos.path);
  if (!prevTextNode) return editor;
  const prevTextEnd = createPosition(prevPos.path, getTextContentLength(prevTextNode));

  const deleteSpan = createSpan(prevTextEnd, pos);
  const change = deleteRange(editor.state, deleteSpan);
  const newSelection = createCursor(prevTextEnd.path, prevTextEnd.offset);

  return rebuildTrees(
    {
      ...editor,
      state: change.newState,
      selection: newSelection,
      history: pushEditorChange(editor.history, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }),
    },
    editor,
    config,
  );
}

function handleDeleteForward(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  // If selection is expanded, delete the range
  if (!isCollapsed(editor.selection)) {
    return deleteSelectionRange(editor, config);
  }

  const pos = editor.selection.focus;

  // Use moveByCharacter to find the next position (handles all nesting)
  const nextSel = moveByCharacter(editor.state, pos, "forward");
  const nextPos = nextSel.focus;

  // If we didn't move (at end of document), nothing to delete
  if (
    nextPos.path.length === pos.path.length &&
    nextPos.path.every((v, i) => v === pos.path[i]) &&
    nextPos.offset === pos.offset
  ) {
    return editor;
  }

  const deleteSpan = createSpan(pos, nextPos);
  const change = deleteRange(editor.state, deleteSpan);
  const newSelection = createCursor(pos.path, pos.offset);

  return rebuildTrees(
    {
      ...editor,
      state: change.newState,
      selection: newSelection,
      history: pushEditorChange(editor.history, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }, "delete"),
    },
    editor,
    config,
  );
}

function handleSplitNode(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  // If selection is expanded, delete selection first
  let current = editor;
  if (!isCollapsed(editor.selection)) {
    current = deleteSelectionRange(editor, config);
  }

  const pos = current.selection.focus;
  const paraIdx = pos.path[0];
  const block = current.state.children[paraIdx];

  // Special handling: enter on list item
  if (block.type === "list" && pos.path.length >= 3) {
    return handleSplitListItem(current, editor, config);
  }

  const nodeId = `node-${current.nextId}`;
  const change = splitNode(current.state, pos, nodeId);

  // Special handling: enter on heading → new paragraph (convert the new block)
  let newState = change.newState;
  if (block.type === "heading") {
    const newBlock = newState.children[paraIdx + 1];
    const converted = createNode(
      newBlock.id,
      "paragraph",
      {},
      newBlock.children,
    );
    newState = updateAtPath(newState, [paraIdx + 1], converted);
  }

  // Find the first text node in the new block for cursor placement
  const newBlock = newState.children[paraIdx + 1];
  const firstText = findFirstTextDescendant(newBlock, [paraIdx + 1]);
  const newSelection = firstText
    ? createCursor(firstText.path, 0)
    : createCursor([paraIdx + 1, 0], 0);

  return rebuildTrees(
    {
      ...current,
      state: newState,
      selection: newSelection,
      history: pushEditorChange(current.history, {
        change: { oldState: current.state, newState, timestamp: 0 },
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }),
      nextId: current.nextId + 1,
    },
    current,
    config,
  );
}

function handleSplitListItem(
  current: EditorState,
  originalEditor: EditorState,
  config: EditorConfig,
): EditorState {
  const pos = current.selection.focus;
  const listIdx = pos.path[0];
  const itemIdx = pos.path[1];
  const list = current.state.children[listIdx];
  const item = list.children[itemIdx];

  // Check if current list item is empty (enter on empty → exit list)
  const textNode = getNodeByPath(current.state, pos.path);
  if (textNode && getTextContentLength(textNode) === 0 && item.children.length === 1) {
    // Remove the empty item from the list
    const newListChildren = [...list.children];
    newListChildren.splice(itemIdx, 1);

    // Create a new paragraph after the list
    const newPara = createNode(
      `node-${current.nextId}-para`,
      "paragraph",
      {},
      [createTextNode(`node-${current.nextId}-text`, "")],
    );

    const docChildren = [...current.state.children];

    if (newListChildren.length === 0) {
      // Empty list — replace with paragraph
      docChildren[listIdx] = newPara;
    } else {
      // Update list and insert paragraph after
      const newList = createNode(list.id, list.type, { ...list.properties }, newListChildren);
      docChildren[listIdx] = newList;
      docChildren.splice(listIdx + 1, 0, newPara);
    }

    const newDoc = createNode(
      current.state.id,
      current.state.type,
      { ...current.state.properties },
      docChildren,
    );

    const newParaIdx = newListChildren.length === 0 ? listIdx : listIdx + 1;
    const newSelection = createCursor([newParaIdx, 0], 0);

    return rebuildTrees(
      {
        ...current,
        state: newDoc,
        selection: newSelection,
        history: pushEditorChange(current.history, {
          change: { oldState: current.state, newState: newDoc, timestamp: 0 },
          selectionBefore: originalEditor.selection,
          selectionAfter: newSelection,
        }),
        nextId: current.nextId + 1,
      },
      current,
      config,
    );
  }

  // Normal split: create a new list item
  const nodeId = `node-${current.nextId}`;

  // Split within the list item (splitDepth = 1 to split the list-item within the list)
  const change = splitNode(current.state, pos, nodeId, 1);

  // Find first text descendant in the new list item for cursor placement
  const newItem = change.newState.children[listIdx]?.children[itemIdx + 1];
  const firstText = newItem ? findFirstTextDescendant(newItem, [listIdx, itemIdx + 1]) : null;
  const newSelection = firstText
    ? createCursor(firstText.path, 0)
    : createCursor([listIdx, itemIdx + 1, 0], 0);

  return rebuildTrees(
    {
      ...current,
      state: change.newState,
      selection: newSelection,
      history: pushEditorChange(current.history, {
        change,
        selectionBefore: originalEditor.selection,
        selectionAfter: newSelection,
      }),
      nextId: current.nextId + 1,
    },
    current,
    config,
  );
}

function handleMoveCursor(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  // If selection is expanded, collapse to start/end without moving
  if (!isCollapsed(editor.selection)) {
    const pos =
      direction === "forward"
        ? selectionEnd(editor.selection)
        : selectionStart(editor.selection);
    return { ...editor, selection: createCursor(pos.path, pos.offset) };
  }

  const newSelection = moveByCharacter(
    editor.state,
    editor.selection.focus,
    direction,
  );
  return { ...editor, selection: newSelection };
}

function handleMoveWord(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  const newSelection = moveByWord(
    editor.state,
    editor.selection.focus,
    direction,
  );
  return { ...editor, selection: newSelection };
}

function handleExpandSelection(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  const newSelection = expandSelection(
    editor.state,
    editor.selection,
    direction,
  );
  return { ...editor, selection: newSelection };
}

function handleExpandWord(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  const moved = moveByWord(editor.state, editor.selection.focus, direction);
  return {
    ...editor,
    selection: createSelection(editor.selection.anchor, moved.focus),
  };
}

function handleMoveLine(
  editor: EditorState,
  direction: "up" | "down",
  config: EditorConfig,
): EditorState {
  // If selection is expanded, collapse to appropriate end then move to adjacent line
  const moveFocus = !isCollapsed(editor.selection)
    ? (direction === "up"
        ? selectionStart(editor.selection)
        : selectionEnd(editor.selection))
    : editor.selection.focus;

  const result = moveToLine(
    editor.state,
    moveFocus,
    editor.layoutTree,
    config.measurer,
    direction,
    editor.targetX,
  );
  if (!result) return editor;
  return {
    ...editor,
    selection: createCursor(result.position.path, result.position.offset),
    targetX: result.targetX,
  };
}

function handleExpandLine(
  editor: EditorState,
  direction: "up" | "down",
  config: EditorConfig,
): EditorState {
  const result = moveToLine(
    editor.state,
    editor.selection.focus,
    editor.layoutTree,
    config.measurer,
    direction,
    editor.targetX,
  );
  if (!result) return editor;
  return {
    ...editor,
    selection: createSelection(
      editor.selection.anchor,
      createPosition(result.position.path, result.position.offset),
    ),
    targetX: result.targetX,
  };
}

function handlePaste(
  editor: EditorState,
  text: string,
  config: EditorConfig,
): EditorState {
  if (text.length === 0) return editor;

  // If selection expanded, delete it first
  let current = editor;
  if (!isCollapsed(editor.selection)) {
    current = deleteSelectionRange(editor, config);
  }

  // Save the original state for a single undo entry (before any deletion)
  const stateBeforePaste = editor.state;
  const selectionBeforePaste = editor.selection;

  const lines = text.split("\n");

  // Insert first line as text
  let result = handleInsertText(current, lines[0], config);

  // For subsequent lines, split then insert
  for (let i = 1; i < lines.length; i++) {
    result = handleSplitNode(result, config);
    if (lines[i].length > 0) {
      result = handleInsertText(result, lines[i], config);
    }
  }

  // Replace all intermediate history entries with a single grouped entry
  const pasteEntry: EditorHistoryEntry = {
    change: { oldState: stateBeforePaste, newState: result.state, timestamp: 0 },
    selectionBefore: selectionBeforePaste,
    selectionAfter: result.selection,
  };

  return {
    ...result,
    history: pushEditorChange(editor.history, pasteEntry),
  };
}

function handleSetBlockType(
  editor: EditorState,
  blockType: string,
  properties: Record<string, unknown>,
  config: EditorConfig,
): EditorState {
  const pos = editor.selection.focus;
  const paraIdx = pos.path[0];
  const para = editor.state.children[paraIdx];
  if (!para) return editor;

  // If already this type, convert back to paragraph
  const newType = para.type === blockType ? "paragraph" : blockType;
  const newProps = para.type === blockType ? {} : properties;

  const newPara = createNode(
    para.id,
    newType,
    { ...newProps },
    para.children,
  );
  const newState = updateAtPath(editor.state, [paraIdx], newPara);
  const change = { oldState: editor.state, newState, timestamp: 0 };

  return rebuildTrees(
    {
      ...editor,
      state: newState,
      history: pushEditorChange(editor.history, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: editor.selection,
      }),
    },
    editor,
    config,
  );
}

function handleToggleList(
  editor: EditorState,
  listType: "ordered" | "unordered",
  config: EditorConfig,
): EditorState {
  const pos = editor.selection.focus;
  const paraIdx = pos.path[0];
  const currentBlock = editor.state.children[paraIdx];
  if (!currentBlock) return editor;

  // If already in a list, unwrap
  if (currentBlock.type === "list") {
    // Extract list items as paragraphs
    const newChildren = [...editor.state.children];
    const listItems = currentBlock.children;
    const paragraphs: StateNode[] = [];

    for (const item of listItems) {
      const para = createNode(
        item.id,
        "paragraph",
        {},
        item.children,
      );
      paragraphs.push(para);
    }

    newChildren.splice(paraIdx, 1, ...paragraphs);
    const newDoc = createNode(
      editor.state.id,
      editor.state.type,
      { ...editor.state.properties },
      newChildren,
    );
    const change = { oldState: editor.state, newState: newDoc, timestamp: 0 };

    // Adjust selection path — cursor was at [paraIdx, itemIdx, textIdx...], now [paraIdx + itemIdx, textIdx...]
    const itemIdx = pos.path[1] ?? 0;
    const newSelection = createCursor([paraIdx + itemIdx, ...pos.path.slice(2)], pos.offset);

    return rebuildTrees(
      {
        ...editor,
        state: newDoc,
        selection: newSelection,
        history: pushEditorChange(editor.history, {
          change,
          selectionBefore: editor.selection,
          selectionAfter: newSelection,
        }),
      },
      editor,
      config,
    );
  }

  // Wrap current paragraph in a list
  const listItem = createNode(
    `li-${editor.nextId}`,
    "list-item",
    {},
    currentBlock.children,
  );
  const list = createNode(
    `list-${editor.nextId}`,
    "list",
    { listType },
    [listItem],
  );

  const newChildren = [...editor.state.children];
  newChildren[paraIdx] = list;
  const newDoc = createNode(
    editor.state.id,
    editor.state.type,
    { ...editor.state.properties },
    newChildren,
  );
  const change = { oldState: editor.state, newState: newDoc, timestamp: 0 };

  // Selection path changes: [paraIdx, textIdx] → [paraIdx, 0, textIdx]
  const textPathRest = pos.path.slice(1);
  const newSelection = createCursor([paraIdx, 0, ...textPathRest], pos.offset);

  return rebuildTrees(
    {
      ...editor,
      state: newDoc,
      selection: newSelection,
      history: pushEditorChange(editor.history, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }),
      nextId: editor.nextId + 1,
    },
    editor,
    config,
  );
}

const STYLE_MAP: Record<string, "fontWeight" | "fontStyle" | "textDecoration"> = {
  bold: "fontWeight",
  italic: "fontStyle",
  underline: "textDecoration",
};

function handleToggleStyle(
  editor: EditorState,
  style: "bold" | "italic" | "underline",
  config: EditorConfig,
): EditorState {
  if (isCollapsed(editor.selection)) return editor;

  const property = STYLE_MAP[style];
  const idBase = `style-${editor.nextId}`;
  const fullyStyled = isFullyStyled(editor.state, editor.selection, property);

  const change = fullyStyled
    ? removeInlineStyle(editor.state, editor.selection, property, idBase)
    : applyInlineStyle(editor.state, editor.selection, property, idBase);

  if (change.newState === editor.state) return editor;

  return rebuildTrees(
    {
      ...editor,
      state: change.newState,
      history: pushEditorChange(editor.history, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: editor.selection,
      }),
      nextId: editor.nextId + 1,
    },
    editor,
    config,
  );
}

function handleUndo(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const { undoStack } = editor.history;
  if (undoStack.length === 0) return editor;

  const entry = undoStack[undoStack.length - 1];
  const newHistory: EditorHistory = {
    undoStack: undoStack.slice(0, -1),
    redoStack: [...editor.history.redoStack, entry],
    lastEditTimestamp: 0,
    lastEditTag: "",
  };

  return rebuildTrees(
    {
      ...editor,
      state: entry.change.oldState,
      selection: entry.selectionBefore,
      history: newHistory,
    },
    editor,
    config,
  );
}

function handleRedo(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const { redoStack } = editor.history;
  if (redoStack.length === 0) return editor;

  const entry = redoStack[redoStack.length - 1];
  const newHistory: EditorHistory = {
    undoStack: [...editor.history.undoStack, entry],
    redoStack: redoStack.slice(0, -1),
    lastEditTimestamp: 0,
    lastEditTag: "",
  };

  return rebuildTrees(
    {
      ...editor,
      state: entry.change.newState,
      selection: entry.selectionAfter,
      history: newHistory,
    },
    editor,
    config,
  );
}

function handleSetSelection(
  editor: EditorState,
  selection: Selection,
): EditorState {
  return { ...editor, selection };
}

function handleSetContainerWidth(
  editor: EditorState,
  width: number,
  config: EditorConfig,
): EditorState {
  if (width === editor.containerWidth) return editor;
  const layout = layoutTree(editor.renderTree, width, config.measurer);
  return { ...editor, containerWidth: width, layoutTree: layout };
}

function handleMoveLineBoundary(
  editor: EditorState,
  boundary: "start" | "end",
  config: EditorConfig,
): EditorState {
  const pos = moveToLineBoundary(
    editor.state,
    editor.selection.focus,
    editor.layoutTree,
    config.measurer,
    boundary,
  );
  if (!pos) return editor;
  return { ...editor, selection: createCursor(pos.path, pos.offset) };
}

function handleExpandLineBoundary(
  editor: EditorState,
  boundary: "start" | "end",
  config: EditorConfig,
): EditorState {
  const pos = moveToLineBoundary(
    editor.state,
    editor.selection.focus,
    editor.layoutTree,
    config.measurer,
    boundary,
  );
  if (!pos) return editor;
  return {
    ...editor,
    selection: createSelection(
      editor.selection.anchor,
      createPosition(pos.path, pos.offset),
    ),
  };
}

function handleMoveDocumentBoundary(
  editor: EditorState,
  boundary: "start" | "end",
): EditorState {
  if (boundary === "start") {
    const first = findFirstTextDescendant(editor.state, []);
    if (!first) return editor;
    return { ...editor, selection: createCursor(first.path, 0) };
  } else {
    const last = findLastTextDescendant(editor.state, []);
    if (!last) return editor;
    return {
      ...editor,
      selection: createCursor(last.path, getTextContentLength(last.node)),
    };
  }
}

function handleExpandDocumentBoundary(
  editor: EditorState,
  boundary: "start" | "end",
): EditorState {
  if (boundary === "start") {
    const first = findFirstTextDescendant(editor.state, []);
    if (!first) return editor;
    return {
      ...editor,
      selection: createSelection(
        editor.selection.anchor,
        createPosition(first.path, 0),
      ),
    };
  } else {
    const last = findLastTextDescendant(editor.state, []);
    if (!last) return editor;
    return {
      ...editor,
      selection: createSelection(
        editor.selection.anchor,
        createPosition(last.path, getTextContentLength(last.node)),
      ),
    };
  }
}

function handleSelectAll(editor: EditorState): EditorState {
  const first = findFirstTextDescendant(editor.state, []);
  const last = findLastTextDescendant(editor.state, []);
  if (!first || !last) return editor;
  return {
    ...editor,
    selection: createSelection(
      createPosition(first.path, 0),
      createPosition(last.path, getTextContentLength(last.node)),
    ),
  };
}

function handleDeleteWord(
  editor: EditorState,
  direction: "forward" | "backward",
  config: EditorConfig,
): EditorState {
  if (!isCollapsed(editor.selection)) {
    return deleteSelectionRange(editor, config);
  }

  const pos = editor.selection.focus;
  const target = moveByWord(editor.state, pos, direction);
  const targetPos = target.focus;

  // If we didn't move, nothing to delete
  if (
    targetPos.path.every((v, i) => v === pos.path[i]) &&
    targetPos.path.length === pos.path.length &&
    targetPos.offset === pos.offset
  ) {
    return editor;
  }

  const span =
    direction === "backward"
      ? createSpan(targetPos, pos)
      : createSpan(pos, targetPos);
  const change = deleteRange(editor.state, span);
  const newCursorPos =
    direction === "backward" ? targetPos : pos;
  const newSelection = createCursor(newCursorPos.path, newCursorPos.offset);

  return rebuildTrees(
    {
      ...editor,
      state: change.newState,
      selection: newSelection,
      history: pushEditorChange(editor.history, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }),
    },
    editor,
    config,
  );
}

function handleDeleteLine(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  if (!isCollapsed(editor.selection)) {
    return deleteSelectionRange(editor, config);
  }

  const pos = editor.selection.focus;
  const lineStart = moveToLineBoundary(
    editor.state,
    pos,
    editor.layoutTree,
    config.measurer,
    "start",
  );
  if (!lineStart) return editor;

  // If already at line start, nothing to delete
  if (
    lineStart.path.every((v, i) => v === pos.path[i]) &&
    lineStart.path.length === pos.path.length &&
    lineStart.offset === pos.offset
  ) {
    return editor;
  }

  const span = createSpan(lineStart, pos);
  const change = deleteRange(editor.state, span);
  const newSelection = createCursor(lineStart.path, lineStart.offset);

  return rebuildTrees(
    {
      ...editor,
      state: change.newState,
      selection: newSelection,
      history: pushEditorChange(editor.history, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }),
    },
    editor,
    config,
  );
}

// --- Tree rebuilding helpers ---

function rebuildTrees(
  newEditor: EditorState,
  oldEditor: EditorState,
  config: EditorConfig,
): EditorState {
  const newRender = renderTreeIncremental(
    newEditor.state,
    oldEditor.state,
    oldEditor.renderTree,
    config.registry,
  );
  const newLayout = layoutTreeIncremental(
    newRender,
    oldEditor.renderTree,
    oldEditor.layoutTree,
    newEditor.containerWidth,
    config.measurer,
  );

  return {
    ...newEditor,
    renderTree: newRender,
    layoutTree: newLayout,
  };
}

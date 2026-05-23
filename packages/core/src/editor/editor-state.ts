import { createEmptyDocument } from "../state/initial-state";
import { History, createHistory } from "../state/history";
import { type State, getBlock } from "../state/state";
import {
  createPosition,
  createSpan,
  type Selection,
} from "../state/block-position";
import { render, type RenderOutput } from "../render/render";
import { cascadePass } from "../cascade";
import { layoutTree } from "../layout/dispatch";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import type { RenderNode } from "../render/render-node";
import type { LayoutBox } from "../layout/layout-node";
import type { PageConfig } from "../layout/page-config";
import type { ComponentRegistry } from "../components/component-registry";
import type { AttrRegistry } from "../cascade/attr-registry";
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
  handleSetLink,
  handleUndo,
  handleRedo,
  handlePaste,
  handleInsertNode,
} from "./actions";

// Re-export helpers that are part of the public API.
export { findFirstContentBlock, findLastContentBlock } from "./actions";

// --- EditorState ---

export interface EditorState {
  readonly state: State;
  readonly selection: Selection;
  readonly history: History;
  /**
   * Convenience alias for `renderOutput.root`. Pre-R-D field; many
   * downstream consumers (paint, react integration) read `renderTree`
   * directly. New code should prefer `renderOutput` for full access
   * including `embedContents`.
   */
  readonly renderTree: RenderNode;
  /**
   * Full render output (root + embedContents) — needed as the `prev`
   * input to the next `renderIncremental` call so unchanged
   * RenderNodes flow through by reference.
   */
  readonly renderOutput: RenderOutput;
  /**
   * Post-cascade render tree (every node has `computedStyle`). Stored
   * to feed `cascadePassIncremental` on the next reducer cycle —
   * reusing it preserves the ref-equality chain that the incremental
   * render set up.
   */
  readonly cascadedRoot: RenderNode;
  readonly layoutTree: LayoutBox;
  readonly containerWidth: number;
  readonly targetX: number | null;
}

export interface EditorConfig {
  readonly measurer: TextShaper | TextMeasurer;
  readonly componentRegistry: ComponentRegistry;
  readonly attrRegistry: AttrRegistry;
  readonly containerWidth: number;
  readonly pageConfig?: PageConfig;
}

export function createInitialEditorState(config: EditorConfig): EditorState {
  const state = createEmptyDocument();
  const docBlock = getBlock(state, state.rootId);
  if (docBlock === null) {
    throw new Error("createInitialEditorState: root block not found");
  }
  const firstParagraphId = docBlock.firstChildId;
  if (firstParagraphId === null) {
    throw new Error(
      "createInitialEditorState: empty document has no paragraph child",
    );
  }
  const cursor = createPosition(firstParagraphId, 0);
  const selection = createSpan(cursor, cursor);

  const rendered = render(state, config.componentRegistry, config.attrRegistry);
  // Cascade explicitly so we can store the cascaded tree on
  // EditorState for the next cycle's `cascadePassIncremental`.
  const cascadedRoot = cascadePass(rendered.root);
  const layout = layoutTree(
    cascadedRoot,
    config.containerWidth,
    config.measurer,
    config.pageConfig,
  );

  return {
    state,
    selection,
    history: createHistory(state),
    renderTree: rendered.root,
    renderOutput: rendered,
    cascadedRoot,
    layoutTree: layout,
    containerWidth: config.containerWidth,
    targetX: null,
  };
}

/** Pure reducer: applies an action to EditorState and returns new state. */
export function reduceEditor(
  editor: EditorState,
  action: EditorAction,
  config: EditorConfig,
): EditorState {
  // Vertical actions preserve targetX; all others clear it.
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
    case "SET_LINK":
      result = handleSetLink(editor, action.url, config);
      break;
    case "PASTE":
      result = handlePaste(editor, action.text, config);
      break;
    case "SET_BLOCK_TYPE":
      result = handleSetBlockType(
        editor,
        action.blockType,
        action.properties ?? {},
        config,
      );
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
    case "INSERT_NODE":
      result = handleInsertNode(editor, action.node, action.position, config);
      break;
    default: {
      action satisfies never;
      result = editor;
      break;
    }
  }

  if (!isVertical && result.targetX !== null) {
    result = { ...result, targetX: null };
  }

  return result;
}

import { createEmptyDocument, History, createHistory, getBlock, createPosition, createSpan } from "../state";
import type { State, Selection, BlockId } from "../state";
import { render, type RenderOutput } from "../render/render";
import { cascadePass } from "../cascade";
import { layoutTree } from "../layout/dispatch";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import type { RenderNode, ElementBox } from "../render/render-node";
import type { LayoutBox } from "../layout/layout-node";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
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
  handleSectionBreak,
  handleToggleSectionLandscape,
  handleInsertHeaderFooter,
  handleInsertFootnote,
  handleSetTextAlign,
  handleSetFootnotePolicy,
} from "./actions";

import { cascadeTemplateContents, cascadeEmbedContents } from "./actions/helpers";

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
   * Full render output (root + embedContents + templateContents) — needed
   * as the `prev` input to the next `renderIncremental` call so unchanged
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
  /**
   * Cascaded header/footer template bodies (C.2c), keyed by the template
   * body's root BlockId — one entry per `renderOutput.templateContents`
   * entry. Each value is the body root after `cascadePass` (so it carries
   * a populated `computedStyle`, ready for slot layout). Empty for docs with
   * no header/footer bodies. Stored so the next reducer cycle can reuse an
   * unchanged body's cascaded tree by reference (the incremental path keys
   * reuse off `dirtyIds`), and threaded into the layout pass so
   * `materializePage` can lay the bodies into each page's header/footer slot
   * (T4 consumes it; T3 only makes it available).
   */
  readonly cascadedTemplateContents: ReadonlyMap<BlockId, ElementBox>;
  /**
   * Cascaded footnote-body bodies (FN-1), keyed by the embed-content body's
   * root BlockId — one entry per `renderOutput.embedContents` entry. Each value
   * is the body root after `cascadePass` (so it carries a populated
   * `computedStyle`, ready for the `resolveFootnotes` slot layout). Empty for
   * docs with no footnotes. The exact parallel to `cascadedTemplateContents`
   * (headers/footers): stored so the next reducer cycle can reuse an unchanged
   * body's cascaded tree by reference (the incremental path keys reuse off
   * `dirtyIds`). FN-1 only makes it available; the footnote layout pass
   * (`resolveFootnotes`, FN-4) consumes it.
   */
  readonly cascadedEmbedContents: ReadonlyMap<BlockId, ElementBox>;
  /**
   * The layout result. In paginated mode (the common word-processor case) this
   * is a `VirtualLayoutTree` — a `PagePlan` plus lazily-materialized
   * `PageBox`es — produced by `layoutTreeIncremental` / `layoutTree`. In
   * unpaginated mode, or for documents using features the measure pass cannot
   * reproduce (float/`clear`), it is a fully-positioned `LayoutBox`. Consumers
   * expecting a positioned tree bridge through `resolvePositionedTree`.
   */
  readonly layoutTree: LayoutBox | VirtualLayoutTree;
  readonly containerWidth: number;
  readonly targetX: number | null;
  /**
   * NON-undoable view state (#323): which page's header/footer SLOT instance the
   * caret is visually on. A header/footer body is ONE shared `templateContents`
   * subtree rendered into EVERY page's slot, so a slot caret `Position` is
   * page-AMBIGUOUS; this records the page the user is editing so caret-render
   * resolves on that page (via `getPage(hint)`, O(1)) instead of always pinning
   * to the body's first carrying page. `undefined` for a body caret /
   * single-page doc.
   *
   * Lifecycle (the OPPOSITE model from `targetX`, which is centrally cleared in
   * `reduceEditor`): set by `SET_SELECTION` (the controller passes the clicked
   * page), PRESERVED through other handlers by their `{...editor}` spread, and
   * cleared EXPLICITLY only by undo/redo (post-restore page is ambiguous) and a
   * body `SET_SELECTION` (which passes no hint). It is view state — never stored
   * in `History`, never part of `Position` / `Selection`.
   */
  readonly caretPageHint?: number;
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
  // C.2c: full-cascade every header/footer template body (no prev → full
  // cascade each). Empty for the standard empty document (no template bodies).
  const cascadedTemplateContents = cascadeTemplateContents(
    rendered,
    null,
    null,
    undefined,
  );
  // FN-1: full-cascade every footnote body (no prev → full cascade each).
  // Empty for the standard empty document (no footnotes).
  const cascadedEmbedContents = cascadeEmbedContents(
    rendered,
    null,
    null,
    undefined,
  );
  // FN-4.0: ordered footnote anchors over the main document, threaded into the
  // initial full build for the footnote layout pass (FN-4.2 `resolveFootnotes`).
  // FN-8: read the anchors `render` already collected (and cached on the
  // RenderOutput) — no separate walk. The full-render path collects them once
  // (skipping the walk entirely for a footnote-free doc, the standard empty
  // document). Subsequent incremental cycles (`rebuildTrees`) read the same
  // field, which is reused across cycles when no anchor changed.
  const footnoteAnchors = rendered.footnoteAnchors;
  const layout = layoutTree(
    cascadedRoot,
    config.containerWidth,
    config.measurer,
    config.pageConfig,
    // #328 (C1): thread the cascaded header/footer bodies through the initial
    // full build so a seeded tall-header doc paginates with the GROWN insets.
    cascadedTemplateContents,
    // FN-4.0: cascaded footnote bodies + anchors, threaded for the (later)
    // footnote layout pass. Unused for layout output today.
    cascadedEmbedContents,
    footnoteAnchors,
  );

  return {
    state,
    selection,
    history: createHistory(state),
    renderTree: rendered.root,
    renderOutput: rendered,
    cascadedRoot,
    cascadedTemplateContents,
    cascadedEmbedContents,
    layoutTree: layout,
    containerWidth: config.containerWidth,
    targetX: null,
    caretPageHint: undefined,
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
      result = handleSetSelection(editor, action.selection, action.caretPageHint);
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
    case "SECTION_BREAK":
      result = handleSectionBreak(editor, config);
      break;
    case "TOGGLE_SECTION_LANDSCAPE":
      result = handleToggleSectionLandscape(editor, config);
      break;
    case "INSERT_HEADER":
      result = handleInsertHeaderFooter(editor, "header", config);
      break;
    case "INSERT_FOOTER":
      result = handleInsertHeaderFooter(editor, "footer", config);
      break;
    case "INSERT_FOOTNOTE":
      result = handleInsertFootnote(editor, config);
      break;
    case "SET_TEXT_ALIGN":
      result = handleSetTextAlign(editor, action.align, config);
      break;
    case "SET_FOOTNOTE_POLICY":
      result = handleSetFootnotePolicy(
        editor,
        { reset: action.reset, format: action.format },
        config,
      );
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

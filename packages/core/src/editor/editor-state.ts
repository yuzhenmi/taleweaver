import { createEmptyDocument, History, createHistory, getBlock, createPosition, createSpan, selectionContextOf } from "../state";
import { isDevMode } from "../state/dev-mode";
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
import type { CaretAffinity } from "../cursor/line-bidi";
import { coalesceKeyOf } from "./coalesce-key";
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
  handleSetTextColor,
  handleSetTextTransform,
  handleSetHighlight,
  handleSetFontSize,
  handleSetFontFamily,
  handleClearFormatting,
  handleUndo,
  handleRedo,
  handlePaste,
  handleInsertNode,
  handleSectionBreak,
  handleToggleSectionLandscape,
  handleInsertHeaderFooter,
  handleInsertHorizontalLine,
  handleInsertTableRow,
  handleInsertImage,
  handleSetImageSize,
  handleInsertFootnote,
  handleSetTextAlign,
  handleSetLineSpacing,
  handleIndent,
  INDENT_STEP,
  handleListIndent,
  handleSetListType,
  handleSetListRestart,
  handleSetParagraphSpacing,
  handleSetFootnotePolicy,
  handleReplaceMatch,
  handleReplaceAll,
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
  /**
   * NON-undoable view state (P4-C.2 §D): the caret ASSOCIATION (which logical
   * side a collapsed caret sticks to) at a bidi direction boundary. One logical
   * `offset` has TWO visual positions at an LTR↔RTL boundary; `"before"` draws
   * the caret at the trailing edge of the leaf ENDING at the offset, `"after"`
   * at the leading edge of the leaf STARTING at it. `undefined` / `"after"` is
   * today's LTR behavior (both sides give the same X on a uniform line, so the
   * field is inert there).
   *
   * Lifecycle (the same OPPOSITE-of-`targetX` model as `caretPageHint`): SET by
   * mouse hit-test (from the hit side) and by visual-order arrow motion at a
   * boundary flip; RESET to `undefined` by edits and non-arrow selection changes
   * so it never goes stale. It is VIEW state — never stored in `History`, never
   * part of `Position` / `Selection` / `Span`. The handler wiring (the central
   * reset + the hit-test / arrow writes) lands in P4-C.2.1+; this field + its
   * default are the shared primitive.
   */
  readonly caretAffinity?: CaretAffinity;
}

export interface EditorConfig {
  readonly measurer: TextShaper | TextMeasurer;
  readonly componentRegistry: ComponentRegistry;
  readonly attrRegistry: AttrRegistry;
  readonly containerWidth: number;
  readonly pageConfig?: PageConfig;
  /**
   * Injected clock for undo-coalescing timing (#420). Defaults to `Date.now`.
   * Tests pass a controllable counter so the pause window is deterministic.
   */
  readonly now?: () => number;
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
    caretAffinity: undefined,
  };
}

/** Pure reducer: applies an action to EditorState and returns new state. */
export function reduceEditor(
  editor: EditorState,
  action: EditorAction,
  config: EditorConfig,
): EditorState {
  // #420: undo-group coalescing. Decide the undo boundary BEFORE the operation
  // runs (with `captureTimeout: MAX`, a transaction merges into the open group
  // unless we `stopCapturing` first). Committing actions open/continue a group;
  // selection jumps and undo/redo close it; inert actions (container resize) do
  // neither. This runs before the per-action handler's no-op short-circuit (the
  // "Accepted edge" in the design): a no-op committing action still advances the
  // boundary, which is intentional — keeping the policy in one place.
  const coalesceClass = coalesceKeyOf(action);
  switch (coalesceClass) {
    case "insert":
    case "delete":
    case "command":
      editor.history.beginEntry(coalesceClass, (config.now ?? Date.now)());
      break;
    case "selection-break":
      editor.history.breakCoalescing();
      break;
    case "inert":
      break;
    default: {
      coalesceClass satisfies never;
      break;
    }
  }

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
      result = handleMoveCursor(editor, action.direction, config);
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
    case "SET_SELECTION": {
      // Engine backstop (#424): a Span must keep BOTH endpoints in the SAME
      // selection context (the main document tree, OR one footnote/embed body,
      // OR one header/footer/template body). Cross-context spans are unsupported
      // by the data model — `iterateSpan` throws on them — so storing one here is
      // a latent crash deferred to the first consumer. `SET_SELECTION` is the only
      // reducer arm that accepts an arbitrary externally-supplied span (MOVE_*/
      // EXPAND_*/SELECT_ALL are context-confined by construction), so it is the
      // chokepoint. The DOM controller already guards pointer-drag at the UX
      // layer; this is the caller-agnostic engine guard. Dev-throw (fail fast on
      // the programmer error) + production no-op (keep the prior in-context
      // selection rather than corrupt state), matching the codebase invariant
      // pattern (assertChainIntegrity / requireInTransaction). Root ids are
      // globally unique, so same-context ⇔ equal non-null `selectionContextOf`.
      const anchorCtx = selectionContextOf(editor.state, action.selection.anchor.blockId);
      const focusCtx = selectionContextOf(editor.state, action.selection.focus.blockId);
      if (anchorCtx === null || focusCtx === null || anchorCtx !== focusCtx) {
        if (isDevMode()) {
          throw new Error(
            `reduceEditor SET_SELECTION: cross-context selection rejected — anchor ` +
              `block "${action.selection.anchor.blockId}" (context "${anchorCtx}") and focus ` +
              `block "${action.selection.focus.blockId}" (context "${focusCtx}") are in ` +
              `different selection contexts; a span must stay within one context.`,
          );
        }
        result = editor; // production backstop: no-op, keep the prior in-context selection
      } else {
        result = handleSetSelection(
          editor,
          action.selection,
          action.caretPageHint,
          action.caretAffinity,
        );
      }
      break;
    }
    case "EXPAND_SELECTION":
      result = handleExpandSelection(editor, action.direction, config);
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
    case "SET_TEXT_COLOR":
      result = handleSetTextColor(editor, action.color, config);
      break;
    case "SET_TEXT_TRANSFORM":
      result = handleSetTextTransform(editor, action.value, config);
      break;
    case "SET_HIGHLIGHT":
      result = handleSetHighlight(editor, action.color, config);
      break;
    case "SET_FONT_SIZE":
      result = handleSetFontSize(editor, action.size, config);
      break;
    case "SET_FONT_FAMILY":
      result = handleSetFontFamily(editor, action.family, config);
      break;
    case "CLEAR_FORMATTING":
      result = handleClearFormatting(editor, config);
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
    case "INSERT_HORIZONTAL_LINE":
      result = handleInsertHorizontalLine(editor, config);
      break;
    case "INSERT_TABLE_ROW":
      result = handleInsertTableRow(editor, action.position, config);
      break;
    case "INSERT_IMAGE":
      result = handleInsertImage(editor, action.src, action.width, action.height, config);
      break;
    case "SET_IMAGE_SIZE":
      result = handleSetImageSize(editor, action.blockId, action.width, action.height, config);
      break;
    case "SET_TEXT_ALIGN":
      result = handleSetTextAlign(editor, action.align, config);
      break;
    case "SET_LINE_SPACING":
      result = handleSetLineSpacing(editor, action.spacing, config);
      break;
    case "INDENT":
      result = handleIndent(editor, INDENT_STEP, config);
      break;
    case "OUTDENT":
      result = handleIndent(editor, -INDENT_STEP, config);
      break;
    case "LIST_INDENT":
      result = handleListIndent(editor, 1, config);
      break;
    case "LIST_OUTDENT":
      result = handleListIndent(editor, -1, config);
      break;
    case "SET_LIST_TYPE":
      result = handleSetListType(editor, action.listType, config);
      break;
    case "SET_LIST_RESTART":
      result = handleSetListRestart(editor, action.value, config);
      break;
    case "SET_PARAGRAPH_SPACING":
      result = handleSetParagraphSpacing(editor, action.edge, action.value, config);
      break;
    case "SET_FOOTNOTE_POLICY":
      result = handleSetFootnotePolicy(
        editor,
        { reset: action.reset, format: action.format },
        config,
      );
      break;
    case "REPLACE_MATCH":
      result = handleReplaceMatch(editor, action.match, action.replacement, config);
      break;
    case "REPLACE_ALL":
      result = handleReplaceAll(editor, action.matches, action.replacement, config);
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

  // Central caret-affinity reset (P4-C.2.2b §C, mirrors the `targetX` clear
  // above). `caretAffinity` is a bidi-boundary VIEW seed; it must persist ONLY
  // across the actions that explicitly manage it, and reset to `undefined` after
  // any other action (every edit / non-managing selection change) so it never
  // goes stale. `actionManagesCaretAffinity` is the single extension point —
  // C.2.3/C.2.6 add the visual-arrow / Home-End / expand actions there.
  if (!actionManagesCaretAffinity(action) && result.caretAffinity !== undefined) {
    result = { ...result, caretAffinity: undefined };
  }

  return result;
}

/**
 * Does this action explicitly MANAGE `EditorState.caretAffinity` (set or
 * deliberately clear it), exempting it from the central reset above?
 *
 * Qualifying actions (each SETS `caretAffinity` on its result, so the central
 * reset must NOT clobber it):
 *   - `SET_SELECTION` — the DOM click seeds the hit side; a programmatic
 *     selection with no affinity passes `undefined` to clear it.
 *   - `MOVE_CURSOR` (P4-C.2.3) — visual-order ArrowLeft/Right sets the boundary
 *     affinity from `moveVisually` (the dual-caret flip side), or clears it to
 *     `undefined` on an exit / collapse.
 *   - `EXPAND_SELECTION` (P4-C.2.4) — visual-order Shift+ArrowLeft/Right extends
 *     the FOCUS via the same `moveVisually`, carrying the focus's boundary
 *     affinity (or clearing it to `undefined` on an exit / logical fallback).
 *   - `MOVE_LINE_BOUNDARY` (P4-C.2.6 §G) — Home/End set a direction-independent
 *     affinity (Home→"after", End→"before") so the LOGICAL line boundary renders
 *     at the correct visual edge of an RTL line. (Inert on uniform LTR lines.)
 *   - `EXPAND_LINE_BOUNDARY` (P4-C.2.6 §G) — Shift+Home/End move the FOCUS to a
 *     logical boundary and seed the focus affinity the same way.
 */
function actionManagesCaretAffinity(action: EditorAction): boolean {
  return (
    action.type === "SET_SELECTION" ||
    action.type === "MOVE_CURSOR" ||
    action.type === "EXPAND_SELECTION" ||
    action.type === "MOVE_LINE_BOUNDARY" ||
    action.type === "EXPAND_LINE_BOUNDARY"
  );
}

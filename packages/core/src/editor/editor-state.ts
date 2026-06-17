import { createEmptyDocument, History, createHistory, selectionContextOf, positionsEqual } from "../state";
import { isDevMode } from "../state/dev-mode";
import type { State, Selection, BlockId, PageConfig } from "../state";
import type { ComponentRegistry } from "../components/component-registry";
import type { AttrRegistry } from "../cascade/attr-registry";
import type { EditorAction } from "./editor-action";
import type { CaretAffinity } from "../cursor/selection";
import { coalesceKeyOf } from "./coalesce-key";
import {
  handleInsertText,
  handleDeleteBackward,
  handleDeleteForward,
  handleDeleteWord,
  handleDeleteRange,
  handleSplitNode,
  handleMoveWord,
  handleMoveDocumentBoundary,
  handleEscape,
  handleExpandWord,
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
  handleSetSectionColumns,
  handleInsertHeaderFooter,
  handleInsertHorizontalLine,
  handleInsertTableOfContents,
  handleInsertTable,
  handleInsertTableRow,
  handleInsertTableColumn,
  handleDeleteTableRow,
  handleDeleteTableColumn,
  handleDeleteTable,
  handleSplitCell,
  handleMergeCells,
  handleInsertImage,
  handleInsertInlineImage,
  handleSetImageSize,
  handleSetImageWrap,
  handleSetImageAlt,
  handleInsertFootnote,
  handleInsertCrossReference,
  handleInsertPageField,
  handleInsertTab,
  handleSetTabStops,
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
  handleAddComment,
  handleResolveComment,
  handleReopenComment,
  handleDeleteComment,
  handleAddReply,
  handleAcceptSuggestion,
  handleRejectSuggestion,
  handleAcceptAllSuggestions,
  handleRejectAllSuggestions,
} from "./actions";

import { initialSelectionForState } from "./actions";

// Re-export helpers that are part of the public API.
export { findFirstContentBlock, findLastContentBlock } from "./actions";

// --- EditorState ---

export interface EditorState {
  readonly state: State;
  readonly selection: Selection;
  readonly history: History;
  /**
   * What this dispatch changed (Phase 0b): the set of block ids whose own
   * attrs/content changed in the action that produced THIS state — the
   * geometry-free hand-off to the print backend's layout-driver, which consumes
   * it to rebuild the render→cascade→layout tree INCREMENTALLY (reusing unchanged
   * subtrees by reference). Core's reducer is geometry-free; it records WHAT
   * changed but never runs layout.
   *
   * `null` means "no incremental hint" — a FULL rebuild: a selection-only /
   * inert action (no document mutation), the initial build, or a container-width
   * resize. Within the reducer dispatch cycle a non-null (possibly empty) set is
   * written ONLY by `rebuildTrees`, so a mutating action's dirty ids never leak
   * forward onto a later selection-only action's state (the reducer's entry-clear
   * enforces this). The ONE writer OUTSIDE the reducer is
   * `reconcileForeignChange` (a collab peer's edit): it sets a non-null set
   * directly, which is sound because it produces a whole new `EditorState` the
   * host swaps in atomically (no in-flight dispatch can observe a stale value).
   * NON-undoable, transient view/hand-off state — never in `History`, never part
   * of `Position` / `Selection`.
   */
  readonly lastDirtyIds: ReadonlySet<BlockId> | null;
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
  /**
   * NON-undoable view state (#503): the ANCHOR's caret-boundary association at a
   * bidi direction boundary — the symmetric twin of `caretAffinity` (the FOCUS's
   * boundary side). Post-Phase-0b the print backend's NavIntent resolver seeds it
   * (on the collapse→extend transition, via the barrel-exported `seedAnchorAffinity`)
   * and threads it through the `SET_SELECTION` it dispatches; thereafter it persists
   * through continued extension. Clears on any action but `SET_SELECTION` (the same
   * central-reset model as `caretAffinity`). It is VIEW state — never stored in
   * `History`, never part of `Position` / `Selection` / `Span`.
   */
  readonly anchorAffinity?: CaretAffinity;
}

export interface EditorConfig {
  readonly componentRegistry: ComponentRegistry;
  readonly attrRegistry: AttrRegistry;
  readonly containerWidth: number;
  /**
   * Document page-setup data (size, orientation, margins, gap). DOCUMENT data,
   * NOT layout geometry (Phase 0b Resolution B): page setup round-trips with the
   * document (Google Docs File ▸ Page setup; Word per-section; .docx). The
   * geometry-free reducer reads it in `toggle-section-landscape` (the landscape
   * dimension swap consults the document's default page dimensions). The print
   * backend's `LayoutConfig` ALSO carries the SAME instance for pagination; the
   * host supplies it to both. `undefined` = an unpaginated/single-page harness.
   * (`measurer`/`hyphenator` — the genuine print-mechanics fields — left core's
   * `EditorConfig` for the backend `LayoutConfig` in this phase; `pageConfig`
   * stays because it is document data.)
   */
  readonly pageConfig?: PageConfig;
  /**
   * Injected clock for undo-coalescing timing (#420). Defaults to `Date.now`.
   * Tests pass a controllable counter so the pause window is deterministic.
   */
  readonly now?: () => number;
  /**
   * Suggesting mode (change-tracking, spec §3): when a non-null author string, every
   * mutating edit becomes a tracked SUGGESTION attributed to that author (timestamped
   * via `now`), instead of a direct edit. `null`/undefined = direct editing. The HOST
   * owns "who is suggesting" (this is configuration, not session state).
   */
  readonly suggestingAuthor?: string | null;
}

export function createInitialEditorState(config: EditorConfig): EditorState {
  const state = createEmptyDocument();
  const selection = initialSelectionForState(state);
  return createEditorStateFromState(state, selection, config);
}

/**
 * Build a fresh `EditorState` from an arbitrary `State` + initial `Selection`
 * (a fresh `History` bound to that state). `createInitialEditorState` delegates
 * here with the empty document. Primarily for tests that need a non-default seed
 * document (e.g. a table-only body) without an editor-from-state injection seam.
 *
 * Phase 0b: core is geometry-free. This builds NO render/cascade/layout trees —
 * the print backend's layout-driver owns that pipeline and rebuilds it from
 * `state` after each dispatch. `lastDirtyIds: null` signals the driver to do a
 * FULL initial build.
 *
 * `historyOrigin` is the transaction origin the editor's `History` tracks for
 * undo (default `null` = the single-editor origin). A collaborating peer passes
 * its own origin token so its `UndoManager` tracks ONLY its own edits (undo
 * isolation, E4b) — building the right History up front instead of replacing a
 * default one (which would leak the default's UndoManager listener).
 */
export function createEditorStateFromState(
  state: State,
  selection: Selection,
  config: EditorConfig,
  historyOrigin: unknown = null,
): EditorState {
  return {
    state,
    selection,
    history: createHistory(state, undefined, historyOrigin),
    lastDirtyIds: null,
    containerWidth: config.containerWidth,
    targetX: null,
    caretPageHint: undefined,
    caretAffinity: undefined,
    anchorAffinity: undefined,
  };
}

/** Pure reducer: applies an action to EditorState and returns new state. */
export function reduceEditor(
  rawEditor: EditorState,
  action: EditorAction,
  config: EditorConfig,
): EditorState {
  // Phase 0b ENTRY-CLEAR: `lastDirtyIds` is the layout-driver's per-dispatch
  // incremental hint, written ONLY by a mutating action's `rebuildTrees`. Clear
  // it at the entry of every dispatch so a prior mutating action's dirty ids
  // never leak forward onto a later selection-only / inert action (which would
  // make the driver wrongly rebuild only those blocks). A mutating handler's
  // `rebuildTrees` re-sets a fresh non-null set; everything else leaves it null.
  const editor =
    rawEditor.lastDirtyIds === null ? rawEditor : { ...rawEditor, lastDirtyIds: null };

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
    case "resolve":
      // Non-undoable suggestion accept/reject: BREAK the open group (so any
      // preceding typing commits as its own unit) WITHOUT opening a tracked one —
      // the resolve op's `SUGGESTION_RESOLVE_ORIGIN` txn fires no StackItem, so
      // `beginEntry` (the committing arm) would open a group that never fills.
      editor.history.breakCoalescing();
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
    case "MOVE_WORD":
      result = handleMoveWord(editor, action.direction, config);
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
          action.anchorAffinity,
          action.targetX,
        );
      }
      break;
    }
    case "EXPAND_WORD":
      result = handleExpandWord(editor, action.direction);
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
    case "MOVE_DOCUMENT_BOUNDARY":
      result = handleMoveDocumentBoundary(editor, action.boundary);
      break;
    case "EXPAND_DOCUMENT_BOUNDARY":
      result = handleExpandDocumentBoundary(editor, action.boundary);
      break;
    case "ESCAPE":
      // #525: pure selection move (no commit) — collapse an object selection to
      // just after the object. Not a line/vertical action and does not manage
      // bidi affinity, so it joins no targetX / caretAffinity / anchorAffinity
      // exemption list.
      result = handleEscape(editor, config);
      break;
    case "SELECT_ALL":
      result = handleSelectAll(editor);
      break;
    case "DELETE_WORD":
      result = handleDeleteWord(editor, action.direction, config);
      break;
    case "DELETE_RANGE":
      result = handleDeleteRange(editor, action.span, config);
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
    case "SET_SECTION_COLUMNS":
      result = handleSetSectionColumns(editor, action, config);
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
    case "INSERT_CROSS_REFERENCE":
      result = handleInsertCrossReference(
        editor,
        action.targetId,
        action.refMode,
        config,
        action.numberStyle,
      );
      break;
    case "INSERT_PAGE_NUMBER":
      result = handleInsertPageField(editor, "page-number", action.numberStyle, config);
      break;
    case "INSERT_PAGE_COUNT":
      result = handleInsertPageField(editor, "page-count", action.numberStyle, config);
      break;
    case "INSERT_TAB":
      result = handleInsertTab(editor, config);
      break;
    case "SET_TAB_STOPS":
      result = handleSetTabStops(editor, action.blockId, action.tabStops, config);
      break;
    case "INSERT_HORIZONTAL_LINE":
      result = handleInsertHorizontalLine(editor, config);
      break;
    case "INSERT_TABLE_OF_CONTENTS":
      result = handleInsertTableOfContents(editor, config);
      break;
    case "INSERT_TABLE":
      result = handleInsertTable(editor, action.rows, action.cols, config);
      break;
    case "INSERT_TABLE_ROW":
      result = handleInsertTableRow(editor, action.position, config);
      break;
    case "INSERT_TABLE_COLUMN":
      result = handleInsertTableColumn(editor, action.position, config);
      break;
    case "DELETE_TABLE_ROW":
      result = handleDeleteTableRow(editor, config);
      break;
    case "DELETE_TABLE_COLUMN":
      result = handleDeleteTableColumn(editor, config);
      break;
    case "DELETE_TABLE":
      result = handleDeleteTable(editor, config);
      break;
    case "SPLIT_CELL":
      result = handleSplitCell(editor, config);
      break;
    case "MERGE_CELLS":
      result = handleMergeCells(editor, config);
      break;
    case "INSERT_IMAGE":
      result = handleInsertImage(editor, action.src, action.width, action.height, config);
      break;
    case "INSERT_INLINE_IMAGE":
      result = handleInsertInlineImage(
        editor,
        action.src,
        action.width,
        action.height,
        action.alt,
        config,
      );
      break;
    case "SET_IMAGE_SIZE":
      result = handleSetImageSize(editor, action.blockId, action.width, action.height, config);
      break;
    case "SET_IMAGE_WRAP":
      result = handleSetImageWrap(editor, action.blockId, action.wrap, config);
      break;
    case "SET_IMAGE_ALT":
      result = handleSetImageAlt(editor, action.blockId, action.alt, config);
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
    case "ADD_COMMENT":
      result = handleAddComment(
        editor,
        action.id,
        action.author,
        action.body,
        action.createdAt,
        config,
      );
      break;
    case "RESOLVE_COMMENT":
      result = handleResolveComment(editor, action.id, config);
      break;
    case "REOPEN_COMMENT":
      result = handleReopenComment(editor, action.id, config);
      break;
    case "DELETE_COMMENT":
      result = handleDeleteComment(editor, action.id, config);
      break;
    case "ADD_REPLY":
      result = handleAddReply(
        editor,
        action.commentId,
        action.replyId,
        action.author,
        action.body,
        action.createdAt,
        config,
      );
      break;
    case "ACCEPT_SUGGESTION":
      result = handleAcceptSuggestion(editor, action.id, config);
      break;
    case "REJECT_SUGGESTION":
      result = handleRejectSuggestion(editor, action.id, config);
      break;
    case "ACCEPT_ALL_SUGGESTIONS":
      result = handleAcceptAllSuggestions(editor, config);
      break;
    case "REJECT_ALL_SUGGESTIONS":
      result = handleRejectAllSuggestions(editor, config);
      break;
    default: {
      action satisfies never;
      result = editor;
      break;
    }
  }

  // Central transient-view-state clear: `targetX` (line-nav sticky goal column)
  // and the bidi-boundary affinities are all resolved against a SPECIFIC
  // document/layout shape, so any action other than the one that MANAGES them
  // must reset them (else they go stale). Post-Phase-0b that managing action is
  // `SET_SELECTION` alone — the print backend's NavIntent resolver originates a
  // line-move's `targetX` + caret/anchor affinity and threads ALL THREE through
  // the `SET_SELECTION` it dispatches (a programmatic / body `SET_SELECTION`
  // passes `null`/`undefined`, deliberately clearing them). The six lifted
  // geometric-nav handlers that used to manage these no longer run in core. So
  // every non-`SET_SELECTION` action routes through `clearTransientViewState`
  // (the single home for "what's stale-on-mutation", also used by
  // `reconcileForeignChange`); the helper is allocation-guarded.
  if (action.type !== "SET_SELECTION") {
    result = clearTransientViewState(result);
  }

  return result;
}

/**
 * Reset the transient VIEW fields that go stale on any document mutation:
 * `targetX` (line-nav sticky goal column) and `caretAffinity` / `anchorAffinity`
 * (bidi-boundary seeds). Each is resolved against a specific document/layout
 * shape, so any edit invalidates it. Allocation-guarded — returns `editor`
 * unchanged when all three are already cleared.
 *
 * The SINGLE home for "what counts as stale-on-mutation view state". Every
 * producer of a post-mutation `EditorState` routes through here — the reducer
 * (after every non-`SET_SELECTION` action) and `reconcileForeignChange` (after a
 * peer's foreign edit) — so a new producer can't silently forget a field.
 */
export function clearTransientViewState(editor: EditorState): EditorState {
  if (
    editor.targetX === null &&
    editor.caretAffinity === undefined &&
    editor.anchorAffinity === undefined
  ) {
    return editor;
  }
  return {
    ...editor,
    targetX: null,
    caretAffinity: undefined,
    anchorAffinity: undefined,
  };
}

/**
 * The shared `anchorAffinity` seed/persist rule (#503) for the three focus-only
 * selection extenders — `EXPAND_SELECTION` (Shift+ArrowLeft/Right), `EXPAND_LINE`
 * (Shift+ArrowUp/Down), `EXPAND_LINE_BOUNDARY` (Shift+Home/End). Post-Phase-0b
 * these extenders live in the print backend's NavIntent resolver, which imports
 * this barrel-exported helper to compute the `anchorAffinity` it threads into the
 * `SET_SELECTION` it dispatches. They all keep the ANCHOR fixed and move only the
 * FOCUS, so the anchor's bidi-boundary side must be captured ONCE — on the
 * genuine collapse→extend transition — and then PERSIST through continued
 * extension (the central reset exempts `SET_SELECTION`, the action they dispatch).
 *
 * Contract:
 *   - On the collapse→extend transition (`isCollapsed && anchorAffinity ===
 *     undefined`) SEED from the caret's boundary side (`editor.caretAffinity`),
 *     so a selection STARTED by ANY of the three extenders renders the anchor
 *     edge on the correct visual side of a bidi boundary on the first line.
 *   - Otherwise PERSIST the existing `editor.anchorAffinity` (continued
 *     extension; a non-collapsed span; an already-seeded anchor).
 *
 * The two guards are load-bearing (see `handleExpandSelection`'s longer note):
 * `isCollapsed` gates the LTR inert-affinity latching case, and `anchorAffinity
 * === undefined` gates the bidi transient-collapse re-seed case. A fresh caret
 * always has `anchorAffinity === undefined`, so a NEW selection seeds correctly.
 * Living here keeps the rule in ONE place across the three extenders.
 */
export function seedAnchorAffinity(editor: EditorState): CaretAffinity | undefined {
  const isCollapsed = positionsEqual(editor.selection.anchor, editor.selection.focus);
  return isCollapsed && editor.anchorAffinity === undefined
    ? editor.caretAffinity // seed from the caret's boundary side on first extend
    : editor.anchorAffinity; // persist on continued extension
}

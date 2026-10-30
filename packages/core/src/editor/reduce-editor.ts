import { selectionContextOf, positionsEqual, resolveBlock, createSpan } from "../state";
import { caretAfterMarkers } from "../cursor/cursor-ops";
import { getTypingAttrs } from "./typing-attrs";
import { normalizeSelectionForAtomicMarks } from "./atomic-marks";
import { handleApplyForeignChange } from "./foreign-change";
import { handlePropose } from "./proposals";
import { runTransaction, applyInputRules, updateActiveTrigger } from "./extensions";
import { isDevMode } from "../state/dev-mode";
import { clearTransientViewState, type EditorState } from "./editor-state";
import type { EditorConfig } from "./editor-config";
import type { EditorAction } from "./editor-action";
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
  handleSetMark,
  handleRemoveMark,
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
  handleInsertLineBreak,
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
  handleResolveSuggestionGroup,
  handleRejectAllSuggestions,
} from "./actions";

/** Actions that insert content at a collapsed caret (a split is not one: it has its own marker rule). */
const INSERTS_AT_CARET: ReadonlySet<EditorAction["type"]> = new Set<EditorAction["type"]>([
  "INSERT_TEXT",
  "PASTE",
  "INSERT_LINE_BREAK",
  "INSERT_TAB",
  "INSERT_CROSS_REFERENCE",
  "INSERT_FOOTNOTE",
  "INSERT_PAGE_NUMBER",
  "INSERT_PAGE_COUNT",
  "INSERT_INLINE_IMAGE",
]);

/** `editor` with a collapsed caret moved past the markers adjacent on its right. */
function withCaretAfterMarkers(editor: EditorState): EditorState {
  const { anchor, focus } = editor.selection;
  if (!positionsEqual(anchor, focus)) return editor;
  const caret = caretAfterMarkers(editor.state, focus);
  return caret === focus ? editor : { ...editor, selection: createSpan(caret, caret) };
}

/** Pure reducer: applies an action to EditorState and returns new state. */
export function reduceEditor(rawEditor: EditorState, action: EditorAction): EditorState {
  const { config } = rawEditor;
  // ENTRY-CLEAR: `lastDirtyIds` is the layout-driver's per-dispatch
  // incremental hint, written ONLY by a mutating action's `rebuildTrees`. Clear
  // it at the entry of every dispatch so a prior mutating action's dirty ids
  // never leak forward onto a later selection-only / inert action (which would
  // make the driver wrongly rebuild only those blocks). A mutating handler's
  // `rebuildTrees` re-sets a fresh non-null set; everything else leaves it null.
  const cleared =
    rawEditor.lastDirtyIds === null ? rawEditor : { ...rawEditor, lastDirtyIds: null };
  // Markers are not caret stops: every insertion at a collapsed caret goes after the
  // markers adjacent on its right — inside a bookmark / comment at its start, outside
  // at its end. Normalized once here, so no insertion handler repeats it (block-local).
  const editor = INSERTS_AT_CARET.has(action.type) ? withCaretAfterMarkers(cleared) : cleared;

  // Undo-group coalescing. Decide the undo boundary BEFORE the operation
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
      editor.history.beginEntry(coalesceClass, (config.now ?? Date.now)(), editor.selection);
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
      // User-typed text may complete a host input rule (its own undo entry).
      if (action.userInput === true && result.state !== editor.state) {
        result = applyInputRules(result, config, reduceEditor);
      }
      break;
    case "TRANSACTION":
      result = runTransaction(editor, action.run, reduceEditor);
      break;
    case "APPLY_FOREIGN_CHANGE":
      result = handleApplyForeignChange(editor, action.dirtyIds);
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
      // Engine backstop: a Span must keep BOTH endpoints in the SAME
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
    case "SET_MARK":
      result = handleSetMark(editor, action.key, action.value, action.replace, action.span, config);
      break;
    case "REMOVE_MARK":
      result = handleRemoveMark(editor, action.key, action.value, action.span, config);
      break;
    case "PASTE":
      result = handlePaste(editor, action, config);
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
      // Pure selection move (no commit) — collapse an object selection to
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
    case "INSERT_LINE_BREAK":
      result = handleInsertLineBreak(editor, config);
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
    case "ACCEPT_SUGGESTION_GROUP":
      result = handleResolveSuggestionGroup(editor, action.groupId, "accept", config);
      break;
    case "REJECT_SUGGESTION_GROUP":
      result = handleResolveSuggestionGroup(editor, action.groupId, "reject", config);
      break;
    case "PROPOSE":
      result = handlePropose(editor, action.proposal, action.basedOn, config);
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
  // must reset them (else they go stale). That managing action is
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

  // Atomic marks: the caret never rests inside one (whatever moved it — a click,
  // an arrow step, undo, a programmatic selection), and a range selection covers
  // one whole or not at all.
  if (result !== editor) {
    const selection = normalizeSelectionForAtomicMarks(result.state, result.selection, editor.selection);
    if (selection !== result.selection) result = { ...result, selection };
  }

  result = updateStoredAttrs(editor, result, action, coalesceClass, config);
  result = updateActiveTrigger(editor, result, action, config);
  // Keep the selection's blocks snapshotted in the current state: a later foreign
  // change maps the caret from that snapshot (the Y.Doc has changed by then). O(1).
  if (result.state !== editor.state || result.selection !== editor.selection) {
    resolveBlock(result.state, result.selection.focus.blockId);
    resolveBlock(result.state, result.selection.anchor.blockId);
  }
  return result;
}

/** Actions after which an emptied caret block keeps the removed text's typing attrs. */
const CARRY_TYPING_ATTRS: ReadonlySet<EditorAction["type"]> = new Set([
  "DELETE_BACKWARD",
  "DELETE_FORWARD",
  "DELETE_WORD",
  "DELETE_RANGE",
  "SPLIT_NODE",
]);

/**
 * The `storedAttrs` lifecycle (see `EditorState.storedAttrs`): drop pending typing
 * attrs the action did not set itself (unless it is inert or re-sets the same
 * selection); and when a delete / paragraph split leaves the caret in an EMPTY
 * block, carry the INCLUSIVE typing attrs from before the edit so typing there
 * continues in the same formatting (Google Docs / Word) — never a link or mark.
 */
function updateStoredAttrs(
  before: EditorState,
  result: EditorState,
  action: EditorAction,
  coalesceClass: ReturnType<typeof coalesceKeyOf>,
  config: EditorConfig,
): EditorState {
  let out = result;
  if (out.storedAttrs !== undefined && out.storedAttrs === before.storedAttrs) {
    const keep =
      coalesceClass === "inert" ||
      (action.type === "SET_SELECTION" &&
        positionsEqual(out.selection.anchor, before.selection.anchor) &&
        positionsEqual(out.selection.focus, before.selection.focus));
    if (!keep) out = { ...out, storedAttrs: undefined };
  }
  if (
    out.storedAttrs === undefined &&
    out.state !== before.state &&
    CARRY_TYPING_ATTRS.has(action.type) &&
    positionsEqual(out.selection.anchor, out.selection.focus)
  ) {
    const content = resolveBlock(out.state, out.selection.focus.blockId)?.block.inlineContent ?? null;
    if (content !== null && content.items.length === 0) {
      // Only INCLUSIVE keys (formatting) carry: a deleted link / mention / other
      // non-inclusive or atomic mark — and change-tracking ids — must not
      // resurrect on the next keystroke.
      const carried: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(getTypingAttrs(before))) {
        if (config.attrRegistry.isInclusive(key)) carried[key] = value;
      }
      if (Object.keys(carried).length > 0) out = { ...out, storedAttrs: Object.freeze(carried) };
    }
  }
  return out;
}

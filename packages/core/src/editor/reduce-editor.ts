import { positionsEqual, resolveBlock, createSpan } from "../state";
import { caretAfterMarkers } from "../cursor/cursor-ops";
import { getTypingAttrs } from "./typing-attrs";
import { normalizeSelectionForAtomicMarks } from "./atomic-marks";
import { handleApplyForeignChange } from "./foreign-change";
import { handlePropose } from "./proposals";
import { runTransaction, applyInputRules, updateActiveTrigger } from "./extensions";
import { clearTransientViewState, type EditorState } from "./editor-state";
import type { EditorAction, ActionOf } from "./editor-action";
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

/** How an action affects undo-group coalescing. */
export type ActionClass =
  | "insert" // coalescible text insertion
  | "delete" // coalescible text deletion (any direction/granularity)
  | "command" // discrete edit — its own undo unit, never coalesces
  | "selection-break" // caret move / selection change / undo / redo — breaks the open group
  | "inert"; // neither edits nor breaks coalescing (resize, a peer's change, a proposal)

type ActionType = EditorAction["type"];

/** What the reducer's cross-cutting passes need to know about an action type. */
interface ActionTraits {
  /** Its undo-group coalescing class. */
  readonly coalesce: ActionClass;
  /**
   * It inserts content at a collapsed caret, so the caret first moves past the markers
   * adjacent on its right (a split is not one: it has its own marker rule).
   */
  readonly insertsAtCaret?: true;
  /** After it, an emptied caret block keeps the removed text's typing attrs. */
  readonly carriesTypingAttrs?: true;
}

/** Everything the reducer knows about one action type. */
interface ActionSpec<K extends ActionType> extends ActionTraits {
  /** The action's own transition. */
  readonly reduce: (editor: EditorState, action: ActionOf<K>) => EditorState;
}

/** User-typed text may complete a host input rule (its own undo entry). */
function insertText(editor: EditorState, action: ActionOf<"INSERT_TEXT">): EditorState {
  const result = handleInsertText(editor, action);
  return action.userInput === true && result.state !== editor.state
    ? applyInputRules(result, editor.config, reduceEditor)
    : result;
}

function transaction(editor: EditorState, action: ActionOf<"TRANSACTION">): EditorState {
  return runTransaction(editor, action.run, reduceEditor);
}

/**
 * Every action type's spec. The mapped type makes a newly added action a compile error
 * here until it has a handler and a coalescing class.
 */
const ACTIONS: { readonly [K in ActionType]: ActionSpec<K> } = {
  INSERT_TEXT: { reduce: insertText, coalesce: "insert", insertsAtCaret: true },
  TRANSACTION: { reduce: transaction, coalesce: "command" },
  // A peer's change: not ours to undo, and it must not split our typing group.
  APPLY_FOREIGN_CHANGE: { reduce: handleApplyForeignChange, coalesce: "inert" },
  DELETE_BACKWARD: { reduce: handleDeleteBackward, coalesce: "delete", carriesTypingAttrs: true },
  DELETE_FORWARD: { reduce: handleDeleteForward, coalesce: "delete", carriesTypingAttrs: true },
  DELETE_WORD: { reduce: handleDeleteWord, coalesce: "delete", carriesTypingAttrs: true },
  DELETE_RANGE: { reduce: handleDeleteRange, coalesce: "delete", carriesTypingAttrs: true },
  SPLIT_NODE: { reduce: handleSplitNode, coalesce: "command", carriesTypingAttrs: true },
  MOVE_WORD: { reduce: handleMoveWord, coalesce: "selection-break" },
  MOVE_DOCUMENT_BOUNDARY: { reduce: handleMoveDocumentBoundary, coalesce: "selection-break" },
  EXPAND_WORD: { reduce: handleExpandWord, coalesce: "selection-break" },
  EXPAND_DOCUMENT_BOUNDARY: { reduce: handleExpandDocumentBoundary, coalesce: "selection-break" },
  SELECT_ALL: { reduce: handleSelectAll, coalesce: "selection-break" },
  SET_SELECTION: { reduce: handleSetSelection, coalesce: "selection-break" },
  // A pure selection move (deselect an object → caret beside it): breaks the open undo
  // group like any other caret move.
  ESCAPE: { reduce: handleEscape, coalesce: "selection-break" },
  UNDO: { reduce: handleUndo, coalesce: "selection-break" },
  REDO: { reduce: handleRedo, coalesce: "selection-break" },
  SET_CONTAINER_WIDTH: { reduce: handleSetContainerWidth, coalesce: "inert" },
  // Another author's proposal: keeps the stored typing attrs; its handler opens its OWN
  // undo entry only when it applies something (1.5 "Host proposals").
  PROPOSE: { reduce: handlePropose, coalesce: "inert" },
  PASTE: { reduce: handlePaste, coalesce: "command", insertsAtCaret: true },
  INSERT_NODE: { reduce: handleInsertNode, coalesce: "command" },
  SET_BLOCK_TYPE: { reduce: handleSetBlockType, coalesce: "command" },
  TOGGLE_LIST: { reduce: handleToggleList, coalesce: "command" },
  SET_LIST_TYPE: { reduce: handleSetListType, coalesce: "command" },
  SET_LIST_RESTART: { reduce: handleSetListRestart, coalesce: "command" },
  LIST_INDENT: { reduce: handleListIndent, coalesce: "command" },
  LIST_OUTDENT: { reduce: handleListIndent, coalesce: "command" },
  INDENT: { reduce: handleIndent, coalesce: "command" },
  OUTDENT: { reduce: handleIndent, coalesce: "command" },
  SECTION_BREAK: { reduce: handleSectionBreak, coalesce: "command" },
  TOGGLE_SECTION_LANDSCAPE: { reduce: handleToggleSectionLandscape, coalesce: "command" },
  SET_SECTION_COLUMNS: { reduce: handleSetSectionColumns, coalesce: "command" },
  INSERT_HEADER: { reduce: handleInsertHeaderFooter, coalesce: "command" },
  INSERT_FOOTER: { reduce: handleInsertHeaderFooter, coalesce: "command" },
  INSERT_FOOTNOTE: { reduce: handleInsertFootnote, coalesce: "command", insertsAtCaret: true },
  INSERT_CROSS_REFERENCE: { reduce: handleInsertCrossReference, coalesce: "command", insertsAtCaret: true },
  INSERT_PAGE_NUMBER: { reduce: handleInsertPageField, coalesce: "command", insertsAtCaret: true },
  INSERT_PAGE_COUNT: { reduce: handleInsertPageField, coalesce: "command", insertsAtCaret: true },
  INSERT_TAB: { reduce: handleInsertTab, coalesce: "command", insertsAtCaret: true },
  INSERT_LINE_BREAK: { reduce: handleInsertLineBreak, coalesce: "command", insertsAtCaret: true },
  SET_TAB_STOPS: { reduce: handleSetTabStops, coalesce: "command" },
  INSERT_HORIZONTAL_LINE: { reduce: handleInsertHorizontalLine, coalesce: "command" },
  INSERT_TABLE_OF_CONTENTS: { reduce: handleInsertTableOfContents, coalesce: "command" },
  INSERT_TABLE: { reduce: handleInsertTable, coalesce: "command" },
  INSERT_TABLE_ROW: { reduce: handleInsertTableRow, coalesce: "command" },
  INSERT_TABLE_COLUMN: { reduce: handleInsertTableColumn, coalesce: "command" },
  DELETE_TABLE_ROW: { reduce: handleDeleteTableRow, coalesce: "command" },
  DELETE_TABLE_COLUMN: { reduce: handleDeleteTableColumn, coalesce: "command" },
  DELETE_TABLE: { reduce: handleDeleteTable, coalesce: "command" },
  SPLIT_CELL: { reduce: handleSplitCell, coalesce: "command" },
  MERGE_CELLS: { reduce: handleMergeCells, coalesce: "command" },
  INSERT_IMAGE: { reduce: handleInsertImage, coalesce: "command" },
  INSERT_INLINE_IMAGE: { reduce: handleInsertInlineImage, coalesce: "command", insertsAtCaret: true },
  SET_IMAGE_SIZE: { reduce: handleSetImageSize, coalesce: "command" },
  SET_IMAGE_WRAP: { reduce: handleSetImageWrap, coalesce: "command" },
  SET_IMAGE_ALT: { reduce: handleSetImageAlt, coalesce: "command" },
  TOGGLE_STYLE: { reduce: handleToggleStyle, coalesce: "command" },
  SET_LINK: { reduce: handleSetLink, coalesce: "command" },
  SET_TEXT_COLOR: { reduce: handleSetTextColor, coalesce: "command" },
  SET_TEXT_TRANSFORM: { reduce: handleSetTextTransform, coalesce: "command" },
  SET_HIGHLIGHT: { reduce: handleSetHighlight, coalesce: "command" },
  SET_FONT_SIZE: { reduce: handleSetFontSize, coalesce: "command" },
  SET_FONT_FAMILY: { reduce: handleSetFontFamily, coalesce: "command" },
  CLEAR_FORMATTING: { reduce: handleClearFormatting, coalesce: "command" },
  SET_MARK: { reduce: handleSetMark, coalesce: "command" },
  REMOVE_MARK: { reduce: handleRemoveMark, coalesce: "command" },
  SET_TEXT_ALIGN: { reduce: handleSetTextAlign, coalesce: "command" },
  SET_LINE_SPACING: { reduce: handleSetLineSpacing, coalesce: "command" },
  SET_PARAGRAPH_SPACING: { reduce: handleSetParagraphSpacing, coalesce: "command" },
  SET_FOOTNOTE_POLICY: { reduce: handleSetFootnotePolicy, coalesce: "command" },
  REPLACE_MATCH: { reduce: handleReplaceMatch, coalesce: "command" },
  REPLACE_ALL: { reduce: handleReplaceAll, coalesce: "command" },
  ADD_COMMENT: { reduce: handleAddComment, coalesce: "command" },
  RESOLVE_COMMENT: { reduce: handleResolveComment, coalesce: "command" },
  REOPEN_COMMENT: { reduce: handleReopenComment, coalesce: "command" },
  DELETE_COMMENT: { reduce: handleDeleteComment, coalesce: "command" },
  ADD_REPLY: { reduce: handleAddReply, coalesce: "command" },
  // Suggestion resolution: undoable, each its own entry.
  ACCEPT_SUGGESTION: { reduce: handleAcceptSuggestion, coalesce: "command" },
  REJECT_SUGGESTION: { reduce: handleRejectSuggestion, coalesce: "command" },
  ACCEPT_SUGGESTION_GROUP: { reduce: handleResolveSuggestionGroup, coalesce: "command" },
  REJECT_SUGGESTION_GROUP: { reduce: handleResolveSuggestionGroup, coalesce: "command" },
  ACCEPT_ALL_SUGGESTIONS: { reduce: handleAcceptAllSuggestions, coalesce: "command" },
  REJECT_ALL_SUGGESTIONS: { reduce: handleRejectAllSuggestions, coalesce: "command" },
};

/** Classify an `EditorAction` for undo-group coalescing. */
export function coalesceKeyOf(action: EditorAction): ActionClass {
  return ACTIONS[action.type].coalesce;
}

/** Run `action`'s own transition (`type` correlates the table entry with the action). */
function reduceAction<K extends ActionType>(editor: EditorState, type: K, action: ActionOf<K>): EditorState {
  return ACTIONS[type].reduce(editor, action);
}

/** `editor` with a collapsed caret moved past the markers adjacent on its right. */
function withCaretAfterMarkers(editor: EditorState): EditorState {
  const { anchor, focus } = editor.selection;
  if (!positionsEqual(anchor, focus)) return editor;
  const caret = caretAfterMarkers(editor.state, focus);
  return caret === focus ? editor : { ...editor, selection: createSpan(caret, caret) };
}

/** Pure reducer: applies an action to EditorState and returns new state. */
export function reduceEditor(rawEditor: EditorState, action: EditorAction): EditorState {
  const spec = ACTIONS[action.type];
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
  const editor = spec.insertsAtCaret === true ? withCaretAfterMarkers(cleared) : cleared;

  // Undo-group coalescing. Decide the undo boundary BEFORE the operation
  // runs (with `captureTimeout: MAX`, a transaction merges into the open group
  // unless we `stopCapturing` first). Committing actions open/continue a group;
  // selection jumps and undo/redo close it; inert actions (container resize) do
  // neither. This runs before the per-action handler's no-op short-circuit (the
  // "Accepted edge" in the design): a no-op committing action still advances the
  // boundary, which is intentional — keeping the policy in one place.
  const coalesceClass = spec.coalesce;
  switch (coalesceClass) {
    case "insert":
    case "delete":
    case "command":
      editor.history.beginEntry(coalesceClass, (editor.config.now ?? Date.now)(), editor.selection);
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

  let result = reduceAction(editor, action.type, action);

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

  result = updateStoredAttrs(editor, result, action, spec);
  result = updateActiveTrigger(editor, result, action, editor.config);
  // Keep the selection's blocks snapshotted in the current state: a later foreign
  // change maps the caret from that snapshot (the Y.Doc has changed by then). O(1).
  if (result.state !== editor.state || result.selection !== editor.selection) {
    resolveBlock(result.state, result.selection.focus.blockId);
    resolveBlock(result.state, result.selection.anchor.blockId);
  }
  return result;
}

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
  traits: ActionTraits,
): EditorState {
  let out = result;
  if (out.storedAttrs !== undefined && out.storedAttrs === before.storedAttrs) {
    const keep =
      traits.coalesce === "inert" ||
      (action.type === "SET_SELECTION" &&
        positionsEqual(out.selection.anchor, before.selection.anchor) &&
        positionsEqual(out.selection.focus, before.selection.focus));
    if (!keep) out = { ...out, storedAttrs: undefined };
  }
  if (
    out.storedAttrs === undefined &&
    out.state !== before.state &&
    traits.carriesTypingAttrs === true &&
    positionsEqual(out.selection.anchor, out.selection.focus)
  ) {
    const content = resolveBlock(out.state, out.selection.focus.blockId)?.block.inlineContent ?? null;
    if (content !== null && content.items.length === 0) {
      // Only INCLUSIVE keys (formatting) carry: a deleted link / mention / other
      // non-inclusive or atomic mark — and change-tracking ids — must not
      // resurrect on the next keystroke.
      const carried: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(getTypingAttrs(before))) {
        if (before.config.attrRegistry.isInclusive(key)) carried[key] = value;
      }
      if (Object.keys(carried).length > 0) out = { ...out, storedAttrs: Object.freeze(carried) };
    }
  }
  return out;
}

import { positionsEqual, resolveBlock, createSpan } from "../state";
import { caretAfterMarkers } from "../cursor/cursor-ops";
import { getTypingAttrs } from "./typing-attrs";
import { normalizeSelectionForAtomicMarks } from "./atomic-marks";
import { normalizeSelectionForObjects } from "../cursor/object-range";
import { runTransaction, applyInputRules, updateActiveTrigger } from "./extensions";
import { clearTransientViewState, type EditorState } from "./editor-state";
import type { EditorAction, ActionOf } from "./editor-action";
import { applyEdit, type Edit } from "./edit";
import {
  handleInsertText,
  handleApplyForeignChange,
  handleDeleteBackward,
  handleDeleteForward,
  handleDeleteWord,
  handleDeleteRange,
  handleSplitNode,
  handleMoveWord,
  handleMoveDocumentBoundary,
  handleExpandWord,
  handleExpandDocumentBoundary,
  handleSelectAll,
  handleSetSelection,
  handleEscape,
  handleUndo,
  handleRedo,
  handleSetContainerWidth,
  handlePropose,
  handlePaste,
  handleInsertNode,
  handleSetBlockType,
  handleToggleList,
  handleSetListType,
  handleSetListRestart,
  handleListIndent,
  handleListOutdent,
  handleIndent,
  handleOutdent,
  handleSectionBreak,
  handleToggleSectionLandscape,
  handleSetSectionColumns,
  handleInsertHeader,
  handleInsertFooter,
  handleInsertFootnote,
  handleInsertCrossReference,
  handleInsertPageNumber,
  handleInsertPageCount,
  handleInsertTab,
  handleInsertLineBreak,
  handleSetTabStops,
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
  handleSetTextAlign,
  handleSetLineSpacing,
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
  handleAcceptSuggestionGroup,
  handleRejectSuggestionGroup,
  handleAcceptAllSuggestions,
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
  /**
   * It places the selection together with its view hints (`SET_SELECTION`): the central
   * reset leaves those hints alone, and re-placing the same selection keeps the pending
   * typing attrs.
   */
  readonly placesSelection?: true;
}

/** `TRANSACTION` composes other actions: the reducer runs it itself (`runTransaction`). */
type HandledActionType = Exclude<ActionType, "TRANSACTION">;

/**
 * Everything the reducer knows about one action type: its handler, which computes what
 * the action did (`Edit`, or `null` for nothing) for the reducer to apply (`applyEdit`),
 * and its traits.
 */
interface ActionSpec<K extends HandledActionType> extends ActionTraits {
  readonly edit: (editor: EditorState, action: ActionOf<K>) => Edit | null;
}

const TRANSACTION_TRAITS: ActionTraits = { coalesce: "command" };

/**
 * Every action type's spec. The mapped type makes a newly added action a compile error
 * here until it has a handler and a coalescing class.
 */
const ACTIONS: { readonly [K in HandledActionType]: ActionSpec<K> } = {
  INSERT_TEXT: { edit: handleInsertText, coalesce: "insert", insertsAtCaret: true },
  // A peer's change: not ours to undo, and it must not split our typing group.
  APPLY_FOREIGN_CHANGE: { edit: handleApplyForeignChange, coalesce: "inert" },
  DELETE_BACKWARD: { edit: handleDeleteBackward, coalesce: "delete", carriesTypingAttrs: true },
  DELETE_FORWARD: { edit: handleDeleteForward, coalesce: "delete", carriesTypingAttrs: true },
  DELETE_WORD: { edit: handleDeleteWord, coalesce: "delete", carriesTypingAttrs: true },
  DELETE_RANGE: { edit: handleDeleteRange, coalesce: "delete", carriesTypingAttrs: true },
  SPLIT_NODE: { edit: handleSplitNode, coalesce: "command", carriesTypingAttrs: true },
  MOVE_WORD: { edit: handleMoveWord, coalesce: "selection-break" },
  MOVE_DOCUMENT_BOUNDARY: { edit: handleMoveDocumentBoundary, coalesce: "selection-break" },
  EXPAND_WORD: { edit: handleExpandWord, coalesce: "selection-break" },
  EXPAND_DOCUMENT_BOUNDARY: { edit: handleExpandDocumentBoundary, coalesce: "selection-break" },
  SELECT_ALL: { edit: handleSelectAll, coalesce: "selection-break" },
  SET_SELECTION: { edit: handleSetSelection, coalesce: "selection-break", placesSelection: true },
  // A pure selection move (deselect an object → caret beside it): breaks the open undo
  // group like any other caret move.
  ESCAPE: { edit: handleEscape, coalesce: "selection-break" },
  UNDO: { edit: handleUndo, coalesce: "selection-break" },
  REDO: { edit: handleRedo, coalesce: "selection-break" },
  SET_CONTAINER_WIDTH: { edit: handleSetContainerWidth, coalesce: "inert" },
  // Another author's proposal: keeps the stored typing attrs; its handler opens its OWN
  // undo entry only when it applies something (1.5 "Host proposals").
  PROPOSE: { edit: handlePropose, coalesce: "inert" },
  PASTE: { edit: handlePaste, coalesce: "command", insertsAtCaret: true },
  INSERT_NODE: { edit: handleInsertNode, coalesce: "command" },
  SET_BLOCK_TYPE: { edit: handleSetBlockType, coalesce: "command" },
  TOGGLE_LIST: { edit: handleToggleList, coalesce: "command" },
  SET_LIST_TYPE: { edit: handleSetListType, coalesce: "command" },
  SET_LIST_RESTART: { edit: handleSetListRestart, coalesce: "command" },
  LIST_INDENT: { edit: handleListIndent, coalesce: "command" },
  LIST_OUTDENT: { edit: handleListOutdent, coalesce: "command" },
  INDENT: { edit: handleIndent, coalesce: "command" },
  OUTDENT: { edit: handleOutdent, coalesce: "command" },
  SECTION_BREAK: { edit: handleSectionBreak, coalesce: "command" },
  TOGGLE_SECTION_LANDSCAPE: { edit: handleToggleSectionLandscape, coalesce: "command" },
  SET_SECTION_COLUMNS: { edit: handleSetSectionColumns, coalesce: "command" },
  INSERT_HEADER: { edit: handleInsertHeader, coalesce: "command" },
  INSERT_FOOTER: { edit: handleInsertFooter, coalesce: "command" },
  INSERT_FOOTNOTE: { edit: handleInsertFootnote, coalesce: "command", insertsAtCaret: true },
  INSERT_CROSS_REFERENCE: { edit: handleInsertCrossReference, coalesce: "command", insertsAtCaret: true },
  INSERT_PAGE_NUMBER: { edit: handleInsertPageNumber, coalesce: "command", insertsAtCaret: true },
  INSERT_PAGE_COUNT: { edit: handleInsertPageCount, coalesce: "command", insertsAtCaret: true },
  INSERT_TAB: { edit: handleInsertTab, coalesce: "command", insertsAtCaret: true },
  INSERT_LINE_BREAK: { edit: handleInsertLineBreak, coalesce: "command", insertsAtCaret: true },
  SET_TAB_STOPS: { edit: handleSetTabStops, coalesce: "command" },
  INSERT_HORIZONTAL_LINE: { edit: handleInsertHorizontalLine, coalesce: "command" },
  INSERT_TABLE_OF_CONTENTS: { edit: handleInsertTableOfContents, coalesce: "command" },
  INSERT_TABLE: { edit: handleInsertTable, coalesce: "command" },
  INSERT_TABLE_ROW: { edit: handleInsertTableRow, coalesce: "command" },
  INSERT_TABLE_COLUMN: { edit: handleInsertTableColumn, coalesce: "command" },
  DELETE_TABLE_ROW: { edit: handleDeleteTableRow, coalesce: "command" },
  DELETE_TABLE_COLUMN: { edit: handleDeleteTableColumn, coalesce: "command" },
  DELETE_TABLE: { edit: handleDeleteTable, coalesce: "command" },
  SPLIT_CELL: { edit: handleSplitCell, coalesce: "command" },
  MERGE_CELLS: { edit: handleMergeCells, coalesce: "command" },
  INSERT_IMAGE: { edit: handleInsertImage, coalesce: "command" },
  INSERT_INLINE_IMAGE: { edit: handleInsertInlineImage, coalesce: "command", insertsAtCaret: true },
  SET_IMAGE_SIZE: { edit: handleSetImageSize, coalesce: "command" },
  SET_IMAGE_WRAP: { edit: handleSetImageWrap, coalesce: "command" },
  SET_IMAGE_ALT: { edit: handleSetImageAlt, coalesce: "command" },
  TOGGLE_STYLE: { edit: handleToggleStyle, coalesce: "command" },
  SET_LINK: { edit: handleSetLink, coalesce: "command" },
  SET_TEXT_COLOR: { edit: handleSetTextColor, coalesce: "command" },
  SET_TEXT_TRANSFORM: { edit: handleSetTextTransform, coalesce: "command" },
  SET_HIGHLIGHT: { edit: handleSetHighlight, coalesce: "command" },
  SET_FONT_SIZE: { edit: handleSetFontSize, coalesce: "command" },
  SET_FONT_FAMILY: { edit: handleSetFontFamily, coalesce: "command" },
  CLEAR_FORMATTING: { edit: handleClearFormatting, coalesce: "command" },
  SET_MARK: { edit: handleSetMark, coalesce: "command" },
  REMOVE_MARK: { edit: handleRemoveMark, coalesce: "command" },
  SET_TEXT_ALIGN: { edit: handleSetTextAlign, coalesce: "command" },
  SET_LINE_SPACING: { edit: handleSetLineSpacing, coalesce: "command" },
  SET_PARAGRAPH_SPACING: { edit: handleSetParagraphSpacing, coalesce: "command" },
  SET_FOOTNOTE_POLICY: { edit: handleSetFootnotePolicy, coalesce: "command" },
  REPLACE_MATCH: { edit: handleReplaceMatch, coalesce: "command" },
  REPLACE_ALL: { edit: handleReplaceAll, coalesce: "command" },
  ADD_COMMENT: { edit: handleAddComment, coalesce: "command" },
  RESOLVE_COMMENT: { edit: handleResolveComment, coalesce: "command" },
  REOPEN_COMMENT: { edit: handleReopenComment, coalesce: "command" },
  DELETE_COMMENT: { edit: handleDeleteComment, coalesce: "command" },
  ADD_REPLY: { edit: handleAddReply, coalesce: "command" },
  // Suggestion resolution: undoable, each its own entry.
  ACCEPT_SUGGESTION: { edit: handleAcceptSuggestion, coalesce: "command" },
  REJECT_SUGGESTION: { edit: handleRejectSuggestion, coalesce: "command" },
  ACCEPT_SUGGESTION_GROUP: { edit: handleAcceptSuggestionGroup, coalesce: "command" },
  REJECT_SUGGESTION_GROUP: { edit: handleRejectSuggestionGroup, coalesce: "command" },
  ACCEPT_ALL_SUGGESTIONS: { edit: handleAcceptAllSuggestions, coalesce: "command" },
  REJECT_ALL_SUGGESTIONS: { edit: handleRejectAllSuggestions, coalesce: "command" },
};

function traitsOf(type: ActionType): ActionTraits {
  return type === "TRANSACTION" ? TRANSACTION_TRAITS : ACTIONS[type];
}

/** Classify an `EditorAction` for undo-group coalescing. */
export function coalesceKeyOf(action: EditorAction): ActionClass {
  return traitsOf(action.type).coalesce;
}

/** What `action` did (`type` correlates the table entry with the action). */
function editOf<K extends HandledActionType>(editor: EditorState, type: K, action: ActionOf<K>): Edit | null {
  const spec: ActionSpec<K> = ACTIONS[type];
  return spec.edit(editor, action);
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
  const traits = traitsOf(action.type);
  // ENTRY-CLEAR: `lastDirtyIds` is the layout-driver's per-dispatch
  // incremental hint, written ONLY by `applyEdit` for a changing action. Clear
  // it at the entry of every dispatch so a prior mutating action's dirty ids
  // never leak forward onto a later selection-only / inert action (which would
  // make the driver wrongly rebuild only those blocks). A changing action's
  // `applyEdit` re-sets a fresh non-null set; everything else leaves it null.
  const cleared =
    rawEditor.lastDirtyIds === null ? rawEditor : { ...rawEditor, lastDirtyIds: null };
  // Markers are not caret stops: every insertion at a collapsed caret goes after the
  // markers adjacent on its right — inside a bookmark / comment at its start, outside
  // at its end. Normalized once here, so no insertion handler repeats it (block-local).
  const editor = traits.insertsAtCaret === true ? withCaretAfterMarkers(cleared) : cleared;

  // Undo-group coalescing. Decide the undo boundary BEFORE the operation
  // runs (with `captureTimeout: MAX`, a transaction merges into the open group
  // unless we `stopCapturing` first). Committing actions open/continue a group;
  // selection jumps and undo/redo close it; inert actions (container resize) do
  // neither. This runs before the per-action handler's no-op short-circuit (the
  // "Accepted edge" in the design): a no-op committing action still advances the
  // boundary, which is intentional — keeping the policy in one place.
  const coalesceClass = traits.coalesce;
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

  let result =
    action.type === "TRANSACTION"
      ? runTransaction(editor, action.run, reduceEditor)
      : applyEdit(editor, editOf(editor, action.type, action));
  // User-typed text may complete a host input rule (its own undo entry).
  if (action.type === "INSERT_TEXT" && action.userInput === true && result.state !== editor.state) {
    result = applyInputRules(result, editor.config, reduceEditor);
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
  // every other action (the `placesSelection` trait) routes through `clearTransientViewState`
  // (the single home for "what's stale-on-mutation", also used by
  // `reconcileForeignChange`); the helper is allocation-guarded.
  if (traits.placesSelection !== true) {
    result = clearTransientViewState(result);
  }

  // Atomic marks: the caret never rests inside one (whatever moved it — a click,
  // an arrow step, undo, a programmatic selection), and a range selection covers
  // one whole or not at all. Likewise a range covers a table whole or not at all.
  if (result !== editor) {
    const selection = normalizeSelectionForObjects(
      result.state,
      normalizeSelectionForAtomicMarks(result.state, result.selection, editor.selection),
    );
    if (selection !== result.selection) result = { ...result, selection };
  }

  result = updateStoredAttrs(editor, result, traits);
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
  traits: ActionTraits,
): EditorState {
  let out = result;
  if (out.storedAttrs !== undefined && out.storedAttrs === before.storedAttrs) {
    const keep =
      traits.coalesce === "inert" ||
      (traits.placesSelection === true &&
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

import type { EditorAction } from "./editor-action";

/** How an action affects undo-group coalescing. */
export type ActionClass =
  | "insert" // coalescible text insertion
  | "delete" // coalescible text deletion (any direction/granularity)
  | "command" // discrete edit — its own undo unit, never coalesces
  | "selection-break" // caret move / selection change / undo / redo — breaks the open group
  | "inert"; // neither edits nor breaks coalescing

/**
 * Classify an `EditorAction` for undo-group coalescing. Exhaustive over
 * the action union — the `never` default makes a newly-added action a COMPILE
 * error here until it is classified.
 */
export function coalesceKeyOf(action: EditorAction): ActionClass {
  switch (action.type) {
    case "INSERT_TEXT":
      return "insert";
    case "DELETE_BACKWARD":
    case "DELETE_FORWARD":
    case "DELETE_WORD":
    case "DELETE_RANGE":
      return "delete";
    case "SPLIT_NODE":
    case "PASTE":
    case "INSERT_NODE":
    case "SET_BLOCK_TYPE":
    case "TOGGLE_LIST":
    case "SET_LIST_TYPE":
    case "SET_LIST_RESTART":
    case "SECTION_BREAK":
    case "TOGGLE_SECTION_LANDSCAPE":
    case "SET_SECTION_COLUMNS":
    case "INSERT_HEADER":
    case "INSERT_FOOTER":
    case "INSERT_FOOTNOTE":
    case "INSERT_CROSS_REFERENCE":
    case "INSERT_PAGE_NUMBER":
    case "INSERT_PAGE_COUNT":
    case "INSERT_TAB":
    case "INSERT_LINE_BREAK":
    case "SET_TAB_STOPS":
    case "INSERT_HORIZONTAL_LINE":
    case "INSERT_TABLE_OF_CONTENTS":
    case "INSERT_TABLE":
    case "INSERT_TABLE_ROW":
    case "INSERT_TABLE_COLUMN":
    case "DELETE_TABLE_ROW":
    case "DELETE_TABLE_COLUMN":
    case "DELETE_TABLE":
    case "SPLIT_CELL":
    case "MERGE_CELLS":
    case "INSERT_IMAGE":
    case "INSERT_INLINE_IMAGE":
    case "SET_IMAGE_SIZE":
    case "SET_IMAGE_WRAP":
    case "SET_IMAGE_ALT":
    case "SET_FOOTNOTE_POLICY":
    case "TOGGLE_STYLE":
    case "SET_LINK":
    case "SET_TEXT_COLOR":
    case "SET_TEXT_TRANSFORM":
    case "SET_HIGHLIGHT":
    case "SET_FONT_SIZE":
    case "SET_FONT_FAMILY":
    case "CLEAR_FORMATTING":
    case "TRANSACTION":
    case "SET_MARK":
    case "REMOVE_MARK":
    case "SET_TEXT_ALIGN":
    case "SET_LINE_SPACING":
    case "SET_PARAGRAPH_SPACING":
    case "INDENT":
    case "OUTDENT":
    case "LIST_INDENT":
    case "LIST_OUTDENT":
    case "REPLACE_MATCH":
    case "REPLACE_ALL":
    case "ADD_COMMENT":
    case "RESOLVE_COMMENT":
    case "REOPEN_COMMENT":
    case "DELETE_COMMENT":
    case "ADD_REPLY":
      return "command";
    // Suggestion resolution and host proposals: undoable, each its own entry.
    case "ACCEPT_SUGGESTION":
    case "REJECT_SUGGESTION":
    case "ACCEPT_SUGGESTION_GROUP":
    case "REJECT_SUGGESTION_GROUP":
    case "ACCEPT_ALL_SUGGESTIONS":
    case "REJECT_ALL_SUGGESTIONS":
      return "command";
    case "MOVE_WORD":
    case "MOVE_DOCUMENT_BOUNDARY":
    case "EXPAND_WORD":
    case "EXPAND_DOCUMENT_BOUNDARY":
    case "SELECT_ALL":
    case "SET_SELECTION":
    // ESCAPE is a pure selection move (deselect an object → caret beside
    // it), so it breaks the open undo group like any other caret move.
    case "ESCAPE":
    case "UNDO":
    case "REDO":
      return "selection-break";
    case "SET_CONTAINER_WIDTH":
    // A peer's change: not ours to undo, and it must not split our typing group.
    case "APPLY_FOREIGN_CHANGE":
    // Another author's proposal: keeps the stored typing attrs; its handler opens its OWN
    // undo entry only when it applies something (1.5 "Host proposals").
    case "PROPOSE":
      return "inert";
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

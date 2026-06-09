import type { EditorAction } from "./editor-action";

/** How an action affects undo-group coalescing (#420). */
export type ActionClass =
  | "insert" // coalescible text insertion
  | "delete" // coalescible text deletion (any direction/granularity)
  | "command" // discrete edit — its own undo unit, never coalesces
  | "selection-break" // caret move / selection change / undo / redo — breaks the open group
  | "inert"; // neither edits nor breaks coalescing

/**
 * Classify an `EditorAction` for undo-group coalescing (#420). Exhaustive over
 * the action union — the `never` default makes a newly-added action a COMPILE
 * error here until it is classified. See
 * `docs/superpowers/specs/2026-06-01-undo-coalescing-design.md`.
 */
export function coalesceKeyOf(action: EditorAction): ActionClass {
  switch (action.type) {
    case "INSERT_TEXT":
      return "insert";
    case "DELETE_BACKWARD":
    case "DELETE_FORWARD":
    case "DELETE_WORD":
    case "DELETE_LINE":
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
    case "INSERT_TAB":
    case "SET_TAB_STOPS":
    case "INSERT_HORIZONTAL_LINE":
    case "INSERT_TABLE_ROW":
    case "INSERT_TABLE_COLUMN":
    case "DELETE_TABLE_ROW":
    case "DELETE_TABLE_COLUMN":
    case "DELETE_TABLE":
    case "SPLIT_CELL":
    case "MERGE_CELLS":
    case "INSERT_IMAGE":
    case "SET_IMAGE_SIZE":
    case "SET_FOOTNOTE_POLICY":
    case "TOGGLE_STYLE":
    case "SET_LINK":
    case "SET_TEXT_COLOR":
    case "SET_TEXT_TRANSFORM":
    case "SET_HIGHLIGHT":
    case "SET_FONT_SIZE":
    case "SET_FONT_FAMILY":
    case "CLEAR_FORMATTING":
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
    case "MOVE_CURSOR":
    case "MOVE_WORD":
    case "MOVE_LINE":
    case "MOVE_LINE_BOUNDARY":
    case "MOVE_DOCUMENT_BOUNDARY":
    case "EXPAND_SELECTION":
    case "EXPAND_WORD":
    case "EXPAND_LINE":
    case "EXPAND_LINE_BOUNDARY":
    case "EXPAND_DOCUMENT_BOUNDARY":
    case "SELECT_ALL":
    case "SET_SELECTION":
    case "UNDO":
    case "REDO":
      return "selection-break";
    case "SET_CONTAINER_WIDTH":
      return "inert";
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

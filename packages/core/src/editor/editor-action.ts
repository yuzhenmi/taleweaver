import type { Selection, Position, BlockInit, TextMatch, BlockId, CrossReferenceMode, CommentId, SuggestionId } from "../state";
import type { TextAlign, TextTransform } from "../styles/style";
import type { TabStop } from "../styles/tab-stops";
import type { CounterFormat, FootnoteNumberingPolicy } from "../footnotes";
import type { CaretAffinity } from "../cursor/line-bidi";
import type { ColumnRule } from "../layout/column-config";

export type EditorAction =
  | { type: "INSERT_TEXT"; text: string }
  | { type: "DELETE_BACKWARD" }
  | { type: "SPLIT_NODE" }
  | { type: "MOVE_CURSOR"; direction: "forward" | "backward" }
  | { type: "MOVE_WORD"; direction: "forward" | "backward" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET_CONTAINER_WIDTH"; width: number }
  | {
      type: "SET_SELECTION";
      selection: Selection;
      caretPageHint?: number;
      caretAffinity?: CaretAffinity;
    }
  | { type: "EXPAND_SELECTION"; direction: "forward" | "backward" }
  | { type: "EXPAND_WORD"; direction: "forward" | "backward" }
  | { type: "DELETE_FORWARD" }
  | { type: "MOVE_LINE"; direction: "up" | "down" }
  | { type: "EXPAND_LINE"; direction: "up" | "down" }
  | { type: "TOGGLE_STYLE"; style: "bold" | "italic" | "underline" | "strikethrough" }
  | { type: "SET_LINK"; url: string | null }
  | { type: "SET_TEXT_COLOR"; color: string | null }
  | { type: "SET_TEXT_TRANSFORM"; value: TextTransform }
  | { type: "SET_HIGHLIGHT"; color: string | null }
  | { type: "SET_FONT_SIZE"; size: number | null }
  | { type: "SET_FONT_FAMILY"; family: string | null }
  | { type: "CLEAR_FORMATTING" }
  | { type: "PASTE"; text: string }
  | { type: "SET_BLOCK_TYPE"; blockType: string; properties?: Record<string, unknown> }
  | { type: "TOGGLE_LIST"; listType: "ordered" | "unordered" }
  | { type: "SET_LIST_TYPE"; listType: "ordered" | "unordered" }
  | { type: "SET_LIST_RESTART"; value: number | null }
  | { type: "MOVE_LINE_BOUNDARY"; boundary: "start" | "end" }
  | { type: "EXPAND_LINE_BOUNDARY"; boundary: "start" | "end" }
  | { type: "MOVE_DOCUMENT_BOUNDARY"; boundary: "start" | "end" }
  | { type: "EXPAND_DOCUMENT_BOUNDARY"; boundary: "start" | "end" }
  | { type: "SELECT_ALL" }
  | { type: "DELETE_WORD"; direction: "forward" | "backward" }
  | { type: "DELETE_LINE" }
  | { type: "INSERT_NODE"; node: BlockInit; position?: Position }
  | { type: "SECTION_BREAK" }
  | { type: "TOGGLE_SECTION_LANDSCAPE" }
  | { type: "SET_SECTION_COLUMNS"; columnCount: number; columnGap?: number; columnRule?: ColumnRule | null }
  | { type: "INSERT_HEADER" }
  | { type: "INSERT_FOOTER" }
  | { type: "INSERT_FOOTNOTE" }
  | { type: "INSERT_CROSS_REFERENCE"; targetId: BlockId; refMode: CrossReferenceMode }
  | { type: "INSERT_TAB" }
  | { type: "SET_TAB_STOPS"; blockId: BlockId; tabStops: readonly TabStop[] }
  | { type: "INSERT_HORIZONTAL_LINE" }
  | { type: "INSERT_TABLE_ROW"; position: "above" | "below" }
  | { type: "INSERT_TABLE_COLUMN"; position: "left" | "right" }
  | { type: "DELETE_TABLE_ROW" }
  | { type: "DELETE_TABLE_COLUMN" }
  | { type: "DELETE_TABLE" }
  | { type: "SPLIT_CELL" }
  | { type: "MERGE_CELLS" }
  | { type: "INSERT_IMAGE"; src: string; width?: number; height?: number }
  | { type: "SET_IMAGE_SIZE"; blockId: BlockId; width: number; height: number }
  | { type: "SET_TEXT_ALIGN"; align: TextAlign }
  | { type: "SET_LINE_SPACING"; spacing: number }
  | { type: "INDENT" }
  | { type: "OUTDENT" }
  | { type: "LIST_INDENT" }
  | { type: "LIST_OUTDENT" }
  | { type: "SET_PARAGRAPH_SPACING"; edge: "before" | "after"; value: number | null }
  | {
      type: "SET_FOOTNOTE_POLICY";
      reset?: FootnoteNumberingPolicy["reset"];
      format?: CounterFormat;
    }
  | { type: "REPLACE_MATCH"; match: TextMatch; replacement: string }
  | { type: "REPLACE_ALL"; matches: TextMatch[]; replacement: string }
  | { type: "ADD_COMMENT"; id: CommentId; author: string; body: string; createdAt: number }
  | { type: "RESOLVE_COMMENT"; id: CommentId }
  | { type: "REOPEN_COMMENT"; id: CommentId }
  | { type: "DELETE_COMMENT"; id: CommentId }
  | {
      type: "ADD_REPLY";
      commentId: CommentId;
      replyId: string;
      author: string;
      body: string;
      createdAt: number;
    }
  // Change-tracking (Suggesting mode) RESOLVE actions. NON-undoable — the state
  // ops run a `SUGGESTION_RESOLVE_ORIGIN` txn that fires no UndoManager StackItem
  // (accept/reject is final, Ctrl+Z cannot revert it — the Google Docs
  // convention). Classified `"resolve"` in `coalesce-key.ts`.
  | { type: "ACCEPT_SUGGESTION"; id: SuggestionId }
  | { type: "REJECT_SUGGESTION"; id: SuggestionId }
  | { type: "ACCEPT_ALL_SUGGESTIONS" }
  | { type: "REJECT_ALL_SUGGESTIONS" };

import type { Selection, Position, BlockInit, TextMatch } from "../state";
import type { TextAlign, TextTransform } from "../styles/style";
import type { CounterFormat, FootnoteNumberingPolicy } from "../footnotes";

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
      caretAffinity?: "before" | "after";
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
  | { type: "INSERT_HEADER" }
  | { type: "INSERT_FOOTER" }
  | { type: "INSERT_FOOTNOTE" }
  | { type: "SET_TEXT_ALIGN"; align: TextAlign }
  | { type: "SET_LINE_SPACING"; spacing: number }
  | { type: "INDENT" }
  | { type: "OUTDENT" }
  | { type: "SET_PARAGRAPH_SPACING"; edge: "before" | "after"; value: number | null }
  | {
      type: "SET_FOOTNOTE_POLICY";
      reset?: FootnoteNumberingPolicy["reset"];
      format?: CounterFormat;
    }
  | { type: "REPLACE_MATCH"; match: TextMatch; replacement: string }
  | { type: "REPLACE_ALL"; matches: TextMatch[]; replacement: string };

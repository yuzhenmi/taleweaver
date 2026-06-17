import type { Selection, Position, Span, BlockInit, TextMatch, BlockId, CrossReferenceMode, CommentId, SuggestionId, PageFieldNumberStyle } from "../state";
import type { TextAlign, TextTransform } from "../styles/style";
import type { TabStop } from "../styles/tab-stops";
import type { CounterFormat, FootnoteNumberingPolicy } from "../footnotes";
import type { CaretAffinity } from "../cursor/selection";
import type { ColumnRule } from "../styles/column-config";
import type { ImageWrap } from "./actions/set-image-wrap";

export type EditorAction =
  | { type: "INSERT_TEXT"; text: string }
  | { type: "DELETE_BACKWARD" }
  | { type: "SPLIT_NODE" }
  | { type: "MOVE_WORD"; direction: "forward" | "backward" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET_CONTAINER_WIDTH"; width: number }
  | {
      type: "SET_SELECTION";
      selection: Selection;
      caretPageHint?: number;
      caretAffinity?: CaretAffinity;
      // #503: the ANCHOR's bidi-boundary side. Post-Phase-0b, the backend
      // NavIntent resolver originates affinity (the lifted line/expand handlers
      // moved out of core), threading BOTH `caretAffinity` and `anchorAffinity`
      // here so affinity that once survived via the central-reset exemption now
      // survives via this carried payload. `handleSetSelection` STORES it.
      anchorAffinity?: CaretAffinity;
      // The line-navigation sticky goal-column (`targetX`). The backend computes
      // a line-move's `targetX` and threads it here so consecutive backend
      // ArrowUp/Down keep the column; `null` clears it (every non-line nav). The
      // central `targetX` clear in `reduceEditor` exempts `SET_SELECTION` so this
      // survives.
      targetX?: number | null;
    }
  | { type: "EXPAND_WORD"; direction: "forward" | "backward" }
  | { type: "DELETE_FORWARD" }
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
  | { type: "MOVE_DOCUMENT_BOUNDARY"; boundary: "start" | "end" }
  | { type: "EXPAND_DOCUMENT_BOUNDARY"; boundary: "start" | "end" }
  // ESCAPE (#525): deselect an object selection — collapse the caret to just
  // AFTER the atomic-leaf object (Google Docs). A no-op for a text caret.
  | { type: "ESCAPE" }
  | { type: "SELECT_ALL" }
  | { type: "DELETE_WORD"; direction: "forward" | "backward" }
  // DELETE_RANGE (Phase 0b): delete a geometry-free `Span` in ONE history commit,
  // collapsing the caret to the document-order START (normalized, backward-span
  // safe). The print backend computes the span for line-deletion (Cmd+Backspace)
  // — the geometry lives in the backend NavIntent — and dispatches this; core
  // owns the deletion. Also the public arbitrary-span delete (Phase 2).
  | { type: "DELETE_RANGE"; span: Span }
  | { type: "INSERT_NODE"; node: BlockInit; position?: Position }
  | { type: "SECTION_BREAK" }
  | { type: "TOGGLE_SECTION_LANDSCAPE" }
  | { type: "SET_SECTION_COLUMNS"; columnCount: number; columnGap?: number; columnRule?: ColumnRule | null }
  | { type: "INSERT_HEADER" }
  | { type: "INSERT_FOOTER" }
  | { type: "INSERT_FOOTNOTE" }
  | {
      type: "INSERT_CROSS_REFERENCE";
      targetId: BlockId;
      refMode: CrossReferenceMode;
      // Number format for `refMode: "page"` page-number references (default "decimal");
      // ignored by "number"/"text" modes. Read by the INSERT_CROSS_REFERENCE handler (S7).
      numberStyle?: PageFieldNumberStyle;
    }
  | { type: "INSERT_PAGE_NUMBER"; numberStyle?: PageFieldNumberStyle }
  | { type: "INSERT_PAGE_COUNT"; numberStyle?: PageFieldNumberStyle }
  | { type: "INSERT_TAB" }
  | { type: "SET_TAB_STOPS"; blockId: BlockId; tabStops: readonly TabStop[] }
  | { type: "INSERT_HORIZONTAL_LINE" }
  | { type: "INSERT_TABLE_OF_CONTENTS" }
  | { type: "INSERT_TABLE"; rows: number; cols: number }
  | { type: "INSERT_TABLE_ROW"; position: "above" | "below" }
  | { type: "INSERT_TABLE_COLUMN"; position: "left" | "right" }
  | { type: "DELETE_TABLE_ROW" }
  | { type: "DELETE_TABLE_COLUMN" }
  | { type: "DELETE_TABLE" }
  | { type: "SPLIT_CELL" }
  | { type: "MERGE_CELLS" }
  | { type: "INSERT_IMAGE"; src: string; width?: number; height?: number }
  | { type: "INSERT_INLINE_IMAGE"; src: string; width: number; height: number; alt: string }
  | { type: "SET_IMAGE_SIZE"; blockId: BlockId; width: number; height: number }
  | { type: "SET_IMAGE_WRAP"; blockId: BlockId; wrap: ImageWrap }
  | { type: "SET_IMAGE_ALT"; blockId: BlockId; alt: string | null }
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

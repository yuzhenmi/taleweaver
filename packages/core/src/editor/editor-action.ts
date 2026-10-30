import type { Selection, Position, Span, BlockInit, TextMatch, BlockId, CrossReferenceMode, CommentId, SuggestionId, PageFieldNumberStyle, State } from "../state";
import type { TextAlign, TextTransform } from "../styles/style";
import type { TabStop } from "../styles/tab-stops";
import type { CounterFormat, FootnoteNumberingPolicy } from "../footnotes";
import type { CaretAffinity } from "../cursor/selection";
import type { ColumnRule } from "../styles/column-config";
import type { Transaction } from "./extensions";
import type { Proposal } from "./proposals";

/** How text wraps around an image: floated left / right, or a full-width block. */
export type ImageWrap = "left" | "right" | "break";

export type EditorAction =
  /**
   * Insert `text` at the caret / over the selection. `userInput: true` marks text the
   * USER typed (keystrokes, beforeinput, IME commits) — only such text fires the host's
   * input rules and triggers; programmatic / command inserts never do.
   */
  | { type: "INSERT_TEXT"; text: string; userInput?: boolean }
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
      // The ANCHOR's bidi-boundary side. The backend
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
  /**
   * Put inline mark `key` = `value` on `span` (default: the selection). An
   * exclusive mark replaces the type's value there; a non-exclusive one adds an
   * instance (see `MarkSpec`). `replace` (non-exclusive marks): an existing
   * instance's value to swap for `value` in the same step (one undo step, one
   * suggestion). Undoable; tracked as a formatting suggestion in suggesting mode.
   * No-op on a collapsed span.
   */
  | { type: "SET_MARK"; key: string; value: unknown; replace?: unknown; span?: Span }
  /**
   * Remove inline mark `key` from `span` (default: the selection) — only the runs /
   * instance whose value deep-equals `value` when given, every value otherwise.
   */
  | { type: "REMOVE_MARK"; key: string; value?: unknown; span?: Span }
  | { type: "PASTE"; text?: string; html?: string; clip?: string }
  | { type: "SET_BLOCK_TYPE"; blockType: string; properties?: Record<string, unknown> }
  | { type: "TOGGLE_LIST"; listType: "ordered" | "unordered" }
  | { type: "SET_LIST_TYPE"; listType: "ordered" | "unordered" }
  | { type: "SET_LIST_RESTART"; value: number | null }
  | { type: "MOVE_DOCUMENT_BOUNDARY"; boundary: "start" | "end" }
  | { type: "EXPAND_DOCUMENT_BOUNDARY"; boundary: "start" | "end" }
  // ESCAPE: deselect an object selection — collapse the caret to just
  // AFTER the atomic-leaf object (Google Docs). A no-op for a text caret.
  | { type: "ESCAPE" }
  /**
   * Run several engine steps as ONE edit: `run` receives the live editor and a
   * `dispatch` that applies nested actions through the reducer — suggesting mode,
   * typing attrs and mark rules apply as for user edits — and they land in a SINGLE
   * undo entry. `run` must be pure (no host side effects): it may be re-run. Steps
   * must be undoable as part of it: dispatching UNDO / REDO, APPLY_FOREIGN_CHANGE
   * (untracked) or PROPOSE (another author's own entry) throws before it applies, and a throwing transaction is rolled back entirely.
   */
  | { type: "TRANSACTION"; run: (tx: Transaction) => void }
  /**
   * A collaborator's change has landed in this editor's Y.Doc (`dirtyIds` = the blocks
   * it touched; see `subscribeRemoteChanges`): reconcile the EditorState and rebase the
   * local selection through it. Never touches local undo grouping.
   */
  | { type: "APPLY_FOREIGN_CHANGE"; dirtyIds: ReadonlySet<BlockId> }
  | { type: "SELECT_ALL" }
  | { type: "DELETE_WORD"; direction: "forward" | "backward" }
  // DELETE_RANGE: delete a geometry-free `Span` in ONE history commit,
  // collapsing the caret to the document-order START (normalized, backward-span
  // safe). The print backend computes the span for line-deletion (Cmd+Backspace)
  // — the geometry lives in the backend NavIntent — and dispatches this; core
  // owns the deletion. Also the public arbitrary-span delete.
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
      // ignored by "number"/"text" modes. Read by the INSERT_CROSS_REFERENCE handler.
      numberStyle?: PageFieldNumberStyle;
    }
  | { type: "INSERT_PAGE_NUMBER"; numberStyle?: PageFieldNumberStyle }
  | { type: "INSERT_PAGE_COUNT"; numberStyle?: PageFieldNumberStyle }
  | { type: "INSERT_TAB" }
  /** Soft line break (Shift+Enter): an inline `hard-break` in the paragraph. */
  | { type: "INSERT_LINE_BREAK" }
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
  // Change-tracking RESOLVE actions — each ONE undoable history entry (undo restores
  // the suggestion exactly). A suggestion that belongs to a group resolves with its
  // whole group (groups are reviewed as one unit).
  | { type: "ACCEPT_SUGGESTION"; id: SuggestionId }
  | { type: "REJECT_SUGGESTION"; id: SuggestionId }
  | { type: "ACCEPT_SUGGESTION_GROUP"; groupId: string }
  | { type: "REJECT_SUGGESTION_GROUP"; groupId: string }
  | { type: "ACCEPT_ALL_SUGGESTIONS" }
  | { type: "REJECT_ALL_SUGGESTIONS" }
  /**
   * A host PROPOSAL: several edits recorded as ONE suggestion group, in any editing
   * mode. Like another author's change it is NOT in the user's undo stack, and the caret
   * is only rebased through it. `basedOn`: the version the edit positions refer to —
   * mapped through the change chain (stale when the ranges changed). Refused whole when
   * invalid / self-overlapping / overlapping a pending suggestion. The verdict lands on
   * `EditorState.lastProposal`.
   */
  | { type: "PROPOSE"; proposal: Proposal; basedOn?: State };

/** The member of `EditorAction` whose `type` is `K`. */
export type ActionOf<K extends EditorAction["type"]> = Extract<EditorAction, { type: K }>;

/**
 * The `state/` module barrel — the intra-core API contract.
 *
 * This file IS the surface that sibling core modules (render, cascade,
 * layout, cursor, editor, components) and the cross-package
 * `packages/core/src/index.ts` are meant to import from. It re-exports the
 * three-layer API of the document model — types & access primitives, pure
 * utilities, state-mutating operations — plus the boot helper.
 *
 * The barrel uses explicit named `export { ... } from` re-exports (never
 * `export *`) so the surface is reviewable symbol-by-symbol and so the
 * infrastructure files below are PROVABLY excluded.
 *
 * Excluded by design (state-module-private infrastructure — NOT re-exported
 * here, so consumers outside `state/` cannot reach them through the barrel):
 *   - `state-internal`        — the `STATE_INTERNAL` symbol gating State's
 *                               underlying Y.Doc + snapshot cache. Its
 *                               containment is the whole Yjs encapsulation;
 *                               re-exporting it would open the breach.
 *   - `yjs-doc` / `y-block` / `y-utils` — Y.Doc construction + the
 *                               read/write helpers between Block snapshots
 *                               and the inner Y.Map entries.
 *   - `snapshot`              — per-State snapshot cache.
 *   - `dev-mode`              — `isDevMode()` gate for invariant assertions.
 *   - `id-collision-check`    — UUID-collision defense.
 *   - `build-state-from-blocks` — internal fixture builder (the public
 *                               `buildState` test-util delegates here).
 *   - `root-id-cache`         — `getEmbedContentRootIds` / `getTemplateContentRootIds`
 *                               take a raw `Y.Doc`, so they're infra; the
 *                               consumer-facing accessors are
 *                               `getEmbedContentIds` / `getTemplateContentIds`
 *                               (Layer 1, on `state`).
 *   - `block-schema`          — `BLOCK_FIELDS` / `BlockFieldSpec` is the
 *                               shared read/write-path schema, consumed only
 *                               by `snapshot.ts` and `y-block.ts`. It's a
 *                               write-path internal seam, not a consumer API.
 */

// ─────────────────────────────────────────────────────────────────────────
// Layer 1 — types and access primitives
//
// Yjs-free value types plus the narrow O(1) snapshot accessors. `State`'s
// only public field is `rootId`; the underlying Y.Doc + snapshot cache live
// behind the non-exported STATE_INTERNAL symbol (deliberately absent above).
// ─────────────────────────────────────────────────────────────────────────

// State container, transaction runner, snapshot accessors.
export type {
  State,
  OperationResult,
  ResolvedBlock,
  ResolvedBlockKind,
} from "./state";
export {
  createState,
  applyOperation,
  freshState,
  freshStateFromDoc,
  getBlock,
  getEmbedContent,
  getTemplateContent,
  resolveBlock,
  getEmbedContentIds,
  getTemplateContentIds,
  docHasFootnotes,
} from "./state";

export { subscribeForeignChanges } from "./collab";
export { runWithTransactionOrigin } from "./yjs-doc";

// Block snapshot type and the insert-time partial-block shape.
export type { Block } from "./block";
export type { BlockInit } from "./block-init";

// Block identity and allocation.
export type { BlockId, IdAllocator } from "./block-id";
export type { BlockParentLookup } from "./block-parent-lookup-type";
export type { PageConfig, PageMargins } from "./page-config";
export {
  asBlockId,
  coerceBlockId,
  productionAllocator,
  createTestAllocator,
  newListId,
} from "./block-id";

// Positions, spans, selections + pure builders / comparisons.
export type { Position, Span, Selection } from "./block-position";
export {
  createPosition,
  createSpan,
  positionsEqual,
  comparePositionsWithinBlock,
} from "./block-position";

// Inline content: items + pure normalization / offset helpers.
export type {
  InlineContent,
  InlineItem,
  TextItem,
  EmbedItem,
} from "./inline-content";
export {
  inlineContentLength,
  findItemAtOffset,
  attrsAtOffset,
  mergeAdjacentTextItems,
  splitInlineContentAtOffset,
  INLINE_IMAGE_EMBED_TYPE,
} from "./inline-content";

// Open-schema attribute values + equality / merge helpers.
export type { ReadonlyAttrs } from "./attrs";
export { deepValueEqual, attrsEqual, mergeAttrs } from "./attrs";

// Block-shape taxonomy + the resolver the component registry implements.
// Callers ask "what kind is this type?" via the resolver directly
// (`resolver.getBlockKind(type)`); there is no separate free function.
export type { BlockKind, BlockKindResolver } from "./block-kinds";

// ─────────────────────────────────────────────────────────────────────────
// Layer 2 — pure read-only utilities
//
// Traversal, document-order comparison, span iteration, text extraction.
// Consumed both by Layer 3 internally and by external read paths (cursor,
// render, editor geometry queries).
// ─────────────────────────────────────────────────────────────────────────

// Block-tree traversal.
export {
  nextBlockInDocOrder,
  prevBlockInDocOrder,
  ancestorChain,
  firstLeafBlock,
  lastLeafBlock,
} from "./block-traversal";

// Table editing (P15a): caret→table context resolution + columnWidths helpers +
// the shared cell-span predicate.
export { resolveTableContext, getChildIds, buildTableGrid } from "./table-context";
export type { TableContext } from "./table-context";
export { spliceColumnWidth, removeColumnWidth } from "./table-column-widths";
export { spanValue, isSpan } from "./table-cell-span";
// Layering-neutral occupancy-grid core (P8 §17.5 scan, shared by layout + the
// P15b state-side span-aware editing ops). Layout's `assignTableGrid` adapter
// (layout/table-grid.ts) and state ops build the SAME grid from this core.
export { assignTableGrid } from "./table-grid-core";
export type { GridCell, AssignedCell, TableGrid } from "./table-grid-core";
// Cross-cell selection → grid rectangle resolver (P15b span-aware editing input):
// bounding-box the anchor/focus cells over the occupancy grid, then fixpoint-
// expand to whole span-rectangles. The editor `Selection` stays linear.
export { resolveCellRange } from "./table-cell-range";
export type { CellRange } from "./table-cell-range";

// Document-order comparison + span endpoints + selection-context lookup.
export {
  compareBlocksInDocOrder,
  comparePositions,
  spanStart,
  spanEnd,
  selectionContextOf,
} from "./block-compare";

// Span normalization + per-leaf / per-block iteration.
export type { BlockRange } from "./span-iteration";
export { normalizeSpan, iterateSpan, iterateBlocksInSpan } from "./span-iteration";

// Whole-document depth-first block walk + the list-presence predicate the
// render pass uses to short-circuit list-event collection on list-free docs.
export { iterateBlocksInDocumentOrder, iterateLeafBlocksInDocumentOrder, docHasLists } from "./document-order";

// List numbering definitions (per-list level configuration). `getListDefsForState`
// is the render-pass entry point — it resolves all defs as a plain Map for the
// numbering engine (`computeCounters`).
export type { ListDef, ListLevelConfig } from "./list-defs";
export { getListDefsForState, classifyListDef } from "./list-defs";

// Flatten a span to plain text (clipboard, find/replace, a11y).
export type { EmbedSerializer } from "./extract-text";
export { extractText, builtinEmbedSerializer, captionEmbedSerializer } from "./extract-text";

// Find: non-overlapping text search over main-tree leaf blocks (Find & Replace
// foundation — read-only query, returns block-relative match offsets).
export type { TextMatch, FindMatchesOptions } from "./find-matches";
export { findMatches } from "./find-matches";

// Word count: read-only document statistics over main-tree leaf blocks
// (Google Docs Tools ▸ Word count — words / characters / chars-excl-spaces).
// `getSelectionWordCount` is the per-selection figure shown alongside the
// document total; `countText` is the shared single-string counting kernel.
export type { WordCount, WordCountOptions } from "./word-count";
export { getWordCount, getSelectionWordCount, countText } from "./word-count";

// Document outline: read-only flat list of heading blocks over main-tree leaf
// blocks (Google Docs View ▸ Show outline — blockId / level / text per heading).
export type { OutlineEntry, OutlineOptions, OutlineSigEntry, OutlineSignature } from "./outline";
export {
  getOutline,
  computeOutlineSignature,
  outlineSignaturesEqual,
  EMPTY_OUTLINE_SIGNATURE,
} from "./outline";

// Active formatting: read-side counterpart to the SET_*/TOGGLE_STYLE actions —
// the inline + block formatting active at a selection (value / "mixed" / unset),
// for driving a formatting toolbar's pressed-states + value controls.
export type { ActiveFormatting } from "./active-formatting";
export { getActiveFormatting } from "./active-formatting";

// ─────────────────────────────────────────────────────────────────────────
// Layer 3 — state-mutating operations + history
//
// The audited write surface. Every op takes a State + args and returns an
// OperationResult (new state + dirtyIds). Editor action handlers are the
// sole external callers; each composes one or more ops then records a
// single undo entry via History.
//
// The op files live in the `ops/` subdirectory (one file per barrel-exposed
// operation, plus each op's `plan*` / `*InTx` primitives). This barrel is the
// public op surface; the prose groupings below (inline / structural / attrs /
// section / template) are the category taxonomy. History and the boot helper
// stay at the top level (they are not document-mutation ops).
// ─────────────────────────────────────────────────────────────────────────

// Inline-content edits.
export { insertText } from "./ops/insert-text";
export { deleteRange } from "./ops/delete-range";
export { replaceRange } from "./ops/replace-range";
export type { ReplaceAllPlan, BlockWrite } from "./ops/replace-matches";
export {
  // Planner + applier are split-exposed (unlike planDeleteRange etc., which stay
  // private) so REPLACE_ALL can plan, then read the plan for cursor placement,
  // before applying in one transaction.
  planReplaceMatches,
  replaceAllMatches,
  applyReplaceAllPlan,
} from "./ops/replace-matches";
export { applyAttrsToRange } from "./ops/apply-attrs";

// Block-structural edits.
export { splitBlockAtPosition } from "./ops/split-block";
// Suggesting-mode paragraph SPLIT (Enter): a real `splitBlockAtPosition` + a
// zero-width `block-split-suggestion` embed at the end of the first block + an
// `insertion` record, all in ONE transaction. Grouped with the suggestion CREATE
// ops (`mintInsertion`/`markDeletion`) below by intent; lives here next to the
// split op it builds on.
export { splitWithSuggestion } from "./ops/split-block";
export { mergeAdjacentBlocks } from "./ops/merge-blocks";
// Suggesting-mode paragraph JOIN (Backspace at block-start / Delete at block-end):
// a zero-width `block-join-suggestion` embed at the end of the FIRST block + a
// `deletion` record, in ONE transaction. Does NOT merge the blocks (resolution
// does). Mirror of `splitWithSuggestion`; lives next to the merge op it pairs with.
export { markBlockJoinSuggestion } from "./ops/merge-blocks";
export type { InsertBlockArgs } from "./ops/insert-block";
export { insertBlock } from "./ops/insert-block";
export type { SiblingBlockInit } from "./ops/insert-blocks-after";
export { insertBlocksAfter } from "./ops/insert-blocks-after";
export { removeBlock } from "./ops/remove-block";
// `replaceBlockWithText` removes a whole block AND inserts text into a surviving
// sibling in ONE transaction (one undo entry) — image OBJECT-SELECTION, #525.
// Composes `removeBlockInTx` + `insertTextInTx` (both stay op-internal), mirroring
// `replaceRange`'s atomic delete+insert. The sole-child "seed a fresh paragraph"
// case (delete leaving an empty body) is handled by `deleteTableWithReplacement`
// (a generic remove-block-with-replacement primitive; see its docstring).
export { replaceBlockWithText } from "./ops/replace-block-with-text";
// Table editing (P15a). `planInsertTableRow` / `insertTableRowInTx` are
// intentionally NOT re-exported (the in-tx primitives stay op-internal, matching
// planInsertBlock / insertBlockInTx).
export { insertTableRow } from "./ops/insert-table-row";
export type { RowPosition } from "./ops/insert-table-row";
export { deleteTableWithReplacement } from "./ops/delete-table";
export { insertTableColumn } from "./ops/insert-table-column";
export type { ColumnPosition } from "./ops/insert-table-column";
export { splitCell } from "./ops/split-cell";
export { mergeCells } from "./ops/merge-cells";
export { insertTableRowSpanAware } from "./ops/insert-table-row-span-aware";
export { insertTableColumnSpanAware } from "./ops/insert-table-column-span-aware";
export { deleteTableRowSpanAware } from "./ops/delete-table-row-span-aware";
export { deleteTableRow } from "./ops/delete-table-row";
export { deleteTableColumn } from "./ops/delete-table-column";
export { deleteTableColumnSpanAware } from "./ops/delete-table-column-span-aware";
export { createTable, buildTableSubtreePlan } from "./ops/create-table";
export { setTableHeaderRows } from "./ops/set-table-header-rows";
export { largestCleanHeaderCount, adjustHeaderRowCount } from "./ops/table-header-rows";
export type { RowEditOp } from "./ops/table-header-rows";
export type {
  CreateTablePlan,
  TableSubtreePlan,
  TableRowPlan,
  TableCellPlan,
} from "./ops/create-table";

// Block-attribute + type edits.
export { setBlockAttrs, setBlockAttrsInTx } from "./ops/set-block-attrs";
export { mergeBlockAttrs } from "./ops/merge-block-attrs";
export { setBlockType } from "./ops/set-block-type";

// List config edits (per-list numbering type + per-item counter restart).
export { setListType } from "./ops/set-list-type";
export { setListRestart } from "./ops/set-list-restart";

// Section structure (flat never-nested `section` blocks).
export { reparentChildren } from "./ops/reparent-children";
export type { SectionBreakResult } from "./ops/section-break";
export { applySectionBreak } from "./ops/section-break";
export { mergeSectionWithPrevious } from "./ops/merge-section";

// Header/footer template bodies (C.2c). Creates + links a one-paragraph body.
export type {
  TemplateRegion,
  InsertTemplateBodyArgs,
  InsertTemplateBodyResult,
} from "./ops/insert-template-body";
export { insertTemplateBody } from "./ops/insert-template-body";

// Footnotes (FN-1). Atomically creates a footnote anchor (an EmbedItem at the
// cursor) + its body subtree (a CONTAINER root + one paragraph) in embedContents.
export type { InsertFootnoteResult } from "./ops/insert-footnote";
export {
  insertFootnote,
  FOOTNOTE_ANCHOR_EMBED_TYPE,
} from "./ops/insert-footnote";
export type { CrossReferenceMode } from "./ops/insert-cross-reference";
export {
  insertCrossReference,
  CROSS_REFERENCE_EMBED_TYPE,
} from "./ops/insert-cross-reference";
export { insertTab, TAB_EMBED_TYPE } from "./ops/insert-tab";
// Inline image (Google Docs "In line" positioning). A primitive-property inline
// embed with NO owned body — its image data (`src`/`width`/`height`/`alt`) lives
// inline in `properties`; render lays it out as a single inline-block replaced
// atom. The `INLINE_IMAGE_EMBED_TYPE` discriminant lives in `./inline-content`
// (re-exported from this barrel) so Layer-1 consumers import it without reaching
// into `ops/`.
export { insertInlineImage } from "./ops/insert-inline-image";
export type { InlineImageProperties } from "./ops/insert-inline-image";
// Hard line break (`<br>`). Produced ONLY by HTML decode (no editor action / op),
// so the embed-type constant lives at the state root (`./hard-break`) — like
// `./page-field` and `./comments` — so Layer-1 `extract-text.ts` can import it
// without reaching into `ops/`.
export { HARD_BREAK_EMBED_TYPE } from "./hard-break";
// Page-fields (layout-dependent reference fields: page-number / page-count). A
// pointer-property inline embed with NO owned body — its value is resolved from
// PAGINATED layout (the render-time placeholder is page-agnostic). Constants live
// at the state root (`./page-field`) so Layer-1 `extract-text.ts` can import the
// embed-type without reaching into `ops/`.
export { insertPageField } from "./ops/insert-page-field";
export { PAGE_FIELD_EMBED_TYPE, PAGE_FIELD_RESERVED_GLYPHS, isPageFieldKind, isPageFieldNumberStyle } from "./page-field";
export type { PageFieldKind, PageFieldNumberStyle, PageFieldProperties } from "./page-field";

// Comments. Paired zero-width `comment-start`/`comment-end` marker embeds
// delimit a comment range; the markers ARE the anchor (they move/clone with
// surrounding text for free). `insertCommentMarkers` inserts the pair;
// `buildCommentRangeIndex` / `resolveCommentRange` resolve the range (incl.
// derived `orphaned`) by content scan. The thread-record CRUD ops
// (`addComment`/`resolveComment`/`reopenComment`/`deleteComment`/`addReply`)
// are NORMAL tracked `applyOperation` content ops — the comments Y.Map is in
// the UndoManager's tracked scopes, so a comment reverts atomically with its
// markers. `getComments` is the read surface (record + scanned range).
export { insertCommentMarkers } from "./ops/insert-comment-markers";
export {
  addComment,
  resolveComment,
  reopenComment,
  deleteComment,
  addReply,
} from "./ops/comment-ops";
export type { AddCommentInput, AddReplyInput } from "./ops/comment-ops";
export type {
  CommentId,
  CommentReply,
  CommentRecord,
  CommentRange,
  ResolvedComment,
} from "./comments";
export {
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  buildCommentRangeIndex,
  resolveCommentRange,
  getComments,
  // `replyToY` (CommentReply → Y.Map) is re-exported here for INTRA-STATE use
  // only (the `addReply` op in ops/comment-ops.ts) — it is deliberately NOT on
  // the public core barrel (`packages/core/src/index.ts`), since nothing outside
  // `state/` builds reply Y.Maps. Mirrors how the `*InTx` write-path helpers are
  // exposed state-internally without leaking to the cross-package surface.
  replyToY,
} from "./comments";

// Change-tracking / Suggesting mode (slice 1 — INERT state vocabulary). The
// three inline-attr dimensions (`insertion/deletion/formattingSuggestionId`) +
// the two zero-width break embeds (block-join/split) tag tracked changes; their
// records live in the 6th `suggestions` side-table Y.Map keyed by SuggestionId.
// The types + attr-key + embed-type consts are part of the public surface (the
// editor/render layers + downstream consumers need them broadly); the side-table
// IO helpers (`getSuggestionsMap`, `writeSuggestionRecordInTx`,
// `readSuggestionRecord`) are intra-state — imported directly from `./yjs-doc` /
// `./suggestions`, NOT re-exported here (mirror of comments' `getCommentsMap` /
// `writeCommentRecordInTx`).
export type {
  SuggestionId,
  SuggestionKind,
  SuggestionRecord,
  SuggestionRange,
  ResolvedSuggestion,
  SuggestionMintInput,
  SuggestionView,
} from "./suggestions";
export {
  newSuggestionId,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  // The slice-5c preview-view projection foundation — per-item visibility under
  // a `SuggestionView` ("suggesting"/"final"/"original"); consumed by the read
  // surfaces (extractText/getWordCount) and the render pass.
  itemVisibleInView,
  blockBoundaryMergesInView,
  buildSuggestionRangeIndex,
  resolveSuggestionRange,
  getSuggestions,
  // `State`-level record read used by the render pass (expandInlineItems) to
  // resolve suggestion visuals (author color + underline/lineThrough) without
  // piercing STATE_INTERNAL.
  readSuggestionRecordFromState,
  // The Layer-1 origin slice-3's accept/reject ops pass to make the resolve
  // txn non-undoable; intra-state (consumed by ops), barrel-exposed here.
  SUGGESTION_RESOLVE_ORIGIN,
} from "./suggestions";
// Suggesting-mode Layer-3 op surface (the complete feature op set). The three
// CREATE ops (`markFormatting`/`markDeletion`/`mintInsertion`) mint suggestions
// from the editor's mutating handlers in Suggesting mode (slice 4b+); the four
// RESOLVE ops (`acceptSuggestion`/`rejectSuggestion`/`acceptAll`/`rejectAll`)
// run a `SUGGESTION_RESOLVE_ORIGIN` (non-undoable) transaction.
export {
  markFormatting,
  markDeletion,
  mintInsertion,
  replaceWithSuggestion,
  replaceWithSuggestedFragment,
  splitWithSuggestionOverSelection,
  acceptSuggestion,
  rejectSuggestion,
  acceptAll,
  rejectAll,
} from "./ops/suggestion-ops";
export type { ReplaceSuggestionInput } from "./ops/suggestion-ops";

// History (Y.UndoManager-backed undo/redo with aligned selection stacks).
export type { SelectionEntry, UndoRedoResult, BeginKey } from "./history";
export { History, createHistory, UNDO_COALESCE_PAUSE_MS } from "./history";

// ─────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────

export type { CreateEmptyDocumentArgs } from "./initial-state";
export { createEmptyDocument } from "./initial-state";

// Declarative construction — the SAFE public counterpart to the internal
// `buildStateFromBlocks`. `buildDocumentFromTree` lowers a nested `BlockNode`
// tree (no ids, no manual sibling/parent pointers) to a `State`, minting ids
// and DERIVING all structural links. It is the format-agnostic foundation any
// importer (e.g. the HTML serializer) targets. (`buildStateFromBlocks` /
// `buildStateWithListDefs` stay state-module-internal — barrel-excluded — since
// their manual link fields are a footgun.)
export type { BlockNode, ContainerBlockNode, LeafBlockNode } from "./build-document-from-tree";
export { buildDocumentFromTree } from "./build-document-from-tree";

// ───────────────────────────────────────────────────────────────────────────
// Document serialization — pluggable DocumentSerializer + registry + engine
// dispatch + the v1 lossless Yjs-binary serializer. The serialize module lives
// INSIDE state/ because it consumes/produces State and needs the raw Y.Doc
// (read via STATE_INTERNAL by sibling import); its barrel surface is re-exported
// here. `getMetaRootId` (yjs-doc) stays state-private and is NOT re-exported.
// ───────────────────────────────────────────────────────────────────────────
export type { SerializedDocument, DocumentSerializer, SerializerRegistry } from "./serialize";
export type { HtmlNode, HtmlParser } from "./serialize";
export {
  createSerializerRegistry,
  createDefaultSerializerRegistry,
  serializeDocument,
  deserializeDocument,
  createBinaryDocumentSerializer,
  BINARY_FORMAT,
  createJsonDocumentSerializer,
  JSON_FORMAT,
  UnknownSerializerFormatError,
  MalformedDocumentError,
  encodeHtml,
  decodeHtml,
  createHtmlDocumentSerializer,
  HTML_FORMAT,
} from "./serialize";

// NOTE: the reparent write-list machinery (`computeReparentWrites`,
// `planReparentChildren`, `reparentChildrenInTx`, `BlockFieldWrite`,
// `ReparentPlan`) and the paste helper `clonePastedSubtree` / `ClonedSubtree`
// are deliberately NOT re-exported here. They are state-module-internal: the
// only intra-core callers (`section-break`, `merge-section`) import them
// directly from `./ops/reparent-children`, keeping the barrel's public op
// surface to the supported entry points (`reparentChildren`, `applySectionBreak`).

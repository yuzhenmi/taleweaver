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

// Block snapshot type and the insert-time partial-block shape.
export type { Block } from "./block";
export type { BlockInit } from "./block-init";

// Block identity and allocation.
export type { BlockId, IdAllocator } from "./block-id";
export {
  asBlockId,
  coerceBlockId,
  productionAllocator,
  createTestAllocator,
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
export { iterateBlocksInDocumentOrder, docHasLists } from "./document-order";

// List numbering definitions (per-list level configuration). `getListDefsForState`
// is the render-pass entry point — it resolves all defs as a plain Map for the
// numbering engine (`computeCounters`).
export type { ListDef, ListLevelConfig } from "./list-defs";
export { getListDefsForState } from "./list-defs";

// Defensive load-time migration: OLD structural `list` containers → FLAT
// list-item attrs. A consumer that loads a persisted document runs this once
// before editing; live editing never produces structural lists, so the engine
// has no auto-call site (persistence is a downstream concern).
export { migrateListStructure } from "./migrate-list-structure";

// Flatten a span to plain text (clipboard, find/replace, a11y).
export type { EmbedSerializer } from "./extract-text";
export { extractText, builtinEmbedSerializer } from "./extract-text";

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
export type { OutlineEntry, OutlineOptions } from "./outline";
export { getOutline } from "./outline";

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
export { mergeAdjacentBlocks } from "./ops/merge-blocks";
export type { InsertBlockArgs } from "./ops/insert-block";
export { insertBlock } from "./ops/insert-block";
export type { SiblingBlockInit } from "./ops/insert-blocks-after";
export { insertBlocksAfter } from "./ops/insert-blocks-after";
export { removeBlock } from "./ops/remove-block";

// Block-attribute + type edits.
export { setBlockAttrs } from "./ops/set-block-attrs";
export { mergeBlockAttrs } from "./ops/merge-block-attrs";
export { setBlockType } from "./ops/set-block-type";

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

// History (Y.UndoManager-backed undo/redo with aligned selection stacks).
export type { SelectionEntry, UndoRedoResult, BeginKey } from "./history";
export { History, createHistory, UNDO_COALESCE_PAUSE_MS } from "./history";

// ─────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────

export type { CreateEmptyDocumentArgs } from "./initial-state";
export { createEmptyDocument } from "./initial-state";

// NOTE: the reparent write-list machinery (`computeReparentWrites`,
// `planReparentChildren`, `reparentChildrenInTx`, `BlockFieldWrite`,
// `ReparentPlan`) and the paste helper `clonePastedSubtree` / `ClonedSubtree`
// are deliberately NOT re-exported here. They are state-module-internal: the
// only intra-core callers (`section-break`, `merge-section`) import them
// directly from `./ops/reparent-children`, keeping the barrel's public op
// surface to the supported entry points (`reparentChildren`, `applySectionBreak`).

import { resolveBlock, selectionContextOf } from "@taleweaver/core";
import type { State, Position, BlockId } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";
import type { PagePlan } from "../layout/measure-pass";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import type { TextShaper } from "@taleweaver/core";
import type { TextMeasurer } from "@taleweaver/core";
import { isTextShaper, adaptShaperToMeasurer } from "@taleweaver/core";
import {
  getLineIndex,
  pickSoftWrapLine,
  coordOf,
  sizeAlong,
  lineCoordOf,
  lineSizeAlong,
  type AbsoluteLineBox,
} from "./line-flatten";
import {
  buildLineBidiView,
  caretInlineCoordInLeaf,
  findLeafOwner,
  type CaretAffinity,
} from "./line-bidi";
import { axisMapFor } from "@taleweaver/core";
import { markStart, markEnd } from "@taleweaver/core";
import { isDevMode } from "@taleweaver/core";

// Re-exported so existing importers of `cursor-position.ts` keep working; the
// single declaration lives in the core selection module (`./selection`).
export type { CaretAffinity };

/**
 * Pixel-position result for a resolved Position. Coords are page-
 * relative (descendants of PageBox use the page's coordinate frame;
 * otherwise document-relative).
 */
export interface PixelPosition {
  x: number;
  /** Cursor y (top of line box, page-relative). */
  y: number;
  /** Cursor height (line height, excluding margins). */
  height: number;
  /** Top of the line box (page-relative, no margin offset). */
  lineY: number;
  /** Full line height (excluding margins). */
  lineHeight: number;
  /** Resolved top margin of the line in px. */
  lineMarginTop: number;
  /** Resolved bottom margin of the line in px. */
  lineMarginBottom: number;
  /** Page this position is on. */
  pageIndex: number;
}

/** Default-shape PixelPosition used when no spatial information is available. */
function defaultPixelPosition(): PixelPosition {
  return {
    x: 0,
    y: 0,
    height: 16,
    lineY: 0,
    lineHeight: 16,
    lineMarginTop: 0,
    lineMarginBottom: 0,
    pageIndex: 0,
  };
}

/**
 * Resolve a state Position to pixel coordinates using the layout tree.
 *
 * Algorithm (LineBox-canonical; see
 * `docs/superpowers/specs/2026-05-23-linebox-canonical-anchor-design.md`):
 *   1. `resolveBlock(state, position.blockId)` (checks main / embed /
 *      template trees, so a header/footer slot body block resolves too).
 *      Returns null on miss.
 *   2. Walk every LineBox; pick the one whose
 *      `(ownerBlockId, inlineOffsetStart..inlineOffsetEnd)` contains
 *      the position. Soft-wrap preference: at an exact boundary
 *      `offset === currentLine.inlineOffsetEnd`, prefer the NEXT
 *      line's start when both belong to the same block (caret at
 *      visual line break stays on the new line, matching Word /
 *      Google Docs).
 *   3. Within the picked line, walk leaves accumulating
 *      `offsetContribution` until we cover
 *      `withinLineOffset = position.offset - line.inlineOffsetStart`.
 *      For text-run leaves: prefix-measure for X. For inline-block
 *      leaves: X = leading edge (offset == cumulative) or trailing
 *      edge (offset == cumulative + 1).
 *   4. Empty line: caret at `(line.absoluteX, line.absoluteY)`.
 *   5. No line for blockId (defensive — empty container block with
 *      null inlineContent): fall back to a block-baseline walk that
 *      finds the block's `BlockBox` and returns its top-left.
 *
 * Accepts EITHER a fully-positioned `LayoutBox` (unpaginated /
 * legacy-fallback) OR a
 * `VirtualLayoutTree` (paginated mode). For a virtual tree the
 * cursor's page is resolved via the `PagePlan` and only that page (+
 * an adjacent page at the cross-page soft-wrap edge) is materialized
 * via `getPage` — never the whole document. This is what makes caret
 * resolution O(1 page) on the typing/Enter hot path (Phase 3 Task 3).
 */
export function resolvePixelPosition(
  state: State,
  position: Position,
  layoutTree: LayoutBox | VirtualLayoutTree,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  // #323: which page's header/footer SLOT instance to resolve a template-block
  // caret on. `undefined` → the body's first carrying page (the deterministic
  // default). Ignored for a normal main-tree caret (the plan maps it to its own
  // page). View state — see `EditorState.caretPageHint`.
  caretPageHint?: number,
  // P4-C.2.1: which side a collapsed caret sticks to at a bidi run boundary.
  // `undefined` defaults to `"after"` (today's behavior). View state — see
  // `EditorState.caretAffinity`. Inert on uniform (single-direction) lines.
  caretAffinity?: CaretAffinity,
): PixelPosition | null {
  const t = markStart("cursor.cursor-position");
  try {
    // `resolveBlock` (not `getBlock`) so a caret in a HEADER/FOOTER slot
    // (C.2c T6) is not rejected here: a slot body block lives in the
    // `templateContents` tree, which `getBlock` (main map only) misses.
    // `resolveBlock` checks all three trees (main / embed / template).
    if (resolveBlock(state, position.blockId) === null) return null;

    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    if (layoutTree.type === "virtual-root") {
      return resolveInVirtualTree(layoutTree, position, measurer, state, caretPageHint, caretAffinity);
    }

    // Positioned-tree path (unchanged): O(1) lookup via the cached
    // BlockId→AbsoluteLineBox[] index. Previously this filtered the full
    // line list per call (O(N_lines)); at scale that dominated cursor-
    // position cost on a hot doc (L-PERF-D).
    const ownLines = getLineIndex(layoutTree).byBlock.get(position.blockId) ?? [];
    if (ownLines.length === 0) {
      // Defensive fallback: block has no LineBoxes (no IFC ran for
      // it — e.g., a container block with null inlineContent). Walk
      // the layout tree for the BlockBox and return its top-left.
      const baseline = findBlockBaseline(layoutTree, position.blockId);
      return baseline ?? defaultPixelPosition();
    }

    return resolvePositionInOwnLines(ownLines, position, measurer, caretAffinity);
  } finally {
    markEnd("cursor.cursor-position", t);
  }
}

/**
 * Resolve a position within a `VirtualLayoutTree` by materializing only the
 * page(s) the cursor touches — never the whole document.
 *
 * Page resolution: `plan.pageIndexOfBlock(blockId)` returns the page where the
 * block makes whole-block progress, i.e. the LAST page a spanning block touches
 * (a paragraph crossing pages N..M maps to M). We start there and walk earlier
 * pages only while the offset precedes the page's first own-line — so a block on
 * a single page materializes exactly ONE page, and a spanning block
 * materializes only as many pages as separate the cursor offset from the
 * block's end. The walk is FLOORED at the block's first page
 * (`plan.pageSpanOfBlock(blockId).first`) so it never steps onto a page the
 * block does not occupy — that would both materialize unrelated pages (perf) and
 * risk resolving against a different block's line at offset 0 (correctness).
 *
 * Cross-page soft-wrap edge: at a block's last line on page N with
 * `offset === inlineOffsetEnd`, if the block continues onto page N+1 we fetch
 * `getPage(N+1)` and return its first same-block line (Word/Docs convention —
 * the caret snaps to the visual next line). Bounded to one extra page.
 *
 * When `pageIndexOfBlock` returns -1 (the block is not a top-level body child),
 * the caret is resolved PER-PAGE via a secondary plan resolver: a header/footer
 * slot body via `resolveTemplateBlockPage`, or a footnote body via
 * `resolveFootnoteBlockPage` (`pageIndexOfFootnoteBlock`). A well-formed doc's
 * caret always maps to one of these; reaching neither is a stale-caret error
 * (dev-throw; prod returns `null`). NEVER positions the whole document.
 */
function resolveInVirtualTree(
  tree: VirtualLayoutTree,
  position: Position,
  measurer: TextMeasurer,
  state: State,
  caretPageHint?: number,
  caretAffinity?: CaretAffinity,
): PixelPosition | null {
  const plan = tree.plan;
  const endPage = plan.pageIndexOfBlock(position.blockId);

  if (endPage < 0) {
    // Header/footer SLOT fast path (C.2c T6, #323). A slot body block lives in
    // the `templateContents` tree, not the main document flow, so
    // `pageIndexOfBlock` can't map it (it's never a top-level body child).
    // Resolve it WITHOUT materializing the whole document: pick the page whose
    // slot the caret is visually on (the `caretPageHint`, or the body's first
    // carrying page by default), materialize ONLY that page, and resolve
    // against its slot lines (which change (1) put into the page's `byBlock`
    // index). #323 resolves the prior first-instance limitation by threading
    // the page hint; the descendant parent-walk inside `resolveTemplateBlockPage`
    // covers the #326 container-body case (caret in the body's paragraph CHILD,
    // not the slot ROOT id).
    const resolvedPage = resolveTemplateBlockPage(state, plan, position.blockId, caretPageHint);
    if (resolvedPage >= 0) {
      const onResolved = resolveSlotOnPage(tree, resolvedPage, position, measurer, caretAffinity);
      if (onResolved !== null) return onResolved;

      // I1 STALE-FALLBACK: the hinted page exists but its slot doesn't carry
      // this body (e.g. a section without this header/footer) — `resolveSlotOnPage`
      // found neither slot lines nor a slot box there. Don't pin a blank caret on
      // it; recompute the page WITHOUT the hint (the template-root default
      // carrying page) and retry on it.
      if (caretPageHint !== undefined) {
        const defaultPage = resolveTemplateBlockPage(state, plan, position.blockId, undefined);
        if (defaultPage >= 0 && defaultPage !== resolvedPage) {
          const onDefault = resolveSlotOnPage(tree, defaultPage, position, measurer, caretAffinity);
          if (onDefault !== null) return onDefault;
        }
      }
      // Neither the resolved nor the default carrying page produced a result.
      // Fall through to the footnote / dev-throw degradation below.
    }

    // FOOTNOTE-body fast path: a footnote body lives in `embedContents`, so
    // `pageIndexOfBlock` AND `pageIndexOfTemplateBlock` both miss it — but the
    // plan's `pageIndexOfFootnoteBlock` maps it to the page its slot STARTS on.
    // Resolve it per-page (the slot's lines are in `getLineIndex(getPage(p)).byBlock`),
    // never materializing the whole document.
    const footnotePage = resolveFootnoteBlockPage(state, tree, position);
    if (footnotePage >= 0) {
      const page = tree.getPage(footnotePage);
      const fnLines = getLineIndex(page).byBlock.get(position.blockId) ?? [];
      if (fnLines.length > 0) {
        return resolvePositionInOwnLines(fnLines, position, measurer, caretAffinity);
      }
      const baseline = findBlockBaseline(page, position.blockId);
      if (baseline !== null) return baseline;
    }

    // TABLE-CELL (or any MAIN-tree block nested inside a top-level container): the
    // caret's block lives in the main `blocks` tree but is NOT a top-level body
    // child (paragraph → table-cell → table-row → table), so `pageIndexOfBlock`
    // (a top-level-body-only map) misses it. Walk up `parentId` to the containing
    // top-level block (the table) — which IS page-mapped — materialize ONLY its
    // page, and resolve against that page's `byBlock` lines (the table FC's IFC
    // stamped the cell paragraph's lines there during `getPage`).
    const nestedPage = resolveNestedMainTreeBlockPage(state, tree, position);
    if (nestedPage >= 0) {
      const page = tree.getPage(nestedPage);
      const cellLines = getLineIndex(page).byBlock.get(position.blockId) ?? [];
      if (cellLines.length > 0) {
        return resolvePositionInOwnLines(cellLines, position, measurer, caretAffinity);
      }
      const baseline = findBlockBaseline(page, position.blockId);
      if (baseline !== null) return baseline;
    }

    // Block not mapped by the plan, not a resolvable template block, not a
    // resolvable footnote body, and not a nested main-tree block. In a well-formed
    // document EVERY caret resolves to a concrete page via one of the resolvers
    // above; reaching here means the caret's block has no page (a programmer error
    // — a stale caret on a detached block). Dev-throw to catch it; in prod degrade
    // safely to an unresolvable caret (`null`), which callers already tolerate
    // (e.g. an off-page caret). NEVER materialize the whole tree.
    if (isDevMode()) {
      throw new Error(
        `resolveInVirtualTree: block ${position.blockId} maps to no page ` +
          `(not a top-level body, header/footer, footnote, or nested main-tree block) — stale caret?`,
      );
    }
    return null;
  }

  // The block's FIRST page floors the backward walk. `pageIndexOfBlock`
  // (== `endPage`) is the block's whole-block-progress (LAST) page; `endPage` is
  // where we START. Without a floor at the block's first page the walk would
  // decrement down to page 0 (the DOCUMENT start) — materializing pages the
  // block does not occupy, and possibly resolving against a DIFFERENT block's
  // line that happens to begin at offset 0 on an unrelated earlier page. The
  // span's `first` bounds the walk to the block's own page range.
  const span = plan.pageSpanOfBlock(position.blockId);
  // `first` should be ≤ `endPage`; if the plan can't span the block (shouldn't
  // happen for a mapped block) fall back to flooring at endPage itself (the
  // single page we know it occupies) — never below.
  const firstPage = span !== null ? Math.min(span.first, endPage) : endPage;

  // Walk from the block's last page backward to the page that contains the
  // offset, never stepping below the block's first page. Per-page own-lines are
  // monotonically increasing in offset, so the first page (going backward)
  // whose first own-line starts at or before the offset is the page that owns
  // it.
  let pageIndex = endPage;
  let ownLines: readonly AbsoluteLineBox[] = [];
  for (;;) {
    const page = tree.getPage(pageIndex);
    ownLines = getLineIndex(page).byBlock.get(position.blockId) ?? [];
    if (ownLines.length === 0) {
      // No own-lines on this page (shouldn't happen within the block's span, but
      // be defensive): try the block-baseline walk on this page, else give up.
      const baseline = findBlockBaseline(page, position.blockId);
      if (baseline !== null) return baseline;
      if (pageIndex <= firstPage) return defaultPixelPosition();
      pageIndex--;
      continue;
    }
    const firstOwn = ownLines[0];
    if (firstOwn === undefined) {
      throw new Error("cursor-position: ownLines[0] missing (unreachable — length checked)");
    }
    const firstStart = firstOwn.line.inlineOffsetStart;
    // Settle on this page when the offset is at/after its first own-line —
    // EXCEPT a "before" affinity landing EXACTLY on this page's first-line start
    // (a cross-page soft-wrap boundary: the offset is also the PREVIOUS page's
    // last-line end). There the caret must pin to the previous page's end, so we
    // step back one page (#474 B2, cross-page mirror of the intra-page fix). The
    // block's first-page floor always stops the walk.
    const settleHere =
      position.offset > firstStart ||
      (position.offset === firstStart && caretAffinity !== "before");
    if (settleHere || pageIndex <= firstPage) {
      break;
    }
    // The offset precedes this page's own-lines (or a "before" caret sits on the
    // boundary): it lives on an earlier page within the block's span.
    pageIndex--;
  }

  // Cross-page soft-wrap edge: caret at the block's last own-line on THIS page
  // with `offset === inlineOffsetEnd`, and the block continues onto the next
  // page (the next page has own-lines for this block). The within-page resolver
  // would pin the caret to the bottom of page N; instead snap to page N+1's
  // first same-block line (matching the doc-wide soft-wrap preference). An
  // explicit `caretAffinity === "before"` opts OUT (the end-of-page-N-line
  // position must stay reachable — the cross-page mirror of the #474 B2
  // intra-page fix); it then falls through to the page-N resolve below.
  const lastOwn = ownLines[ownLines.length - 1];
  if (lastOwn === undefined) {
    throw new Error("cursor-position: last own-line missing (unreachable — length checked)");
  }
  if (
    position.offset === lastOwn.line.inlineOffsetEnd &&
    pageIndex + 1 < plan.entries.length &&
    caretAffinity !== "before"
  ) {
    const nextPage = tree.getPage(pageIndex + 1);
    const nextOwn = getLineIndex(nextPage).byBlock.get(position.blockId) ?? [];
    const nextFirst = nextOwn[0];
    if (nextFirst !== undefined) {
      return resolvePositionInOwnLines([nextFirst], position, measurer, caretAffinity);
    }
  }

  return resolvePositionInOwnLines(ownLines, position, measurer, caretAffinity);
}

/**
 * Resolve which PAGE a header/footer template-block caret should render on
 * (#323). A header/footer body is ONE shared `templateContents` subtree rendered
 * into EVERY page's slot, so a slot caret `Position` alone is page-ambiguous;
 * this picks the page using the (view-state) `caretPageHint`, defaulting to the
 * body's first carrying page.
 *
 * Resolution order:
 *   1. `pageIndexOfTemplateBlock(blockId)` — the slot-ROOT fast path (the
 *      `position.blockId` IS the body root, e.g. a single-paragraph T8 body).
 *   2. DESCENDANT walk (#326 container body): the caret is in the body's
 *      paragraph CHILD, not the slot root, so step 1 missed. Walk to the
 *      template tree's root via `selectionContextOf` and map THAT root. (Skip
 *      when the walk lands on `state.rootId` — that means the block is in the
 *      MAIN body, not a template, and is not a template caret at all.)
 *   3. Prefer the `caretPageHint` over the default first page when it is a valid
 *      in-range page index (the controller passed the page the user is editing).
 *
 * Returns the chosen page index, or -1 when `blockId` is not a template block at
 * all (no fast-path map entry and the descendant walk reaches the main root).
 *
 * Exported so line-navigation reuses the SAME resolution (the I1 empty-slot
 * fallback lives in each caller, since it needs the materialized page's lines).
 */
export function resolveTemplateBlockPage(
  state: State,
  plan: PagePlan,
  blockId: BlockId,
  caretPageHint: number | undefined,
): number {
  // 1. Slot-ROOT fast path.
  let page = plan.pageIndexOfTemplateBlock(blockId);

  // 2. DESCENDANT → body root via the parentId walk (#326 container body).
  if (page < 0) {
    const root = selectionContextOf(state, blockId);
    if (root !== null && root !== state.rootId) {
      page = plan.pageIndexOfTemplateBlock(root);
    }
  }

  if (page < 0) return -1;

  // 3. Prefer a valid in-range hint over the default first carrying page.
  if (
    caretPageHint !== undefined &&
    caretPageHint >= 0 &&
    caretPageHint < plan.entries.length
  ) {
    return caretPageHint;
  }
  return page;
}

/**
 * Resolve a template-block caret against ONE page's materialized slot (#323).
 * Returns the PixelPosition if `pageIndex`'s slot carries `position.blockId`
 * (either as own LineBoxes — the editable paragraph case — OR as a slot-box the
 * baseline walk finds — the container-root case), else `null` (the page doesn't
 * carry this body → caller applies the I1 fallback / bridge). Materializes only
 * `pageIndex` (one `getPage`), never the whole document.
 */
function resolveSlotOnPage(
  tree: VirtualLayoutTree,
  pageIndex: number,
  position: Position,
  measurer: TextMeasurer,
  caretAffinity?: CaretAffinity,
): PixelPosition | null {
  const page = tree.getPage(pageIndex);
  const slotLines = getLineIndex(page).byBlock.get(position.blockId) ?? [];
  if (slotLines.length > 0) {
    return resolvePositionInOwnLines(slotLines, position, measurer, caretAffinity);
  }
  // No own-lines (e.g. the #326 CONTAINER root carries no IFC itself — its
  // paragraph child does). If the page nonetheless carries the body's box, pin
  // the caret to its top-left baseline ON THIS PAGE. `findBlockBaseline` walks
  // the page's header/footer slots too, so a slot-root id resolves here.
  return findBlockBaseline(page, position.blockId);
}

/**
 * Resolve which PAGE a FOOTNOTE-body caret's offset lives on, WITHOUT
 * materializing the whole tree. A footnote body lives in the `embedContents`
 * tree, so it is neither a top-level main child (`pageIndexOfBlock` → -1) nor a
 * header/footer body (`pageIndexOfTemplateBlock` → -1); the plan's
 * `pageIndexOfFootnoteBlock` maps the body ROOT to the page its slot STARTS on
 * (the FRESH page). A body that splits distributes its child paragraphs (and a
 * child's own wrapped continuation lines) across later pages' slots, and
 * `byBlock` is keyed by the leaf child — so the caret block need NOT have lines
 * on the fresh page. From the fresh page we walk FORWARD to the page that
 * actually carries the caret block's lines and owns the offset, clamping to the
 * block's last fragment page (or to the fresh page if its lines never appear — a
 * safe degradation the caller turns into null / a dev-throw).
 *
 * Returns the resolved page index, or -1 when `position.blockId` is not a
 * footnote body at all (no `pageIndexOfFootnoteBlock` entry). Reuses
 * `getLineIndex(getPage(p)).byBlock`, which includes the page's footnote-slot
 * lines (`collectLineBoxes` walks the `footnoteSlot`).
 *
 * The plan's footnote map is keyed by the body ROOT id (the anchor's
 * `contentBlockId`), but the caret usually lives in the body's paragraph CHILD,
 * so we first walk `position.blockId` to its selection-context root
 * (`selectionContextOf`) — the footnote body root — then map THAT (mirroring the
 * descendant walk in `resolveTemplateBlockPage`). The root itself is also tried
 * first (the rare single-block-body case).
 *
 * Exported so line-navigation reuses the SAME per-page footnote resolution.
 */
export function resolveFootnoteBlockPage(
  state: State,
  tree: VirtualLayoutTree,
  position: Position,
): number {
  // The body ROOT id: try the caret's block directly (single-block body), else
  // its selection-context root (the body root for a caret in a body CHILD).
  let startPage = tree.plan.pageIndexOfFootnoteBlock(position.blockId);
  if (startPage < 0) {
    const root = selectionContextOf(state, position.blockId);
    if (root !== null && root !== state.rootId) {
      startPage = tree.plan.pageIndexOfFootnoteBlock(root);
    }
  }
  if (startPage < 0) return -1;

  // Walk forward over the body's slot fragments. Per-page slot-lines for a body
  // are monotonically increasing in offset (the body splits in document order),
  // so the first page (going forward) whose last own-line covers the offset — or
  // the last page that carries any own-lines — owns the caret. Bounded by the
  // page count (a body's slot can't render past the document's last page).
  // Walk forward for the page that actually CARRIES the caret block's lines. A
  // multi-paragraph footnote body distributes its child paragraphs across the
  // slot's fragment pages, and `byBlock` is keyed by the leaf child — so the
  // caret's child does NOT in general have lines on the body's fresh page; it can
  // first appear several pages later. Track the last page that carried the block
  // so a caret PAST the final fragment clamps to it; if the block's lines never
  // appear at all, fall back to the fresh page (a stale-caret degradation the
  // caller turns into null / dev-throw). Bounded by the document page count.
  let pageIndex = startPage;
  const lastPage = tree.plan.entries.length - 1;
  let lastFound = -1;
  for (;;) {
    const lines = getLineIndex(tree.getPage(pageIndex)).byBlock.get(position.blockId) ?? [];
    const lastLine = lines[lines.length - 1];
    if (lastLine !== undefined) {
      lastFound = pageIndex;
      const lastEnd = lastLine.line.inlineOffsetEnd;
      // This page owns the offset (or it's the last page) → done.
      if (position.offset <= lastEnd || pageIndex >= lastPage) return pageIndex;
      // Offset is past this page's lines: a continuation fragment is on a later page.
    }
    if (pageIndex >= lastPage) return lastFound >= 0 ? lastFound : startPage;
    pageIndex++;
  }
}

/**
 * Resolve which PAGE a MAIN-tree block NESTED inside a top-level container lives
 * on (e.g. a paragraph inside a table cell: paragraph → table-cell → table-row →
 * table). `pageIndexOfBlock` only maps TOP-LEVEL body children, so a nested block
 * misses it; this walks up the `parentId` chain to the nearest ancestor that IS
 * page-mapped (the containing top-level block — the table).
 *
 * The containing block (e.g. a table) may SPAN pages. `pageIndexOfBlock` returns
 * its whole-block-progress (LAST) page, but the caret block's lines can be on an
 * EARLIER fragment page — so after finding the ancestor, forward-walk its page
 * SPAN to the page that actually carries `position.blockId`'s lines (clamping to
 * the last page that carries them, or the ancestor's first page if none do — a
 * safe degradation the caller turns into a baseline / null). This mirrors
 * {@link resolveFootnoteBlockPage}'s per-page forward walk (#496); a single-page
 * table just walks its one page.
 *
 * Returns -1 when no ancestor maps to a page (the block is not in the main tree,
 * or the plan has no mapping at all — a stale caret on a detached block).
 *
 * The main-tree counterpart to the side-tree descendant walks in
 * {@link resolveTemplateBlockPage} (templateContents) and
 * {@link resolveFootnoteBlockPage} (embedContents): here the container (table) IS
 * a top-level body child, so its OWN id is what `pageIndexOfBlock` maps. Exported
 * so line-navigation reuses the SAME resolution.
 */
export function resolveNestedMainTreeBlockPage(
  state: State,
  tree: VirtualLayoutTree,
  position: Position,
): number {
  const plan = tree.plan;
  // Walk up the `parentId` chain to the nearest page-mapped ancestor (the
  // containing top-level block — e.g. the table). Bounded (cycle/depth guard,
  // mirrors the block-traversal bounds used elsewhere in the state layer). The
  // caller has already confirmed `position.blockId` itself is unmapped; the first
  // iteration re-checks it harmlessly, then climbs.
  let ancestorId: BlockId | null = null;
  let id: BlockId | null = position.blockId;
  let steps = 0;
  while (id !== null && id !== state.rootId) {
    if (++steps > 1024) return -1;
    if (plan.pageIndexOfBlock(id) >= 0) {
      ancestorId = id;
      break;
    }
    const resolved = resolveBlock(state, id);
    if (resolved === null) return -1;
    id = resolved.block.parentId;
  }
  if (ancestorId === null) return -1;

  // Forward-walk the ancestor's page span to the page carrying the caret block's
  // lines. `byBlock` is keyed by the leaf (the cell paragraph), so a fragment of
  // the table on an earlier page carries the cell's lines even though the
  // ancestor's `pageIndexOfBlock` points at the LAST page.
  const span = plan.pageSpanOfBlock(ancestorId);
  const firstPage = span !== null ? span.first : plan.pageIndexOfBlock(ancestorId);
  const lastPage = span !== null ? span.last : firstPage;
  let lastFound = -1;
  for (let p = firstPage; p <= lastPage; p++) {
    const lines = getLineIndex(tree.getPage(p)).byBlock.get(position.blockId) ?? [];
    const lastLine = lines[lines.length - 1];
    if (lastLine !== undefined) {
      lastFound = p;
      const lastEnd = lastLine.line.inlineOffsetEnd;
      // This page owns the offset (or it's the last span page) → done.
      if (position.offset <= lastEnd || p >= lastPage) return p;
    }
  }
  return lastFound >= 0 ? lastFound : firstPage;
}

/**
 * Resolve a position to pixel coords given the block's own `AbsoluteLineBox`es
 * (already filtered to `position.blockId`, in document order). Shared by the
 * positioned-tree and virtual-tree paths.
 *
 * `ownLines` must be non-empty. Picks the target line (with the same soft-wrap
 * preference the doc-wide path uses: at an exact line-end boundary prefer the
 * next same-block line when one exists in `ownLines`), then walks that line's
 * leaves to measure the X for `position.offset`.
 */
function resolvePositionInOwnLines(
  ownLines: readonly AbsoluteLineBox[],
  position: Position,
  measurer: TextMeasurer,
  caretAffinity?: CaretAffinity,
): PixelPosition {
  // Pick the target line via the shared soft-wrap picker (CUR-3): the line whose
  // [start, end] contains the offset wins; at the soft-wrap edge (offset ===
  // current.end AND next is same block) it prefers the next line's start UNLESS
  // `caretAffinity === "before"` pins the caret to this line's end (#474 B2).
  // `ownLines` is block-filtered (every entry belongs to `position.blockId`), so
  // the picker's foreign-line skip is a no-op here. `-1` (no own-line matched —
  // shouldn't happen for non-empty block-filtered `ownLines`) clamps to the first
  // line, matching the prior loop's default.
  const pickedIdx = pickSoftWrapLine(ownLines, position, caretAffinity);
  const targetIdx = pickedIdx >= 0 ? pickedIdx : 0;
  const target = ownLines[targetIdx];
  if (target === undefined) {
    throw new Error(
      `resolvePositionInOwnLines: ownLines[${targetIdx}] missing (unreachable — ownLines non-empty)`,
    );
  }
  const line = target.line;

  // P4-C.2.1: the LineBidiView is the single place that knows the line's
  // VISUAL↔LOGICAL leaf correspondence, so the intra-line caret X is now
  // direction-aware (LTR leaves measure left→right, RTL leaves right→left;
  // inline-blocks are atomic edges). It walks leaves in LOGICAL (state) order,
  // so a bidi-reordered line picks the right OWNING leaf (the old visual-order
  // accumulation picked the wrong leaf on a reordered line).
  // The line's axis map: which physical axis the inline/block axes map to.
  // `direction` is `computedStyle.direction` (M3, the canonical source).
  const am = axisMapFor(line.writingMode, line.computedStyle.direction);

  const view = buildLineBidiView(target);
  if (view.isEmpty) {
    // Strut-only line (empty paragraph): caret at the line's content edge along
    // the INLINE axis. For a non-reversed inline direction that's the line's
    // inline-start (`coordOf(target-as-line, am.inline)`) — byte-identical to the
    // pre-bidi empty-line fast path for h-tb LTR. For the reversed inline
    // direction (`am.inlineReversed`, which folds in both v-rl... no: it folds in
    // RTL in any mode) the content edge is the far inline edge, so add the line's
    // inline-size along the inline axis. This is the ONE place `inlineReversed` is
    // consulted at the line level (I1).
    const base = lineCoordOf(target, am.inline);
    const x = am.inlineReversed ? base + line.inlineSize : base;
    return pixelPositionForLine(target, x, am);
  }

  // STATE offset to resolve, clamped into the line's own [start, end] range
  // (the offset is already line-scoped by the pick loop above, but a past-block-
  // end position can land here as the last line's end).
  const stateOffset = Math.max(
    line.inlineOffsetStart,
    Math.min(position.offset, line.inlineOffsetEnd),
  );

  const owner = findLeafOwner(view.logicalLeaves, stateOffset, caretAffinity);
  const rawX = caretInlineCoordInLeaf(owner, stateOffset, measurer, am);

  // #338 P2 (I2) — pin the caret to the OWNING leaf's own INLINE-axis box edges.
  // For a CLAMPED hung trailing space (IFC gave it width 0 at the content edge),
  // the prefix measurement inside `caretInlineCoordInLeaf` still adds ~one glyph
  // advance, which would land the caret PAST the box edge (the reverted-Phase-2
  // off-page caret bug). Clamping to `[coordOf(leaf, am.inline), + sizeAlong(leaf,
  // am.inline)]` pins it to the (clamped) edge. Direction-agnostic: for an
  // even-level leaf the upper bound bites, for an odd-level leaf the lower bound
  // bites; for a normal word leaf the caret is already inside, so the clamp is a
  // no-op.
  const leafLo = coordOf(owner.leaf, am.inline);
  const leafHi = leafLo + sizeAlong(owner.leaf, am.inline);
  const x = Math.max(leafLo, Math.min(rawX, leafHi));
  return pixelPositionForLine(target, x, am);
}

function pixelPositionForLine(
  target: AbsoluteLineBox,
  x: number,
  am: ReturnType<typeof axisMapFor>,
): PixelPosition {
  // `x` is the caret's INLINE-axis coordinate (already projected by the caller).
  // `y`/`lineY` is the line block-START along the BLOCK axis; `height`/
  // `lineHeight` its extent along the BLOCK axis. For h-tb (`am.block === "y"`)
  // these read `absoluteY` + the physical-Y extent — byte-identical to before.
  const blockStart = lineCoordOf(target, am.block);
  const blockExtent = lineSizeAlong(target, am.block);
  return {
    x,
    y: blockStart,
    height: blockExtent,
    lineY: blockStart,
    lineHeight: blockExtent,
    lineMarginTop: 0,
    lineMarginBottom: 0,
    pageIndex: target.pageIndex,
  };
}

/**
 * Walk the layout tree looking for the block-level box keyed
 * `blockId` and return its top-left as a baseline PixelPosition.
 * Used only as a defensive fallback when a block has no LineBoxes
 * (e.g., container block with null inlineContent — cursor shouldn't
 * be positioned there in normal flow, but the function degrades
 * gracefully).
 */
function findBlockBaseline(
  box: LayoutBox,
  blockId: string,
  parentX: number = 0,
  parentY: number = 0,
  pageIndex: number = 0,
): PixelPosition | null {
  if (box.type === "page") {
    // Visit header/footer SLOTS too (C.2c T6) so the defensive baseline walk
    // reaches a slot-DESCENDANT block id (the rare multi-block-header case that
    // the `pageIndexOfTemplateBlock` fast path does not cover and which falls to
    // positioning the whole document). Page-local origin, same pageIndex.
    if (box.headerSlot !== null) {
      const found = findBlockBaseline(box.headerSlot, blockId, 0, 0, box.pageIndex);
      if (found !== null) return found;
    }
    for (const child of box.children) {
      const found = findBlockBaseline(child, blockId, 0, 0, box.pageIndex);
      if (found !== null) return found;
    }
    if (box.footerSlot !== null) {
      const found = findBlockBaseline(box.footerSlot, blockId, 0, 0, box.pageIndex);
      if (found !== null) return found;
    }
    // DA3: the footnote SLOT is a NAMED field (like header/footer), NOT in
    // `box.children`, so the baseline walk must reach it BY NAME — otherwise a
    // footnote-body block id never resolves to a baseline (used by the defensive
    // fallback for the rare multi-block / bridge cursor-read path). Page-local
    // origin, same pageIndex.
    if (box.footnoteSlot !== null) {
      const found = findBlockBaseline(box.footnoteSlot, blockId, 0, 0, box.pageIndex);
      if (found !== null) return found;
    }
    return null;
  }
  if (box.type === "text-run" || box.type === "marker") return null;

  const absX = parentX + box.x;
  const absY = parentY + box.y;

  if (box.key === blockId) {
    // M1: project the box's PHYSICAL accumulators onto the inline/block field
    // contract. `x` ← the box's physical coord along the INLINE axis, `y`/`lineY`
    // ← along the BLOCK axis; `height`/`lineHeight` ← the box's BLOCK-axis extent
    // (`box.width` for a vertical mode, `box.height` for h-tb). For h-tb
    // (`am.inline === "x"`, `am.block === "y"`) this is byte-identical to the old
    // `{x: absX, y: absY, height: box.height}`.
    const am = axisMapFor(box.writingMode, box.computedStyle.direction);
    const inlineCoord = am.inline === "x" ? absX : absY;
    const blockCoord = am.block === "x" ? absX : absY;
    const blockExtentRaw = am.block === "x" ? box.width : box.height;
    const blockExtent = blockExtentRaw > 0 ? blockExtentRaw : 16;
    return {
      x: inlineCoord,
      y: blockCoord,
      height: blockExtent,
      lineY: blockCoord,
      lineHeight: blockExtent,
      lineMarginTop: 0,
      lineMarginBottom: 0,
      pageIndex,
    };
  }

  if (box.type === "multicolumn") {
    // A MultiColumnBox is a CONTAINER whose `columns` (BlockBoxes) hold the
    // section's content; descend each column to reach the target block's baseline.
    for (const col of box.columns) {
      const found = findBlockBaseline(col, blockId, absX, absY, pageIndex);
      if (found !== null) return found;
    }
    return null;
  }

  if (
    box.type === "block" ||
    box.type === "line" ||
    box.type === "inline" ||
    box.type === "inline-block" ||
    box.type === "table" ||
    box.type === "table-row" ||
    box.type === "table-cell"
  ) {
    for (const child of box.children) {
      const found = findBlockBaseline(child, blockId, absX, absY, pageIndex);
      if (found !== null) return found;
    }
  }
  return null;
}

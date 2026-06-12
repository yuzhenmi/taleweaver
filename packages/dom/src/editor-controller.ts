import {
  createSpan,
  createPosition,
  isCollapsed,
  extractText,
  builtinEmbedSerializer,
  selectWord,
  getBlock,
  inlineContentLength,
  findItemAtOffset,
  resolvePixelPosition,
  resolvePositionFromPixel,
  selectionContextOf,
  comparePositions,
  findMatches,
  computeSelectionRects,
  computeSelectionRectsForPage,
  resolveCommentRange,
  resolveSuggestionRange,
  spanStart,
  spanEnd,
  markStart,
  markEnd,
  type LayoutBox,
  type VirtualLayoutTree,
  type Position,
  type BlockId,
  type CommentId,
  type SuggestionId,
  type TextShaper,
  type TextMeasurer,
  type EditorAction,
  type EditorState,
  type State,
  type SelectionRect,
  type PixelPosition,
  type TextMatch,
  type FindMatchesOptions,
  type Span,
  type CaretAffinity,
} from "@taleweaver/core";
import { mapKeyEvent } from "./key-handler";
import { FONT_CONFIG } from "./font-config";
import { isOpenableLinkUrl } from "./url-safety";
import {
  paintCanvas,
  paintPage,
  type CursorState,
  type MatchHighlightRect,
  type CommentHighlightRect,
  type SuggestionHighlightRect,
} from "./canvas-renderer";
import { createPaintCache, type PaintCache } from "./paint-cache";
import { ImageCache } from "./image-cache";

const DEFAULT_PAGE_GAP = 24;
const SCROLL_DURATION = 250;

/**
 * A find-match's boundary positions resolved against the current layout tree.
 * Stage 1 (`resolveFindHighlights`) populates these; Stage 2 (paint) emits
 * per-page rects from them without re-resolving. Internal to the controller.
 */
interface ResolvedMatch {
  span: Span;
  startPos: PixelPosition;
  endPos: PixelPosition;
  /** Boundary block straddles a page break → a single page's rects can't see
   * the other-page fragment; the spanning block's rects are unioned per-page via
   * `selectionRectsAcrossPages` (per-page, never the whole tree). */
  spanned: boolean;
}

/**
 * A host-set comment highlight (comments slice 5): which comment is lit and
 * whether it is the active (hovered/selected) one. The controller RE-RESOLVES
 * the comment's range from live state each `update()`, so the host re-calls
 * `setCommentHighlights` only when the comment SET or active-flag changes — not
 * on every keystroke. The controller never calls `getComments`; the host owns
 * WHICH comments are lit.
 */
export interface CommentHighlight {
  commentId: CommentId;
  active: boolean;
}

/**
 * A comment highlight's boundary positions resolved against the current layout
 * tree (comments slice 5). The exact analog of `ResolvedMatch`, plus the
 * `commentId`/`active` carried from the host-set slot. Stage 1
 * (`resolveCommentHighlights`) populates these; Stage 2 (paint) emits per-page
 * rects from them without re-resolving. Internal to the controller.
 */
interface ResolvedCommentHighlight {
  commentId: CommentId;
  active: boolean;
  span: Span;
  startPos: PixelPosition;
  endPos: PixelPosition;
  /** Boundary block(s) straddle a page break → a single page's rects can't see
   * the other-page fragment; the spanning block's rects are unioned per-page via
   * `selectionRectsAcrossPages` (per-page, never the whole tree). */
  spanned: boolean;
}

/**
 * A host-set suggestion highlight (change-tracking slice 6): which pending
 * tracked-change is lit and whether it is the active (focused/selected in the
 * suggestion sidebar) one. The exact analog of {@link CommentHighlight}. The
 * controller RE-RESOLVES the suggestion's range from live state each `update()`,
 * so the host re-calls `setSuggestionHighlights` only when the suggestion SET or
 * active-flag changes — not on every keystroke. The controller never calls
 * `getSuggestions`; the host owns WHICH suggestions are lit.
 */
export interface SuggestionHighlight {
  suggestionId: SuggestionId;
  active: boolean;
}

/**
 * A suggestion highlight's boundary positions resolved against the current layout
 * tree (change-tracking slice 6). The exact analog of {@link ResolvedCommentHighlight},
 * plus the `suggestionId`/`active` carried from the host-set slot. Stage 1
 * (`resolveSuggestionHighlights`) populates these; Stage 2 (paint) emits per-page
 * rects from them without re-resolving. Internal to the controller.
 */
interface ResolvedSuggestionHighlight {
  suggestionId: SuggestionId;
  active: boolean;
  span: Span;
  startPos: PixelPosition;
  endPos: PixelPosition;
  /** Boundary block(s) straddle a page break → a single page's rects can't see
   * the other-page fragment; the spanning block's rects are unioned per-page via
   * `selectionRectsAcrossPages` (per-page, never the whole tree). */
  spanned: boolean;
}

/**
 * Get the link URL at a Position, or null if the position isn't on
 * a hyperlink. Used by Cmd+Click handling.
 */
function linkUrlAtPosition(
  state: import("@taleweaver/core").State,
  pos: Position,
): string | null {
  const block = getBlock(state, pos.blockId);
  if (block === null || block.inlineContent === null) return null;
  const { itemIndex } = findItemAtOffset(block.inlineContent, pos.offset);
  const item = block.inlineContent.items[itemIndex];
  if (item === undefined || item.kind !== "text") return null;
  const link = item.attrs.link;
  return typeof link === "string" && link.length > 0 ? link : null;
}

export interface EditorControllerOptions {
  measurer: TextShaper | TextMeasurer;
  dispatch: (action: EditorAction) => void;
  pageHeight?: number;
  pageGap?: number;
}

/**
 * The state of an active find session, surfaced to the find-bar UI (#433):
 * `total` matches found and the `activeIndex` of the currently-emphasized one
 * (the find bar shows "activeIndex+1 of total"). `total === 0` ⇒ no matches,
 * with `activeIndex === -1`.
 *
 * `activeIndex === -1` means "no match is currently emphasized" and can occur
 * even when `total > 0` — e.g. a direct `setFindHighlights(matches, -1)` call
 * highlights the matches without emphasizing any. A consumer (the find bar)
 * must render this as "– of N" / "0 of N", NOT "-1 of N".
 */
export interface FindStatus {
  readonly total: number;
  readonly activeIndex: number;
}

export interface EditorController {
  update(editorState: EditorState): void;
  focus(): void;
  destroy(): void;
  /**
   * Show the find-match highlight overlay (#433): paint `matches` as a
   * translucent yellow band, with the match at `activeIndex` emphasized in
   * orange. `activeIndex` out of range (< 0 or >= matches.length) → no match
   * emphasized (all inactive). Triggers a repaint. The find session drives this.
   */
  setFindHighlights(matches: readonly TextMatch[], activeIndex: number): void;
  /** Hide the find-match highlight overlay and repaint (erases the band). */
  clearFindHighlights(): void;
  /**
   * Show the comment-highlight overlay (comments slice 5): paint each given
   * comment's anchored range as a translucent amber band, with the comment(s)
   * flagged `active` emphasized in a deeper amber. The controller RE-RESOLVES
   * each comment's range from live state every `update()`, so the host only
   * re-calls this when the comment SET or active-flag changes — NOT on every
   * keystroke (markers self-heal: they move with the text). Comments resolving
   * orphaned (a marker deleted) emit no band. Triggers a repaint.
   */
  setCommentHighlights(highlights: readonly CommentHighlight[]): void;
  /** Hide the comment-highlight overlay and repaint (erases the band). */
  clearCommentHighlights(): void;
  /**
   * Show the suggestion-highlight overlay (change-tracking slice 6): paint each
   * given pending tracked-change's range as a translucent teal band, with the
   * suggestion(s) flagged `active` emphasized in a deeper teal. The controller
   * RE-RESOLVES each suggestion's range from live state every `update()`, so the
   * host only re-calls this when the suggestion SET or active-flag changes — NOT
   * on every keystroke (a suggestion's tagged runs move with the text). A
   * suggestion whose tagged content is all gone (range resolves null) emits no
   * band. Triggers a repaint.
   */
  setSuggestionHighlights(highlights: readonly SuggestionHighlight[]): void;
  /** Hide the suggestion-highlight overlay and repaint (erases the band). */
  clearSuggestionHighlights(): void;
  /**
   * Start a find session (#433): run `findMatches(state, query, options)`,
   * highlight every match, pick the initial active match (the first at/after the
   * document cursor — Google Docs "find from here"), and scroll it into view.
   * Stores the session so a doc edit live-recomputes the matches (in `update()`).
   * Calling it again overwrites the session and re-queries. `options` defaults to
   * `{ caseSensitive: false, wholeWord: false }`. Returns the find status.
   */
  findStart(query: string, options?: FindMatchesOptions): FindStatus;
  /**
   * The current find status — `{ total, activeIndex }` for the active session
   * (`total 0` / `activeIndex -1` when there's no session or no matches). The
   * find bar polls this each render for the authoritative "n of N" count, since
   * `replaceActive`/`replaceAll` dispatch asynchronously (the post-replace count
   * only lands after the React reducer feeds the new state back via `update()`).
   */
  findStatus(): FindStatus;
  /**
   * Replace the ACTIVE find match with `replacement` (#433). When a session is
   * active and there's an active match, dispatches `REPLACE_MATCH` with that
   * match (`findHighlights.matches[activeIndex]`). Does NOT manually advance the
   * active index — the live-recompute clamp in `update()` (after the dispatched
   * edit refreshes state) advances it (the replaced match is gone, so the same
   * index now points at the following match, clamped). Returns the CURRENT
   * (pre-refresh) status; the find bar polls `findStatus()` after the update for
   * the authoritative count. No-op (returns the current status, no dispatch) when
   * there's no session / no active match.
   */
  replaceActive(replacement: string): FindStatus;
  /**
   * Replace EVERY match in the active session with `replacement` (#433) in one
   * undo step — dispatches `REPLACE_ALL` with the session's matches
   * (`findHighlights.matches`). Returns the current (pre-refresh) status. No-op
   * (no dispatch) when there's no session / no matches.
   */
  replaceAll(replacement: string): FindStatus;
  /**
   * Advance to the next match (wrapping last → first), re-emphasize, and scroll
   * it into view. No-op (returns the current status, no scroll) when there are no
   * matches. Does NOT move the document cursor.
   */
  findNext(): FindStatus;
  /**
   * Retreat to the previous match (wrapping first → last), re-emphasize, and
   * scroll it into view. No-op when there are no matches. Does NOT move the
   * document cursor.
   */
  findPrev(): FindStatus;
  /**
   * End the find session: clear the highlights and forget the session. Does NOT
   * move the document selection (Google Docs keeps the caret where it was).
   */
  findClose(): void;
}

export function createEditorController(
  container: HTMLElement,
  options: EditorControllerOptions,
): EditorController {
  const { measurer, dispatch } = options;
  const pageHeight = options.pageHeight;
  const pageGap = options.pageGap ?? DEFAULT_PAGE_GAP;

  // ── State ──────────────────────────────────────────────────────────────

  let state: EditorState | null = null;
  // The current layout tree, straight off `state.layoutTree`. In paginated mode
  // it is a `VirtualLayoutTree` (a `PagePlan` + lazily-materialized pages); in
  // unpaginated / unsupported-feature-fallback mode it is a fully-positioned
  // `LayoutBox`. The HOT PATH (paint visible pages, slot sizing, caret) reads
  // the plan + `getPage(visible ∪ cursorPage)` directly and never materializes
  // every page (Phase 3 Tasks 2/3).
  let layoutTree: LayoutBox | VirtualLayoutTree | null = null;
  // The positioned `LayoutBox` for the NON-paginated paths only (single-canvas
  // paint/sizing + the `pageIndex === null` selection/find/comment branches).
  // In those branches `layoutTree` is already a fully-positioned `LayoutBox`
  // (non-paginated / float-clear legacy fallback), never a `VirtualLayoutTree`
  // (virtualization only happens in paginated mode). Returns null defensively
  // if ever called in paginated mode — those callers union per-page instead and
  // never reach here. The whole document is NEVER materialized.
  function nonPaginatedTree(): LayoutBox | null {
    if (layoutTree === null || layoutTree.type === "virtual-root") return null;
    return layoutTree;
  }
  // Hit-test against ONLY the clicked page (virtual) — never the whole tree.
  // `resolvePositionFromPixel` filters its line index by `pageIndex`, so a
  // single `PageBox` resolves correctly (mirrors the per-page line-nav
  // migration). Non-paginated mode has a positioned `LayoutBox` already.
  function treeForPageHitTest(pageIndex: number): LayoutBox | null {
    if (layoutTree === null) return null;
    if (layoutTree.type === "virtual-root") return layoutTree.getPage(pageIndex);
    return layoutTree;
  }
  // True when `blockId` straddles a page break. Per-page selection rects can't
  // see a block's fragment on the other page (and `resolvePixelPosition` snaps a
  // boundary at a page edge to the continuation page), so a selection whose
  // start/end block spans pages falls back to the full bridge for that render.
  function blockSpansPages(plan: VirtualLayoutTree["plan"], blockId: BlockId): boolean {
    const s = plan.pageSpanOfBlock(blockId);
    return s !== null && s.first !== s.last;
  }
  // Spanning-block selection rects WITHOUT materializing the whole tree: resolve the
  // span's start/end pixel positions once against the virtual tree, then union
  // computeSelectionRectsForPage over the pages the span covers. Equivalent to
  // computeSelectionRects over the materialized tree for a spanning boundary
  // block (computeSelectionRectsForPage self-culls pages outside the range), but
  // materializes only the spanned pages instead of every page.
  function selectionRectsAcrossPages(
    st: State,
    span: Span,
    tree: VirtualLayoutTree,
    m: TextShaper | TextMeasurer,
    anchorAffinity?: CaretAffinity,
    focusAffinity?: CaretAffinity,
  ): SelectionRect[] {
    const start = spanStart(st, span);
    const end = spanEnd(st, span);
    const startPos = resolvePixelPosition(st, start, tree, m);
    const endPos = resolvePixelPosition(st, end, tree, m);
    if (startPos === null || endPos === null) return [];
    const rects: SelectionRect[] = [];
    // `startPos`/`endPos` were resolved against `tree`, so every index in
    // [startPos.pageIndex, endPos.pageIndex] is a valid page (getPage throws
    // only on out-of-range). computeSelectionRectsForPage self-culls, so this
    // union equals computeSelectionRects over the fully-materialized tree.
    for (let p = startPos.pageIndex; p <= endPos.pageIndex; p++) {
      rects.push(
        ...computeSelectionRectsForPage(
          st, span, tree.getPage(p), p, startPos, endPos, m, anchorAffinity, focusAffinity,
        ),
      );
    }
    return rects;
  }
  let focused = true;
  let cursorVisible = true;
  let blinkIntervalId: ReturnType<typeof setInterval> | null = null;
  let scrollRafId = 0;
  let scrollAnimId = 0;
  let isDragging = false;
  let dragAnchor: Position | null = null;
  let isComposing = false;
  let destroyed = false;

  // Image cache for rendering image blocks
  const imageCache = new ImageCache(() => paint());

  // Paint caches: one for the single-canvas mode, one per page index for
  // paginated mode. Plan 3.K.2 Task 1 wires these so paint takes the
  // incremental path with root-reference short-circuit. Without these,
  // every paint pass clears the entire canvas and repaints every box —
  // O(N) per cursor move. Pruned on page removal in the excess-slot loop
  // (see `pageCaches.delete(i)` there) so the map never outgrows the live
  // page count.
  const canvasCache: PaintCache = createPaintCache();
  const pageCaches: Map<number, PaintCache> = new Map();
  function getOrCreatePageCache(idx: number): PaintCache {
    let c = pageCaches.get(idx);
    if (!c) {
      c = createPaintCache();
      pageCaches.set(idx, c);
    }
    return c;
  }

  // Computed on update
  let cursorPos: PixelPosition = {
    x: 0,
    y: 0,
    height: 16,
    lineY: 0,
    lineHeight: 24,
    lineMarginTop: 0,
    lineMarginBottom: 0,
    pageIndex: 0,
  };
  let selectionRects: SelectionRect[] = [];
  // Selection-highlight state (set in `update()`, consumed in `paintPages` and
  // `getCursorState`). Paginated mode computes rects PER VISIBLE PAGE in
  // `paintPages` from the cached span boundary positions — `selectionRects`
  // above is then empty (it carries rects only for the non-paginated path and
  // the rare spanning-block fallback). `hasSelectionHighlight` lets the caret
  // hide over a selection even when `selectionRects` is empty.
  let hasSelectionHighlight = false;
  let selStart: PixelPosition | null = null;
  let selEnd: PixelPosition | null = null;
  let selSpanningFallback = false;

  // ── Find-match highlight overlay (#433) ──────────────────────────────────
  //
  // Transient overlay (like selection, never document attrs): the find session
  // drives `setFindHighlights(matches, activeIndex)`. `null` = find inactive.
  // `activeIndex` out of range (< 0 or >= matches.length) → no match emphasized.
  let findHighlights:
    | { matches: readonly TextMatch[]; activeIndex: number }
    | null = null;
  // The active find SESSION (#433): the query + options that drive the matches.
  // `null` = no session. Distinct from `findHighlights` (the resolved matches +
  // activeIndex for rendering): the session is what makes a doc edit
  // live-recompute the matches in `update()`. `findStart` sets it; `findClose`
  // and `destroy` null it. `findNext`/`findPrev` only move the activeIndex held
  // in `findHighlights` — the session (query/options) is unchanged.
  let findSession: { query: string; options: FindMatchesOptions } | null = null;
  // Stage-1 resolved boundary positions, ONE per match, recomputed in
  // `resolveFindHighlights()` (on `update()`/matches change — NOT on blink).
  // `paintPages`/`paintSingle` (Stage 2) emit per-page rects from these without
  // ever re-resolving (the two-stage split that keeps next/prev + paint off the
  // per-page union — only a `spanned` match unions across pages).
  let resolvedMatches: ResolvedMatch[] = [];

  // ── Comment highlight overlay (comments slice 5) ─────────────────────────
  //
  // Transient overlay (like selection/find, never document attrs): the host
  // drives `setCommentHighlights([{ commentId, active }])`. `null` = no comments
  // lit. The controller stores `{ commentId, active }` (NOT raw Positions) and
  // RE-RESOLVES each comment's range from live state every `update()`, so the
  // band self-heals across edits (markers move with the text); the host re-calls
  // only when the comment SET or active-flag changes. The controller never reads
  // `getComments` — the host owns WHICH comments are lit.
  let commentHighlights: readonly CommentHighlight[] | null = null;
  // Stage-1 resolved boundary positions, ONE per non-orphaned lit comment,
  // recomputed in `resolveCommentHighlights()` (on `update()`/set change — NOT on
  // blink). `paintPages`/`paintSingle` (Stage 2) emit per-page rects from these
  // without ever re-resolving (mirrors `resolvedMatches`).
  let resolvedCommentHighlights: ResolvedCommentHighlight[] = [];

  // ── Suggestion highlight overlay (change-tracking slice 6) ───────────────
  //
  // Transient overlay (like selection/find/comment, never document attrs): the
  // host drives `setSuggestionHighlights([{ suggestionId, active }])`. `null` = no
  // suggestions lit. The controller stores `{ suggestionId, active }` (NOT raw
  // Positions) and RE-RESOLVES each suggestion's range from live state every
  // `update()`, so the band self-heals across edits (tagged runs move with the
  // text); the host re-calls only when the suggestion SET or active-flag changes.
  // The controller never reads `getSuggestions` — the host owns WHICH suggestions
  // are lit. The exact analog of the comment highlight overlay above.
  let suggestionHighlights: readonly SuggestionHighlight[] | null = null;
  // Stage-1 resolved boundary positions, ONE per live lit suggestion, recomputed
  // in `resolveSuggestionHighlights()` (on `update()`/set change — NOT on blink).
  // `paintPages`/`paintSingle` (Stage 2) emit per-page rects from these without
  // ever re-resolving (mirrors `resolvedCommentHighlights`).
  let resolvedSuggestionHighlights: ResolvedSuggestionHighlight[] = [];

  // ── Page model (paginated mode) ──────────────────────────────────────────
  //
  // Per-page SLOT geometry, derived without positioning any page:
  //   - virtual tree → `vtree.plan.entries` (per-entry `pageConfig` +
  //     running-sum `blockOffset`);
  //   - positioned tree → the positioned `PageBox` children's geometry.
  // `pageSlots`'s length is the page count; an empty array means non-paginated
  // (single-canvas mode).
  //
  // Pages are NOT uniform-height (C.2b-2): a `section` can override its page
  // geometry, so every consumer (slot sizing, caret/textarea Y, scroll, mouse
  // hit-test) reads PER-SLOT geometry from this array — there is no
  // `pageIndex * (pageHeight + pageGap)` arithmetic and no virtual-vs-positioned
  // branching at the call sites. `top` is the page's document-y (the plan's
  // running-sum `blockOffset`); `gap` is the visual gap AFTER this page. For a
  // doc whose every page resolves to the doc-wide config this reduces to the old
  // uniform behavior (`top === i*(H+gap)`, `gap === pageGap`, `width === H-wide`).
  interface PageSlotGeom {
    readonly width: number;
    readonly height: number;
    /** Visual gap AFTER this page (per-section in virtual mode). */
    readonly gap: number;
    /** Document-y of this page's top edge (the plan's running-sum offset). */
    readonly top: number;
  }
  let pageSlotGeoms: PageSlotGeom[] = [];
  // Positioned-mode only: the materialized `PageBox` children (the legacy
  // path). Empty in virtual mode — pages are fetched on demand via `getPageBox`.
  let positionedPages: LayoutBox[] = [];
  // The current paginated layout tree (the virtual tree, or null when the
  // positioned path / non-paginated). Set in `syncDom`.
  let virtualTree: VirtualLayoutTree | null = null;

  /** Number of paginated page slots; 0 ⇒ non-paginated (single-canvas mode). */
  function pageCount(): number {
    return pageSlotGeoms.length;
  }

  /**
   * The positioned `PageBox` for slot `idx`. In virtual mode this calls
   * `vtree.getPage(idx)` — positioning ONLY that page (memoized). In positioned
   * mode it returns the pre-materialized child. Returns null out of range.
   */
  function getPageBox(idx: number): LayoutBox | null {
    if (virtualTree !== null) {
      if (idx < 0 || idx >= virtualTree.plan.entries.length) return null;
      return virtualTree.getPage(idx);
    }
    return positionedPages[idx] ?? null;
  }

  // ── DOM elements ───────────────────────────────────────────────────────

  // Set container styles
  container.style.position = "relative";
  container.style.outline = "none";
  container.style.fontFamily = FONT_CONFIG.fontFamily;
  container.style.fontSize = `${FONT_CONFIG.fontSize}px`;
  container.style.lineHeight = `${FONT_CONFIG.lineHeight * FONT_CONFIG.fontSize}px`; // 1.2 * 16 = 19.2px
  container.style.cursor = "text";
  container.style.userSelect = "none";

  // Create textarea
  const textarea = document.createElement("textarea");
  textarea.style.position = "absolute";
  textarea.style.width = "1px";
  textarea.style.opacity = "0";
  textarea.style.border = "none";
  textarea.style.padding = "0";
  textarea.style.margin = "0";
  textarea.style.outline = "none";
  textarea.style.resize = "none";
  textarea.style.overflow = "hidden";
  textarea.style.caretColor = "transparent";
  textarea.style.fontSize = `${FONT_CONFIG.fontSize}px`;
  textarea.style.fontFamily = FONT_CONFIG.fontFamily;
  textarea.tabIndex = 0;
  container.appendChild(textarea);
  textarea.focus();

  // Spacer div (non-paginated only, created lazily)
  let spacerDiv: HTMLDivElement | null = null;

  // Single canvas (non-paginated)
  let singleCanvas: HTMLCanvasElement | null = null;
  let singleCtx: CanvasRenderingContext2D | null = null;

  // Paginated: slot divs + canvas pool
  let pageSlots: HTMLDivElement[] = [];
  const activeCanvases = new Map<number, HTMLCanvasElement>();
  const canvasPool: HTMLCanvasElement[] = [];
  let intersectionObserver: IntersectionObserver | null = null;

  // ── Scroll parent ──────────────────────────────────────────────────────

  let scrollParent: HTMLElement | Window = window;

  function detectScrollParent() {
    let el: HTMLElement | null = container.parentElement;
    while (el) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === "auto" || overflow === "scroll") {
        scrollParent = el;
        return;
      }
      el = el.parentElement;
    }
    scrollParent = window;
  }

  // ── Paint ──────────────────────────────────────────────────────────────

  // ── Find-highlight Stage 1 (boundary-position resolution) ────────────────
  //
  // For each match, resolve its start/end PixelPosition ONCE (mirroring the
  // selection's `selStart`/`selEnd` + `blockSpansPages` detection). Recomputed
  // whenever the layout/matches change (`update()` + `setFindHighlights`), NOT
  // on blink/scroll. `paintPages`/`paintSingle` (Stage 2) emit per-page rects
  // from these cached positions without re-resolving — the load-bearing split
  // that keeps N matches off any whole-tree materialization per paint.
  function resolveFindHighlights(): void {
    resolvedMatches = [];
    const st = state;
    if (!st || findHighlights === null || layoutTree === null) return;
    for (const m of findHighlights.matches) {
      const span = createSpan(
        createPosition(m.blockId, m.start),
        createPosition(m.blockId, m.end),
      );
      let spanned = false;
      if (layoutTree.type === "virtual-root") {
        spanned = blockSpansPages(layoutTree.plan, m.blockId);
      }
      const startPos = resolvePixelPosition(
        st.state, span.anchor, layoutTree, measurer, st.caretPageHint,
      );
      const endPos = resolvePixelPosition(
        st.state, span.focus, layoutTree, measurer, st.caretPageHint,
      );
      if (startPos === null || endPos === null) continue;
      resolvedMatches.push({ span, startPos, endPos, spanned });
    }
  }

  // ── Find-highlight Stage 2 (per-page rect emission) ──────────────────────
  //
  // Emit this page's `MatchHighlightRect[]` from the Stage-1 resolved positions.
  // Reuses the selection's per-page routing (`computeSelectionRectsForPage`, or
  // `selectionRectsAcrossPages` per-page-unioned for a `spanned` match — no
  // per-page union). The match at `activeIndex` is tagged `active: true`;
  // all others `false`. `pageIndex` null (single-canvas / non-paginated path)
  // still emits from the positioned tree (Slice 5).
  function matchHighlightsForPage(pageBox: LayoutBox | null, pageIndex: number | null): MatchHighlightRect[] {
    const st = state;
    if (!st || findHighlights === null || resolvedMatches.length === 0) return [];
    const activeIndex = findHighlights.activeIndex;
    const out: MatchHighlightRect[] = [];
    for (let i = 0; i < resolvedMatches.length; i++) {
      const rm = resolvedMatches[i];
      const active = i === activeIndex;
      let rects: SelectionRect[];
      if (pageBox !== null && pageIndex !== null && !rm.spanned) {
        // Page-range cull: a non-spanned match only produces rects on pages
        // within [startPos.pageIndex, endPos.pageIndex]. Skip the costly
        // `computeSelectionRectsForPage` call for pages outside that range —
        // otherwise every match would be probed for every visible page
        // (O(N×P) per paint). Spanned matches keep the bridge fallback below.
        if (rm.startPos.pageIndex > pageIndex || rm.endPos.pageIndex < pageIndex) {
          continue;
        }
        rects = computeSelectionRectsForPage(
          st.state, rm.span, pageBox, pageIndex, rm.startPos, rm.endPos, measurer,
        );
      } else if (pageIndex !== null && layoutTree !== null && layoutTree.type === "virtual-root") {
        // Paginated spanned match (boundary block taller than a page): per-page
        // concat over the virtual tree (per-page, never the whole tree), then keep
        // only this page's rects.
        rects = selectionRectsAcrossPages(st.state, rm.span, layoutTree, measurer)
          .filter((r) => r.pageIndex === pageIndex);
      } else {
        // Non-paginated single canvas (`pageIndex === null`): `layoutTree` is a
        // positioned `LayoutBox` here, so compute rects directly over it.
        const positioned = nonPaginatedTree();
        rects = positioned
          ? computeSelectionRects(st.state, rm.span, positioned, measurer)
          : [];
        if (pageIndex !== null) {
          rects = rects.filter((r) => r.pageIndex === pageIndex);
        }
      }
      for (const r of rects) out.push({ ...r, active });
    }
    return out;
  }

  // ── Comment-highlight Stage 1 (boundary-position resolution) ─────────────
  //
  // For each host-lit comment, re-resolve its range from LIVE state
  // (`resolveCommentRange`) and then its start/end PixelPosition (mirroring
  // `resolveFindHighlights`). Recomputed whenever the layout/comment-set changes
  // (`update()` + `setCommentHighlights`), NOT on blink/scroll. Orphaned comments
  // (a marker deleted) are skipped. `paintPages`/`paintSingle` (Stage 2) emit
  // per-page rects from these cached positions without re-resolving.
  function resolveCommentHighlights(): void {
    resolvedCommentHighlights = [];
    const st = state;
    if (!st || commentHighlights === null || layoutTree === null) return;
    for (const { commentId, active } of commentHighlights) {
      const range = resolveCommentRange(st.state, commentId);
      if (range === null || range.orphaned) continue;
      const span = createSpan(range.start, range.end);
      // A comment's range can be cross-block. A non-spanned single block matches
      // a find-match's single-blockId case; for a multi-block comment, fall back
      // to the bridge if EITHER endpoint block straddles a page break (per-page
      // rects can't see the other-page fragment).
      let spanned = false;
      if (layoutTree.type === "virtual-root") {
        spanned =
          blockSpansPages(layoutTree.plan, range.start.blockId) ||
          blockSpansPages(layoutTree.plan, range.end.blockId);
      }
      const startPos = resolvePixelPosition(
        st.state, span.anchor, layoutTree, measurer, st.caretPageHint,
      );
      const endPos = resolvePixelPosition(
        st.state, span.focus, layoutTree, measurer, st.caretPageHint,
      );
      if (startPos === null || endPos === null) continue;
      resolvedCommentHighlights.push({ commentId, active, span, startPos, endPos, spanned });
    }
  }

  // ── Comment-highlight Stage 2 (per-page rect emission) ───────────────────
  //
  // Emit this page's `CommentHighlightRect[]` from the Stage-1 resolved
  // positions. Reuses the selection's per-page routing
  // (`computeSelectionRectsForPage`, or `selectionRectsAcrossPages`
  // per-page-unioned for a `spanned` comment — never the whole tree) — the
  // exact analog of `matchHighlightsForPage`. Each rect is tagged with the
  // comment's `commentId` + `active`. `pageIndex` null (single-canvas /
  // non-paginated path) still emits from the positioned tree (Slice 5).
  function commentHighlightsForPage(pageBox: LayoutBox | null, pageIndex: number | null): CommentHighlightRect[] {
    const st = state;
    if (!st || commentHighlights === null || resolvedCommentHighlights.length === 0) return [];
    const out: CommentHighlightRect[] = [];
    for (const rch of resolvedCommentHighlights) {
      let rects: SelectionRect[];
      if (pageBox !== null && pageIndex !== null && !rch.spanned) {
        // Page-range cull: a non-spanned comment only produces rects on pages
        // within [startPos.pageIndex, endPos.pageIndex]. Skip the costly
        // `computeSelectionRectsForPage` call for pages outside that range.
        if (rch.startPos.pageIndex > pageIndex || rch.endPos.pageIndex < pageIndex) {
          continue;
        }
        rects = computeSelectionRectsForPage(
          st.state, rch.span, pageBox, pageIndex, rch.startPos, rch.endPos, measurer,
        );
      } else if (pageIndex !== null && layoutTree !== null && layoutTree.type === "virtual-root") {
        // Paginated spanned comment (a boundary block taller than a page):
        // per-page concat over the virtual tree (never the whole tree),
        // then keep only this page's rects.
        rects = selectionRectsAcrossPages(st.state, rch.span, layoutTree, measurer)
          .filter((r) => r.pageIndex === pageIndex);
      } else {
        // Non-paginated single canvas (`pageIndex === null`): `layoutTree` is a
        // positioned `LayoutBox` here, so compute rects directly over it.
        const positioned = nonPaginatedTree();
        rects = positioned
          ? computeSelectionRects(st.state, rch.span, positioned, measurer)
          : [];
        if (pageIndex !== null) {
          rects = rects.filter((r) => r.pageIndex === pageIndex);
        }
      }
      for (const r of rects) out.push({ ...r, commentId: rch.commentId, active: rch.active });
    }
    return out;
  }

  // ── Suggestion-highlight Stage 1 (boundary-position resolution) ──────────
  //
  // For each host-lit suggestion, re-resolve its range from LIVE state
  // (`resolveSuggestionRange`) and then its start/end PixelPosition (mirroring
  // `resolveCommentHighlights`). Recomputed whenever the layout/suggestion-set
  // changes (`update()` + `setSuggestionHighlights`), NOT on blink/scroll. A
  // suggestion whose tagged content is all gone (`range === null`) is skipped —
  // unlike comments there is no separate `orphaned` flag (the suggestion range
  // index simply omits an id with no live tagged content). `paintPages`/
  // `paintSingle` (Stage 2) emit per-page rects from these cached positions
  // without re-resolving.
  function resolveSuggestionHighlights(): void {
    resolvedSuggestionHighlights = [];
    const st = state;
    if (!st || suggestionHighlights === null || layoutTree === null) return;
    for (const { suggestionId, active } of suggestionHighlights) {
      const range = resolveSuggestionRange(st.state, suggestionId);
      if (range === null) continue;
      const span = createSpan(range.start, range.end);
      // A suggestion's range can be cross-block (the same id on text in two
      // paragraphs). A non-spanned single block matches a comment's single-block
      // case; for a multi-block suggestion, fall back to the bridge if EITHER
      // endpoint block straddles a page break (per-page rects can't see the
      // other-page fragment).
      let spanned = false;
      if (layoutTree.type === "virtual-root") {
        spanned =
          blockSpansPages(layoutTree.plan, range.start.blockId) ||
          blockSpansPages(layoutTree.plan, range.end.blockId);
      }
      const startPos = resolvePixelPosition(
        st.state, span.anchor, layoutTree, measurer, st.caretPageHint,
      );
      const endPos = resolvePixelPosition(
        st.state, span.focus, layoutTree, measurer, st.caretPageHint,
      );
      if (startPos === null || endPos === null) continue;
      resolvedSuggestionHighlights.push({ suggestionId, active, span, startPos, endPos, spanned });
    }
  }

  // ── Suggestion-highlight Stage 2 (per-page rect emission) ────────────────
  //
  // Emit this page's `SuggestionHighlightRect[]` from the Stage-1 resolved
  // positions. Reuses the selection's per-page routing
  // (`computeSelectionRectsForPage`, or `selectionRectsAcrossPages`
  // per-page-unioned for a `spanned` suggestion — never the whole tree) — the
  // exact analog of `commentHighlightsForPage`. Each rect is tagged with the
  // suggestion's `suggestionId` + `active`. `pageIndex` null (single-canvas /
  // non-paginated path) still emits from the positioned tree.
  function suggestionHighlightsForPage(pageBox: LayoutBox | null, pageIndex: number | null): SuggestionHighlightRect[] {
    const st = state;
    if (!st || suggestionHighlights === null || resolvedSuggestionHighlights.length === 0) return [];
    const out: SuggestionHighlightRect[] = [];
    for (const rsh of resolvedSuggestionHighlights) {
      let rects: SelectionRect[];
      if (pageBox !== null && pageIndex !== null && !rsh.spanned) {
        // Page-range cull: a non-spanned suggestion only produces rects on pages
        // within [startPos.pageIndex, endPos.pageIndex]. Skip the costly
        // `computeSelectionRectsForPage` call for pages outside that range.
        if (rsh.startPos.pageIndex > pageIndex || rsh.endPos.pageIndex < pageIndex) {
          continue;
        }
        rects = computeSelectionRectsForPage(
          st.state, rsh.span, pageBox, pageIndex, rsh.startPos, rsh.endPos, measurer,
        );
      } else if (pageIndex !== null && layoutTree !== null && layoutTree.type === "virtual-root") {
        // Paginated spanned suggestion (a boundary block taller than a page):
        // per-page concat over the virtual tree (never the whole tree),
        // then keep only this page's rects.
        rects = selectionRectsAcrossPages(st.state, rsh.span, layoutTree, measurer)
          .filter((r) => r.pageIndex === pageIndex);
      } else {
        // Non-paginated single canvas (`pageIndex === null`): `layoutTree` is a
        // positioned `LayoutBox` here, so compute rects directly over it.
        const positioned = nonPaginatedTree();
        rects = positioned
          ? computeSelectionRects(st.state, rsh.span, positioned, measurer)
          : [];
        if (pageIndex !== null) {
          rects = rects.filter((r) => r.pageIndex === pageIndex);
        }
      }
      for (const r of rects) out.push({ ...r, suggestionId: rsh.suggestionId, active: rsh.active });
    }
    return out;
  }

  function getCursorState(): CursorState {
    // Hide the caret over a non-collapsed selection. Use the flag, not
    // `selectionRects.length`: in paginated mode the rects are computed
    // per-page in `paintPages` and `selectionRects` stays empty.
    if (hasSelectionHighlight) return "hidden";
    if (!focused) return "inactive";
    if (cursorVisible) return "active";
    return "hidden";
  }

  function paintSingle() {
    if (!state) return;
    if (!singleCanvas) return;
    // Non-paginated mode: `layoutTree` is a positioned `LayoutBox` (never a
    // virtual tree — virtualization only happens in paginated mode).
    const tree = nonPaginatedTree();
    if (!tree) return;
    if (!singleCtx) singleCtx = singleCanvas.getContext("2d");
    const ctx = singleCtx;
    if (!ctx) return;

    const logicalWidth = tree.width;
    const logicalHeight = tree.height;

    const dpr = typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1;
    const physicalWidth = logicalWidth * dpr;
    const physicalHeight = logicalHeight * dpr;
    if (singleCanvas.width !== physicalWidth || singleCanvas.height !== physicalHeight) {
      singleCanvas.width = physicalWidth;
      singleCanvas.height = physicalHeight;
      singleCanvas.style.width = `${logicalWidth}px`;
      singleCanvas.style.height = `${logicalHeight}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Compute visible range using scroll parent
    const sp = scrollParent;
    let visibleTop: number;
    let viewportHeight: number;
    if (sp instanceof Window) {
      const rect = singleCanvas.getBoundingClientRect();
      visibleTop = Math.max(0, -rect.top);
      viewportHeight = sp.innerHeight;
    } else {
      visibleTop = sp.scrollTop;
      viewportHeight = sp.clientHeight;
    }
    const visibleBottom = visibleTop + viewportHeight;

    paintCanvas(
      ctx,
      tree,
      selectionRects,
      matchHighlightsForPage(null, null),
      commentHighlightsForPage(null, null),
      suggestionHighlightsForPage(null, null),
      cursorPos,
      getCursorState(),
      logicalWidth,
      logicalHeight,
      visibleTop,
      visibleBottom,
      imageCache,
      canvasCache,
    );
  }

  function paintPages() {
    const st = state;
    if (!st) return;
    const dpr = typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1;
    const cs = getCursorState();
    // Per-page selection rects for a non-collapsed selection in paginated mode,
    // computed from the boundary positions resolved once in `update()` (cached
    // in `selStart`/`selEnd`) — NO `resolvePixelPosition` per blink/scroll
    // repaint. The non-paginated path and the spanning-block fallback use the
    // `selectionRects` array (filtered per page) instead. `pgStart`/`pgEnd` are
    // const captures so the per-page branch can narrow them to non-null without
    // `!` at the use site (a narrowing that does NOT flow through the
    // `perPageSel` boolean, so the null check lives at the use site below).
    const pgStart = selStart;
    const pgEnd = selEnd;
    const perPageSel =
      hasSelectionHighlight && !selSpanningFallback &&
      layoutTree?.type === "virtual-root";

    for (const [idx, canvas] of activeCanvases) {
      // Position ONLY this visible page (virtual mode: `getPage(idx)`; memoized
      // so repeat paints are free). Non-visible pages are never materialized.
      const page = getPageBox(idx);
      if (!page) continue;

      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      const physicalWidth = page.width * dpr;
      const physicalHeight = page.height * dpr;
      if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
        canvas.width = physicalWidth;
        canvas.height = physicalHeight;
        canvas.style.width = `${page.width}px`;
        canvas.style.height = `${page.height}px`;
        // A dimension change means this page's geometry changed (C.2b-2: a
        // section's page size was overridden, re-materializing the PageBox at a
        // new width/height). A pure geometry change moves no content boxes, so
        // walkAndDetectChanges would see "no diff" and short-circuit, leaving
        // the resized canvas blank/stale. Drop the per-page PaintCache so the
        // whole page is treated dirty and actually repaints (mirrors
        // acquireCanvas's delete-on-recycle).
        pageCaches.delete(idx);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Selection rects for this page: per-page (virtual) or filter the
      // precomputed array (non-paginated / spanning fallback / collapsed=empty).
      const pageSelRects = (perPageSel && pgStart !== null && pgEnd !== null)
        ? computeSelectionRectsForPage(
            st.state, st.selection, page, idx, pgStart, pgEnd, measurer,
            st.anchorAffinity, st.caretAffinity,
          )
        : selectionRects.filter((r) => r.pageIndex === idx);

      // Find-match highlights for this page (Stage 2; empty when find inactive).
      const pageMatchHighlights = matchHighlightsForPage(page, idx);

      // Comment highlights for this page (Stage 2; empty when no comments lit).
      const pageCommentHighlights = commentHighlightsForPage(page, idx);

      // Suggestion highlights for this page (Stage 2; empty when no suggestions lit).
      const pageSuggestionHighlights = suggestionHighlightsForPage(page, idx);

      // Cursor on this page? (null if not)
      const pageCursor = cursorPos.pageIndex === idx
        ? { x: cursorPos.x, y: cursorPos.y, height: cursorPos.height }
        : null;

      paintPage(ctx, page, pageSelRects, pageMatchHighlights, pageCommentHighlights, pageSuggestionHighlights, pageCursor, cs, imageCache, getOrCreatePageCache(idx));
    }
  }

  function paint() {
    if (destroyed) return;
    if (pageCount() > 0) {
      paintPages();
    } else {
      paintSingle();
    }
  }

  // ── Cursor blink ───────────────────────────────────────────────────────

  function startBlink() {
    stopBlink();
    cursorVisible = true;
    if (!focused) return;
    blinkIntervalId = setInterval(() => {
      cursorVisible = !cursorVisible;
      paint();
    }, 500);
  }

  function stopBlink() {
    if (blinkIntervalId !== null) {
      clearInterval(blinkIntervalId);
      blinkIntervalId = null;
    }
  }

  // ── Smooth scroll ──────────────────────────────────────────────────────

  function smoothScrollTo(el: HTMLElement | Window, target: number, duration: number) {
    cancelAnimationFrame(scrollAnimId);
    const start = el instanceof Window ? el.scrollY : el.scrollTop;
    const delta = target - start;
    if (Math.abs(delta) < 1) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min((now - t0) / duration, 1);
      const ease = 1 - (1 - elapsed) ** 3; // easeOutCubic
      const value = start + delta * ease;
      if (el instanceof Window) {
        el.scrollTo(0, value);
      } else {
        el.scrollTop = value;
      }
      if (elapsed < 1) {
        scrollAnimId = requestAnimationFrame(step);
      }
    };
    scrollAnimId = requestAnimationFrame(step);
  }

  function scrollCursorIntoView() {
    if (!focused || !state) return;
    scrollVisualIntoView(cursorPos);
  }

  /**
   * Scroll a visual position into view (smooth). Takes a `{pageIndex, y,
   * height}` — the cursor path passes `cursorPos`; the find-session path passes
   * an active match's start `PixelPosition`. Unlike `scrollCursorIntoView`, this
   * has NO `!focused`/`!state` guard: it reads only `pos` + the closure-local
   * `pageSlotGeoms`/`container`/`scrollParent`, all valid after ≥1 `update()`.
   * Find callers (the find bar holds focus, not the canvas) scroll regardless of
   * the editor's focus, by calling this directly with the match position.
   */
  function scrollVisualIntoView(pos: { pageIndex: number; y: number; height: number }) {
    const sp = scrollParent;

    // Compute visual Y from the target's page slot. Per-page geometry (C.2b-2):
    // the page's document-y is its slot `top` (running-sum offset), NOT a
    // uniform `pageIndex * (pageHeight + pageGap)`. Paginated-vs-not is keyed on
    // slot presence (an empty `pageSlotGeoms` ⇒ non-paginated single canvas).
    const targetSlot = pageSlotGeoms[pos.pageIndex];
    const targetVisualY =
      pageCount() > 0 && targetSlot ? targetSlot.top + pos.y : pos.y;
    const targetH = pos.height;
    const scrollPadding = 64;

    const containerRect = container.getBoundingClientRect();

    if (sp instanceof Window) {
      const targetScreenTop = containerRect.top + targetVisualY;
      const targetScreenBottom = targetScreenTop + targetH + scrollPadding;
      if (targetScreenBottom > sp.innerHeight) {
        smoothScrollTo(sp, sp.scrollY + targetScreenBottom - sp.innerHeight, SCROLL_DURATION);
      } else if (targetScreenTop < 0) {
        smoothScrollTo(sp, sp.scrollY + targetScreenTop - scrollPadding, SCROLL_DURATION);
      }
    } else if (typeof sp.getBoundingClientRect === "function") {
      const spRect = sp.getBoundingClientRect();
      const targetInSp = containerRect.top - spRect.top + sp.scrollTop + targetVisualY;
      const visTop = sp.scrollTop;
      const visBottom = sp.scrollTop + sp.clientHeight;
      if (targetInSp + targetH + scrollPadding > visBottom) {
        smoothScrollTo(sp, targetInSp + targetH + scrollPadding - sp.clientHeight, SCROLL_DURATION);
      } else if (targetInSp < visTop + scrollPadding) {
        smoothScrollTo(sp, Math.max(0, targetInSp - scrollPadding), SCROLL_DURATION);
      }
    }
  }

  // ── DOM sync ───────────────────────────────────────────────────────────

  function syncDom() {
    if (!state || !layoutTree) return;

    const tree = layoutTree;

    // Derive the page-SLOT geometry WITHOUT positioning any page. Virtual mode:
    // read `plan.entries` (count + per-slot blockSize) — never the whole tree.
    // Positioned mode (unsupported-feature fallback): extract the already-
    // positioned `PageBox` children. Non-paginated: zero slots → single canvas.
    const newSlotGeoms: PageSlotGeom[] = [];
    const newPositionedPages: LayoutBox[] = [];
    let newVirtualTree: VirtualLayoutTree | null = null;

    if (pageHeight) {
      if (tree.type === "virtual-root") {
        newVirtualTree = tree;
        // Per-entry geometry (C.2b-2): width + gap are PER-ENTRY (a section may
        // override its page size/gap), height is the entry's `blockSize`, and
        // `top` is the running-sum `blockOffset`. The slot tops in DOM flow
        // (height + marginBottom, summed) MUST agree with `top` — caret/mouse
        // use `top` while the DOM stacks slots by height + gap.
        for (const entry of tree.plan.entries) {
          newSlotGeoms.push({
            width: entry.pageConfig.pageInlineSize,
            height: entry.blockSize,
            gap: entry.pageConfig.pageGap,
            top: entry.blockOffset,
          });
        }
      } else if (tree.type === "block") {
        for (const c of tree.children) {
          // "page"-type children indicate the paginated positioned tree.
          // `LayoutBox` is a discriminated union including `PageBox`, so the
          // `type` check narrows `c` to `PageBox` — no cast needed. The legacy
          // floats/`clear` fallback uses the doc-wide `pageGap` (it does not yet
          // model per-section geometry); `top` is the box's own document-y.
          if (c.type === "page") {
            newPositionedPages.push(c);
            newSlotGeoms.push({ width: c.width, height: c.height, gap: pageGap, top: c.blockOffset });
          }
        }
      }
    }
    const isPaginated = newSlotGeoms.length > 0;
    pageSlotGeoms = newSlotGeoms;
    positionedPages = newPositionedPages;
    virtualTree = newVirtualTree;

    if (isPaginated) {
      // Remove single-canvas DOM
      if (singleCanvas) {
        singleCanvas.remove();
        singleCanvas = null;
        singleCtx = null;
      }
      if (spacerDiv) {
        spacerDiv.remove();
        spacerDiv = null;
      }
      container.style.minHeight = "";

      // Sync page canvases
      syncPageCanvases();
    } else {
      // Remove paginated DOM
      cleanupPageCanvases();

      // Ensure single canvas + spacer. Height comes from the positioned
      // (non-paginated) tree directly — never a virtual tree here.
      const positioned = nonPaginatedTree();
      if (!spacerDiv) {
        spacerDiv = document.createElement("div");
        spacerDiv.style.pointerEvents = "none";
        container.insertBefore(spacerDiv, textarea);
      }
      spacerDiv.style.height = `${positioned ? positioned.height : 0}px`;

      if (!singleCanvas) {
        singleCanvas = document.createElement("canvas");
        singleCanvas.style.position = "absolute";
        singleCanvas.style.left = "0";
        singleCanvas.style.top = "0";
        container.insertBefore(singleCanvas, textarea);
      }

      container.style.minHeight = "100%";
    }

    // Position textarea on the correct page. Per-page geometry (C.2b-2): the
    // page's document-y is its slot `top` (the plan's running-sum offset), NOT
    // `pageIndex * (pageHeight + pageGap)`.
    const cursorSlot = pageSlotGeoms[cursorPos.pageIndex];
    const textareaTop =
      isPaginated && cursorSlot ? cursorSlot.top + cursorPos.y : cursorPos.y;
    textarea.style.left = `${cursorPos.x}px`;
    textarea.style.top = `${textareaTop}px`;
    textarea.style.height = `${cursorPos.height}px`;
  }

  function syncPageCanvases() {
    const tTotal = markStart("ctrl.syncPageCanvases");
    const currentCount = pageSlots.length;
    const targetCount = pageSlotGeoms.length;

    // Remove excess slots
    for (let i = targetCount; i < currentCount; i++) {
      // Return canvas to pool if active
      const canvas = activeCanvases.get(i);
      if (canvas) {
        canvas.remove();
        canvasPool.push(canvas);
        activeCanvases.delete(i);
      }
      pageSlots[i].remove();
      // Prune this index's PaintCache. Without this, `pageCaches` retains one
      // entry per peak page index for the lifetime of the controller (open a
      // 200-page doc, shrink to 2 → 198 stale caches held). Correctness on
      // grow-back is already guaranteed by acquireCanvas deleting the cache on
      // re-acquire; this just frees the memory promptly when a page is removed.
      pageCaches.delete(i);
    }
    pageSlots.length = targetCount;

    // Add new slots
    for (let i = currentCount; i < targetCount; i++) {
      const slot = document.createElement("div");
      slot.dataset.pageIndex = String(i);
      slot.style.position = "relative";
      slot.style.boxShadow =
        "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)";
      container.insertBefore(slot, textarea);
      pageSlots[i] = slot;
    }

    // Update existing slot attributes, dimensions + margins — from the SLOT
    // geometry (no page positioned).
    for (let i = 0; i < targetCount; i++) {
      const slot = pageSlots[i];
      const geom = pageSlotGeoms[i];
      slot.dataset.pageIndex = String(i);
      slot.style.width = `${geom.width}px`;
      slot.style.height = `${geom.height}px`;
      // Per-entry gap (C.2b-2): keeps the DOM-flow slot tops (height +
      // marginBottom, summed) consistent with each slot's `top` (running-sum
      // offset) that caret/mouse use — they MUST agree.
      slot.style.marginBottom = i < targetCount - 1 ? `${geom.gap}px` : "0";
    }

    // Setup IntersectionObserver
    setupIntersectionObserver();
    markEnd("ctrl.syncPageCanvases", tTotal);
  }

  function acquireCanvas(idx: number, slot: HTMLDivElement) {
    if (activeCanvases.has(idx)) return;
    const canvas = canvasPool.pop() ?? document.createElement("canvas");
    canvas.dataset.pageIndex = String(idx);
    canvas.style.display = "block";
    // The canvas may be brand-new (zero pixels) or recycled from the pool
    // (carrying stale pixels from a previously-rendered page). Either way the
    // pixels don't match `idx`'s current content, so the next paint must do a
    // full repaint. Resetting the dimensions clears stale pixels (spec
    // behavior of setting canvas.width); deleting the per-page PaintCache
    // makes walkAndDetectChanges treat the entire pageBox as dirty so
    // paintPage actually draws instead of short-circuiting on "no diff".
    canvas.width = 0;
    canvas.height = 0;
    pageCaches.delete(idx);
    slot.appendChild(canvas);
    activeCanvases.set(idx, canvas);
  }

  function releaseCanvas(idx: number) {
    const canvas = activeCanvases.get(idx);
    if (!canvas) return;
    canvas.remove();
    canvasPool.push(canvas);
    activeCanvases.delete(idx);
  }

  function setupIntersectionObserver() {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
    }

    intersectionObserver = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const el = entry.target as HTMLDivElement;
          const idx = Number(el.dataset.pageIndex);
          if (isNaN(idx)) continue;
          if (entry.isIntersecting) {
            if (!activeCanvases.has(idx)) {
              acquireCanvas(idx, el);
              changed = true;
            }
          } else {
            if (activeCanvases.has(idx)) {
              releaseCanvas(idx);
              changed = true;
            }
          }
        }
        if (changed) paint();
      },
      {
        // IntersectionObserver wants Element | Document | null, never Window.
        // A non-window scroll parent (editor embedded in a scrollable <div>)
        // becomes the observer root; the window fallback maps to null (the
        // viewport).
        root: scrollParent instanceof HTMLElement ? scrollParent : null,
        rootMargin: "200px",
      },
    );

    for (const slot of pageSlots) {
      intersectionObserver.observe(slot);
    }
  }

  function cleanupPageCanvases() {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
    for (const [, canvas] of activeCanvases) {
      canvas.remove();
    }
    activeCanvases.clear();
    for (const slot of pageSlots) {
      slot.remove();
    }
    pageSlots = [];
    canvasPool.length = 0;
  }

  // ── Mouse handling ─────────────────────────────────────────────────────

  function resolveMouseToLayout(e: MouseEvent): { x: number; y: number; pageIndex: number } | null {
    const total = pageCount();
    if (total > 0 && pageHeight) {
      const target = e.target as HTMLElement;
      const inRange = (idx: number) => idx >= 0 && idx < total;

      // Check if clicked on a canvas inside a slot
      if (target instanceof HTMLCanvasElement && target.dataset.pageIndex != null) {
        const idx = Number(target.dataset.pageIndex);
        if (inRange(idx)) {
          const rect = target.getBoundingClientRect();
          return { x: e.clientX - rect.left, y: e.clientY - rect.top, pageIndex: idx };
        }
      }

      // Check if clicked on a slot div directly
      if (target instanceof HTMLDivElement && target.dataset.pageIndex != null) {
        const idx = Number(target.dataset.pageIndex);
        if (inRange(idx)) {
          const rect = target.getBoundingClientRect();
          return { x: e.clientX - rect.left, y: e.clientY - rect.top, pageIndex: idx };
        }
      }

      // Click outside any slot — find the page by visual Y. Pages are NOT
      // uniform-height (C.2b-2: a section may override its geometry), so the
      // slot top is the running-sum `top` in `pageSlotGeoms`, NOT
      // `idx*(pageHeight+pageGap)`. With a virtual tree the plan maps document-y
      // → page authoritatively (`pageIndexAtBlockOffset`, a binary search over
      // the running-sum offsets); the positioned fallback finds the last slot
      // whose `top <= visualY`. The page-local Y subtracts that slot's `top` and
      // clamps to THAT page's own height (so a click low on a tall section page
      // is not clamped to the short default).
      const rect = container.getBoundingClientRect();
      const visualY = e.clientY - rect.top;
      let idx: number;
      if (virtualTree !== null) {
        idx = Math.max(0, Math.min(total - 1, virtualTree.plan.pageIndexAtBlockOffset(visualY)));
      } else {
        // Positioned fallback: the last slot whose top edge is at/above visualY.
        idx = 0;
        for (let i = 0; i < total; i++) {
          if (pageSlotGeoms[i].top <= visualY) idx = i;
          else break;
        }
      }
      const slot = pageSlotGeoms[idx];
      const pageLocalY = visualY - (slot?.top ?? 0);
      return {
        x: e.clientX - rect.left,
        y: Math.max(0, Math.min(slot?.height ?? 0, pageLocalY)),
        pageIndex: idx,
      };
    }
    const rect = container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, pageIndex: 0 };
  }

  function handleMouseDown(e: MouseEvent) {
    if (destroyed || !state || !layoutTree) return;
    e.preventDefault();
    textarea.focus();

    const coords = resolveMouseToLayout(e);
    if (!coords) return;

    // Hit-test against ONLY the clicked page (virtual tree) — never
    // materialize the whole document (Phase 4).
    const hitTree = treeForPageHitTest(coords.pageIndex);
    if (!hitTree) return;
    const hit = resolvePositionFromPixel(
      state.state,
      hitTree,
      measurer,
      coords.x,
      coords.y,
      coords.pageIndex,
    );
    if (!hit) {
      dispatch({ type: "MOVE_DOCUMENT_BOUNDARY", boundary: "end" });
      return;
    }
    // P4-C.2.2b §D: carry the hit-side caret-affinity seed through to the click's
    // SET_SELECTION so a collapsed caret at a bidi direction boundary renders on
    // the clicked side. Multi-click / shift-extend selections are non-collapsed
    // (affinity is inert there) — they pass no seed, which clears any stale value.
    const pos = hit.position;
    const caretAffinity = hit.caretAffinity;

    // HL.3: Cmd/Ctrl+Click on a hyperlink opens the URL in a new
    // tab instead of placing the cursor. Plain click still positions
    // the cursor — needed so users can edit link text.
    if (e.metaKey || e.ctrlKey) {
      const url = linkUrlAtPosition(state.state, pos);
      if (url !== null) {
        // Allowlist safe schemes (per hyperlinks spec risk table: reject
        // javascript: / data: / vbscript: and scheme-less URLs). Shared with the
        // taleweaver-html export guard.
        if (isOpenableLinkUrl(url)) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
    }

    // Triple-click: select paragraph (the entire leaf block).
    // In the new model `pos.blockId` IS the leaf block, so we select from
    // offset 0 to that block's inline-content length.
    if (e.detail >= 3) {
      const block = getBlock(state.state, pos.blockId);
      if (block) {
        const length = block.inlineContent
          ? inlineContentLength(block.inlineContent)
          : 0;
        dispatch({
          type: "SET_SELECTION",
          selection: createSpan(
            createPosition(pos.blockId, 0),
            createPosition(pos.blockId, length),
          ),
          caretPageHint: coords.pageIndex,
        });
      }
      return;
    }

    // Double-click: select word
    if (e.detail === 2) {
      const wordSel = selectWord(state.state, pos);
      dispatch({ type: "SET_SELECTION", selection: wordSel, caretPageHint: coords.pageIndex });
      return;
    }

    // Shift-click: extend selection from current anchor.
    // A pointer selection is CONFINED to the selection context it began in
    // (Google Docs): you cannot shift-extend from the body into a footnote
    // slot (a different selection context), or vice versa. Extending across
    // contexts would build a cross-context Span, which crashes the next render
    // (getActiveFormatting → iterateSpan throws "different selection
    // contexts"). When `pos` is cross-context, keep the prior in-context
    // selection — skip the extension.
    if (e.shiftKey) {
      // A null context means the block isn't in any tree (should not happen for
      // a hit-test position, but never extend into an unknown context). Treat
      // null as a definitive skip so two unknown contexts can't compare equal.
      const anchorCtx = selectionContextOf(state.state, state.selection.anchor.blockId);
      const posCtx = selectionContextOf(state.state, pos.blockId);
      if (anchorCtx === null || posCtx === null || anchorCtx !== posCtx) return;
      dispatch({
        type: "SET_SELECTION",
        selection: createSpan(state.selection.anchor, pos),
        caretPageHint: coords.pageIndex,
      });
      return;
    }

    // Single click: position cursor + start drag. Seed the caret affinity from
    // the hit side so a collapsed caret at a bidi direction boundary renders
    // there (P4-C.2.2b §D).
    isDragging = true;
    dragAnchor = pos;
    dispatch({
      type: "SET_SELECTION",
      selection: createSpan(pos, pos),
      caretPageHint: coords.pageIndex,
      caretAffinity,
    });
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging || !dragAnchor || !state || !layoutTree) return;

    const coords = resolveMouseToLayout(e);
    if (!coords) return;

    // Drag hit-test against ONLY the page under the pointer (see
    // handleMouseDown) — never materialize the whole document.
    const hitTree = treeForPageHitTest(coords.pageIndex);
    if (!hitTree) return;
    const hit = resolvePositionFromPixel(
      state.state,
      hitTree,
      measurer,
      coords.x,
      coords.y,
      coords.pageIndex,
    );
    if (hit) {
      // P4-C.2.2b §D: a drag builds a (usually non-collapsed) span — caret
      // affinity is inert across a range, so the drag's SET_SELECTION carries the
      // hit-side seed only so a drag that collapses back onto a boundary still
      // renders on the pointer side.
      const pos = hit.position;
      const caretAffinity = hit.caretAffinity;
      // A drag selection is CONFINED to the selection context it began in
      // (Google Docs): once the pointer crosses from the body into a footnote
      // slot (a different selection context), the drag does NOT extend into it.
      // Building `createSpan(dragAnchor, pos)` across contexts would store a
      // cross-context Span, which crashes the next render (getActiveFormatting
      // → iterateSpan throws "different selection contexts"). Skip the
      // extension when `pos` left the anchor's context — the prior in-context
      // selection stands.
      // A null context means the block isn't in any tree (should not happen for
      // a hit-test position, but never extend into an unknown context). Treat
      // null as a definitive skip so two unknown contexts can't compare equal.
      const anchorCtx = selectionContextOf(state.state, dragAnchor.blockId);
      const posCtx = selectionContextOf(state.state, pos.blockId);
      if (anchorCtx === null || posCtx === null || anchorCtx !== posCtx) return;
      // The drag hint tracks the FOCUS page (the current drag point) so the
      // caret resolves on the page under the pointer.
      dispatch({
        type: "SET_SELECTION",
        selection: createSpan(dragAnchor, pos),
        caretPageHint: coords.pageIndex,
        caretAffinity,
      });
    }
  }

  function handleMouseUp() {
    isDragging = false;
  }

  // ── Keyboard / input handling ──────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent) {
    if (isComposing || e.isComposing) return;
    // Tab / Shift+Tab routing is context-sensitive: pass whether the caret's
    // focus block is a list-item so the keymap can map Tab → list nesting.
    const focusBlock =
      state !== null
        ? getBlock(state.state, state.selection.focus.blockId)
        : null;
    const action = mapKeyEvent(e, {
      inListItem: focusBlock?.type === "list-item",
    });
    if (action) {
      e.preventDefault();
      dispatch(action);
    }
  }

  function handleInput() {
    if (isComposing) return;
    // Ignore input while blurred. An `input` that fires when the editor is not
    // focused (a programmatic textarea value-set, or a stray event arriving after
    // a focus race) would apply text at a STALE caret — the engine's selection
    // points elsewhere. Clear the buffer so the value can't leak into the next
    // focused input. (Provenance of focused non-typing input — autofill /
    // translation bulk-sets — is a separate hardening concern, tracked as #490.)
    if (!focused) {
      textarea.value = "";
      return;
    }
    const text = textarea.value;
    if (text) {
      dispatch({ type: "INSERT_TEXT", text });
    }
    textarea.value = "";
  }

  function handleCompositionStart() {
    isComposing = true;
  }

  function handleCompositionEnd(e: CompositionEvent) {
    isComposing = false;
    const text = e.data;
    if (text) {
      dispatch({ type: "INSERT_TEXT", text });
    }
    textarea.value = "";
  }

  // ── Clipboard handling ─────────────────────────────────────────────────

  function handleCopy(e: ClipboardEvent) {
    if (!state) return;
    if (isCollapsed(state.selection)) return;
    e.preventDefault();
    const text = extractText(state.state, state.selection, builtinEmbedSerializer);
    e.clipboardData?.setData("text/plain", text);
  }

  function handleCut(e: ClipboardEvent) {
    if (!state) return;
    if (isCollapsed(state.selection)) return;
    e.preventDefault();
    const text = extractText(state.state, state.selection, builtinEmbedSerializer);
    e.clipboardData?.setData("text/plain", text);
    dispatch({ type: "DELETE_BACKWARD" });
  }

  function handlePaste(e: ClipboardEvent) {
    // preventDefault UNCONDITIONALLY: if we returned before it on `state === null`,
    // the browser's default paste would land in the hidden textarea and leak back
    // in via `handleInput` as an INSERT_TEXT — defeating the guard. Block the
    // native paste first, THEN no-op when there is no state to paste into.
    e.preventDefault();
    if (!state) return;
    const text = e.clipboardData?.getData("text/plain");
    if (text) {
      dispatch({ type: "PASTE", text });
    }
  }

  // ── Focus handling ─────────────────────────────────────────────────────

  function handleFocus() {
    focused = true;
    cursorVisible = true;
    startBlink();
    paint();
  }

  function handleBlur() {
    focused = false;
    // If an IME composition was in flight when focus was lost, ABANDON it. There
    // is no spec guarantee `compositionend` fires before/at blur (Chrome/Safari
    // differ, and an interrupted composition may never fire it), so a stale
    // `isComposing === true` would gate `handleKeyDown`/`handleInput` forever —
    // the editor would silently accept no input after refocus (a dead editor).
    // Clearing the flag + the textarea buffer recovers cleanly (the partial
    // composed text is dropped, which is the acceptable trade for recoverability).
    if (isComposing) {
      isComposing = false;
      textarea.value = "";
    }
    stopBlink();
    paint();
  }

  // ── Scroll handling ────────────────────────────────────────────────────

  function handleScroll() {
    cancelAnimationFrame(scrollRafId);
    scrollRafId = requestAnimationFrame(() => paint());
  }

  // ── Attach event listeners ─────────────────────────────────────────────

  container.addEventListener("mousedown", handleMouseDown);
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
  textarea.addEventListener("keydown", handleKeyDown);
  textarea.addEventListener("input", handleInput);
  textarea.addEventListener("compositionstart", handleCompositionStart);
  textarea.addEventListener("compositionend", handleCompositionEnd);
  textarea.addEventListener("copy", handleCopy);
  textarea.addEventListener("cut", handleCut);
  textarea.addEventListener("paste", handlePaste);
  textarea.addEventListener("focus", handleFocus);
  textarea.addEventListener("blur", handleBlur);

  // Detect scroll parent and listen
  detectScrollParent();
  scrollParent.addEventListener("scroll", handleScroll, { passive: true } as AddEventListenerOptions);

  // ── Public API ─────────────────────────────────────────────────────────

  function update(editorState: EditorState) {
    if (destroyed) return;
    const tTotal = markStart("ctrl.update");
    state = editorState;

    // Do NOT materialize all pages here. `layoutTree` is the raw (possibly
    // virtual) tree; paginated paths (paint, caret, hit-test, selection/find/
    // comment rects) read it per-page via `getPage` and union per-page via
    // `selectionRectsAcrossPages` — the whole document is never materialized.
    // Only the non-paginated branches read it as a positioned `LayoutBox` (via
    // `nonPaginatedTree()`).
    layoutTree = state.layoutTree;

    // Cursor position: resolved directly against the (virtual or positioned)
    // tree. In virtual mode `resolvePixelPosition` positions only the cursor's
    // page (+ a neighbor at the cross-page soft-wrap edge), NEVER all pages —
    // this is what makes the typing/Enter hot path O(1 page). Returns null for
    // unknown blockIds; fall back to default coords for a placeholder cursor.
    const tResolve = markStart("ctrl.resolveCursor");
    const resolved = resolvePixelPosition(
      state.state,
      state.selection.focus,
      layoutTree,
      measurer,
      state.caretPageHint,
      // P4-C.2.2b read-side: feed the stored bidi caret-affinity so a collapsed
      // caret at an LTR↔RTL run boundary renders on the side the user clicked /
      // last arrowed to (the dual-caret). The seed is written by hit-test + bidi
      // move; without threading it here the render always defaulted to "after".
      state.caretAffinity,
    );
    cursorPos = resolved ?? {
      x: 0,
      y: 0,
      height: 16,
      lineY: 0,
      lineHeight: 24,
      lineMarginTop: 0,
      lineMarginBottom: 0,
      pageIndex: 0,
    };
    markEnd("ctrl.resolveCursor", tResolve);

    // Selection rects. Collapsed (typing/Enter hot path) → none. Paginated +
    // non-collapsed → per-page in `paintPages` from the boundary positions
    // resolved ONCE here (no bridge). Non-paginated → the full positioned tree.
    // Spanning-block boundary → fall back to the bridge (rare; per-page can't
    // see a block's fragment on the other page). `selectionRects` carries rects
    // only for the non-paginated + spanning-fallback cases; the per-page path
    // leaves it empty and uses `selStart`/`selEnd`.
    const tSel = markStart("ctrl.selectionRects");
    hasSelectionHighlight = !isCollapsed(state.selection);
    selStart = null;
    selEnd = null;
    selSpanningFallback = false;
    selectionRects = [];
    if (hasSelectionHighlight) {
      const start = spanStart(state.state, state.selection);
      const end = spanEnd(state.state, state.selection);
      if (layoutTree.type === "virtual-root") {
        selSpanningFallback =
          blockSpansPages(layoutTree.plan, start.blockId) ||
          blockSpansPages(layoutTree.plan, end.blockId);
        if (selSpanningFallback) {
          // Rare: a boundary block taller than a page. Per-page concat over the
          // virtual tree (per-page, never the whole tree).
          selectionRects = selectionRectsAcrossPages(
            state.state, state.selection, layoutTree, measurer,
            state.anchorAffinity, state.caretAffinity,
          );
        } else {
          selStart = resolvePixelPosition(state.state, start, layoutTree, measurer, state.caretPageHint);
          selEnd = resolvePixelPosition(state.state, end, layoutTree, measurer, state.caretPageHint);
          // rects computed per-page in paintPages from selStart/selEnd
        }
      } else {
        selectionRects = computeSelectionRects(
          state.state, state.selection, layoutTree, measurer,
          state.anchorAffinity, state.caretAffinity,
        );
      }
    }
    markEnd("ctrl.selectionRects", tSel);

    // Find live-recompute (D9): while a session is active, re-run findMatches
    // against the fresh state after every doc change. Preserve the user's place
    // by clamping the activeIndex into the new range (if the prior active match
    // was deleted the clamp lands on a surviving neighbor — accepted v1 behavior,
    // no identity remap). Does NOT scroll (only findStart/Next/Prev scroll) — a
    // recompute mid-typing must not yank the viewport. `total === 0` keeps the
    // session alive with an empty (no-match) highlight set.
    if (findSession !== null) {
      const matches = findMatches(state.state, findSession.query, findSession.options);
      // `-1` (the no-active-match sentinel) is the safe default. The `?.` is
      // correct, not defensive padding: `setFindHighlights` is public and can
      // set `findHighlights` directly (without a session), so the
      // findSession-implies-findHighlights pairing isn't enforced — findHighlights
      // may legitimately be null here. Using `-1` (not `0`) means a null
      // findHighlights can't silently land the user on index 0 —
      // `Math.max(prior, 0)` still clamps to 0 when total > 0.
      const prior = findHighlights?.activeIndex ?? -1;
      const activeIndex =
        matches.length === 0 ? -1 : Math.min(Math.max(prior, 0), matches.length - 1);
      // Direct assignment (not `setFindHighlights(...)`): that helper calls
      // `paint()`, which is redundant here because `update()` calls `paint()`
      // unconditionally below. We still invoke `resolveFindHighlights()` (just
      // past this block) to refresh the match geometry. A future maintainer
      // adding bookkeeping to `setFindHighlights` must mirror it here.
      findHighlights = { matches, activeIndex };
    }

    // Find-highlight Stage 1: re-resolve each match's boundary positions against
    // the fresh layout tree (matches geometry can shift when the doc changes).
    resolveFindHighlights();

    // Comment-highlight Stage 1: re-resolve each lit comment's range + boundary
    // positions against the fresh state/layout (markers self-heal across edits —
    // the host doesn't re-call setCommentHighlights per keystroke).
    resolveCommentHighlights();

    // Suggestion-highlight Stage 1: re-resolve each lit suggestion's range +
    // boundary positions against the fresh state/layout (tagged runs self-heal
    // across edits — the host doesn't re-call setSuggestionHighlights per keystroke).
    resolveSuggestionHighlights();

    const tSync = markStart("ctrl.syncDom");
    syncDom();
    markEnd("ctrl.syncDom", tSync);

    const tBlink = markStart("ctrl.startBlink");
    startBlink();
    markEnd("ctrl.startBlink", tBlink);

    const tPaint = markStart("ctrl.paint");
    paint();
    markEnd("ctrl.paint", tPaint);

    const tScroll = markStart("ctrl.scrollIntoView");
    scrollCursorIntoView();
    markEnd("ctrl.scrollIntoView", tScroll);

    markEnd("ctrl.update", tTotal);
  }

  function setFindHighlights(matches: readonly TextMatch[], activeIndex: number): void {
    if (destroyed) return;
    findHighlights = { matches, activeIndex };
    // Stage 1: resolve boundary positions against the current layout, then
    // repaint. A bare `paint()` suffices: the renderer drives the match-highlight
    // dirty bookkeeping. Inside paintPage/paintCanvas, `addMatchHighlightDirty`
    // (in canvas-renderer.ts) compares `cache.getLastMatchHighlightRects()` vs
    // the current rects each paint, so the incremental path doesn't short-circuit
    // even though layout + cursor are unchanged.
    resolveFindHighlights();
    paint();
  }

  function clearFindHighlights(): void {
    if (destroyed) return;
    if (findHighlights === null && resolvedMatches.length === 0) return;
    findHighlights = null;
    resolvedMatches = [];
    // A bare `paint()` suffices: the dirty-region bookkeeping happens inside the
    // renderer. `addMatchHighlightDirty` (in canvas-renderer.ts) compares
    // `cache.getLastMatchHighlightRects()` vs the now-empty current set each
    // paint, so it dirties the PRIOR rects' regions and the old highlight band
    // is erased.
    paint();
  }

  // ── Comment highlight overlay (comments slice 5) ─────────────────────────

  function setCommentHighlights(highlights: readonly CommentHighlight[]): void {
    if (destroyed) return;
    commentHighlights = highlights;
    // Stage 1: resolve each lit comment's range + boundary positions against the
    // current state/layout, then repaint. A bare `paint()` suffices: the renderer
    // drives the comment-highlight dirty bookkeeping. Inside paintPage/paintCanvas,
    // `addCommentHighlightDirty` compares `cache.getLastCommentHighlightRects()`
    // vs the current rects each paint, so the incremental path doesn't
    // short-circuit even though layout + cursor are unchanged.
    resolveCommentHighlights();
    paint();
  }

  function clearCommentHighlights(): void {
    if (destroyed) return;
    if (commentHighlights === null && resolvedCommentHighlights.length === 0) return;
    commentHighlights = null;
    resolvedCommentHighlights = [];
    // A bare `paint()` suffices: `addCommentHighlightDirty` compares
    // `cache.getLastCommentHighlightRects()` vs the now-empty current set each
    // paint, so it dirties the PRIOR rects' regions and the old band is erased.
    paint();
  }

  // ── Suggestion highlight overlay (change-tracking slice 6) ───────────────

  function setSuggestionHighlights(highlights: readonly SuggestionHighlight[]): void {
    if (destroyed) return;
    suggestionHighlights = highlights;
    // Stage 1: resolve each lit suggestion's range + boundary positions against the
    // current state/layout, then repaint. A bare `paint()` suffices: the renderer
    // drives the suggestion-highlight dirty bookkeeping. Inside paintPage/paintCanvas,
    // `addSuggestionHighlightDirty` compares `cache.getLastSuggestionHighlightRects()`
    // vs the current rects each paint, so the incremental path doesn't
    // short-circuit even though layout + cursor are unchanged.
    resolveSuggestionHighlights();
    paint();
  }

  function clearSuggestionHighlights(): void {
    if (destroyed) return;
    if (suggestionHighlights === null && resolvedSuggestionHighlights.length === 0) return;
    suggestionHighlights = null;
    resolvedSuggestionHighlights = [];
    // A bare `paint()` suffices: `addSuggestionHighlightDirty` compares
    // `cache.getLastSuggestionHighlightRects()` vs the now-empty current set each
    // paint, so it dirties the PRIOR rects' regions and the old band is erased.
    paint();
  }

  // ── Find session + navigation (#433) ─────────────────────────────────────

  /** The current find status from `findHighlights` (total + activeIndex). */
  function findStatus(): FindStatus {
    if (findHighlights === null || findHighlights.matches.length === 0) {
      return { total: 0, activeIndex: -1 };
    }
    return { total: findHighlights.matches.length, activeIndex: findHighlights.activeIndex };
  }

  function replaceActive(replacement: string): FindStatus {
    if (destroyed || findHighlights === null) return findStatus();
    const { matches, activeIndex } = findHighlights;
    // No active match (out of range / empty set) → no-op.
    if (activeIndex < 0 || activeIndex >= matches.length) return findStatus();
    // Dispatch the engine action; the React reducer produces the new state and
    // EditorView's effect calls `update()`, whose live recompute refreshes the
    // highlights AND clamps the activeIndex onto the following match (the
    // replaced one is gone). We do NOT advance the index here (that would
    // double-advance / skip). Return the CURRENT (pre-refresh) status — the find
    // bar polls `findStatus()` after the update for the authoritative count.
    dispatch({ type: "REPLACE_MATCH", match: matches[activeIndex], replacement });
    return findStatus();
  }

  function replaceAll(replacement: string): FindStatus {
    if (destroyed || findHighlights === null) return findStatus();
    const { matches } = findHighlights;
    if (matches.length === 0) return findStatus();
    // One undo step (guaranteed by the REPLACE_ALL action). The live recompute
    // in the subsequent `update()` refreshes the highlights (typically empty for
    // the replaced query). Return the current (pre-refresh) status.
    dispatch({ type: "REPLACE_ALL", matches: [...matches], replacement });
    return findStatus();
  }

  /**
   * Scroll the active match into view via the active match's START
   * `PixelPosition` (Stage-1 `resolvedMatches[activeIndex].startPos`). NEVER
   * moves the document cursor. No-op when there is no active match or its
   * position hasn't resolved (off-layout block). Scrolls regardless of editor
   * focus (the find bar holds focus) — `scrollVisualIntoView` has no focus guard.
   */
  function scrollActiveMatchIntoView(): void {
    if (findHighlights === null) return;
    const { activeIndex } = findHighlights;
    const rm = resolvedMatches[activeIndex];
    if (rm === undefined) return;
    scrollVisualIntoView(rm.startPos);
  }

  /**
   * The initial active index for `findStart`: the first match whose start is
   * at-or-after the document cursor (Google Docs "find from here"), wrapping to 0
   * if none follow. 0 when there's no resolvable cursor, or when the cursor and
   * the matches live in different selection contexts (`comparePositions` throws
   * "no common ancestor" — guarded here).
   */
  function initialActiveIndex(matches: readonly TextMatch[]): number {
    const st = state;
    if (st === null || matches.length === 0) return 0;
    const cursorPosn = st.selection.focus;
    // Cross-context guard: a cursor in a footnote/header body and main-tree
    // matches have no common ancestor → comparePositions throws. Fall back to 0.
    if (selectionContextOf(st.state, cursorPosn.blockId) !==
        selectionContextOf(st.state, matches[0].blockId)) {
      return 0;
    }
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const matchStart = createPosition(m.blockId, m.start);
      try {
        if (comparePositions(st.state, matchStart, cursorPosn) >= 0) return i;
      } catch {
        /* cross-context (e.g. caller passed cross-context `blockIds`): this match
           lives in a different selection context than the cursor, so
           comparePositions throws "no common ancestor". The pre-check above only
           compares the cursor to matches[0]; with caller-supplied blockIds later
           matches can still span contexts. Treat this match as not-after-cursor
           and fall through — eventually wrapping to the first match (return 0). */
      }
    }
    // No match at/after the cursor → wrap to the first match.
    return 0;
  }

  function findStart(query: string, options?: FindMatchesOptions): FindStatus {
    if (destroyed || state === null) return { total: 0, activeIndex: -1 };
    const opts: FindMatchesOptions = options ?? { caseSensitive: false, wholeWord: false };
    findSession = { query, options: opts };
    const matches = findMatches(state.state, query, opts);
    if (matches.length === 0) {
      // Keep the session active (so a later edit live-recomputes), but no match.
      setFindHighlights(matches, -1);
      // `findStatus()` is the single source of truth (matches findNext/findPrev):
      // after `setFindHighlights(matches, -1)` with empty matches it returns
      // `{ total: 0, activeIndex: -1 }`.
      return findStatus();
    }
    const activeIndex = initialActiveIndex(matches);
    setFindHighlights(matches, activeIndex);
    scrollActiveMatchIntoView();
    return { total: matches.length, activeIndex };
  }

  function findNext(): FindStatus {
    if (destroyed || findHighlights === null) return findStatus();
    const total = findHighlights.matches.length;
    if (total === 0) return findStatus();
    const activeIndex = (findHighlights.activeIndex + 1) % total;
    setFindHighlights(findHighlights.matches, activeIndex);
    scrollActiveMatchIntoView();
    return { total, activeIndex };
  }

  function findPrev(): FindStatus {
    if (destroyed || findHighlights === null) return findStatus();
    const total = findHighlights.matches.length;
    if (total === 0) return findStatus();
    const activeIndex = (findHighlights.activeIndex - 1 + total) % total;
    setFindHighlights(findHighlights.matches, activeIndex);
    scrollActiveMatchIntoView();
    return { total, activeIndex };
  }

  function findClose(): void {
    if (destroyed) return;
    findSession = null;
    // Does NOT move the document selection — the caret stays where it was.
    clearFindHighlights();
  }

  function destroy() {
    destroyed = true;
    layoutTree = null;
    virtualTree = null;
    hasSelectionHighlight = false;
    selStart = null;
    selEnd = null;
    selSpanningFallback = false;
    findHighlights = null;
    resolvedMatches = [];
    findSession = null;
    commentHighlights = null;
    resolvedCommentHighlights = [];
    suggestionHighlights = null;
    resolvedSuggestionHighlights = [];

    // Remove event listeners
    container.removeEventListener("mousedown", handleMouseDown);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    textarea.removeEventListener("keydown", handleKeyDown);
    textarea.removeEventListener("input", handleInput);
    textarea.removeEventListener("compositionstart", handleCompositionStart);
    textarea.removeEventListener("compositionend", handleCompositionEnd);
    textarea.removeEventListener("copy", handleCopy);
    textarea.removeEventListener("cut", handleCut);
    textarea.removeEventListener("paste", handlePaste);
    textarea.removeEventListener("focus", handleFocus);
    textarea.removeEventListener("blur", handleBlur);
    scrollParent.removeEventListener("scroll", handleScroll);

    // Clear timers
    stopBlink();
    cancelAnimationFrame(scrollRafId);
    cancelAnimationFrame(scrollAnimId);

    // Dispose the document History so its Y.UndoManager detaches its
    // afterTransaction observers from the Doc. `history` is the one long-lived
    // instance carried by reference across every EditorState, so disposing it
    // once here releases the observers a torn-down/recreated controller would
    // otherwise leak (collab / multi-view).
    state?.history.destroy();

    // Cleanup DOM
    cleanupPageCanvases();
    if (singleCanvas) {
      singleCanvas.remove();
      singleCanvas = null;
      singleCtx = null;
    }
    if (spacerDiv) {
      spacerDiv.remove();
      spacerDiv = null;
    }
    textarea.remove();
  }

  function focus() {
    textarea.focus();
  }

  return {
    update,
    focus,
    destroy,
    setFindHighlights,
    clearFindHighlights,
    setCommentHighlights,
    clearCommentHighlights,
    setSuggestionHighlights,
    clearSuggestionHighlights,
    findStart,
    findStatus,
    replaceActive,
    replaceAll,
    findNext,
    findPrev,
    findClose,
  };
}

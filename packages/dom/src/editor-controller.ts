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
  computeSelectionRects,
  resolvePositionedTree,
  markStart,
  markEnd,
  type LayoutBox,
  type VirtualLayoutTree,
  type Position,
  type TextShaper,
  type TextMeasurer,
  type EditorAction,
  type EditorState,
  type SelectionRect,
  type PixelPosition,
} from "@taleweaver/core";
import { mapKeyEvent } from "./key-handler";
import { FONT_CONFIG } from "./font-config";
import { paintCanvas, paintPage, type CursorState } from "./canvas-renderer";
import { createPaintCache, type PaintCache } from "./paint-cache";
import { ImageCache } from "./image-cache";

const DEFAULT_PAGE_GAP = 24;
const SCROLL_DURATION = 250;

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

export interface EditorController {
  update(editorState: EditorState): void;
  focus(): void;
  destroy(): void;
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
  // Lazy `materializeAll()` bridge for the consumers NOT yet migrated off it
  // (Phase 4): `computeSelectionRects` for NON-collapsed selections, and the
  // mouse hit-test `resolvePositionFromPixel`. Resolved on FIRST access per
  // `update()` (memoized in `positionedBridge`) — never eagerly at the top of
  // `update()`, so the collapsed-selection typing/Enter hot path provably never
  // triggers `materializeAll()`.
  let positionedBridge: LayoutBox | null = null;
  function getPositionedTree(): LayoutBox | null {
    if (positionedBridge !== null) return positionedBridge;
    if (layoutTree === null) return null;
    positionedBridge = resolvePositionedTree(layoutTree);
    return positionedBridge;
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
  // O(N) per cursor move.
  // TODO: prune pageCaches when pages are removed (currently leaks one
  // PaintCache per removed page; benign in practice, page count is small).
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

  // ── Page model (paginated mode) ──────────────────────────────────────────
  //
  // Per-page SLOT geometry, derived without positioning any page:
  //   - virtual tree → `vtree.plan.entries` (count + `blockSize` per slot);
  //   - positioned tree → the positioned `PageBox` children's width/height.
  // `pageSlots`'s length is the page count; an empty array means non-paginated
  // (single-canvas mode).
  interface PageSlotGeom {
    readonly width: number;
    readonly height: number;
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

  function getCursorState(): CursorState {
    if (selectionRects.length > 0) return "hidden";
    if (!focused) return "inactive";
    if (cursorVisible) return "active";
    return "hidden";
  }

  function paintSingle() {
    if (!state) return;
    if (!singleCanvas) return;
    // Non-paginated mode: `layoutTree` is a positioned `LayoutBox` (never a
    // virtual tree — virtualization only happens in paginated mode), so
    // `getPositionedTree()` is a no-op identity here, not a materialize.
    const tree = getPositionedTree();
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
    const dpr = typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1;
    const cs = getCursorState();

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
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Filter selection rects for this page
      const pageSelRects = selectionRects.filter((r) => r.pageIndex === idx);

      // Cursor on this page? (null if not)
      const pageCursor = cursorPos.pageIndex === idx
        ? { x: cursorPos.x, y: cursorPos.y, height: cursorPos.height }
        : null;

      paintPage(ctx, page, pageSelRects, pageCursor, cs, imageCache, getOrCreatePageCache(idx));
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
    const sp = scrollParent;

    // Compute visual Y from pageIndex and page-relative cursor Y
    const cursorVisualY =
      pageCount() > 0 && pageHeight
        ? cursorPos.pageIndex * (pageHeight + pageGap) + cursorPos.y
        : cursorPos.y;
    const cursorH = cursorPos.height;
    const scrollPadding = 64;

    const containerRect = container.getBoundingClientRect();

    if (sp instanceof Window) {
      const cursorScreenTop = containerRect.top + cursorVisualY;
      const cursorScreenBottom = cursorScreenTop + cursorH + scrollPadding;
      if (cursorScreenBottom > sp.innerHeight) {
        smoothScrollTo(sp, sp.scrollY + cursorScreenBottom - sp.innerHeight, SCROLL_DURATION);
      } else if (cursorScreenTop < 0) {
        smoothScrollTo(sp, sp.scrollY + cursorScreenTop - scrollPadding, SCROLL_DURATION);
      }
    } else if (typeof sp.getBoundingClientRect === "function") {
      const spRect = sp.getBoundingClientRect();
      const cursorInSp = containerRect.top - spRect.top + sp.scrollTop + cursorVisualY;
      const visTop = sp.scrollTop;
      const visBottom = sp.scrollTop + sp.clientHeight;
      if (cursorInSp + cursorH + scrollPadding > visBottom) {
        smoothScrollTo(sp, cursorInSp + cursorH + scrollPadding - sp.clientHeight, SCROLL_DURATION);
      } else if (cursorInSp < visTop + scrollPadding) {
        smoothScrollTo(sp, Math.max(0, cursorInSp - scrollPadding), SCROLL_DURATION);
      }
    }
  }

  // ── DOM sync ───────────────────────────────────────────────────────────

  function syncDom() {
    if (!state || !layoutTree) return;

    const tree = layoutTree;

    // Derive the page-SLOT geometry WITHOUT positioning any page. Virtual mode:
    // read `plan.entries` (count + per-slot blockSize) — no `materializeAll`.
    // Positioned mode (unsupported-feature fallback): extract the already-
    // positioned `PageBox` children. Non-paginated: zero slots → single canvas.
    const newSlotGeoms: PageSlotGeom[] = [];
    const newPositionedPages: LayoutBox[] = [];
    let newVirtualTree: VirtualLayoutTree | null = null;

    if (pageHeight) {
      if (tree.type === "virtual-root") {
        newVirtualTree = tree;
        for (const entry of tree.plan.entries) {
          newSlotGeoms.push({ width: tree.plan.pageInlineSize, height: entry.blockSize });
        }
      } else if (tree.type === "block") {
        for (const c of tree.children) {
          // "page"-type children indicate the paginated positioned tree.
          // `LayoutBox` is a discriminated union including `PageBox`, so the
          // `type` check narrows `c` to `PageBox` — no cast needed.
          if (c.type === "page") {
            newPositionedPages.push(c);
            newSlotGeoms.push({ width: c.width, height: c.height });
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
      // (non-paginated) tree directly — never a virtual tree here, so this is a
      // no-op identity, not a materialize.
      const positioned = getPositionedTree();
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

    // Position textarea on the correct page
    const textareaTop =
      isPaginated && pageHeight
        ? cursorPos.pageIndex * (pageHeight + pageGap) + cursorPos.y
        : cursorPos.y;
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
      slot.style.marginBottom = i < targetCount - 1 ? `${pageGap}px` : "0";
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
      { rootMargin: "200px" },
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

      // Click outside any slot — find the page by visual Y. With a virtual
      // tree the plan maps document-y → page authoritatively
      // (`pageIndexAtBlockOffset`); the slots are uniform `pageHeight` so the
      // document-y for a given visual-y is `idx*(pageHeight+pageGap)+local` and
      // the inverse is the floor arithmetic below. Both agree for uniform
      // pages; we keep the cheap floor and clamp to the page count.
      const rect = container.getBoundingClientRect();
      const visualY = e.clientY - rect.top;
      const slotHeight = pageHeight + pageGap;
      let idx = Math.max(0, Math.min(total - 1, Math.floor(visualY / slotHeight)));
      if (virtualTree !== null) {
        // Authoritative pixel-y → page via the plan (document-y == visual-y for
        // uniform page heights with the same gap the plan uses).
        idx = Math.max(0, Math.min(total - 1, virtualTree.plan.pageIndexAtBlockOffset(visualY)));
      }
      const pageLocalY = visualY - idx * slotHeight;
      return { x: e.clientX - rect.left, y: Math.max(0, Math.min(pageHeight, pageLocalY)), pageIndex: idx };
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

    // Mouse hit-test stays on the lazy `materializeAll()` bridge (Phase 4).
    // Resolving the positioned tree here materializes all pages — acceptable on
    // a (rare) mouse event, and lazy so the typing/Enter hot path never hits it.
    const positioned = getPositionedTree();
    if (!positioned) return;
    const pos = resolvePositionFromPixel(
      state.state,
      positioned,
      measurer,
      coords.x,
      coords.y,
      coords.pageIndex,
    );
    if (!pos) {
      dispatch({ type: "MOVE_DOCUMENT_BOUNDARY", boundary: "end" });
      return;
    }

    // HL.3: Cmd/Ctrl+Click on a hyperlink opens the URL in a new
    // tab instead of placing the cursor. Plain click still positions
    // the cursor — needed so users can edit link text.
    if (e.metaKey || e.ctrlKey) {
      const url = linkUrlAtPosition(state.state, pos);
      if (url !== null) {
        // Allowlist safe schemes (per hyperlinks spec risk table:
        // reject javascript: / data: URLs).
        if (/^(https?:|mailto:|tel:)/i.test(url)) {
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
        });
      }
      return;
    }

    // Double-click: select word
    if (e.detail === 2) {
      const wordSel = selectWord(state.state, pos);
      dispatch({ type: "SET_SELECTION", selection: wordSel });
      return;
    }

    // Shift-click: extend selection from current anchor
    if (e.shiftKey) {
      dispatch({
        type: "SET_SELECTION",
        selection: createSpan(state.selection.anchor, pos),
      });
      return;
    }

    // Single click: position cursor + start drag
    isDragging = true;
    dragAnchor = pos;
    dispatch({
      type: "SET_SELECTION",
      selection: createSpan(pos, pos),
    });
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging || !dragAnchor || !state || !layoutTree) return;

    const coords = resolveMouseToLayout(e);
    if (!coords) return;

    // Drag hit-test on the lazy bridge (see handleMouseDown).
    const positioned = getPositionedTree();
    if (!positioned) return;
    const pos = resolvePositionFromPixel(
      state.state,
      positioned,
      measurer,
      coords.x,
      coords.y,
      coords.pageIndex,
    );
    if (pos) {
      dispatch({
        type: "SET_SELECTION",
        selection: createSpan(dragAnchor, pos),
      });
    }
  }

  function handleMouseUp() {
    isDragging = false;
  }

  // ── Keyboard / input handling ──────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent) {
    if (isComposing || e.isComposing) return;
    const action = mapKeyEvent(e);
    if (action) {
      e.preventDefault();
      dispatch(action);
    }
  }

  function handleInput() {
    if (isComposing) return;
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
    e.preventDefault();
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

    // Phase 3 Tasks 2/3: do NOT materialize all pages here. `layoutTree` is the
    // raw (possibly virtual) tree; the `materializeAll()` bridge is now LAZY —
    // `getPositionedTree()` resolves it only when a still-on-bridge consumer
    // (non-collapsed `computeSelectionRects`; mouse hit-test) actually runs.
    // Reset the per-update memo so a fresh tree isn't served a stale bridge.
    layoutTree = state.layoutTree;
    positionedBridge = null;

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

    // Selection rects: SKIPPED for a collapsed selection (the typing/Enter hot
    // path) — so no `computeSelectionRects` and no bridge materialization runs.
    // For a non-collapsed selection it stays on the lazy bridge (Phase 4);
    // `getPositionedTree()` materializes all pages only then.
    const tSel = markStart("ctrl.selectionRects");
    if (isCollapsed(state.selection)) {
      selectionRects = [];
    } else {
      const positioned = getPositionedTree();
      selectionRects = positioned
        ? computeSelectionRects(state.state, state.selection, positioned, measurer)
        : [];
    }
    markEnd("ctrl.selectionRects", tSel);

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

  function destroy() {
    destroyed = true;
    layoutTree = null;
    positionedBridge = null;
    virtualTree = null;

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

  return { update, focus, destroy };
}

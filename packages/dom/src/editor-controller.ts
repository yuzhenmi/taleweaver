import {
  createCursor,
  createSelection,
  createPosition,
  isCollapsed,
  extractText,
  selectWord,
  getNodeByPath,
  getTextContentLength,
  resolvePixelPosition,
  resolvePositionFromPixel,
  computeSelectionRects,
  findFirstTextDescendant,
  findLastTextDescendant,
  type LayoutBox,
  type Position,
  type TextMeasurer,
  type EditorAction,
  type EditorState,
  type SelectionRect,
} from "@taleweaver/core";
import { mapKeyEvent } from "./key-handler";
import { FONT_CONFIG } from "./font-config";
import { paintCanvas, paintPage, type CursorState } from "./canvas-renderer";
import { ImageCache } from "./image-cache";

const DEFAULT_PAGE_GAP = 24;
const SCROLL_DURATION = 250;

export interface EditorControllerOptions {
  measurer: TextMeasurer;
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

  // Computed on update
  let cursorPos = { x: 0, y: 0, height: 16, lineY: 0, lineHeight: 24, pageIndex: 0 };
  let selectionRects: SelectionRect[] = [];
  let pages: LayoutBox[] = [];

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
    if (!singleCtx) singleCtx = singleCanvas.getContext("2d");
    const ctx = singleCtx;
    if (!ctx) return;

    const tree = state.layoutTree;
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
    );
  }

  function paintPages() {
    const dpr = typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1;
    const cs = getCursorState();

    for (const [idx, canvas] of activeCanvases) {
      const page = pages[idx];
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

      paintPage(ctx, page, pageSelRects, pageCursor, cs, imageCache);
    }
  }

  function paint() {
    if (destroyed) return;
    if (pages.length > 0) {
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
      pages.length > 0 && pageHeight
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
    if (!state) return;

    const tree = state.layoutTree;
    const newPages: LayoutBox[] = [];
    if (pageHeight) {
      for (const c of tree.children) {
        if (c.type === "page") newPages.push(c);
      }
    }
    const isPaginated = newPages.length > 0;
    pages = newPages;

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

      // Ensure single canvas + spacer
      if (!spacerDiv) {
        spacerDiv = document.createElement("div");
        spacerDiv.style.pointerEvents = "none";
        container.insertBefore(spacerDiv, textarea);
      }
      spacerDiv.style.height = `${tree.height}px`;

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
    const currentCount = pageSlots.length;
    const targetCount = pages.length;

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

    // Update existing slot attributes, dimensions + margins
    for (let i = 0; i < targetCount; i++) {
      const slot = pageSlots[i];
      const page = pages[i];
      slot.dataset.pageIndex = String(i);
      slot.style.width = `${page.width}px`;
      slot.style.height = `${page.height}px`;
      slot.style.marginBottom = i < targetCount - 1 ? `${pageGap}px` : "0";
    }

    // Setup IntersectionObserver
    setupIntersectionObserver();
  }

  function acquireCanvas(idx: number, slot: HTMLDivElement) {
    if (activeCanvases.has(idx)) return;
    const canvas = canvasPool.pop() ?? document.createElement("canvas");
    canvas.dataset.pageIndex = String(idx);
    canvas.style.display = "block";
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
    if (pages.length > 0 && pageHeight) {
      const target = e.target as HTMLElement;

      // Check if clicked on a canvas inside a slot
      if (target instanceof HTMLCanvasElement && target.dataset.pageIndex != null) {
        const idx = Number(target.dataset.pageIndex);
        const page = pages[idx];
        if (page) {
          const rect = target.getBoundingClientRect();
          return { x: e.clientX - rect.left, y: e.clientY - rect.top, pageIndex: idx };
        }
      }

      // Check if clicked on a slot div directly
      if (target instanceof HTMLDivElement && target.dataset.pageIndex != null) {
        const idx = Number(target.dataset.pageIndex);
        const page = pages[idx];
        if (page) {
          const rect = target.getBoundingClientRect();
          return { x: e.clientX - rect.left, y: e.clientY - rect.top, pageIndex: idx };
        }
      }

      // Click outside any slot — find closest page by visual Y
      const rect = container.getBoundingClientRect();
      const visualY = e.clientY - rect.top;
      const slotHeight = pageHeight + pageGap;
      const idx = Math.max(0, Math.min(pages.length - 1, Math.floor(visualY / slotHeight)));
      const pageLocalY = visualY - idx * slotHeight;
      return { x: e.clientX - rect.left, y: Math.max(0, Math.min(pageHeight, pageLocalY)), pageIndex: idx };
    }
    const rect = container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, pageIndex: 0 };
  }

  function handleMouseDown(e: MouseEvent) {
    if (destroyed || !state) return;
    e.preventDefault();
    textarea.focus();

    const coords = resolveMouseToLayout(e);
    if (!coords) return;

    const pos = resolvePositionFromPixel(
      state.state,
      state.layoutTree,
      measurer,
      coords.x,
      coords.y,
      coords.pageIndex,
    );
    if (!pos) {
      dispatch({ type: "MOVE_DOCUMENT_BOUNDARY", boundary: "end" });
      return;
    }

    // Triple-click: select paragraph
    if (e.detail >= 3) {
      const blockPath = pos.path.slice(0, 1);
      const block = getNodeByPath(state.state, blockPath);
      if (block) {
        const first = findFirstTextDescendant(block, blockPath);
        const last = findLastTextDescendant(block, blockPath);
        if (first && last) {
          const lastNode = getNodeByPath(state.state, last.path);
          const endOffset = lastNode ? getTextContentLength(lastNode) : 0;
          dispatch({
            type: "SET_SELECTION",
            selection: createSelection(
              createPosition(first.path, 0),
              createPosition(last.path, endOffset),
            ),
          });
        }
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
        selection: createSelection(
          state.selection.anchor,
          createPosition(pos.path, pos.offset),
        ),
      });
      return;
    }

    // Single click: position cursor + start drag
    isDragging = true;
    dragAnchor = pos;
    dispatch({
      type: "SET_SELECTION",
      selection: createCursor(pos.path, pos.offset),
    });
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging || !dragAnchor || !state) return;

    const coords = resolveMouseToLayout(e);
    if (!coords) return;

    const pos = resolvePositionFromPixel(
      state.state,
      state.layoutTree,
      measurer,
      coords.x,
      coords.y,
      coords.pageIndex,
    );
    if (pos) {
      dispatch({
        type: "SET_SELECTION",
        selection: createSelection(
          dragAnchor,
          createPosition(pos.path, pos.offset),
        ),
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
    if (!state || isCollapsed(state.selection)) return;
    e.preventDefault();
    const text = extractText(state.state, state.selection);
    e.clipboardData?.setData("text/plain", text);
  }

  function handleCut(e: ClipboardEvent) {
    if (!state || isCollapsed(state.selection)) return;
    e.preventDefault();
    const text = extractText(state.state, state.selection);
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
    state = editorState;

    // Compute cursor position and selection rects
    cursorPos = resolvePixelPosition(
      state.state,
      state.selection.focus,
      state.layoutTree,
      measurer,
    );
    selectionRects = isCollapsed(state.selection)
      ? []
      : computeSelectionRects(
          state.state,
          state.selection,
          state.layoutTree,
          measurer,
          state.containerWidth,
        );

    syncDom();
    startBlink();
    paint();
    scrollCursorIntoView();
  }

  function destroy() {
    destroyed = true;

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

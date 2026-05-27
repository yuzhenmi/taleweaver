import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createEditorController,
  type EditorControllerOptions,
} from "./editor-controller";
import * as canvasRenderer from "./canvas-renderer";
import * as keyHandler from "./key-handler";
import * as core from "@taleweaver/core";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("./canvas-renderer", () => ({
  paintCanvas: vi.fn(),
  paintPage: vi.fn(),
}));

vi.mock("./key-handler", () => ({
  mapKeyEvent: vi.fn(),
}));

const MOCK_PIXEL_POSITION: core.PixelPosition = {
  x: 10,
  y: 20,
  height: 16,
  lineY: 18,
  lineHeight: 24,
  lineMarginTop: 0,
  lineMarginBottom: 0,
  pageIndex: 0,
};

vi.mock("@taleweaver/core", async () => {
  const actual = await vi.importActual<typeof core>("@taleweaver/core");
  return {
    ...actual,
    resolvePixelPosition: vi.fn(() => MOCK_PIXEL_POSITION),
    computeSelectionRects: vi.fn(() => []),
    resolvePositionFromPixel: vi.fn(() =>
      actual.createPosition("mock-block" as core.BlockId, 0),
    ),
    selectWord: vi.fn(() =>
      actual.createSpan(
        actual.createPosition("mock-block" as core.BlockId, 0),
        actual.createPosition("mock-block" as core.BlockId, 5),
      ),
    ),
    extractText: vi.fn(() => "hello"),
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

const canvasContextMap = new WeakMap<
  HTMLCanvasElement,
  CanvasRenderingContext2D
>();

function createMockCanvasCtx(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    font: "",
    fillStyle: "" as string | CanvasGradient | CanvasPattern,
    textBaseline: "" as CanvasTextBaseline,
    globalAlpha: 1,
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D;
}

let originalGetContext: PropertyDescriptor | undefined;

// Real EditorState produced by the public-API factory. The empty document
// it creates is a valid layout tree of total height defined by the
// containerWidth/registry/measurer wiring; tests only assert shape, not
// specific dimensions, so we don't need to override layoutTree for the
// non-paginated tests.
const fakeEditorBase: core.EditorState = core.createInitialEditorState({
  measurer: core.createMockMeasurer(8, 16),
  componentRegistry: core.createDefaultComponentRegistry(),
  attrRegistry: core.createDefaultAttrRegistry(),
  containerWidth: 600,
});

function makeFakeEditorState(
  overrides?: Partial<core.EditorState>,
): core.EditorState {
  return {
    ...fakeEditorBase,
    ...overrides,
  };
}

/**
 * Build a paginated POSITIONED layout tree with `pageCount` pages, each
 * `pageHeight` tall. Each page's `blockOffset` is the running sum
 * `i * (pageHeight + pageGap)` — matching the real paginator
 * (`packages/core/src/layout/paginate.ts`), which places positioned pages with
 * the gap INCLUDED. This keeps the fixture consistent with the controller's
 * positioned-path invariant: the DOM stacks slots by height + marginBottom (the
 * gap), so each slot's `top` (read from `blockOffset` by caret/scroll/hit-test)
 * MUST equal the running sum. `pageGap` defaults to the controller's
 * `DEFAULT_PAGE_GAP` (24), which the positioned fallback uses for stacking.
 */
function buildPaginatedLayoutTree(
  pageCount: number,
  width: number,
  pageHeight: number,
  pageGap = 24,
): core.LayoutBox {
  const cs = core.INITIAL_COMPUTED_STYLE;
  const us = core.computeUsedStyle(cs, width, "indefinite");
  const pages: core.LayoutBox[] = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push(
      core.createPageBox(
        `page-${i}`,
        0,
        i * (pageHeight + pageGap),
        width,
        pageHeight,
        cs.writingMode,
        cs.direction,
        cs,
        us,
        [],
        i,
        width,
        null,
        null,
        0,
        0,
      ),
    );
  }
  return core.createBlockBox(
    "doc",
    0,
    0,
    width,
    pageCount * pageHeight + Math.max(0, pageCount - 1) * pageGap,
    cs.writingMode,
    cs.direction,
    cs,
    us,
    pages,
    width,
  );
}

function makePaginatedEditorState(): core.EditorState {
  return makeFakeEditorState({
    layoutTree: buildPaginatedLayoutTree(2, 600, 100),
  });
}

/**
 * A spy-instrumented fake `VirtualLayoutTree`: a real-enough `PagePlan` of
 * `pageCount` uniform pages plus `getPage` / `materializeAll` vitest spies. Used
 * to assert the controller hot path (collapsed selection) NEVER calls
 * `materializeAll` and that `getPage` is invoked only for visible slots.
 */
function makeSpyVirtualTree(pageCount: number, width: number, pageHeight: number, pageGap: number) {
  const cs = core.INITIAL_COMPUTED_STYLE;
  const us = core.computeUsedStyle(cs, width, "indefinite");
  const entries = Array.from({ length: pageCount }, (_, i) => ({
    pageIndex: i,
    blockOffset: i * (pageHeight + pageGap),
    blockSize: pageHeight,
    // Uniform per-entry geometry (C.2b-2): every page resolves to the doc-wide
    // config, so this models the "uniform == today" no-regression case.
    pageConfig: {
      pageInlineSize: width,
      pageBlockSize: pageHeight,
      pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
      pageGap,
    },
    children: [],
    startIndex: i,
    resumeInto: null,
    resumeOut: null,
    listCounterAtStart: 0,
  }));
  const totalBlockSize = pageCount * pageHeight + Math.max(0, pageCount - 1) * pageGap;
  const plan = {
    entries,
    totalBlockSize,
    pageInlineSize: width,
    pageIndexAtBlockOffset: (y: number) => {
      const idx = Math.floor(y / (pageHeight + pageGap));
      return Math.max(0, Math.min(pageCount - 1, idx));
    },
    pageIndexOfBlock: () => -1,
    pageSpanOfBlock: () => null,
  } as unknown as core.VirtualLayoutTree["plan"];

  const makePage = (i: number) =>
    core.createPageBox(`page-${i}`, 0, entries[i].blockOffset, width, pageHeight,
      cs.writingMode, cs.direction, cs, us, [], i, width, null, null, 0, 0);

  const getPage = vi.fn((i: number) => makePage(i));
  const materializeAll = vi.fn(() => {
    const pages = entries.map((_, i) => makePage(i));
    return core.createBlockBox("doc", 0, 0, width, totalBlockSize,
      cs.writingMode, cs.direction, cs, us, pages, width);
  });

  const tree = {
    type: "virtual-root" as const,
    plan,
    inlineSize: width,
    blockSize: totalBlockSize,
    getPage,
    getPages: vi.fn((from: number, to: number) => {
      const out = [];
      for (let i = from; i <= to; i++) out.push(makePage(i));
      return out;
    }),
    materializeAll,
  } as unknown as core.VirtualLayoutTree;

  return { tree, getPage, materializeAll };
}

/**
 * A spy `VirtualLayoutTree` with PER-ENTRY page geometry (C.2b-2). Each entry
 * carries its own `pageConfig` (inline-size, block-size, margins, gap), a
 * RUNNING-SUM `blockOffset`, and a `blockSize` equal to its config's
 * `pageBlockSize`. `pageHeights`/`pageGaps`/`pageWidths` are per-page arrays so
 * a section boundary can be modeled (e.g. page 1 onward taller/wider). Pages are
 * NOT uniform — `pageIndexAtBlockOffset` binary-searches the running-sum offsets.
 */
function makeSpyVirtualTreeWithGeom(
  pageHeights: number[],
  pageWidths: number[],
  pageGaps: number[],
) {
  const pageCount = pageHeights.length;
  const cs = core.INITIAL_COMPUTED_STYLE;

  // Running-sum offsets: blockOffset[i] = sum of (height[j] + gap[j]) for j<i.
  const offsets: number[] = [];
  let running = 0;
  for (let i = 0; i < pageCount; i++) {
    offsets.push(running);
    running += pageHeights[i] + (i < pageCount - 1 ? pageGaps[i] : 0);
  }
  const totalBlockSize = running;

  const entries = Array.from({ length: pageCount }, (_, i) => ({
    pageIndex: i,
    blockOffset: offsets[i],
    blockSize: pageHeights[i],
    pageConfig: {
      pageInlineSize: pageWidths[i],
      pageBlockSize: pageHeights[i],
      pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
      pageGap: pageGaps[i],
    },
    children: [],
    startIndex: i,
    resumeInto: null,
    resumeOut: null,
    listCounterAtStart: 0,
  }));

  const pageIndexAtBlockOffset = (y: number): number => {
    if (y <= 0) return 0;
    if (y >= totalBlockSize) return pageCount - 1;
    for (let i = pageCount - 1; i >= 0; i--) {
      if (y >= offsets[i]) return i;
    }
    return 0;
  };

  const plan = {
    entries,
    totalBlockSize,
    pageInlineSize: pageWidths[0],
    pageContentBlockSize: pageHeights[0],
    pageIndexAtBlockOffset,
    pageIndexOfBlock: () => -1,
    pageSpanOfBlock: () => null,
  } as unknown as core.VirtualLayoutTree["plan"];

  const makePage = (i: number) => {
    const us = core.computeUsedStyle(cs, pageWidths[i], "indefinite");
    return core.createPageBox(
      `page-${i}`, 0, offsets[i], pageWidths[i], pageHeights[i],
      cs.writingMode, cs.direction, cs, us, [], i, pageWidths[i],
      null, null,
      0, 0,
    );
  };

  const getPage = vi.fn((i: number) => makePage(i));
  const materializeAll = vi.fn(() => {
    const pages = entries.map((_, i) => makePage(i));
    const us = core.computeUsedStyle(cs, pageWidths[0], "indefinite");
    return core.createBlockBox("doc", 0, 0, pageWidths[0], totalBlockSize,
      cs.writingMode, cs.direction, cs, us, pages, pageWidths[0]);
  });

  const tree = {
    type: "virtual-root" as const,
    plan,
    inlineSize: pageWidths[0],
    blockSize: totalBlockSize,
    getPage,
    getPages: vi.fn((from: number, to: number) => {
      const out = [];
      for (let i = from; i <= to; i++) out.push(makePage(i));
      return out;
    }),
    materializeAll,
  } as unknown as core.VirtualLayoutTree;

  return { tree, getPage, materializeAll, offsets, totalBlockSize };
}

const measurer: core.TextMeasurer = core.createMockMeasurer(8, 16);

function makeOptions(
  overrides?: Partial<EditorControllerOptions>,
): EditorControllerOptions {
  return {
    measurer,
    dispatch: vi.fn(),
    ...overrides,
  };
}

// ── Setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();

  originalGetContext = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    "getContext",
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: function (this: HTMLCanvasElement) {
      let ctx = canvasContextMap.get(this);
      if (!ctx) {
        ctx = createMockCanvasCtx();
        canvasContextMap.set(this, ctx);
      }
      return ctx;
    },
    writable: true,
    configurable: true,
  });

  // Mock IntersectionObserver
  globalThis.IntersectionObserver = vi.fn().mockImplementation(
    (callback: IntersectionObserverCallback) => {
      return {
        observe: vi.fn((el: Element) => {
          callback(
            [
              {
                target: el,
                isIntersecting: true,
                intersectionRatio: 1,
              } as unknown as IntersectionObserverEntry,
            ],
            {} as IntersectionObserver,
          );
        }),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      };
    },
  ) as unknown as typeof IntersectionObserver;

  vi.mocked(canvasRenderer.paintCanvas).mockClear();
  vi.mocked(canvasRenderer.paintPage).mockClear();
  vi.mocked(keyHandler.mapKeyEvent).mockClear();
  vi.mocked(core.resolvePixelPosition).mockClear();
  vi.mocked(core.computeSelectionRects).mockClear();
  vi.mocked(core.resolvePositionFromPixel).mockClear();
  vi.mocked(core.selectWord).mockClear();
  vi.mocked(core.extractText).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  if (originalGetContext) {
    Object.defineProperty(
      HTMLCanvasElement.prototype,
      "getContext",
      originalGetContext,
    );
  }
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("createEditorController", () => {
  describe("initialization", () => {
    it("creates canvas and textarea inside container", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      expect(container.querySelector("canvas")).not.toBeNull();
      expect(container.querySelector("textarea")).not.toBeNull();

      ctrl.destroy();
    });

    it("sets container styles", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      expect(container.style.position).toBe("relative");
      expect(container.style.cursor).toBe("text");
      expect(container.style.userSelect).toBe("none");

      ctrl.destroy();
    });

    it("textarea is hidden (opacity 0) and absolutely positioned", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      const textarea = container.querySelector("textarea")!;
      expect(textarea.style.opacity).toBe("0");
      expect(textarea.style.position).toBe("absolute");

      ctrl.destroy();
    });

    it("autofocuses the textarea", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      const textarea = container.querySelector("textarea")!;
      expect(document.activeElement).toBe(textarea);

      ctrl.destroy();
      document.body.removeChild(container);
    });
  });

  describe("painting (non-paginated)", () => {
    it("calls paintCanvas on update()", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      expect(canvasRenderer.paintCanvas).toHaveBeenCalled();

      ctrl.destroy();
    });

    it("creates spacer div for scroll height", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      const spacer = container.querySelector("div");
      expect(spacer).not.toBeNull();
      expect(spacer!.style.pointerEvents).toBe("none");

      ctrl.destroy();
    });

    it("uses setTransform for DPR scaling", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      const canvas = container.querySelector("canvas")!;
      const ctx = canvasContextMap.get(canvas)!;
      expect(ctx.setTransform).toHaveBeenCalled();

      ctrl.destroy();
    });
  });

  describe("painting (paginated)", () => {
    it("creates per-page slot divs with data-page-index", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100 }),
      );
      ctrl.update(makePaginatedEditorState());

      const slots = container.querySelectorAll("div[data-page-index]");
      expect(slots.length).toBe(2);
      expect(slots[0].getAttribute("data-page-index")).toBe("0");
      expect(slots[1].getAttribute("data-page-index")).toBe("1");

      ctrl.destroy();
    });

    it("attaches canvases inside visible slots", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100 }),
      );
      ctrl.update(makePaginatedEditorState());

      // Mock IntersectionObserver marks all observed elements as visible,
      // so both slots should have canvases
      const canvases = container.querySelectorAll("canvas[data-page-index]");
      expect(canvases.length).toBe(2);

      ctrl.destroy();
    });

    it("calls paintPage for visible pages", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100 }),
      );
      ctrl.update(makePaginatedEditorState());

      expect(canvasRenderer.paintPage).toHaveBeenCalled();

      ctrl.destroy();
    });

    it("page slots have box-shadow styling", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100 }),
      );
      ctrl.update(makePaginatedEditorState());

      const slot = container.querySelector(
        "div[data-page-index]",
      ) as HTMLDivElement;
      expect(slot.style.boxShadow).toBeTruthy();

      ctrl.destroy();
    });

    it("page slots have fixed dimensions matching page size", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100 }),
      );
      ctrl.update(makePaginatedEditorState());

      const slot = container.querySelector(
        "div[data-page-index]",
      ) as HTMLDivElement;
      expect(slot.style.width).toBe("600px");
      expect(slot.style.height).toBe("100px");

      ctrl.destroy();
    });

    it("adds/removes page slots when page count changes", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100 }),
      );

      // Start with 2 pages
      ctrl.update(makePaginatedEditorState());
      expect(
        container.querySelectorAll("div[data-page-index]").length,
      ).toBe(2);

      // Go to 1 page
      ctrl.update(
        makeFakeEditorState({
          layoutTree: buildPaginatedLayoutTree(1, 600, 100),
        }),
      );
      expect(
        container.querySelectorAll("div[data-page-index]").length,
      ).toBe(1);

      // Back to 2 pages
      ctrl.update(makePaginatedEditorState());
      expect(
        container.querySelectorAll("div[data-page-index]").length,
      ).toBe(2);

      ctrl.destroy();
    });

    it("recycles canvases when pages scroll out of view", () => {
      // Custom IntersectionObserver that lets us control visibility
      let ioCallback: IntersectionObserverCallback;
      const observed: Element[] = [];
      globalThis.IntersectionObserver = vi.fn().mockImplementation(
        (callback: IntersectionObserverCallback) => {
          ioCallback = callback;
          return {
            observe: vi.fn((el: Element) => {
              observed.push(el);
              // Initially mark all as visible
              callback(
                [{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry],
                {} as IntersectionObserver,
              );
            }),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
          };
        },
      ) as unknown as typeof IntersectionObserver;

      const container = document.createElement("div");
      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100 }),
      );
      ctrl.update(makePaginatedEditorState());

      // Both slots have canvases
      expect(container.querySelectorAll("canvas[data-page-index]").length).toBe(2);

      // Simulate page 0 scrolling out of view
      const slot0 = container.querySelector("div[data-page-index='0']")!;
      ioCallback!(
        [{ target: slot0, isIntersecting: false } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );

      // Page 0's canvas should be removed from its slot
      expect(slot0.querySelector("canvas")).toBeNull();
      // Only page 1 has a canvas now
      expect(container.querySelectorAll("canvas[data-page-index]").length).toBe(1);

      // Simulate page 0 scrolling back into view
      ioCallback!(
        [{ target: slot0, isIntersecting: true } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );

      // Page 0 should have a canvas again (recycled from pool)
      expect(slot0.querySelector("canvas")).not.toBeNull();
      expect(container.querySelectorAll("canvas[data-page-index]").length).toBe(2);

      ctrl.destroy();
    });

    it("falls back to single canvas when no pages in paginated mode", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100 }),
      );
      // layoutTree has no page children even though pageHeight is set
      ctrl.update(makeFakeEditorState());

      const paginatedSlots = container.querySelectorAll(
        "div[data-page-index]",
      );
      expect(paginatedSlots.length).toBe(0);
      const singleCanvas = container.querySelector("canvas");
      expect(singleCanvas).not.toBeNull();

      ctrl.destroy();
    });
  });

  describe("painting (virtual tree) — lazy materialize", () => {
    it("sizes page slots from the plan WITHOUT materializeAll on a collapsed-selection update", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions({ pageHeight: 100, pageGap: 24 }));
      const { tree, materializeAll } = makeSpyVirtualTree(3, 600, 100, 24);

      ctrl.update(makeFakeEditorState({ layoutTree: tree }));

      // Slots created from the plan; never materialized the whole tree.
      const slots = container.querySelectorAll("div[data-page-index]");
      expect(slots.length).toBe(3);
      expect((slots[0] as HTMLDivElement).style.width).toBe("600px");
      expect((slots[0] as HTMLDivElement).style.height).toBe("100px");
      expect(materializeAll).not.toHaveBeenCalled();

      ctrl.destroy();
    });

    it("paints visible pages via getPage(idx), never materializeAll, on the collapsed hot path", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions({ pageHeight: 100, pageGap: 24 }));
      const { tree, getPage, materializeAll } = makeSpyVirtualTree(3, 600, 100, 24);

      // fakeEditorBase's selection is collapsed (fresh empty doc), so this is
      // the typing/Enter hot path: no computeSelectionRects, no bridge.
      ctrl.update(makeFakeEditorState({ layoutTree: tree }));

      // The mock IntersectionObserver marks all slots visible → getPage per page.
      expect(getPage).toHaveBeenCalled();
      expect(canvasRenderer.paintPage).toHaveBeenCalled();
      // THE WIN: the whole tree is never materialized on the collapsed path.
      expect(materializeAll).not.toHaveBeenCalled();

      ctrl.destroy();
    });

    it("scroll spacer / total height uses plan.totalBlockSize (no materialize)", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions({ pageHeight: 100, pageGap: 24 }));
      const { tree, materializeAll } = makeSpyVirtualTree(4, 600, 100, 24);

      ctrl.update(makeFakeEditorState({ layoutTree: tree }));
      // Paginated mode uses per-slot divs (no single spacer), but the key
      // guarantee is no materialize on the collapsed update.
      expect(materializeAll).not.toHaveBeenCalled();

      ctrl.destroy();
    });

    it("non-collapsed selection (non-spanning blocks) computes rects per-page, never materializeAll", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions({ pageHeight: 100, pageGap: 24 }));
      const { tree, getPage, materializeAll } = makeSpyVirtualTree(3, 600, 100, 24);

      // A non-collapsed selection. The spy tree's `pageSpanOfBlock` returns null
      // (non-spanning), so the per-page selection-rect path is taken — the
      // bridge `materializeAll()` is NOT used (it would be only for a boundary
      // block that straddles a page break).
      const anchor = core.createPosition("doc" as core.BlockId, 0);
      const focus = core.createPosition("doc" as core.BlockId, 1);
      ctrl.update(
        makeFakeEditorState({
          layoutTree: tree,
          selection: core.createSpan(anchor, focus),
        }),
      );

      expect(materializeAll).not.toHaveBeenCalled();
      expect(getPage).toHaveBeenCalled(); // per-page paint + rect computation

      ctrl.destroy();
    });

    it("hides the caret over a non-collapsed selection (paginated rects are empty)", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions({ pageHeight: 100, pageGap: 24 }));
      const { tree } = makeSpyVirtualTree(3, 600, 100, 24);

      const anchor = core.createPosition("doc" as core.BlockId, 0);
      const focus = core.createPosition("doc" as core.BlockId, 1);
      ctrl.update(
        makeFakeEditorState({ layoutTree: tree, selection: core.createSpan(anchor, focus) }),
      );

      // In paginated mode `selectionRects` is empty (rects are per-page), so the
      // caret-hide MUST come from the `hasSelectionHighlight` flag: every
      // paintPage call's cursorState (arg index 4) is "hidden".
      const calls = vi.mocked(canvasRenderer.paintPage).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(call[4]).toBe("hidden");

      ctrl.destroy();
    });

    it("spanning-block selection boundary falls back to materializeAll (rare)", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions({ pageHeight: 100, pageGap: 24 }));
      const { tree, materializeAll } = makeSpyVirtualTree(3, 600, 100, 24);
      // Force a boundary block to straddle a page break.
      (tree.plan as { pageSpanOfBlock: (id: core.BlockId) => { first: number; last: number } | null })
        .pageSpanOfBlock = () => ({ first: 0, last: 1 });

      const anchor = core.createPosition("doc" as core.BlockId, 0);
      const focus = core.createPosition("doc" as core.BlockId, 1);
      ctrl.update(
        makeFakeEditorState({ layoutTree: tree, selection: core.createSpan(anchor, focus) }),
      );

      // A spanning boundary block can't be resolved per-page → the bridge fires.
      expect(materializeAll).toHaveBeenCalled();

      ctrl.destroy();
    });

    it("paginated mousedown hit-test resolves via getPage(clicked), never materializeAll", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch, pageHeight: 100, pageGap: 24 }),
      );
      const { tree, getPage, materializeAll } = makeSpyVirtualTree(3, 600, 100, 24);
      ctrl.update(makeFakeEditorState({ layoutTree: tree }));

      // Paint already called getPage for visible pages; isolate the mousedown.
      getPage.mockClear();
      materializeAll.mockClear();

      container.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: 0, right: 600, bottom: 372, width: 600, height: 372, x: 0, y: 0, toJSON: () => {},
      }));
      // clientY 150 → page 1 (slotHeight = pageHeight 100 + gap 24 = 124).
      container.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 10, clientY: 150, detail: 1, bubbles: true }),
      );

      // The hit-test materializes ONLY the clicked page — never the whole tree.
      expect(materializeAll).not.toHaveBeenCalled();
      expect(getPage).toHaveBeenCalledWith(1);

      ctrl.destroy();
      document.body.removeChild(container);
    });
  });

  describe("per-section page geometry (C.2b-2)", () => {
    // A doc with a TALL/WIDE section starting at page 1: page 0 is the doc-wide
    // default (100×600, gap 24); pages 1-2 belong to a section overriding to
    // 200 tall × 800 wide, gap 40.
    function makeTallSectionTree() {
      return makeSpyVirtualTreeWithGeom(
        [100, 200, 200],
        [600, 800, 800],
        [24, 40, 40],
      );
    }

    it("slot heights/widths/gaps come from each entry's pageConfig", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100, pageGap: 24 }),
      );
      const { tree } = makeTallSectionTree();
      ctrl.update(makeFakeEditorState({ layoutTree: tree }));

      const slots = container.querySelectorAll("div[data-page-index]");
      expect(slots.length).toBe(3);

      // Page 0: doc-wide default.
      expect((slots[0] as HTMLDivElement).style.width).toBe("600px");
      expect((slots[0] as HTMLDivElement).style.height).toBe("100px");
      // Per-entry gap AFTER page 0 (page 0's own gap = 24).
      expect((slots[0] as HTMLDivElement).style.marginBottom).toBe("24px");

      // Page 1: section override — taller + wider.
      expect((slots[1] as HTMLDivElement).style.width).toBe("800px");
      expect((slots[1] as HTMLDivElement).style.height).toBe("200px");
      // Per-entry gap AFTER page 1 (section gap = 40).
      expect((slots[1] as HTMLDivElement).style.marginBottom).toBe("40px");

      // Page 2: last slot — no trailing margin.
      expect((slots[2] as HTMLDivElement).style.width).toBe("800px");
      expect((slots[2] as HTMLDivElement).style.height).toBe("200px");
      expect((slots[2] as HTMLDivElement).style.marginBottom).toBe("0px");

      ctrl.destroy();
    });

    it("textarea/caret top uses the entry's running-sum blockOffset, not pageIndex*(H+gap)", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100, pageGap: 24 }),
      );
      const { tree, offsets } = makeTallSectionTree();

      // Cursor on page 2 (post-boundary). cursorPos.y = 20 (from MOCK).
      vi.mocked(core.resolvePixelPosition).mockReturnValue({
        x: 10, y: 20, height: 16, lineY: 18, lineHeight: 24,
        lineMarginTop: 0, lineMarginBottom: 0, pageIndex: 2,
      });

      ctrl.update(makeFakeEditorState({ layoutTree: tree }));

      const textarea = container.querySelector("textarea")!;
      // Running sum: offsets[2] = 100+24 + 200+40 = 364. + cursorPos.y(20) = 384.
      // A uniform pageIndex*(100+24)+20 would be 2*124+20 = 268 — WRONG.
      expect(offsets[2]).toBe(364);
      expect(textarea.style.top).toBe(`${offsets[2] + 20}px`);

      ctrl.destroy();
      vi.mocked(core.resolvePixelPosition).mockReturnValue(MOCK_PIXEL_POSITION);
    });

    it("mouse fallback (click outside any slot) maps across a geometry boundary to the right page, clamped to THAT page's height", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch, pageHeight: 100, pageGap: 24 }),
      );
      const { tree, getPage } = makeTallSectionTree();
      ctrl.update(makeFakeEditorState({ layoutTree: tree }));
      getPage.mockClear();
      vi.mocked(core.resolvePositionFromPixel).mockClear();

      // Container rect spans the whole doc; the event target is the container
      // itself (no data-page-index) → the "outside any slot" fallback runs.
      container.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: 0, right: 800, bottom: 564, width: 800, height: 564,
        x: 0, y: 0, toJSON: () => {},
      }));

      // visualY = 500 lands inside page 2 (offsets[2] = 364, page 2 spans
      // [364, 564)). A uniform floor(500/124) would give page 4 — out of range.
      container.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 10, clientY: 500, detail: 1, bubbles: true }),
      );

      // Hit-tested page 2 via getPage (never materializeAll).
      expect(getPage).toHaveBeenCalledWith(2);

      // resolvePositionFromPixel called with pageLocalY = 500 - 364 = 136,
      // clamped to page 2's own height (200) ⇒ 136 (not clamped to the
      // short default 100). Args: (state, tree, measurer, x, y, pageIndex).
      const call = vi.mocked(core.resolvePositionFromPixel).mock.calls.at(-1)!;
      expect(call[5]).toBe(2); // pageIndex
      expect(call[4]).toBe(136); // pageLocalY clamped to the tall page's height

      ctrl.destroy();
      document.body.removeChild(container);
      vi.mocked(core.resolvePositionFromPixel).mockReturnValue(
        core.createPosition("mock-block" as core.BlockId, 0),
      );
    });

    it("mouse fallback clamps a click below a page's content to THAT page's height (not the doc-wide default)", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch, pageHeight: 100, pageGap: 24 }),
      );
      const { tree } = makeTallSectionTree();
      ctrl.update(makeFakeEditorState({ layoutTree: tree }));
      vi.mocked(core.resolvePositionFromPixel).mockClear();

      container.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: 0, right: 800, bottom: 564, width: 800, height: 564,
        x: 0, y: 0, toJSON: () => {},
      }));

      // visualY = 555 — near the bottom of page 2 (spans [364, 564)).
      // pageLocalY = 555 - 364 = 191, which is < page 2's height (200), so it
      // stays 191. Critically NOT clamped to the short default (100).
      container.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 10, clientY: 555, detail: 1, bubbles: true }),
      );
      const call = vi.mocked(core.resolvePositionFromPixel).mock.calls.at(-1)!;
      expect(call[5]).toBe(2);
      expect(call[4]).toBe(191);

      ctrl.destroy();
      document.body.removeChild(container);
      vi.mocked(core.resolvePositionFromPixel).mockReturnValue(
        core.createPosition("mock-block" as core.BlockId, 0),
      );
    });
  });

  describe("cursor blink", () => {
    it("toggles cursor visibility every 500ms", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      vi.mocked(canvasRenderer.paintCanvas).mockClear();

      // After 500ms, cursor toggles — repaint called
      vi.advanceTimersByTime(500);
      expect(canvasRenderer.paintCanvas).toHaveBeenCalled();

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("resets blink on state change", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      // Advance 400ms (cursor still visible)
      vi.advanceTimersByTime(400);
      vi.mocked(canvasRenderer.paintCanvas).mockClear();

      // Update resets blink timer
      ctrl.update(makeFakeEditorState());
      expect(canvasRenderer.paintCanvas).toHaveBeenCalled();

      // After another 500ms from last update, blink should toggle
      vi.mocked(canvasRenderer.paintCanvas).mockClear();
      vi.advanceTimersByTime(500);
      expect(canvasRenderer.paintCanvas).toHaveBeenCalled();

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("hides cursor caret when selection is non-collapsed", () => {
      vi.mocked(core.computeSelectionRects).mockReturnValue([
        { x: 0, y: 0, width: 40, height: 16, pageIndex: 0 },
      ]);

      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      const focusBlockId = fakeEditorBase.selection.focus.blockId;
      ctrl.update(
        makeFakeEditorState({
          selection: core.createSpan(
            core.createPosition(focusBlockId, 0),
            core.createPosition(focusBlockId, 5),
          ),
        }),
      );

      const lastCall = vi.mocked(canvasRenderer.paintCanvas).mock.calls.at(-1)!;
      expect(lastCall[4]).toBe("hidden");

      ctrl.destroy();
      document.body.removeChild(container);
      vi.mocked(core.computeSelectionRects).mockReturnValue([]);
    });

    it("computes selection rects for all non-collapsed selections (no selectAllActive hack)", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());

      // Non-collapsed selection with virtual line break (like select-all in empty doc)
      const focusBlockId = fakeEditorBase.selection.focus.blockId;
      ctrl.update(
        makeFakeEditorState({
          selection: core.createSpan(
            core.createPosition(focusBlockId, 0),
            core.createPosition(focusBlockId, 1),
          ),
        }),
      );

      // computeSelectionRects should be called for non-collapsed selection
      expect(core.computeSelectionRects).toHaveBeenCalled();

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("cursor is always visible immediately after update", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      // Advance 500ms so cursor toggles to hidden
      vi.advanceTimersByTime(500);
      vi.mocked(canvasRenderer.paintCanvas).mockClear();

      // Update while cursor is in hidden phase of blink
      ctrl.update(makeFakeEditorState());

      // The paint from update() should show the cursor as "active", not "hidden"
      const lastCall = vi.mocked(canvasRenderer.paintCanvas).mock.calls.at(-1)!;
      expect(lastCall[4]).toBe("active");

      ctrl.destroy();
      document.body.removeChild(container);
    });
  });

  describe("focus/blur", () => {
    it("calls paintCanvas with inactive cursor on blur", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      const textarea = container.querySelector("textarea")!;
      vi.mocked(canvasRenderer.paintCanvas).mockClear();

      textarea.dispatchEvent(new Event("blur"));

      expect(canvasRenderer.paintCanvas).toHaveBeenCalled();
      // The cursorState arg should be "inactive"
      const lastCall = vi.mocked(canvasRenderer.paintCanvas).mock.calls.at(-1)!;
      expect(lastCall[4]).toBe("inactive");

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("resumes blink on focus", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      const textarea = container.querySelector("textarea")!;
      textarea.dispatchEvent(new Event("blur"));

      vi.mocked(canvasRenderer.paintCanvas).mockClear();
      textarea.dispatchEvent(new Event("focus"));

      // Should repaint with active cursor
      expect(canvasRenderer.paintCanvas).toHaveBeenCalled();
      const lastCall = vi.mocked(canvasRenderer.paintCanvas).mock.calls.at(-1)!;
      expect(lastCall[4]).toBe("active");

      // Blink resumes
      vi.mocked(canvasRenderer.paintCanvas).mockClear();
      vi.advanceTimersByTime(500);
      expect(canvasRenderer.paintCanvas).toHaveBeenCalled();

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("hides cursor on blur when selection is active", () => {
      vi.mocked(core.computeSelectionRects).mockReturnValue([
        { x: 0, y: 0, width: 40, height: 16, pageIndex: 0 },
      ]);

      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      // Non-collapsed selection
      const focusBlockId = fakeEditorBase.selection.focus.blockId;
      ctrl.update(
        makeFakeEditorState({
          selection: core.createSpan(
            core.createPosition(focusBlockId, 0),
            core.createPosition(focusBlockId, 3),
          ),
        }),
      );

      const textarea = container.querySelector("textarea")!;
      vi.mocked(canvasRenderer.paintCanvas).mockClear();
      textarea.dispatchEvent(new Event("blur"));

      expect(canvasRenderer.paintCanvas).toHaveBeenCalled();
      // Cursor should be hidden (not inactive) because there's a selection
      const lastCall = vi.mocked(canvasRenderer.paintCanvas).mock.calls.at(-1)!;
      expect(lastCall[4]).toBe("hidden");

      ctrl.destroy();
      document.body.removeChild(container);
      vi.mocked(core.computeSelectionRects).mockReturnValue([]);
    });

    it("does not blink when unfocused", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      const textarea = container.querySelector("textarea")!;
      textarea.dispatchEvent(new Event("blur"));

      vi.mocked(canvasRenderer.paintCanvas).mockClear();
      vi.advanceTimersByTime(500);

      // No blink repaint when unfocused
      expect(canvasRenderer.paintCanvas).not.toHaveBeenCalled();

      ctrl.destroy();
      document.body.removeChild(container);
    });
  });

  describe("keyboard", () => {
    it("dispatches actions via mapKeyEvent", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch }),
      );
      ctrl.update(makeFakeEditorState());

      vi.mocked(keyHandler.mapKeyEvent).mockReturnValue({
        type: "SPLIT_NODE",
      });

      const textarea = container.querySelector("textarea")!;
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );

      expect(keyHandler.mapKeyEvent).toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalledWith({ type: "SPLIT_NODE" });

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("dispatches INSERT_TEXT on input", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch }),
      );
      ctrl.update(makeFakeEditorState());

      const textarea = container.querySelector("textarea")!;
      textarea.value = "a";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      expect(dispatch).toHaveBeenCalledWith({ type: "INSERT_TEXT", text: "a" });
      expect(textarea.value).toBe("");

      ctrl.destroy();
      document.body.removeChild(container);
    });
  });

  describe("mouse", () => {
    it("dispatches SET_SELECTION on mousedown", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch }),
      );
      ctrl.update(makeFakeEditorState());

      container.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        right: 600,
        bottom: 100,
        width: 600,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      }));

      container.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 10,
          clientY: 20,
          detail: 1,
          bubbles: true,
        }),
      );

      expect(core.resolvePositionFromPixel).toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_SELECTION" }),
      );

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("dispatches word selection on double-click", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch }),
      );
      ctrl.update(makeFakeEditorState());

      container.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        right: 600,
        bottom: 100,
        width: 600,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      }));

      container.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 10,
          clientY: 20,
          detail: 2,
          bubbles: true,
        }),
      );

      expect(core.selectWord).toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_SELECTION" }),
      );

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("dispatches paragraph selection on triple-click", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch }),
      );

      // Use the real initial-document state — it has a single empty paragraph
      // block whose id is reachable via the base selection. The
      // resolvePositionFromPixel mock returns a "mock-block" id which does
      // NOT exist in state, so triple-click no-ops the dispatch. To make
      // the triple-click branch fire a dispatch we override the mock to
      // return the real paragraph's blockId.
      const realParagraphId = fakeEditorBase.selection.focus.blockId;
      vi.mocked(core.resolvePositionFromPixel).mockReturnValueOnce(
        core.createPosition(realParagraphId, 0),
      );

      ctrl.update(makeFakeEditorState());

      container.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        right: 600,
        bottom: 100,
        width: 600,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      }));

      container.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 10,
          clientY: 20,
          detail: 3,
          bubbles: true,
        }),
      );

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_SELECTION" }),
      );

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("extends selection on shift+click", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch }),
      );
      ctrl.update(makeFakeEditorState());

      container.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        right: 600,
        bottom: 100,
        width: 600,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      }));

      // First click
      container.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 10,
          clientY: 20,
          detail: 1,
          bubbles: true,
        }),
      );

      dispatch.mockClear();

      // Shift-click
      container.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 50,
          clientY: 20,
          detail: 1,
          shiftKey: true,
          bubbles: true,
        }),
      );

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_SELECTION" }),
      );

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("updates selection on mousemove during drag", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch }),
      );
      ctrl.update(makeFakeEditorState());

      container.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        right: 600,
        bottom: 100,
        width: 600,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      }));

      // Mousedown starts drag
      container.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 10,
          clientY: 20,
          detail: 1,
          bubbles: true,
        }),
      );

      dispatch.mockClear();

      // Mousemove extends selection
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: 50,
          clientY: 20,
          bubbles: true,
        }),
      );

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_SELECTION" }),
      );

      // Mouseup ends drag
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

      dispatch.mockClear();

      // Further mousemove should NOT dispatch
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: 80,
          clientY: 20,
          bubbles: true,
        }),
      );
      expect(dispatch).not.toHaveBeenCalled();

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("keeps textarea focused on mousedown", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      container.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        right: 600,
        bottom: 100,
        width: 600,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      }));

      container.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 10,
          clientY: 20,
          detail: 1,
          bubbles: true,
        }),
      );

      const textarea = container.querySelector("textarea")!;
      expect(document.activeElement).toBe(textarea);

      ctrl.destroy();
      document.body.removeChild(container);
    });
  });

  // ── #323 Cycle B: per-page caret hint wiring ───────────────────────────────
  //
  // A click into a header/footer slot must (1) carry the clicked page index as
  // `caretPageHint` on the dispatched SET_SELECTION, and (2) thread the
  // EditorState's `caretPageHint` into ALL THREE `resolvePixelPosition` calls
  // (caret + selection-rect endpoints), so the caret AND the highlight resolve
  // on the page the user clicked — not the template block's default first page.
  describe("per-page caret hint (#323 Cycle B)", () => {
    function makePaginatedContainer(dispatch = vi.fn()) {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch, pageHeight: 100, pageGap: 24 }),
      );
      const { tree } = makeSpyVirtualTree(3, 600, 100, 24);
      ctrl.update(makeFakeEditorState({ layoutTree: tree }));
      // Make container coords deterministic for resolveMouseToLayout.
      container.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: 0, right: 600, bottom: 372, width: 600, height: 372, x: 0, y: 0, toJSON: () => {},
      }));
      return { container, ctrl, dispatch };
    }

    it("single click on page 1 dispatches SET_SELECTION with caretPageHint === 1", () => {
      const { container, ctrl, dispatch } = makePaginatedContainer();
      // clientY 150 → page 1 (slotHeight = pageHeight 100 + gap 24 = 124).
      container.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 10, clientY: 150, detail: 1, bubbles: true }),
      );
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_SELECTION", caretPageHint: 1 }),
      );
      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("single click on page 0 dispatches caretPageHint === 0 (body click harmless)", () => {
      const { container, ctrl, dispatch } = makePaginatedContainer();
      // clientY 10 → page 0.
      container.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 10, clientY: 10, detail: 1, bubbles: true }),
      );
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_SELECTION", caretPageHint: 0 }),
      );
      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("double-click (word) carries the clicked page as caretPageHint", () => {
      const { container, ctrl, dispatch } = makePaginatedContainer();
      container.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 10, clientY: 150, detail: 2, bubbles: true }),
      );
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_SELECTION", caretPageHint: 1 }),
      );
      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("triple-click (paragraph) carries the clicked page as caretPageHint", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch, pageHeight: 100, pageGap: 24 }),
      );
      const { tree } = makeSpyVirtualTree(3, 600, 100, 24);
      // Triple-click needs a real blockId so the dispatch fires (the
      // resolvePositionFromPixel mock's "mock-block" id is not in state).
      const realParagraphId = fakeEditorBase.selection.focus.blockId;
      vi.mocked(core.resolvePositionFromPixel).mockReturnValueOnce(
        core.createPosition(realParagraphId, 0),
      );
      ctrl.update(makeFakeEditorState({ layoutTree: tree }));
      container.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: 0, right: 600, bottom: 372, width: 600, height: 372, x: 0, y: 0, toJSON: () => {},
      }));
      container.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 10, clientY: 150, detail: 3, bubbles: true }),
      );
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_SELECTION", caretPageHint: 1 }),
      );
      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("shift-click (extend) carries the clicked page as caretPageHint", () => {
      const { container, ctrl, dispatch } = makePaginatedContainer();
      // Plant an anchor with a first click on page 0.
      container.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 10, clientY: 10, detail: 1, bubbles: true }),
      );
      // The controller reads its anchor from the EditorState; feed back a
      // collapsed selection at the real paragraph so the shift-click extends.
      const realParagraphId = fakeEditorBase.selection.focus.blockId;
      const { tree } = makeSpyVirtualTree(3, 600, 100, 24);
      ctrl.update(
        makeFakeEditorState({
          layoutTree: tree,
          selection: core.createSpan(
            core.createPosition(realParagraphId, 0),
            core.createPosition(realParagraphId, 0),
          ),
        }),
      );
      dispatch.mockClear();
      // Shift-click on page 1.
      container.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 10, clientY: 150, detail: 1, shiftKey: true, bubbles: true }),
      );
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_SELECTION", caretPageHint: 1 }),
      );
      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("drag (mousemove) carries the FOCUS page as caretPageHint", () => {
      const { container, ctrl, dispatch } = makePaginatedContainer();
      // Mousedown on page 0 starts the drag.
      container.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 10, clientY: 10, detail: 1, bubbles: true }),
      );
      dispatch.mockClear();
      // Drag to page 1 — the hint must track the drag point (page 1).
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 10, clientY: 150, bubbles: true }),
      );
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_SELECTION", caretPageHint: 1 }),
      );
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("threads state.caretPageHint into the CARET resolvePixelPosition call", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100, pageGap: 24 }),
      );
      const { tree } = makeSpyVirtualTree(3, 600, 100, 24);
      vi.mocked(core.resolvePixelPosition).mockClear();
      ctrl.update(makeFakeEditorState({ layoutTree: tree, caretPageHint: 1 }));
      // The caret (focus) resolve is the first resolvePixelPosition call.
      const caretCall = vi.mocked(core.resolvePixelPosition).mock.calls[0];
      // Signature: (state, position, layoutTree, measurer, caretPageHint).
      expect(caretCall[4]).toBe(1);
      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("threads state.caretPageHint into BOTH selection-rect endpoint resolves (I2)", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100, pageGap: 24 }),
      );
      const { tree } = makeSpyVirtualTree(3, 600, 100, 24);
      const realParagraphId = fakeEditorBase.selection.focus.blockId;
      vi.mocked(core.resolvePixelPosition).mockClear();
      // Non-collapsed, non-spanning selection (pageSpanOfBlock → null in the
      // spy tree) → controller resolves selStart + selEnd via resolvePixelPosition.
      ctrl.update(
        makeFakeEditorState({
          layoutTree: tree,
          caretPageHint: 1,
          selection: core.createSpan(
            core.createPosition(realParagraphId, 0),
            core.createPosition(realParagraphId, 3),
          ),
        }),
      );
      const calls = vi.mocked(core.resolvePixelPosition).mock.calls;
      // 3 calls: caret(focus) + selStart + selEnd — all must carry the hint.
      expect(calls.length).toBe(3);
      expect(calls[0][4]).toBe(1); // caret
      expect(calls[1][4]).toBe(1); // selStart
      expect(calls[2][4]).toBe(1); // selEnd
      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("NO-REGRESSION: with no hint, resolvePixelPosition gets undefined (single-page body)", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      vi.mocked(core.resolvePixelPosition).mockClear();
      ctrl.update(makeFakeEditorState());
      const caretCall = vi.mocked(core.resolvePixelPosition).mock.calls[0];
      expect(caretCall[4]).toBeUndefined();
      ctrl.destroy();
      document.body.removeChild(container);
    });
  });

  describe("clipboard", () => {
    it("copies text on copy event", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());

      // Set up a non-collapsed selection
      const focusBlockId = fakeEditorBase.selection.focus.blockId;
      const state = makeFakeEditorState({
        selection: core.createSpan(
          core.createPosition(focusBlockId, 0),
          core.createPosition(focusBlockId, 5),
        ),
      });
      ctrl.update(state);

      const textarea = container.querySelector("textarea")!;
      const clipboardData = {
        setData: vi.fn(),
        getData: vi.fn(),
      };
      const copyEvent = new Event("copy", { bubbles: true }) as unknown as ClipboardEvent;
      Object.defineProperty(copyEvent, "clipboardData", { value: clipboardData });
      Object.defineProperty(copyEvent, "preventDefault", { value: vi.fn() });
      textarea.dispatchEvent(copyEvent);

      expect(core.extractText).toHaveBeenCalled();
      expect(clipboardData.setData).toHaveBeenCalledWith(
        "text/plain",
        "hello",
      );

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("cuts text on cut event", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch }),
      );

      const focusBlockId = fakeEditorBase.selection.focus.blockId;
      const state = makeFakeEditorState({
        selection: core.createSpan(
          core.createPosition(focusBlockId, 0),
          core.createPosition(focusBlockId, 5),
        ),
      });
      ctrl.update(state);

      const textarea = container.querySelector("textarea")!;
      const clipboardData = {
        setData: vi.fn(),
        getData: vi.fn(),
      };
      const cutEvent = new Event("cut", { bubbles: true }) as unknown as ClipboardEvent;
      Object.defineProperty(cutEvent, "clipboardData", { value: clipboardData });
      Object.defineProperty(cutEvent, "preventDefault", { value: vi.fn() });
      textarea.dispatchEvent(cutEvent);

      expect(clipboardData.setData).toHaveBeenCalledWith(
        "text/plain",
        "hello",
      );
      expect(dispatch).toHaveBeenCalledWith({ type: "DELETE_BACKWARD" });

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("pastes text on paste event", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch }),
      );
      ctrl.update(makeFakeEditorState());

      const textarea = container.querySelector("textarea")!;
      const clipboardData = {
        setData: vi.fn(),
        getData: vi.fn(() => "pasted text"),
      };
      const pasteEvent = new Event("paste", { bubbles: true }) as unknown as ClipboardEvent;
      Object.defineProperty(pasteEvent, "clipboardData", { value: clipboardData });
      Object.defineProperty(pasteEvent, "preventDefault", { value: vi.fn() });
      textarea.dispatchEvent(pasteEvent);

      expect(dispatch).toHaveBeenCalledWith({
        type: "PASTE",
        text: "pasted text",
      });

      ctrl.destroy();
      document.body.removeChild(container);
    });
  });

  describe("IME composition", () => {
    it("suppresses input during composition", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch }),
      );
      ctrl.update(makeFakeEditorState());

      const textarea = container.querySelector("textarea")!;

      textarea.dispatchEvent(
        new Event("compositionstart", { bubbles: true }),
      );

      // Input during composition should NOT dispatch
      textarea.value = "n";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "INSERT_TEXT" }),
      );

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("commits text on compositionEnd", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch }),
      );
      ctrl.update(makeFakeEditorState());

      const textarea = container.querySelector("textarea")!;

      textarea.dispatchEvent(
        new Event("compositionstart", { bubbles: true }),
      );

      const compositionEnd = new CompositionEvent("compositionend", {
        data: "你",
        bubbles: true,
      });
      textarea.dispatchEvent(compositionEnd);

      expect(dispatch).toHaveBeenCalledWith({
        type: "INSERT_TEXT",
        text: "你",
      });
      expect(textarea.value).toBe("");

      ctrl.destroy();
      document.body.removeChild(container);
    });
  });

  describe("scroll repaint", () => {
    it("repaints on scroll event (rAF-throttled)", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      vi.mocked(canvasRenderer.paintCanvas).mockClear();

      // Fire scroll on window (default scroll parent)
      window.dispatchEvent(new Event("scroll"));
      // rAF-throttled — advance a frame
      vi.advanceTimersByTime(16);

      expect(canvasRenderer.paintCanvas).toHaveBeenCalled();

      ctrl.destroy();
      document.body.removeChild(container);
    });
  });

  // ── #305 (C.2b-2 follow-up): scrollCursorIntoView per-page running-sum Y ───
  //
  // `scrollCursorIntoView` derives the cursor's document-y as
  // `cursorSlot.top + cursorPos.y`, where `cursorSlot.top` is the per-page
  // RUNNING-SUM `blockOffset` (a section may make later pages taller/wider with
  // a different gap), NOT a uniform `pageIndex * (pageHeight + pageGap)`. These
  // tests pin the resulting smooth-scroll TARGET to that running-sum geometry:
  // the mixed-height fixture below makes the uniform formula give a different
  // (wrong) answer, so a regression to `pageIndex*(H+gap)` would flip the
  // asserted number.
  describe("scrollCursorIntoView (per-page running-sum geometry, #305)", () => {
    // page 0: 100 tall / 600 wide / gap 24 (doc-wide default).
    // pages 1-2: 200 tall / 800 wide / gap 40 (a taller+wider section).
    // Running-sum slot tops: [0, 124, 364]. Uniform `i*(100+24)` would give
    // [0, 124, 248] — so page 2's top (364) differs from uniform (248) by 116.
    function makeTallSectionTree() {
      return makeSpyVirtualTreeWithGeom([100, 200, 200], [600, 800, 800], [24, 40, 40]);
    }

    // Build a controller whose detected scroll-parent is a scrollable <div>
    // wrapping the container (overflowY:auto is picked up by detectScrollParent,
    // which runs at construction — so the wrapper must exist BEFORE create).
    function makeScrollableController(
      scrollParentGeom: { scrollTop: number; clientHeight: number; rectTop: number },
      containerRectTop: number,
    ) {
      const sp = document.createElement("div");
      sp.style.overflowY = "auto";
      document.body.appendChild(sp);
      const container = document.createElement("div");
      sp.appendChild(container);

      // jsdom leaves layout metrics at 0; stub the ones the HTMLElement branch
      // of scrollCursorIntoView reads. scrollTop is writable so smoothScrollTo
      // (which assigns sp.scrollTop over rAF frames) lands the final target.
      sp.scrollTop = scrollParentGeom.scrollTop;
      Object.defineProperty(sp, "clientHeight", {
        value: scrollParentGeom.clientHeight,
        configurable: true,
      });
      sp.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: scrollParentGeom.rectTop, right: 800,
        bottom: scrollParentGeom.rectTop + scrollParentGeom.clientHeight,
        width: 800, height: scrollParentGeom.clientHeight, x: 0, y: 0, toJSON: () => {},
      }));
      container.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: containerRectTop, right: 800, bottom: containerRectTop + 564,
        width: 800, height: 564, x: 0, y: 0, toJSON: () => {},
      }));

      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100, pageGap: 24 }),
      );
      return { sp, container, ctrl };
    }

    afterEach(() => {
      vi.mocked(core.resolvePixelPosition).mockReturnValue(MOCK_PIXEL_POSITION);
    });

    it("cursor below the viewport scrolls down to a target derived from the slot's running-sum top (not pageIndex*(H+gap))", () => {
      // Scroll-parent fully at top (scrollTop 0), short viewport (clientHeight
      // 200), container flush with the scroll-parent (both rect tops 0).
      const { sp, container, ctrl } = makeScrollableController(
        { scrollTop: 0, clientHeight: 200, rectTop: 0 },
        0,
      );
      const { tree, offsets } = makeTallSectionTree();

      // Cursor on page 2, cursorPos.y = 20, height 16.
      vi.mocked(core.resolvePixelPosition).mockReturnValue({
        x: 10, y: 20, height: 16, lineY: 18, lineHeight: 24,
        lineMarginTop: 0, lineMarginBottom: 0, pageIndex: 2,
      });

      ctrl.update(makeFakeEditorState({ layoutTree: tree }));
      // smoothScrollTo animates sp.scrollTop over SCROLL_DURATION (250ms);
      // advance past it so easing reaches the final value exactly.
      vi.advanceTimersByTime(400);

      // Running-sum: offsets[2] = 364 (≠ uniform 2*(100+24) = 248).
      expect(offsets[2]).toBe(364);
      // cursorVisualY = 364 + 20 = 384. cursorInSp = 0 - 0 + 0 + 384 = 384.
      // Below-viewport branch: 384 + 16(h) + 64(pad) = 464 > visBottom(0+200).
      // target = cursorInSp + h + pad - clientHeight = 464 - 200 = 264.
      const RUNNING_SUM_TARGET = 364 + 20 + 16 + 64 - 200; // 264
      // A uniform `pageIndex*(H+gap)` (=248) would yield 248+20+16+64-200 = 148.
      const UNIFORM_WRONG_TARGET = 248 + 20 + 16 + 64 - 200; // 148
      expect(RUNNING_SUM_TARGET).not.toBe(UNIFORM_WRONG_TARGET);
      expect(sp.scrollTop).toBeCloseTo(RUNNING_SUM_TARGET, 3);

      ctrl.destroy();
      document.body.removeChild(sp);
    });

    it("cursor above the viewport scrolls up to a target derived from the slot's running-sum top (not pageIndex*(H+gap))", () => {
      // Scroll-parent scrolled down to 500 with the container scrolled up by the
      // same amount (rect top -500), so page 2 sits above the visible window.
      const { sp, container, ctrl } = makeScrollableController(
        { scrollTop: 500, clientHeight: 200, rectTop: 0 },
        -500,
      );
      const { tree, offsets } = makeTallSectionTree();

      vi.mocked(core.resolvePixelPosition).mockReturnValue({
        x: 10, y: 20, height: 16, lineY: 18, lineHeight: 24,
        lineMarginTop: 0, lineMarginBottom: 0, pageIndex: 2,
      });

      ctrl.update(makeFakeEditorState({ layoutTree: tree }));
      vi.advanceTimersByTime(400);

      expect(offsets[2]).toBe(364);
      // cursorVisualY = 364 + 20 = 384. cursorInSp = (-500) - 0 + 500 + 384 = 384.
      // Above-viewport branch: cursorInSp(384) < visTop(500) + pad(64) = 564.
      // target = max(0, cursorInSp - pad) = max(0, 384 - 64) = 320.
      const RUNNING_SUM_TARGET = Math.max(0, 364 + 20 - 64); // 320
      // Uniform 248 would give max(0, 248+20-64) = 204.
      const UNIFORM_WRONG_TARGET = Math.max(0, 248 + 20 - 64); // 204
      expect(RUNNING_SUM_TARGET).not.toBe(UNIFORM_WRONG_TARGET);
      expect(sp.scrollTop).toBeCloseTo(RUNNING_SUM_TARGET, 3);

      ctrl.destroy();
      document.body.removeChild(sp);
    });
  });

  describe("textarea positioning", () => {
    it("positions textarea at cursor position on update", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions());

      vi.mocked(core.resolvePixelPosition).mockReturnValue({
        x: 42,
        y: 84,
        height: 16,
        lineY: 82,
        lineHeight: 24,
        lineMarginTop: 0,
        lineMarginBottom: 0,
        pageIndex: 0,
      });

      ctrl.update(makeFakeEditorState());

      const textarea = container.querySelector("textarea")!;
      expect(textarea.style.left).toBe("42px");
      expect(textarea.style.top).toBe("84px");

      ctrl.destroy();
    });
  });

  describe("destroy", () => {
    it("removes created DOM elements", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      expect(container.querySelector("canvas")).not.toBeNull();
      expect(container.querySelector("textarea")).not.toBeNull();

      ctrl.destroy();

      expect(container.querySelector("canvas")).toBeNull();
      expect(container.querySelector("textarea")).toBeNull();
    });

    it("clears blink interval", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());

      ctrl.destroy();

      vi.mocked(canvasRenderer.paintCanvas).mockClear();
      vi.advanceTimersByTime(1000);

      // No blink repaints after destroy
      expect(canvasRenderer.paintCanvas).not.toHaveBeenCalled();

      document.body.removeChild(container);
    });

    it("removes event listeners", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch }),
      );
      ctrl.update(makeFakeEditorState());

      ctrl.destroy();

      // Mouse events should no longer dispatch
      container.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 10,
          clientY: 20,
          detail: 1,
          bubbles: true,
        }),
      );
      expect(dispatch).not.toHaveBeenCalled();

      document.body.removeChild(container);
    });
  });
});

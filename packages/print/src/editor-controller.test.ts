import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createEditorController,
  type EditorControllerOptions,
} from "./editor-controller";
import * as canvasRenderer from "./canvas-renderer";
import * as keyHandler from "./key-handler";
import * as core from "@taleweaver/core";
import * as printPkg from "./index";
// The geometric cursor functions the controller calls now live in
// `@taleweaver/print`'s own `./cursor/*` modules (dual-mode Phase 3 sub-phase 3).
// They are mocked at their source modules below (the controller imports them
// from these exact paths), so we spy through these namespaces, not the barrel.
import * as cursorPosition from "./cursor/cursor-position";
import * as hitTest from "./cursor/hit-test";
import * as selectionGeometry from "./cursor/selection-geometry";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("./canvas-renderer", () => ({
  paintCanvas: vi.fn(),
  paintPage: vi.fn(),
}));

vi.mock("./key-handler", () => ({
  mapKeyEvent: vi.fn(),
  // Phase 0b: `handleKeyDown` routes the mapped result through `isNavIntent` to
  // split geometric navigation (resolved by the backend nav resolver) from plain
  // editor actions. These tests assert the plain-action dispatch path, so the
  // intent is never a NavIntent — return false (the mapped result is a plain
  // `EditorAction`, dispatched as-is).
  isNavIntent: vi.fn(() => false),
}));

// Phase 0b: the controller builds its layout tree via the backend layout-driver
// (`createLayoutDriver().rebuild(state, width, dirty)`) — `EditorState` no longer
// carries `layoutTree`. These tests inject SYNTHETIC layout trees (spy virtual
// trees / paginated positioned boxes) to exercise the controller's slot-sizing,
// getPage, per-section-geometry, scroll, and hit-test plumbing in isolation from
// real layout. We mock the driver: `rebuild` returns the test-set
// `pendingLayoutTree` when one is staged (consumed/cleared by the next
// `makeFakeEditorState` call), else delegates to the REAL driver so the
// empty-document / non-paginated tests get a genuine positioned tree.
//
// `pendingLayoutTree` is staged by `makeFakeEditorState({ layoutTree })`
// (the old fixture-override shape), so call sites read identically.
const driverState = vi.hoisted(
  (): {
    pendingLayoutTree:
      | import("./index").LayoutBox
      | import("./index").VirtualLayoutTree
      | null;
  } => ({ pendingLayoutTree: null }),
);

vi.mock("./layout-driver/layout-driver", async () => {
  const actual = await vi.importActual<typeof import("./layout-driver/layout-driver")>(
    "./layout-driver/layout-driver",
  );
  return {
    ...actual,
    createLayoutDriver: (
      config: Parameters<typeof actual.createLayoutDriver>[0],
    ) => {
      const real = actual.createLayoutDriver(config);
      return {
        rebuild: (
          st: import("@taleweaver/core").State,
          containerWidth: number,
          lastDirtyIds: ReadonlySet<import("@taleweaver/core").BlockId> | null,
        ) => {
          const staged = driverState.pendingLayoutTree;
          if (staged !== null) return staged;
          return real.rebuild(st, containerWidth, lastDirtyIds);
        },
      };
    },
  };
});

// Capture `syncTree` calls (#513): the controller must forward the layout tree's
// `globalFieldValues` as `syncTree`'s `resolvedFields` arg. We wrap the REAL host
// (so the live DOM mirror still builds) and record each `syncTree(tree, fields)`.
const mirrorSyncTreeCalls = vi.hoisted(
  () => [] as Array<{ resolvedFields: ReadonlyMap<string, string> | undefined }>,
);

vi.mock("./dom-mirror-host", async () => {
  const actual = await vi.importActual<typeof import("./dom-mirror-host")>(
    "./dom-mirror-host",
  );
  return {
    ...actual,
    createDomMirrorHost: (options: Parameters<typeof actual.createDomMirrorHost>[0]) => {
      const host = actual.createDomMirrorHost(options);
      return {
        ...host,
        syncTree: (
          tree: Parameters<typeof host.syncTree>[0],
          resolvedFields?: ReadonlyMap<string, string>,
        ) => {
          mirrorSyncTreeCalls.push({ resolvedFields });
          host.syncTree(tree, resolvedFields);
        },
      };
    },
  };
});

const MOCK_PIXEL_POSITION: printPkg.PixelPosition = {
  x: 10,
  y: 20,
  height: 16,
  lineY: 18,
  lineHeight: 24,
  lineMarginTop: 0,
  lineMarginBottom: 0,
  pageIndex: 0,
};

// P4-C.2.2b: `resolvePositionFromPixel` returns `{ position, caretAffinity }`.
// `hit(pos)` wraps a bare `Position` into that shape for the mock returns below
// (affinity "after" is the inert default — these tests assert dispatch / page
// behavior, not the boundary affinity itself).
function hit(
  position: core.Position,
): { position: core.Position; caretAffinity: "before" | "after" } {
  return { position, caretAffinity: "after" };
}

vi.mock("@taleweaver/core", async () => {
  const actual = await vi.importActual<typeof core>("@taleweaver/core");
  return {
    ...actual,
    selectWord: vi.fn(() =>
      actual.createSpan(
        actual.createPosition("mock-block" as core.BlockId, 0),
        actual.createPosition("mock-block" as core.BlockId, 5),
      ),
    ),
    extractText: vi.fn(() => "hello"),
  };
});
// Geometric cursor fns relocated to `@taleweaver/print` (this package); mock them
// at their source modules so the controller (which imports them from here) is spied.
vi.mock("./cursor/cursor-position", async () => {
  const actual = await vi.importActual<typeof cursorPosition>("./cursor/cursor-position");
  return { ...actual, resolvePixelPosition: vi.fn(() => MOCK_PIXEL_POSITION) };
});
vi.mock("./cursor/selection-geometry", async () => {
  const actual = await vi.importActual<typeof selectionGeometry>("./cursor/selection-geometry");
  return { ...actual, computeSelectionRects: vi.fn(() => []) };
});
vi.mock("./cursor/hit-test", async () => {
  const core_ = await vi.importActual<typeof core>("@taleweaver/core");
  const actual = await vi.importActual<typeof hitTest>("./cursor/hit-test");
  return {
    ...actual,
    resolvePositionFromPixel: vi.fn(() => ({
      position: core_.createPosition("mock-block" as core.BlockId, 0),
      caretAffinity: "after" as const,
    })),
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

// Real EditorState produced by the public-API factory. The empty document it
// creates is geometry-free (Phase 0b: `EditorState` no longer carries
// `layoutTree`); the controller builds the layout tree via its backend driver
// from `state.state`. Tests only assert shape, not specific dimensions, so the
// non-paginated tests let the (mocked) driver delegate to the real layout.
const fakeEditorBase: core.EditorState = core.createInitialEditorState({
  componentRegistry: core.createDefaultComponentRegistry(),
  attrRegistry: core.createDefaultAttrRegistry(),
  containerWidth: 600,
});

// A fixture-override shape that mirrors the pre-Phase-0b `Partial<EditorState>`
// API: callers still pass `{ layoutTree }` to inject a synthetic tree. Geometry
// (`layoutTree`) is no longer an `EditorState` field, so it is split out here and
// staged into the mocked driver instead (consumed in the next `update()`); the
// remaining overrides spread onto the real geometry-free base.
type FakeEditorOverrides = Partial<core.EditorState> & {
  layoutTree?: printPkg.LayoutBox | printPkg.VirtualLayoutTree;
};

function makeFakeEditorState(
  overrides?: FakeEditorOverrides,
): core.EditorState {
  const { layoutTree, ...stateOverrides } = overrides ?? {};
  // Stage the injected tree for the mocked driver (null clears any prior stage,
  // so a plain `makeFakeEditorState()` resets to the real-driver delegation).
  driverState.pendingLayoutTree = layoutTree ?? null;
  return {
    ...fakeEditorBase,
    ...stateOverrides,
  };
}

// The same config `fakeEditorBase` was built from — needed to drive `reduceEditor`
// when seeding a non-empty document for the accessibility-mirror tests (Task 8).
const seedConfig: core.EditorConfig = {
  componentRegistry: core.createDefaultComponentRegistry(),
  attrRegistry: core.createDefaultAttrRegistry(),
  containerWidth: 600,
};

// An EditorState whose document contains the text "Hello" (typed into a FRESH
// empty seed via the REAL reducer). After this single INSERT_TEXT the selection
// is a collapsed caret at the end of "Hello". Used by the a11y-mirror tests,
// which run the (unmocked) `buildAccessibilityTree` over the real state —
// `extractText` is mocked, but the mirror tree builder is not, so the mirror DOM
// contains the real "Hello". A FRESH base (not the shared `fakeEditorBase`) is
// built per call because the underlying Y.Doc mutates in place — reusing it
// across calls would corrupt its History/undo state.
function makeSeededEditorState(): core.EditorState {
  const base = core.createInitialEditorState(seedConfig);
  return core.reduceEditor(
    base,
    { type: "INSERT_TEXT", text: "Hello" },
    seedConfig,
  );
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
): printPkg.LayoutBox {
  const cs = core.INITIAL_COMPUTED_STYLE;
  const us = printPkg.computeUsedStyle(cs, width, "indefinite");
  const pages: printPkg.LayoutBox[] = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push(
      printPkg.createPageBox(
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
        null,
        0,
        0,
      ),
    );
  }
  return printPkg.createBlockBox(
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
 * `pageCount` uniform pages plus a `getPage` vitest spy. Used to assert the
 * controller hot path (collapsed selection) reads only the visible pages via
 * `getPage` and never the whole document.
 */
function makeSpyVirtualTree(pageCount: number, width: number, pageHeight: number, pageGap: number) {
  const cs = core.INITIAL_COMPUTED_STYLE;
  const us = printPkg.computeUsedStyle(cs, width, "indefinite");
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
  } as unknown as printPkg.VirtualLayoutTree["plan"];

  const makePage = (i: number) => {
    const entry = entries[i];
    if (entry === undefined) throw new Error(`expected page entry at index ${i}`);
    return printPkg.createPageBox(`page-${i}`, 0, entry.blockOffset, width, pageHeight,
      cs.writingMode, cs.direction, cs, us, [], i, width, null, null, null, 0, 0);
  };

  const getPage = vi.fn((i: number) => makePage(i));

  const tree = {
    type: "virtual-root" as const,
    plan,
    inlineSize: width,
    blockSize: totalBlockSize,
    footnoteAnchorPages: new Map<core.BlockId, number>(),
    globalFieldValues: new Map<string, string>(),
    getPage,
    getPages: vi.fn((from: number, to: number) => {
      const out = [];
      for (let i = from; i <= to; i++) out.push(makePage(i));
      return out;
    }),
  } satisfies printPkg.VirtualLayoutTree;

  return { tree, getPage };
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
    running += nth(pageHeights, i, "pageHeight") + (i < pageCount - 1 ? nth(pageGaps, i, "pageGap") : 0);
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
      if (y >= nth(offsets, i, "offset")) return i;
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
  } as unknown as printPkg.VirtualLayoutTree["plan"];

  const makePage = (i: number) => {
    const pw = nth(pageWidths, i, "pageWidth");
    const ph = nth(pageHeights, i, "pageHeight");
    const off = nth(offsets, i, "offset");
    const us = printPkg.computeUsedStyle(cs, pw, "indefinite");
    return printPkg.createPageBox(
      `page-${i}`, 0, off, pw, ph,
      cs.writingMode, cs.direction, cs, us, [], i, pw,
      null, null, null,
      0, 0,
    );
  };

  const getPage = vi.fn((i: number) => makePage(i));

  const tree = {
    type: "virtual-root" as const,
    plan,
    inlineSize: nth(pageWidths, 0, "pageWidth"),
    blockSize: totalBlockSize,
    footnoteAnchorPages: new Map<core.BlockId, number>(),
    globalFieldValues: new Map<string, string>(),
    getPage,
    getPages: vi.fn((from: number, to: number) => {
      const out = [];
      for (let i = from; i <= to; i++) out.push(makePage(i));
      return out;
    }),
  } satisfies printPkg.VirtualLayoutTree;

  return { tree, getPage, offsets, totalBlockSize };
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
  vi.mocked(cursorPosition.resolvePixelPosition).mockClear();
  vi.mocked(selectionGeometry.computeSelectionRects).mockClear();
  vi.mocked(hitTest.resolvePositionFromPixel).mockClear();
  vi.mocked(core.selectWord).mockClear();
  vi.mocked(core.extractText).mockClear();
  // #513: reset the captured syncTree-call log so a prior test's mirror syncs
  // never leak into another test's assertions on `mirrorSyncTreeCalls`.
  mirrorSyncTreeCalls.length = 0;
  // Reset the staged layout tree so a prior test's injected synthetic tree never
  // leaks into a test that expects the real-driver delegation.
  driverState.pendingLayoutTree = null;
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

    it("accepts an optional accessibilityMirror flag (default off, no behavior change)", () => {
      const container = document.createElement("div");
      const controller = createEditorController(
        container,
        makeOptions({ accessibilityMirror: false }),
      );
      expect(controller).toBeDefined();
      // No mirror element mounted when the flag is off.
      expect(
        container.querySelector("[data-taleweaver-a11y-mirror]"),
      ).toBeNull();
      controller.destroy();
    });
  });

  describe("getCaretRect (remote-cursor query)", () => {
    it("maps a Position to viewport coords: container origin + caret offset", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());
      // Non-paginated (no slots) → caret y is container-relative; viewport =
      // container bounding-rect origin + the resolved page-local x/y.
      container.getBoundingClientRect = vi.fn(() => ({
        left: 100, top: 50, right: 700, bottom: 850, width: 600, height: 800, x: 100, y: 50, toJSON: () => {},
      }));
      const pos = core.createPosition("mock-block" as core.BlockId, 0);
      // MOCK_PIXEL_POSITION = { x: 10, y: 20, height: 16, pageIndex: 0 }.
      expect(ctrl.getCaretRect(pos)).toEqual({ left: 110, top: 70, height: 16 });
      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("returns null before the first update() (no layout yet)", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions());
      const pos = core.createPosition("mock-block" as core.BlockId, 0);
      expect(ctrl.getCaretRect(pos)).toBeNull();
      ctrl.destroy();
    });

    it("returns null when the position can't be resolved", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      ctrl.update(makeFakeEditorState());
      vi.mocked(cursorPosition.resolvePixelPosition).mockReturnValueOnce(null);
      const pos = core.createPosition("mock-block" as core.BlockId, 0);
      expect(ctrl.getCaretRect(pos)).toBeNull();
      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("adds the page slot's top offset for a caret on a later page (paginated)", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100, pageGap: 24 }),
      );
      // 3 pages of height 100 + gap 24 → slot[1].top = 124.
      const { tree } = makeSpyVirtualTree(3, 600, 100, 24);
      ctrl.update(makeFakeEditorState({ layoutTree: tree }));
      container.getBoundingClientRect = vi.fn(() => ({
        left: 100, top: 50, right: 700, bottom: 850, width: 600, height: 800, x: 100, y: 50, toJSON: () => {},
      }));
      // Resolve to page 1: viewport top = rect.top(50) + slot[1].top(124) + y(20) = 194.
      vi.mocked(cursorPosition.resolvePixelPosition).mockReturnValueOnce({
        ...MOCK_PIXEL_POSITION,
        pageIndex: 1,
      });
      const pos = core.createPosition("mock-block" as core.BlockId, 0);
      expect(ctrl.getCaretRect(pos)).toEqual({ left: 110, top: 194, height: 16 });
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
      const slot0 = slots[0];
      const slot1 = slots[1];
      if (slot0 === undefined || slot1 === undefined) throw new Error("expected two slots");
      expect(slot0.getAttribute("data-page-index")).toBe("0");
      expect(slot1.getAttribute("data-page-index")).toBe("1");

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

    it("constructs the IntersectionObserver with the scrollable ancestor as root", () => {
      // Editor embedded in a scrollable <div> (overflow:auto). The
      // IntersectionObserver must observe relative to that container, not the
      // viewport, or pages acquire/release against the wrong scroll region.
      const scroller = document.createElement("div");
      scroller.style.overflowY = "auto";
      scroller.style.height = "200px";
      const container = document.createElement("div");
      scroller.appendChild(container);
      document.body.appendChild(scroller);

      const ioMock = vi.mocked(globalThis.IntersectionObserver);
      ioMock.mockClear();

      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100 }),
      );
      ctrl.update(makePaginatedEditorState());

      // The last IntersectionObserver constructed should target the scroller.
      expect(ioMock).toHaveBeenCalled();
      const lastCall = ioMock.mock.calls[ioMock.mock.calls.length - 1];
      if (lastCall === undefined) throw new Error("expected an IntersectionObserver call");
      const options = lastCall[1] as IntersectionObserverInit | undefined;
      expect(options?.root).toBe(scroller);

      ctrl.destroy();
      scroller.remove();
    });

    it("constructs the IntersectionObserver with root null when scrolled by the window", () => {
      // No scrollable ancestor → falls back to window scrolling, which maps to
      // a null IntersectionObserver root (the viewport).
      const container = document.createElement("div");
      document.body.appendChild(container);

      const ioMock = vi.mocked(globalThis.IntersectionObserver);
      ioMock.mockClear();

      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100 }),
      );
      ctrl.update(makePaginatedEditorState());

      expect(ioMock).toHaveBeenCalled();
      const lastCall = ioMock.mock.calls[ioMock.mock.calls.length - 1];
      if (lastCall === undefined) throw new Error("expected an IntersectionObserver call");
      const options = lastCall[1] as IntersectionObserverInit | undefined;
      expect(options?.root ?? null).toBeNull();

      ctrl.destroy();
      container.remove();
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
    it("sizes page slots from the plan WITHOUT materializing the whole tree on a collapsed-selection update", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions({ pageHeight: 100, pageGap: 24 }));
      const { tree } = makeSpyVirtualTree(3, 600, 100, 24);

      ctrl.update(makeFakeEditorState({ layoutTree: tree }));

      // Slots created from the plan; never materialized the whole tree.
      const slots = container.querySelectorAll("div[data-page-index]");
      expect(slots.length).toBe(3);
      expect((slots[0] as HTMLDivElement).style.width).toBe("600px");
      expect((slots[0] as HTMLDivElement).style.height).toBe("100px");

      ctrl.destroy();
    });

    it("paints visible pages via getPage(idx) on the collapsed hot path", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions({ pageHeight: 100, pageGap: 24 }));
      const { tree, getPage } = makeSpyVirtualTree(3, 600, 100, 24);

      // fakeEditorBase's selection is collapsed (fresh empty doc), so this is
      // the typing/Enter hot path: no computeSelectionRects.
      ctrl.update(makeFakeEditorState({ layoutTree: tree }));

      // The mock IntersectionObserver marks all slots visible → getPage per page.
      expect(getPage).toHaveBeenCalled();
      expect(canvasRenderer.paintPage).toHaveBeenCalled();

      ctrl.destroy();
    });

    it("scroll spacer / total height uses plan.totalBlockSize (no whole-tree materialize)", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions({ pageHeight: 100, pageGap: 24 }));
      const { tree } = makeSpyVirtualTree(4, 600, 100, 24);

      ctrl.update(makeFakeEditorState({ layoutTree: tree }));
      // Paginated mode uses per-slot divs (no single spacer); the page slots are
      // sized from the plan, not from a materialized whole-document box.
      const slots = container.querySelectorAll("div[data-page-index]");
      expect(slots.length).toBe(4);

      ctrl.destroy();
    });

    it("non-collapsed selection (non-spanning blocks) computes rects per-page", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions({ pageHeight: 100, pageGap: 24 }));
      const { tree, getPage } = makeSpyVirtualTree(3, 600, 100, 24);

      // A non-collapsed selection. The spy tree's `pageSpanOfBlock` returns null
      // (non-spanning), so the per-page selection-rect path is taken.
      const anchor = core.createPosition("doc" as core.BlockId, 0);
      const focus = core.createPosition("doc" as core.BlockId, 1);
      ctrl.update(
        makeFakeEditorState({
          layoutTree: tree,
          selection: core.createSpan(anchor, focus),
        }),
      );

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
      // paintPage call's cursorState (arg index 7, after the matchHighlights
      // param #433, the commentHighlights param comments-slice-5, and the
      // suggestionHighlights param change-tracking-slice-6) is "hidden".
      const calls = vi.mocked(canvasRenderer.paintPage).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(call[7]).toBe("hidden");

      ctrl.destroy();
    });

    it("spanning-block selection boundary unions rects per-page", () => {
      const container = document.createElement("div");
      const ctrl = createEditorController(container, makeOptions({ pageHeight: 100, pageGap: 24 }));
      const { tree, getPage } = makeSpyVirtualTree(3, 600, 100, 24);
      // Force a boundary block to straddle a page break (pages 0..1).
      (tree.plan as { pageSpanOfBlock: (id: core.BlockId) => { first: number; last: number } | null })
        .pageSpanOfBlock = () => ({ first: 0, last: 1 });
      getPage.mockClear();

      const anchor = core.createPosition("doc" as core.BlockId, 0);
      const focus = core.createPosition("doc" as core.BlockId, 1);
      ctrl.update(
        makeFakeEditorState({ layoutTree: tree, selection: core.createSpan(anchor, focus) }),
      );

      // The spanning boundary block is unioned per-page via
      // `selectionRectsAcrossPages` (getPage per spanned page) — the whole tree
      // is never materialized.
      expect(getPage).toHaveBeenCalled();

      ctrl.destroy();
    });

    it("paginated mousedown hit-test resolves via getPage(clicked)", () => {
      const dispatch = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ dispatch, pageHeight: 100, pageGap: 24 }),
      );
      const { tree, getPage } = makeSpyVirtualTree(3, 600, 100, 24);
      ctrl.update(makeFakeEditorState({ layoutTree: tree }));

      // Paint already called getPage for visible pages; isolate the mousedown.
      getPage.mockClear();

      container.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: 0, right: 600, bottom: 372, width: 600, height: 372, x: 0, y: 0, toJSON: () => {},
      }));
      // clientY 150 → page 1 (slotHeight = pageHeight 100 + gap 24 = 124).
      container.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 10, clientY: 150, detail: 1, bubbles: true }),
      );

      // The hit-test materializes ONLY the clicked page — never the whole tree.
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
      vi.mocked(cursorPosition.resolvePixelPosition).mockReturnValue({
        x: 10, y: 20, height: 16, lineY: 18, lineHeight: 24,
        lineMarginTop: 0, lineMarginBottom: 0, pageIndex: 2,
      });

      ctrl.update(makeFakeEditorState({ layoutTree: tree }));

      const textarea = container.querySelector("textarea")!;
      // Running sum: offsets[2] = 100+24 + 200+40 = 364. + cursorPos.y(20) = 384.
      // A uniform pageIndex*(100+24)+20 would be 2*124+20 = 268 — WRONG.
      const offset2 = offsets[2];
      if (offset2 === undefined) throw new Error("expected offset at index 2");
      expect(offset2).toBe(364);
      expect(textarea.style.top).toBe(`${offset2 + 20}px`);

      ctrl.destroy();
      vi.mocked(cursorPosition.resolvePixelPosition).mockReturnValue(MOCK_PIXEL_POSITION);
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
      vi.mocked(hitTest.resolvePositionFromPixel).mockClear();

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

      // Hit-tested page 2 via getPage (never the whole tree).
      expect(getPage).toHaveBeenCalledWith(2);

      // resolvePositionFromPixel called with pageLocalY = 500 - 364 = 136,
      // clamped to page 2's own height (200) ⇒ 136 (not clamped to the
      // short default 100). Args: (state, tree, measurer, x, y, pageIndex).
      const call = vi.mocked(hitTest.resolvePositionFromPixel).mock.calls.at(-1)!;
      expect(call[5]).toBe(2); // pageIndex
      expect(call[4]).toBe(136); // pageLocalY clamped to the tall page's height

      ctrl.destroy();
      document.body.removeChild(container);
      vi.mocked(hitTest.resolvePositionFromPixel).mockReturnValue(
        hit(core.createPosition("mock-block" as core.BlockId, 0)),
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
      vi.mocked(hitTest.resolvePositionFromPixel).mockClear();

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
      const call = vi.mocked(hitTest.resolvePositionFromPixel).mock.calls.at(-1)!;
      expect(call[5]).toBe(2);
      expect(call[4]).toBe(191);

      ctrl.destroy();
      document.body.removeChild(container);
      vi.mocked(hitTest.resolvePositionFromPixel).mockReturnValue(
        hit(core.createPosition("mock-block" as core.BlockId, 0)),
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
      vi.mocked(selectionGeometry.computeSelectionRects).mockReturnValue([
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
      expect(lastCall[7]).toBe("hidden");

      ctrl.destroy();
      document.body.removeChild(container);
      vi.mocked(selectionGeometry.computeSelectionRects).mockReturnValue([]);
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
      expect(selectionGeometry.computeSelectionRects).toHaveBeenCalled();

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
      expect(lastCall[7]).toBe("active");

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
      expect(lastCall[7]).toBe("inactive");

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
      expect(lastCall[7]).toBe("active");

      // Blink resumes
      vi.mocked(canvasRenderer.paintCanvas).mockClear();
      vi.advanceTimersByTime(500);
      expect(canvasRenderer.paintCanvas).toHaveBeenCalled();

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("hides cursor on blur when selection is active", () => {
      vi.mocked(selectionGeometry.computeSelectionRects).mockReturnValue([
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
      expect(lastCall[7]).toBe("hidden");

      ctrl.destroy();
      document.body.removeChild(container);
      vi.mocked(selectionGeometry.computeSelectionRects).mockReturnValue([]);
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

      expect(hitTest.resolvePositionFromPixel).toHaveBeenCalled();
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
      vi.mocked(hitTest.resolvePositionFromPixel).mockReturnValueOnce(
        hit(core.createPosition(realParagraphId, 0)),
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

      // Shift-click. The hit-test must resolve into a block in the SAME
      // selection context as the current anchor (the seeded paragraph), or the
      // cross-context guard correctly skips the extension. The default mock
      // returns "mock-block" (not in state, hence a different/null context), so
      // pin this resolve to the real anchor block.
      const anchorBlockId = fakeEditorBase.selection.anchor.blockId;
      vi.mocked(hitTest.resolvePositionFromPixel).mockReturnValueOnce(
        hit(core.createPosition(anchorBlockId, 0)),
      );
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

      // The drag's mousedown (dragAnchor) and mousemove (focus) must resolve to
      // a REAL in-state block so both are in the same (non-null) selection
      // context — the cross-context guard skips any extension whose endpoint has
      // a null context (the default "mock-block" mock id isn't in state).
      const realDragPos = core.createPosition(
        fakeEditorBase.selection.focus.blockId,
        0,
      );
      vi.mocked(hitTest.resolvePositionFromPixel)
        .mockReturnValueOnce(hit(realDragPos))
        .mockReturnValueOnce(hit(realDragPos));

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

  // ── Cross-context pointer-selection guard (footnote slot crash) ────────────
  //
  // A document with a footnote has MULTIPLE selection contexts: the main body
  // tree and each footnote BODY (an embedContents subtree). A pointer
  // selection-EXTENSION (drag or shift-click) whose anchor is in one context
  // and whose hit-test resolves into ANOTHER context would build a
  // cross-context `Span`. Storing such a span crashes the next render:
  // `getActiveFormatting` runs `iterateSpan`, which THROWS
  // "anchor and focus are in different selection contexts". Google Docs
  // confines a pointer selection to the context it began in, so the controller
  // must skip the extension instead of dispatching the cross-context span.
  describe("cross-context pointer-selection guard (footnote slot)", () => {
    // Build a real EditorState with a footnote so there are two selection
    // contexts. Returns the editor state plus a main-body position and a
    // footnote-body position that live in DIFFERENT contexts.
    function makeFootnoteEditorState(): {
      editorState: core.EditorState;
      bodyPos: core.Position;
      footnotePos: core.Position;
    } {
      const config: core.EditorConfig = {
        componentRegistry: core.createDefaultComponentRegistry(),
        attrRegistry: core.createDefaultAttrRegistry(),
        containerWidth: 600,
      };
      const initial = core.createInitialEditorState(config);
      // Main-body paragraph (the seeded empty paragraph) — context A.
      const bodyBlockId = initial.selection.focus.blockId;
      const typed = core.reduceEditor(
        initial,
        { type: "INSERT_TEXT", text: "hello" },
        config,
      );
      // INSERT_FOOTNOTE drops the caret into the footnote body — context B.
      const withFn = core.reduceEditor(typed, { type: "INSERT_FOOTNOTE" }, config);
      const footnoteBlockId = withFn.selection.focus.blockId;
      // Sanity: the two ends are genuinely in different selection contexts.
      expect(core.selectionContextOf(withFn.state, bodyBlockId)).not.toBe(
        core.selectionContextOf(withFn.state, footnoteBlockId),
      );
      return {
        editorState: withFn,
        bodyPos: core.createPosition(bodyBlockId, 0),
        footnotePos: core.createPosition(footnoteBlockId, 0),
      };
    }

    function makeContainer(dispatch: ReturnType<typeof vi.fn>) {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions({ dispatch }));
      container.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: 0, right: 600, bottom: 100, width: 600, height: 100, x: 0, y: 0, toJSON: () => {},
      }));
      return { container, ctrl };
    }

    it("drag from body into footnote slot does NOT dispatch a cross-context span", () => {
      const { editorState, bodyPos, footnotePos } = makeFootnoteEditorState();
      const dispatch = vi.fn();
      const { container, ctrl } = makeContainer(dispatch);
      ctrl.update(editorState);

      // mousedown resolves into the BODY (context A) → drag anchor in body.
      vi.mocked(hitTest.resolvePositionFromPixel).mockReturnValueOnce(hit(bodyPos));
      container.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 10, clientY: 20, detail: 1, bubbles: true }),
      );
      dispatch.mockClear();

      // mousemove resolves into the FOOTNOTE body (context B). A 1px pointer
      // drift during a double-click fires this same path.
      vi.mocked(hitTest.resolvePositionFromPixel).mockReturnValueOnce(hit(footnotePos));
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 12, clientY: 20, bubbles: true }),
      );

      // The cross-context extension must be skipped: no SET_SELECTION dispatched.
      expect(dispatch).not.toHaveBeenCalled();

      // And the crash is genuinely prevented: feeding the WOULD-BE span (the
      // body anchor + footnote focus) to getActiveFormatting throws today —
      // that is exactly the render-path crash this guard avoids storing.
      const crossContextSpan = core.createSpan(bodyPos, footnotePos);
      expect(() =>
        core.getActiveFormatting(editorState.state, crossContextSpan),
      ).toThrow(/different selection contexts/);

      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("shift-click from body into footnote slot does NOT dispatch a cross-context span", () => {
      const { editorState, bodyPos, footnotePos } = makeFootnoteEditorState();
      const dispatch = vi.fn();
      const { container, ctrl } = makeContainer(dispatch);
      // Anchor the current selection in the BODY (context A).
      ctrl.update({
        ...editorState,
        selection: core.createSpan(bodyPos, bodyPos),
      });

      // shift-click resolves into the FOOTNOTE body (context B).
      vi.mocked(hitTest.resolvePositionFromPixel).mockReturnValueOnce(hit(footnotePos));
      container.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 50, clientY: 20, detail: 1, shiftKey: true, bubbles: true,
        }),
      );

      expect(dispatch).not.toHaveBeenCalled();

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("drag WITHIN the footnote slot still extends (same-context span allowed)", () => {
      const { editorState, footnotePos } = makeFootnoteEditorState();
      const dispatch = vi.fn();
      const { container, ctrl } = makeContainer(dispatch);
      ctrl.update(editorState);

      // mousedown AND mousemove both resolve into the footnote body (context B).
      vi.mocked(hitTest.resolvePositionFromPixel).mockReturnValueOnce(hit(footnotePos));
      container.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 10, clientY: 20, detail: 1, bubbles: true }),
      );
      dispatch.mockClear();

      vi.mocked(hitTest.resolvePositionFromPixel).mockReturnValueOnce(hit(footnotePos));
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 30, clientY: 20, bubbles: true }),
      );

      // Same-context extension is permitted → SET_SELECTION dispatched.
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_SELECTION" }),
      );

      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("shift-click onto a block that is in NO tree (null context) does NOT dispatch", () => {
      // Defensive: a hit-test position whose block is absent from every tree has
      // a null selection context. The guard treats null as a definitive skip
      // (`posCtx === null`), so it can never extend into an unknown context —
      // and two unknown contexts can never `null === null` false-pass into an
      // extension. Anchor is a real body block; the shift-click target is a
      // freshly-allocated id never inserted into the document.
      const { editorState, bodyPos } = makeFootnoteEditorState();
      const dispatch = vi.fn();
      const { container, ctrl } = makeContainer(dispatch);
      ctrl.update({
        ...editorState,
        selection: core.createSpan(bodyPos, bodyPos),
      });

      const ghostId = core.createTestAllocator().allocate();
      expect(core.selectionContextOf(editorState.state, ghostId)).toBeNull();
      vi.mocked(hitTest.resolvePositionFromPixel).mockReturnValueOnce(
        hit(core.createPosition(ghostId, 0)),
      );
      container.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 50, clientY: 20, detail: 1, shiftKey: true, bubbles: true,
        }),
      );

      expect(dispatch).not.toHaveBeenCalled();

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
      vi.mocked(hitTest.resolvePositionFromPixel).mockReturnValueOnce(
        hit(core.createPosition(realParagraphId, 0)),
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
      // Shift-click on page 1. Pin the hit-test to the real paragraph so the
      // extension stays IN-CONTEXT (the default "mock-block" mock is not in
      // state, so the cross-context guard would correctly skip it).
      vi.mocked(hitTest.resolvePositionFromPixel).mockReturnValueOnce(
        hit(core.createPosition(realParagraphId, 0)),
      );
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
      // Pin both drag-resolves to a REAL in-state block so the cross-context
      // guard permits the same-context extension (the default "mock-block" id is
      // not in state → null context → the guard would skip the drag). The page
      // hint still derives from the pixel→page mapping, not the block.
      const realDragPos = core.createPosition(
        fakeEditorBase.selection.focus.blockId,
        0,
      );
      vi.mocked(hitTest.resolvePositionFromPixel)
        .mockReturnValueOnce(hit(realDragPos))
        .mockReturnValueOnce(hit(realDragPos));
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

    it("single click dispatches SET_SELECTION carrying the hit-test caretAffinity seed (P4-C.2.2b)", () => {
      const { container, ctrl, dispatch } = makePaginatedContainer();
      const realParagraphId = fakeEditorBase.selection.focus.blockId;
      const { tree } = makeSpyVirtualTree(3, 600, 100, 24);
      ctrl.update(makeFakeEditorState({ layoutTree: tree }));
      dispatch.mockClear();
      // The hit-test resolves to a boundary offset on the clicked side → "before".
      // The click handler must forward that seed onto SET_SELECTION so the
      // dual-caret renders on the clicked side.
      vi.mocked(hitTest.resolvePositionFromPixel).mockReturnValueOnce({
        position: core.createPosition(realParagraphId, 3),
        caretAffinity: "before",
      });
      container.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 10, clientY: 10, detail: 1, bubbles: true }),
      );
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_SELECTION", caretAffinity: "before" }),
      );
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
      vi.mocked(cursorPosition.resolvePixelPosition).mockClear();
      ctrl.update(makeFakeEditorState({ layoutTree: tree, caretPageHint: 1 }));
      // The caret (focus) resolve is the first resolvePixelPosition call.
      const caretCall = vi.mocked(cursorPosition.resolvePixelPosition).mock.calls[0];
      if (caretCall === undefined) throw new Error("expected a resolvePixelPosition call");
      // Signature: (state, position, layoutTree, measurer, caretPageHint, caretAffinity).
      expect(caretCall[4]).toBe(1);
      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("threads state.caretAffinity into the CARET resolvePixelPosition call (P4-C.2.2b read-side)", () => {
      // Read-side companion to "single click ... carrying the hit-test
      // caretAffinity seed": the WRITE side stores affinity on SET_SELECTION, and
      // this asserts the controller forwards that stored affinity into the caret
      // resolve so the bidi dual-caret renders on the seeded side. Without the
      // 6th arg, resolvePixelPosition defaulted to "after" and the seed was inert.
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(
        container,
        makeOptions({ pageHeight: 100, pageGap: 24 }),
      );
      const { tree } = makeSpyVirtualTree(3, 600, 100, 24);
      vi.mocked(cursorPosition.resolvePixelPosition).mockClear();
      ctrl.update(makeFakeEditorState({ layoutTree: tree, caretAffinity: "before" }));
      // The caret (focus) resolve is the first resolvePixelPosition call; the 6th
      // arg is caretAffinity.
      const caretCall = vi.mocked(cursorPosition.resolvePixelPosition).mock.calls[0];
      if (caretCall === undefined) throw new Error("expected a resolvePixelPosition call");
      expect(caretCall[5]).toBe("before");
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
      vi.mocked(cursorPosition.resolvePixelPosition).mockClear();
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
      const calls = vi.mocked(cursorPosition.resolvePixelPosition).mock.calls;
      // 3 calls: caret(focus) + selStart + selEnd — all must carry the hint.
      expect(calls.length).toBe(3);
      const [call0, call1, call2] = calls;
      if (call0 === undefined || call1 === undefined || call2 === undefined) {
        throw new Error("expected three resolvePixelPosition calls");
      }
      expect(call0[4]).toBe(1); // caret
      expect(call1[4]).toBe(1); // selStart
      expect(call2[4]).toBe(1); // selEnd
      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("NO-REGRESSION: with no hint, resolvePixelPosition gets undefined (single-page body)", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const ctrl = createEditorController(container, makeOptions());
      vi.mocked(cursorPosition.resolvePixelPosition).mockClear();
      ctrl.update(makeFakeEditorState());
      const caretCall = vi.mocked(cursorPosition.resolvePixelPosition).mock.calls[0];
      if (caretCall === undefined) throw new Error("expected a resolvePixelPosition call");
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
      vi.mocked(cursorPosition.resolvePixelPosition).mockReturnValue(MOCK_PIXEL_POSITION);
    });

    it("cursor below the viewport scrolls down to a target derived from the slot's running-sum top (not pageIndex*(H+gap))", () => {
      // Scroll-parent fully at top (scrollTop 0), short viewport (clientHeight
      // 200), container flush with the scroll-parent (both rect tops 0).
      const { sp, ctrl } = makeScrollableController(
        { scrollTop: 0, clientHeight: 200, rectTop: 0 },
        0,
      );
      const { tree, offsets } = makeTallSectionTree();

      // Cursor on page 2, cursorPos.y = 20, height 16.
      vi.mocked(cursorPosition.resolvePixelPosition).mockReturnValue({
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
      const { sp, ctrl } = makeScrollableController(
        { scrollTop: 500, clientHeight: 200, rectTop: 0 },
        -500,
      );
      const { tree, offsets } = makeTallSectionTree();

      vi.mocked(cursorPosition.resolvePixelPosition).mockReturnValue({
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

      vi.mocked(cursorPosition.resolvePixelPosition).mockReturnValue({
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

  describe("IME composition + clipboard guards (controller audit)", () => {
    it("clears the composition flag on blur so input is not dead-locked (#1)", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const dispatch = vi.fn();
      const ctrl = createEditorController(container, makeOptions({ dispatch }));
      ctrl.update(makeFakeEditorState());
      const textarea = container.querySelector("textarea")! as HTMLTextAreaElement;

      // Compose, then blur BEFORE compositionend (the OS commits-and-blurs, or the
      // user clicks away mid-composition). Without the blur-clear, isComposing
      // stays true and gates handleInput/handleKeyDown forever (dead editor).
      textarea.dispatchEvent(new Event("compositionstart"));
      textarea.dispatchEvent(new Event("blur"));

      // Refocus + type: input must apply (not be silently swallowed).
      textarea.dispatchEvent(new Event("focus"));
      dispatch.mockClear();
      textarea.value = "x";
      textarea.dispatchEvent(new Event("input"));

      expect(dispatch).toHaveBeenCalledWith({ type: "INSERT_TEXT", text: "x" });

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("commits exactly once when compositionend fires THEN blur (Chrome sync order)", () => {
      // Chrome fires compositionend synchronously during blur: handleCompositionEnd
      // commits the text and clears isComposing, so handleBlur's ABANDON branch is
      // bypassed — the text must be dispatched exactly ONCE, never double-applied.
      const container = document.createElement("div");
      document.body.appendChild(container);
      const dispatch = vi.fn();
      const ctrl = createEditorController(container, makeOptions({ dispatch }));
      ctrl.update(makeFakeEditorState());
      const textarea = container.querySelector("textarea")! as HTMLTextAreaElement;

      textarea.dispatchEvent(new Event("compositionstart"));
      const end = new Event("compositionend") as CompositionEvent;
      Object.defineProperty(end, "data", { value: "x", configurable: true });
      textarea.dispatchEvent(end);
      textarea.dispatchEvent(new Event("blur"));

      const inserts = dispatch.mock.calls.filter(
        ([a]) => a?.type === "INSERT_TEXT" && a?.text === "x",
      );
      expect(inserts).toHaveLength(1);

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("ignores input fired while blurred (no stale-caret INSERT_TEXT) (#490)", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const dispatch = vi.fn();
      const ctrl = createEditorController(container, makeOptions({ dispatch }));
      ctrl.update(makeFakeEditorState());
      const textarea = container.querySelector("textarea")! as HTMLTextAreaElement;

      textarea.dispatchEvent(new Event("blur"));
      dispatch.mockClear();
      // A value-set + input while blurred must NOT dispatch (the engine's caret
      // points elsewhere) — and the buffer is cleared so it can't leak later.
      textarea.value = "stale";
      textarea.dispatchEvent(new Event("input"));

      expect(dispatch).not.toHaveBeenCalledWith({ type: "INSERT_TEXT", text: "stale" });
      expect(textarea.value).toBe("");

      ctrl.destroy();
      document.body.removeChild(container);
    });

    it("paste is a no-op before the first update() but STILL preventDefaults (#4)", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const dispatch = vi.fn();
      const ctrl = createEditorController(container, makeOptions({ dispatch }));
      const textarea = container.querySelector("textarea")! as HTMLTextAreaElement;

      // No `update()` yet ⇒ state === null. A paste must (a) NOT dispatch PASTE and
      // (b) STILL preventDefault — otherwise the browser pastes into the hidden
      // textarea and the text leaks back in via handleInput as INSERT_TEXT.
      const e = new Event("paste", { cancelable: true }) as ClipboardEvent;
      Object.defineProperty(e, "clipboardData", {
        value: { getData: () => "hello" },
        configurable: true,
      });
      textarea.dispatchEvent(e);

      expect(dispatch).not.toHaveBeenCalledWith({ type: "PASTE", text: "hello" });
      expect(e.defaultPrevented).toBe(true);

      ctrl.destroy();
      document.body.removeChild(container);
    });
  });

  describe("accessibility mirror (slice 2b, default-off flag)", () => {
    it("mounts a mirror reflecting document text and marks the canvas aria-hidden when accessibilityMirror is on", () => {
      const container = document.createElement("div");
      const controller = createEditorController(
        container,
        makeOptions({ accessibilityMirror: true }),
      );
      controller.update(makeSeededEditorState());

      const mirror = container.querySelector("[data-taleweaver-a11y-mirror]");
      expect(mirror).not.toBeNull();
      expect(mirror?.textContent).toContain("Hello");

      const canvas = container.querySelector("canvas");
      expect(canvas?.getAttribute("aria-hidden")).toBe("true");

      // The mirror is the SOLE focus/tab host: the textarea is pulled out of the
      // tab order so a Tab key can't land on it and route input to a non-AT element.
      const textarea = container.querySelector("textarea");
      expect(textarea?.tabIndex).toBe(-1);

      controller.destroy();
    });

    it("does not mount a mirror and leaves the canvas AT-visible when the flag is off", () => {
      const container = document.createElement("div");
      const controller = createEditorController(
        container,
        makeOptions({ accessibilityMirror: false }),
      );
      controller.update(makeSeededEditorState());

      expect(
        container.querySelector("[data-taleweaver-a11y-mirror]"),
      ).toBeNull();
      const canvas = container.querySelector("canvas");
      expect(canvas?.getAttribute("aria-hidden")).toBeNull();
      // Default path untouched: the textarea is the focus/tab host (tabIndex 0).
      const textarea = container.querySelector("textarea");
      expect(textarea?.tabIndex).toBe(0);

      controller.destroy();
    });

    it("does NOT re-dispatch SET_SELECTION when a selectionchange matches the current engine selection (idempotency loop-break)", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const actions: Array<{ type: string }> = [];
      const controller = createEditorController(
        container,
        makeOptions({
          accessibilityMirror: true,
          dispatch: (a) => actions.push(a),
        }),
      );
      // The seeded state's selection is a collapsed caret at the end of "Hello".
      // syncSelection placed that selection into the mirror DOM; a subsequent
      // selectionchange reads back the SAME span, so the controller's idempotency
      // check must suppress the SET_SELECTION re-dispatch (the loop-break).
      controller.update(makeSeededEditorState());
      actions.length = 0;

      document.dispatchEvent(new Event("selectionchange"));

      expect(actions.filter((a) => a.type === "SET_SELECTION")).toEqual([]);

      controller.destroy();
      document.body.removeChild(container);
    });

    // #513: page-field / cross-ref-page resolved-text injection. The controller
    // must forward the virtual layout tree's `globalFieldValues` as `syncTree`'s
    // `resolvedFields` arg, so the host can substitute resolved page text into the
    // mirror. On the non-virtual `LayoutBox` path it forwards an EMPTY map.
    it("forwards the virtual tree's globalFieldValues to syncTree (empty map on the non-virtual path)", () => {
      mirrorSyncTreeCalls.length = 0;
      const container = document.createElement("div");
      const ctrl = createEditorController(
        container,
        makeOptions({ accessibilityMirror: true, pageHeight: 100, pageGap: 24 }),
      );

      // Virtual-root path: a spy tree carrying a known resolved-field map.
      const { tree } = makeSpyVirtualTree(3, 600, 100, 24);
      const fields = new Map<string, string>([["b/inline/1", "2"]]);
      const virtualTree = { ...tree, globalFieldValues: fields };
      ctrl.update(makeFakeEditorState({ layoutTree: virtualTree }));

      const lastVirtual = nth(
        mirrorSyncTreeCalls,
        mirrorSyncTreeCalls.length - 1,
        "syncTree call",
      );
      expect(lastVirtual.resolvedFields).toBe(fields);

      // Non-virtual `LayoutBox` path: the controller forwards an EMPTY map.
      mirrorSyncTreeCalls.length = 0;
      ctrl.update(makeFakeEditorState());
      const lastNonVirtual = nth(
        mirrorSyncTreeCalls,
        mirrorSyncTreeCalls.length - 1,
        "syncTree call",
      );
      expect(lastNonVirtual.resolvedFields).toBeInstanceOf(Map);
      expect(lastNonVirtual.resolvedFields?.size).toBe(0);

      ctrl.destroy();
    });
  });
});

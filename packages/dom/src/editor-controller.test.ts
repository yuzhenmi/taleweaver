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

/** Build a paginated layout tree with `pageCount` pages, each `pageHeight` tall. */
function buildPaginatedLayoutTree(
  pageCount: number,
  width: number,
  pageHeight: number,
): core.LayoutBox {
  const cs = core.INITIAL_COMPUTED_STYLE;
  const us = core.computeUsedStyle(cs, width, "indefinite");
  const pages: core.LayoutBox[] = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push(
      core.createPageBox(
        `page-${i}`,
        0,
        i * pageHeight,
        width,
        pageHeight,
        cs.writingMode,
        cs.direction,
        cs,
        us,
        [],
        i,
        width,
      ),
    );
  }
  return core.createBlockBox(
    "doc",
    0,
    0,
    width,
    pageCount * pageHeight,
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

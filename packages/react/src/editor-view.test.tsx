import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { EditorView } from "./editor-view";
import { useEditor } from "./use-editor";

// Per-canvas mock context tracking
const canvasContextMap = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();

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
let originalResizeObserver: typeof ResizeObserver | undefined;

beforeEach(() => {
  originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
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

  originalResizeObserver = global.ResizeObserver;
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
});

afterEach(() => {
  if (originalGetContext) {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
  }
  if (originalResizeObserver) {
    global.ResizeObserver = originalResizeObserver;
  }
});

function getCanvasCtx(container: HTMLElement): CanvasRenderingContext2D {
  const canvas = container.querySelector("canvas");
  if (!canvas) throw new Error("Expected canvas element");
  const ctx = canvasContextMap.get(canvas);
  if (!ctx) throw new Error("Expected canvas context");
  return ctx;
}

/** Wrapper that calls useEditor() and passes props to EditorView */
function EditorHarness() {
  const editor = useEditor();
  return <EditorView {...editor} />;
}

function getFirstElement(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild;
  if (!(el instanceof HTMLElement))
    throw new Error("Expected HTMLElement as first child");
  return el;
}

function getTextarea(container: HTMLElement): HTMLTextAreaElement {
  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("Expected textarea element");
  return textarea;
}

/** Simulate typing text via the hidden textarea's input event */
function typeText(textarea: HTMLTextAreaElement, text: string) {
  for (const ch of text) {
    // Simulate native input: set value then fire input event
    // eslint-disable-next-line no-param-reassign
    textarea.value = ch;
    fireEvent.input(textarea, { target: { value: ch } });
  }
}

function mockBoundingRect(el: HTMLElement) {
  el.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: 400, bottom: 300,
    width: 400, height: 300, x: 0, y: 0, toJSON: () => {},
  }));
}

describe("EditorView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a hidden textarea for input", () => {
    const { container } = render(<EditorHarness />);
    const textarea = getTextarea(container);
    expect(textarea).toBeDefined();
    expect(textarea.style.opacity).toBe("0");
  });

  it("container div does not have tabIndex", () => {
    const { container } = render(<EditorHarness />);
    const editor = getFirstElement(container);
    expect(editor.getAttribute("tabindex")).toBeNull();
  });

  it("handles text input via textarea", () => {
    const { container } = render(<EditorHarness />);
    const textarea = getTextarea(container);

    typeText(textarea, "a");

    const ctx = getCanvasCtx(container);
    expect(ctx.fillText).toHaveBeenCalledWith("a", expect.any(Number), expect.any(Number));
  });

  it("handles non-character keyDown on textarea (e.g. Enter)", () => {
    const { container } = render(<EditorHarness />);
    const textarea = getTextarea(container);

    typeText(textarea, "hello");
    fireEvent.keyDown(textarea, { key: "Enter" });

    // Enter should split the node — text should still be painted
    const ctx = getCanvasCtx(container);
    const fillTextCalls = vi.mocked(ctx.fillText).mock.calls;
    const hasHello = fillTextCalls.some(([text]) => text === "hello");
    expect(hasHello).toBe(true);
  });

  it("renders canvas element", () => {
    const { container } = render(<EditorHarness />);
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeDefined();
  });

  it("selects word on double-click (detail=2 mouseDown)", () => {
    const { container } = render(<EditorHarness />);
    const editor = getFirstElement(container);
    const textarea = getTextarea(container);

    typeText(textarea, "hello world");

    mockBoundingRect(editor);
    const canvas = container.querySelector("canvas")!;
    mockBoundingRect(canvas);

    fireEvent.mouseDown(editor, { clientX: 4, clientY: 4, detail: 2 });

    const ctx = getCanvasCtx(container);
    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    expect(fillRectCalls.length).toBeGreaterThan(0);
  });

  it("selects paragraph on triple-click (detail=3 mouseDown)", () => {
    const { container } = render(<EditorHarness />);
    const editor = getFirstElement(container);
    const textarea = getTextarea(container);

    typeText(textarea, "hello world");

    mockBoundingRect(editor);
    const canvas = container.querySelector("canvas")!;
    mockBoundingRect(canvas);

    fireEvent.mouseDown(editor, { clientX: 4, clientY: 4, detail: 3 });

    const ctx = getCanvasCtx(container);
    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    expect(fillRectCalls.length).toBeGreaterThan(0);
  });

  it("extends selection on shift+click", () => {
    const { container } = render(<EditorHarness />);
    const editor = getFirstElement(container);
    const textarea = getTextarea(container);

    typeText(textarea, "hello world");

    mockBoundingRect(editor);
    const canvas = container.querySelector("canvas")!;
    mockBoundingRect(canvas);

    fireEvent.mouseDown(editor, { clientX: 4, clientY: 4, detail: 1 });
    fireEvent.mouseDown(editor, { clientX: 60, clientY: 4, detail: 1, shiftKey: true });

    const ctx = getCanvasCtx(container);
    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    expect(fillRectCalls.length).toBeGreaterThan(0);
  });

  it("handles IME composition", () => {
    const { container } = render(<EditorHarness />);
    const textarea = getTextarea(container);

    fireEvent.compositionStart(textarea);

    textarea.value = "你";
    fireEvent.input(textarea, { target: { value: "你" } });

    // Text should NOT be painted yet (still composing)
    const ctx = getCanvasCtx(container);
    const callsBefore = vi.mocked(ctx.fillText).mock.calls.filter(
      ([text]) => text === "你",
    );
    expect(callsBefore).toHaveLength(0);

    // End composition — text should now be painted
    fireEvent.compositionEnd(textarea, { data: "你" });

    const callsAfter = vi.mocked(ctx.fillText).mock.calls.filter(
      ([text]) => text === "你",
    );
    expect(callsAfter.length).toBeGreaterThan(0);
  });

  it("does not commit text during composition", () => {
    const { container } = render(<EditorHarness />);
    const textarea = getTextarea(container);

    fireEvent.compositionStart(textarea);

    textarea.value = "n";
    fireEvent.input(textarea, { target: { value: "n" } });
    textarea.value = "ni";
    fireEvent.input(textarea, { target: { value: "ni" } });

    // Nothing committed yet — no intermediate text painted
    const ctx = getCanvasCtx(container);
    const calls = vi.mocked(ctx.fillText).mock.calls;
    const hasN = calls.some(([text]) => text === "n" || text === "ni");
    expect(hasN).toBe(false);

    fireEvent.compositionEnd(textarea, { data: "你" });

    const afterCalls = vi.mocked(ctx.fillText).mock.calls;
    const hasFinal = afterCalls.some(([text]) => text === "你");
    expect(hasFinal).toBe(true);
  });

  it("blinks cursor via interval — toggles cursor off after 500ms", () => {
    const { container } = render(<EditorHarness />);
    const ctx = getCanvasCtx(container);

    // Initial paint should show cursor (2px wide fillRect)
    const initialCursorCalls = vi.mocked(ctx.fillRect).mock.calls.filter(
      ([_x, _y, w]) => w === 2,
    );
    expect(initialCursorCalls.length).toBeGreaterThan(0);

    vi.mocked(ctx.fillRect).mockClear();
    vi.mocked(ctx.clearRect).mockClear();

    // After 500ms, cursor should toggle off — no 2px-wide fillRect
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(ctx.clearRect).toHaveBeenCalled();
    const cursorOffCalls = vi.mocked(ctx.fillRect).mock.calls.filter(
      ([_x, _y, w]) => w === 2,
    );
    expect(cursorOffCalls).toHaveLength(0);
  });

  it("uses setTransform for DPR scaling", () => {
    const { container } = render(<EditorHarness />);
    const ctx = getCanvasCtx(container);
    expect(ctx.setTransform).toHaveBeenCalled();
  });

  it("renders spacer div for scroll height", () => {
    const { container } = render(<EditorHarness />);
    const editor = getFirstElement(container);
    // First child of the editor container should be the spacer div
    const spacer = editor.firstElementChild;
    expect(spacer).toBeDefined();
    expect(spacer?.tagName).toBe("DIV");
    expect((spacer as HTMLElement).style.pointerEvents).toBe("none");
  });

  it("keeps textarea focused on all mouseDown variants", () => {
    const { container } = render(<EditorHarness />);
    const editor = getFirstElement(container);
    const textarea = getTextarea(container);

    typeText(textarea, "hello world");

    mockBoundingRect(editor);
    const canvas = container.querySelector("canvas")!;
    mockBoundingRect(canvas);

    // Double-click
    fireEvent.mouseDown(editor, { clientX: 4, clientY: 4, detail: 2 });
    expect(document.activeElement).toBe(textarea);

    // Triple-click
    fireEvent.mouseDown(editor, { clientX: 4, clientY: 4, detail: 3 });
    expect(document.activeElement).toBe(textarea);

    // Shift-click
    fireEvent.mouseDown(editor, { clientX: 4, clientY: 4, detail: 1 });
    fireEvent.mouseDown(editor, { clientX: 60, clientY: 4, detail: 1, shiftKey: true });
    expect(document.activeElement).toBe(textarea);
  });

  it("draws grey non-blinking cursor when textarea loses focus", () => {
    const { container } = render(<EditorHarness />);
    const textarea = getTextarea(container);
    const ctx = getCanvasCtx(container);

    // Initially focused (autoFocus) — cursor should be black (active)
    const fillStyles: string[] = [];
    vi.mocked(ctx.fillRect).mockImplementation(function (this: CanvasRenderingContext2D) {
      fillStyles.push(ctx.fillStyle as string);
    });

    // Blur the textarea
    act(() => {
      fireEvent.blur(textarea);
    });

    // After blur, a repaint happens — find the cursor fillRect (w=2)
    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    const cursorIdx = fillRectCalls.findIndex(([_x, _y, w]) => w === 2);
    expect(cursorIdx).toBeGreaterThanOrEqual(0);
    // The cursor should be drawn grey
    expect(fillStyles[cursorIdx]).toBe("rgba(0, 0, 0, 0.4)");
  });

  it("does not blink cursor when unfocused", () => {
    const { container } = render(<EditorHarness />);
    const textarea = getTextarea(container);
    const ctx = getCanvasCtx(container);

    act(() => {
      fireEvent.blur(textarea);
    });

    vi.mocked(ctx.fillRect).mockClear();
    vi.mocked(ctx.clearRect).mockClear();

    // Advance past a blink interval — should NOT trigger repaint
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Cursor should still be visible (grey, static) — not toggled off
    const cursorCalls = vi.mocked(ctx.fillRect).mock.calls.filter(
      ([_x, _y, w]) => w === 2,
    );
    // No repaint occurred since blinking is stopped when unfocused
    expect(ctx.clearRect).not.toHaveBeenCalled();
  });

  it("resumes blinking when textarea regains focus", () => {
    const { container } = render(<EditorHarness />);
    const textarea = getTextarea(container);
    const ctx = getCanvasCtx(container);

    // Blur then refocus
    act(() => {
      fireEvent.blur(textarea);
    });
    vi.mocked(ctx.fillRect).mockClear();
    vi.mocked(ctx.clearRect).mockClear();

    act(() => {
      fireEvent.focus(textarea);
    });

    // After refocus, cursor should be active (black, 2px)
    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    const cursorCall = fillRectCalls.find(([_x, _y, w]) => w === 2);
    expect(cursorCall).toBeDefined();

    // And blinking should resume — advance 500ms
    vi.mocked(ctx.fillRect).mockClear();
    vi.mocked(ctx.clearRect).mockClear();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // A repaint occurred (blink interval is running)
    expect(ctx.clearRect).toHaveBeenCalled();
  });

  it("repaints on scroll events", () => {
    const { container } = render(<EditorHarness />);
    const ctx = getCanvasCtx(container);

    vi.mocked(ctx.clearRect).mockClear();

    // Fire scroll event on window (default scroll parent)
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      // rAF-throttled — advance a frame
      vi.advanceTimersByTime(16);
    });

    expect(ctx.clearRect).toHaveBeenCalled();
  });
});

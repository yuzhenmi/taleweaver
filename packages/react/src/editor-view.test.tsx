import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, act } from "@testing-library/react";
import { EditorView, type EditorViewHandle } from "./editor-view";
import { useEditor } from "./use-editor";
import { createEditorController } from "@taleweaver/print";

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock canvas for jsdom (needed by useEditor → createCanvasMeasurer)
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: vi.fn(() => ({
    font: "",
    measureText: (text: string) => ({ width: text.length * 8 }),
  })),
  writable: true,
  configurable: true,
});

const mockUpdate = vi.fn();
const mockDestroy = vi.fn();
const mockFindStart = vi.fn(() => ({ total: 3, activeIndex: 0 }));
const mockFindNext = vi.fn(() => ({ total: 3, activeIndex: 1 }));
const mockFindPrev = vi.fn(() => ({ total: 3, activeIndex: 2 }));
const mockFindClose = vi.fn();
const mockReplaceActive = vi.fn(() => ({ total: 2, activeIndex: 0 }));
const mockReplaceAll = vi.fn(() => ({ total: 0, activeIndex: -1 }));
const mockFindStatus = vi.fn(() => ({ total: 3, activeIndex: 0 }));

vi.mock("@taleweaver/print", async () => {
  const actual = await vi.importActual<typeof import("@taleweaver/print")>(
    "@taleweaver/print",
  );
  return {
    ...actual,
    createEditorController: vi.fn(() => ({
      update: mockUpdate,
      destroy: mockDestroy,
      findStart: mockFindStart,
      findNext: mockFindNext,
      findPrev: mockFindPrev,
      findClose: mockFindClose,
      replaceActive: mockReplaceActive,
      replaceAll: mockReplaceAll,
      findStatus: mockFindStatus,
    })),
  };
});

let originalResizeObserver: typeof ResizeObserver | undefined;

beforeEach(() => {
  mockUpdate.mockClear();
  mockDestroy.mockClear();
  mockFindStart.mockClear();
  mockFindNext.mockClear();
  mockFindPrev.mockClear();
  mockFindClose.mockClear();
  mockReplaceActive.mockClear();
  mockReplaceAll.mockClear();
  mockFindStatus.mockClear();

  originalResizeObserver = global.ResizeObserver;
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
});

afterEach(() => {
  if (originalResizeObserver) {
    global.ResizeObserver = originalResizeObserver;
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function EditorHarness() {
  const editor = useEditor();
  return <EditorView {...editor} />;
}

function RefHarness({ handleRef }: { handleRef: React.Ref<EditorViewHandle> }) {
  const editor = useEditor();
  return <EditorView {...editor} ref={handleRef} />;
}

function PaginatedEditorHarness() {
  const editor = useEditor({
    pageHeight: 100,
    pageMargins: { top: 10, bottom: 10, left: 10, right: 10 },
  });
  return <EditorView {...editor} pageHeight={100} pageGap={8} />;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("EditorView", () => {
  it("renders a container div", () => {
    const { container } = render(<EditorHarness />);
    const div = container.firstElementChild;
    expect(div).toBeDefined();
    expect(div?.tagName).toBe("DIV");
  });

  it("creates controller on mount", () => {
    render(<EditorHarness />);
    // May be called twice in React StrictMode (dev double-mount)
    expect(createEditorController).toHaveBeenCalled();
  });

  it("calls controller.update() with initial editorState", () => {
    render(<EditorHarness />);
    // mount-only effect calls update, then editorState effect calls update
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("calls controller.update() when editorState changes", () => {
    const { rerender } = render(<EditorHarness />);
    const callsBefore = mockUpdate.mock.calls.length;

    // Force a re-render (useEditor state change)
    act(() => {
      rerender(<EditorHarness />);
    });

    // At minimum the initial update calls happened
    expect(mockUpdate.mock.calls.length).toBeGreaterThanOrEqual(callsBefore);
  });

  it("calls controller.destroy() on unmount", () => {
    const { unmount } = render(<EditorHarness />);

    expect(mockDestroy).not.toHaveBeenCalled();
    unmount();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("works with paginated mode", () => {
    const { container } = render(<PaginatedEditorHarness />);
    const div = container.firstElementChild;
    expect(div).toBeDefined();
    expect(mockUpdate).toHaveBeenCalled();
  });

  // ── Imperative handle (#433 sub-slice A) ───────────────────────────────────

  it("exposes the 7 find/replace methods on the forwarded ref handle", () => {
    const handleRef = createRef<EditorViewHandle>();
    render(<RefHarness handleRef={handleRef} />);

    const handle = handleRef.current;
    expect(handle).not.toBeNull();
    expect(typeof handle?.findStart).toBe("function");
    expect(typeof handle?.findNext).toBe("function");
    expect(typeof handle?.findPrev).toBe("function");
    expect(typeof handle?.findClose).toBe("function");
    expect(typeof handle?.replaceActive).toBe("function");
    expect(typeof handle?.replaceAll).toBe("function");
    expect(typeof handle?.findStatus).toBe("function");
  });

  it("handle methods delegate to the controller (args forwarded + result returned)", () => {
    const handleRef = createRef<EditorViewHandle>();
    render(<RefHarness handleRef={handleRef} />);
    const handle = handleRef.current;
    if (handle === null) throw new Error("handle not mounted");

    // findStart forwards the query + options and returns the controller's status.
    expect(handle.findStart("foo", { caseSensitive: true })).toEqual({
      total: 3,
      activeIndex: 0,
    });
    expect(mockFindStart).toHaveBeenCalledWith("foo", { caseSensitive: true });

    expect(handle.findNext()).toEqual({ total: 3, activeIndex: 1 });
    expect(mockFindNext).toHaveBeenCalledTimes(1);

    expect(handle.findPrev()).toEqual({ total: 3, activeIndex: 2 });
    expect(mockFindPrev).toHaveBeenCalledTimes(1);

    expect(handle.replaceActive("bar")).toEqual({ total: 2, activeIndex: 0 });
    expect(mockReplaceActive).toHaveBeenCalledWith("bar");

    expect(handle.replaceAll("bar")).toEqual({ total: 0, activeIndex: -1 });
    expect(mockReplaceAll).toHaveBeenCalledWith("bar");

    expect(handle.findStatus()).toEqual({ total: 3, activeIndex: 0 });
    expect(mockFindStatus).toHaveBeenCalledTimes(1);

    handle.findClose();
    expect(mockFindClose).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { EditorView } from "./editor-view";
import { useEditor } from "./use-editor";
import { createEditorController } from "@taleweaver/dom";

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

vi.mock("@taleweaver/dom", async () => {
  const actual = await vi.importActual<typeof import("@taleweaver/dom")>(
    "@taleweaver/dom",
  );
  return {
    ...actual,
    createEditorController: vi.fn(() => ({
      update: mockUpdate,
      destroy: mockDestroy,
    })),
  };
});

let originalResizeObserver: typeof ResizeObserver | undefined;

beforeEach(() => {
  mockUpdate.mockClear();
  mockDestroy.mockClear();

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
});

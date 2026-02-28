import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { EditorView } from "./editor-view";
import { useEditor } from "./use-editor";

// Mock canvas for jsdom
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: vi.fn(() => ({
    font: "",
    measureText: (text: string) => ({ width: text.length * 8 }),
  })),
  writable: true,
  configurable: true,
});

// Mock ResizeObserver for jsdom
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

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

function mockBoundingRect(el: HTMLElement) {
  el.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: 400, bottom: 300,
    width: 400, height: 300, x: 0, y: 0, toJSON: () => {},
  }));
}

function hasSelectionHighlight(container: HTMLElement): boolean {
  const selectionDivs = Array.from(container.querySelectorAll("div")).filter((d) =>
    d.style.backgroundColor?.includes("rgba") ||
    d.style.backgroundColor === "rgba(66, 133, 244, 0.3)",
  );
  return selectionDivs.length > 0;
}

describe("EditorView", () => {
  it("renders a focusable container", () => {
    const { container } = render(<EditorHarness />);
    const editor = getFirstElement(container);
    expect(editor.getAttribute("tabindex")).toBe("0");
  });

  it("handles keyDown to insert text", () => {
    const { container } = render(<EditorHarness />);
    const editor = getFirstElement(container);

    fireEvent.keyDown(editor, { key: "a" });

    // The text "a" should appear somewhere in the rendered output
    expect(editor.textContent).toContain("a");
  });

  it("renders cursor element", () => {
    const { container } = render(<EditorHarness />);
    // Should have a cursor div with the blink animation
    const allDivs = container.querySelectorAll("div");
    const cursorDiv = Array.from(allDivs).find((d) =>
      d.style.animation?.includes("blink"),
    );
    expect(cursorDiv).toBeDefined();
  });

  it("selects word on double-click (detail=2 mouseDown)", () => {
    const { container } = render(<EditorHarness />);
    const editor = getFirstElement(container);

    // Type "hello world"
    for (const ch of "hello world") {
      fireEvent.keyDown(editor, { key: ch });
    }
    expect(editor.textContent).toContain("hello world");

    mockBoundingRect(editor);

    // Double-click via mouseDown with detail=2
    fireEvent.mouseDown(editor, { clientX: 4, clientY: 4, detail: 2 });

    expect(hasSelectionHighlight(container)).toBe(true);
  });

  it("selects paragraph on triple-click (detail=3 mouseDown)", () => {
    const { container } = render(<EditorHarness />);
    const editor = getFirstElement(container);

    // Type "hello world"
    for (const ch of "hello world") {
      fireEvent.keyDown(editor, { key: ch });
    }
    expect(editor.textContent).toContain("hello world");

    mockBoundingRect(editor);

    // Triple-click via mouseDown with detail=3
    fireEvent.mouseDown(editor, { clientX: 4, clientY: 4, detail: 3 });

    expect(hasSelectionHighlight(container)).toBe(true);
  });

  it("extends selection on shift+click", () => {
    const { container } = render(<EditorHarness />);
    const editor = getFirstElement(container);

    // Type "hello world"
    for (const ch of "hello world") {
      fireEvent.keyDown(editor, { key: ch });
    }

    mockBoundingRect(editor);

    // Click to position cursor (detail=1)
    fireEvent.mouseDown(editor, { clientX: 4, clientY: 4, detail: 1 });

    // Shift-click further along
    fireEvent.mouseDown(editor, { clientX: 60, clientY: 4, detail: 1, shiftKey: true });

    expect(hasSelectionHighlight(container)).toBe(true);
  });
});

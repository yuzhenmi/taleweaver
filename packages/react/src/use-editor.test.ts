import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditor } from "./use-editor";
import { getBlock } from "@taleweaver/core";

// Mock canvas for jsdom
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: vi.fn(() => ({
    font: "",
    measureText: (text: string) => ({ width: text.length * 8 }),
  })),
  writable: true,
  configurable: true,
});

describe("useEditor", () => {
  it("returns editorState with initial document", () => {
    const { result } = renderHook(() => useEditor());
    const document = result.current.editorState.document;
    const rootBlock = getBlock(document, document.rootId);
    expect(rootBlock).not.toBeNull();
    expect(rootBlock?.type).toBe("document");
  });

  it("returns dispatch function", () => {
    const { result } = renderHook(() => useEditor());
    expect(typeof result.current.dispatch).toBe("function");
  });

  it("returns containerRef", () => {
    const { result } = renderHook(() => useEditor());
    expect(result.current.containerRef).toBeDefined();
  });

  it("dispatch INSERT_TEXT updates state", () => {
    const { result } = renderHook(() => useEditor());
    act(() => {
      result.current.dispatch({ type: "INSERT_TEXT", text: "a" });
    });
    // After INSERT_TEXT "a", the first leaf paragraph block carries the text.
    const document = result.current.editorState.document;
    const focusBlockId = result.current.editorState.selection.focus.blockId;
    const block = getBlock(document, focusBlockId);
    expect(block).not.toBeNull();
    const inline = block?.inlineContent;
    expect(inline?.items.length).toBeGreaterThan(0);
    const firstItem = inline?.items[0];
    expect(firstItem?.kind).toBe("text");
    if (firstItem?.kind === "text") {
      expect(firstItem.text).toBe("a");
    }
  });
});

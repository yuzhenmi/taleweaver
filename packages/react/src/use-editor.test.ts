import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
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

describe("useEditor", () => {
  it("returns editorState with initial document", () => {
    const { result } = renderHook(() => useEditor());
    expect(result.current.editorState.state.type).toBe("document");
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
    const textNode =
      result.current.editorState.state.children[0].children[0];
    expect(textNode.properties.content).toBe("a");
  });

  it("dispatch INSERT_BLOCK inserts image without crashing", () => {
    const { result } = renderHook(() => useEditor());
    act(() => {
      result.current.dispatch({ type: "INSERT_TEXT", text: "hello" });
    });
    act(() => {
      result.current.dispatch({
        type: "INSERT_BLOCK",
        blockType: "image",
        properties: { src: "data:image/png;base64,abc", width: 200, height: 100 },
      });
    });
    expect(result.current.editorState.state.children).toHaveLength(3);
    expect(result.current.editorState.state.children[1].type).toBe("image");
  });

  it("dispatch INSERT_BLOCK inserts horizontal-line without crashing", () => {
    const { result } = renderHook(() => useEditor());
    act(() => {
      result.current.dispatch({ type: "INSERT_TEXT", text: "hello" });
    });
    act(() => {
      result.current.dispatch({
        type: "INSERT_BLOCK",
        blockType: "horizontal-line",
      });
    });
    expect(result.current.editorState.state.children).toHaveLength(3);
    expect(result.current.editorState.state.children[1].type).toBe("horizontal-line");
  });
});

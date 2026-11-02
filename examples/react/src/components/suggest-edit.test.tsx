// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createEditor, createDefaultComponentRegistry, createDefaultAttrRegistry, type Document } from "@taleweaver/core";
import { useSuggestEdit, type Propose } from "./suggest-edit";

afterEach(() => {
  vi.useRealTimers();
});

describe("useSuggestEdit", () => {
  it("proposes against the version it drafted from, though the user typed meanwhile", async () => {
    vi.useFakeTimers();
    const editor = createEditor({ componentRegistry: createDefaultComponentRegistry(), attrRegistry: createDefaultAttrRegistry(), containerWidth: 800 });
    editor.dispatch({ type: "INSERT_TEXT", text: "a very  big day" });
    const drafted = editor.document;
    let basedOn: Document | undefined;
    const propose: Propose = (_proposal, options) => {
      basedOn = options?.basedOn;
      return Promise.resolve({ ok: true });
    };
    const { result, unmount } = renderHook(() => useSuggestEdit(editor, propose));
    act(() => result.current.run());
    editor.dispatch({ type: "INSERT_TEXT", text: "!" });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(basedOn).toBe(drafted);
    unmount();
  });
});

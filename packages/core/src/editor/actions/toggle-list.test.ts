/**
 * Regression: T11's cross-kind guard on setBlockType caused
 * handleToggleList to throw at runtime when the user converted a
 * paragraph to a list-item (paragraph and list-item must be the same
 * kind for setBlockType to accept the transition). The fix reclassifies
 * list-item as an inline-bearing leaf so the same-kind transition is
 * permitted. These tests pin the round-trip via the public reducer so
 * future kind-system changes can't silently break the toolbar handler.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  createInitialEditorState,
  reduceEditor,
  firstChildId,
} from "./test-helpers";
import { getBlock } from "../../state/state";
import type { BlockId } from "../../state/block-id";

describe("handleToggleList — paragraph ⇄ list-item round-trip (regression #155)", () => {
  it("converts a paragraph to a list-item without throwing", () => {
    const initial = createInitialEditorState(config);
    const paraId = firstChildId(initial.state) as BlockId;
    expect(getBlock(initial.state, paraId)?.type).toBe("paragraph");

    const next = reduceEditor(
      initial,
      { type: "TOGGLE_LIST", listType: "unordered" },
      config,
    );

    const block = getBlock(next.state, paraId);
    expect(block?.type).toBe("list-item");
    expect(block?.attrs).toEqual({ listType: "unordered" });
  });

  it("toggles a list-item back to a paragraph on a second invocation", () => {
    let s = createInitialEditorState(config);
    const paraId = firstChildId(s.state) as BlockId;
    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "ordered" }, config);
    expect(getBlock(s.state, paraId)?.type).toBe("list-item");

    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "ordered" }, config);
    expect(getBlock(s.state, paraId)?.type).toBe("paragraph");
    expect(getBlock(s.state, paraId)?.attrs).toEqual({});
  });

  it("preserves the block id and its inlineContent across the toggle", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "hello" }, config);
    const paraId = firstChildId(s.state) as BlockId;
    const before = getBlock(s.state, paraId);
    expect(before?.inlineContent?.items[0]).toMatchObject({
      kind: "text",
      text: "hello",
    });

    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    const after = getBlock(s.state, paraId);
    expect(after?.id).toBe(paraId);
    expect(after?.type).toBe("list-item");
    expect(after?.inlineContent?.items[0]).toMatchObject({
      kind: "text",
      text: "hello",
    });
  });
});

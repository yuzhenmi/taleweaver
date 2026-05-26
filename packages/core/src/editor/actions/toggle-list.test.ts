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
import type { EditorState } from "../editor-state";
import { getBlock, createHistory } from "../../state";
import type { BlockId } from "../../state";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";
import { render } from "../../render/render";
import { cascadePass } from "../../cascade";
import { layoutTree } from "../../layout/dispatch";

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

  // E-A13 / 2026-05-23 audit: cursor inside a nested list-item should
  // toggle the LIST-ITEM (back to paragraph), NOT the containing LIST.
  // Pre-fix walked up to document's direct child (the LIST), tried
  // setBlockType(list, "list-item") — cross-kind (container → leaf)
  // refused by T11. Silently no-op or throw.
  it("E-A13: cursor inside a list-item toggles the leaf back to paragraph (NOT the containing list)", () => {
    const initialState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "list", lastChildId: "list" }),
        buildBlock({ id: "list", type: "list", parentId: "doc", firstChildId: "li", lastChildId: "li", attrs: { listType: "unordered" } }),
        buildBlock({ id: "li", type: "list-item", parentId: "list", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    // Render + layout up-front (mirrors createInitialEditorState) so the
    // EditorState's renderTree / layoutTree are properly typed and
    // populated — no `null as never` escape hatch.
    const rendered = render(initialState, config.componentRegistry, config.attrRegistry);
    const cascadedRoot = cascadePass(rendered.root);
    const layout = layoutTree(
      cascadedRoot,
      config.containerWidth,
      config.measurer,
      config.pageConfig,
    );
    const initial: EditorState = {
      state: initialState,
      selection: { anchor: { blockId: "li" as BlockId, offset: 0 }, focus: { blockId: "li" as BlockId, offset: 0 } },
      history: createHistory(initialState),
      renderTree: rendered.root,
      renderOutput: rendered,
      cascadedRoot,
      cascadedTemplateContents: new Map(),
      layoutTree: layout,
      containerWidth: config.containerWidth,
      targetX: null,
    };
    const next = reduceEditor(
      initial,
      { type: "TOGGLE_LIST", listType: "unordered" },
      config,
    );
    expect(getBlock(next.state, "li" as BlockId)?.type).toBe("paragraph");
    expect(getBlock(next.state, "list" as BlockId)?.type).toBe("list");
  });
});

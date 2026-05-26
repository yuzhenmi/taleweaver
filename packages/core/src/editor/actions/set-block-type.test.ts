/**
 * Regression: T11's cross-kind guard on setBlockType caused
 * handleSetBlockType to throw at runtime when the user picked any block
 * type whose BlockKind differed from the focused block's. The fix
 * keeps the guard but reclassifies list-item as an inline-bearing leaf
 * so the paragraph⇄list-item path through this handler succeeds. Other
 * cross-kind transitions (paragraph→list, paragraph→table) remain
 * refused at the state layer; this handler currently surfaces them as
 * a thrown error to the caller, which is the upstream behaviour
 * documented in setBlockType's contract.
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

describe("handleSetBlockType — same-kind transitions succeed (regression #155)", () => {
  it("converts paragraph → heading without throwing", () => {
    const initial = createInitialEditorState(config);
    const paraId = firstChildId(initial.state) as BlockId;

    const next = reduceEditor(
      initial,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );

    expect(getBlock(next.state, paraId)?.type).toBe("heading");
    expect(getBlock(next.state, paraId)?.attrs).toEqual({ level: 1 });
  });

  it("converts paragraph → list-item without throwing", () => {
    const initial = createInitialEditorState(config);
    const paraId = firstChildId(initial.state) as BlockId;

    const next = reduceEditor(
      initial,
      { type: "SET_BLOCK_TYPE", blockType: "list-item", properties: { listType: "unordered" } },
      config,
    );

    expect(getBlock(next.state, paraId)?.type).toBe("list-item");
    expect(getBlock(next.state, paraId)?.attrs).toEqual({ listType: "unordered" });
  });

  // E-A13 / 2026-05-23 audit: cursor inside a nested block (e.g., a
  // list-item inside a list, a paragraph inside a table cell) should
  // retype the LEAF the cursor is actually in — NOT the outermost
  // ancestor. Pre-fix walked up to the document's direct child,
  // retyping the LIST instead of the list-item (cross-kind: container
  // → leaf, refused by setBlockType per T11 → silently no-op or
  // throw). Post-fix: the leaf is retyped.
  it("E-A13: cursor inside a list-item retypes the list-item, NOT the containing list", () => {
    // Build state with `document → list → list-item("hello")`.
    // Default initial doc is just `document → paragraph`, so we
    // construct directly via buildState.
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
    // Action: SET_BLOCK_TYPE heading. Pre-fix: targets "list" (cross-kind →
    // throws). Post-fix: targets "li" (same-kind: list-item is
    // inline-bearing-leaf, heading is inline-bearing-leaf → succeeds).
    const next = reduceEditor(
      initial,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );
    // The list-item became a heading; the containing list is unchanged.
    expect(getBlock(next.state, "li" as BlockId)?.type).toBe("heading");
    expect(getBlock(next.state, "list" as BlockId)?.type).toBe("list");
  });

  it("re-invoking with the same block type reverts to paragraph", () => {
    let s = createInitialEditorState(config);
    const paraId = firstChildId(s.state) as BlockId;
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 2 } },
      config,
    );
    expect(getBlock(s.state, paraId)?.type).toBe("heading");

    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 2 } },
      config,
    );
    expect(getBlock(s.state, paraId)?.type).toBe("paragraph");
    expect(getBlock(s.state, paraId)?.attrs).toEqual({});
  });
});

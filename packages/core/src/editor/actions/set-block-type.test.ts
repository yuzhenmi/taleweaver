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
  createEditor, firstChildId } from "./test-helpers";
import { type Editor } from "../editor";
import { getBlock } from "../../state";
import type { BlockId } from "../../state";
import { buildDocument, buildBlock, inlineContent, text } from "../../test-utils/document-builders";

describe("handleSetBlockType — same-kind transitions succeed (regression #155)", () => {
  it("converts paragraph → heading without throwing", () => {
    const initial = createEditor(config);
    const paraId = firstChildId(initial.document) as BlockId;

    initial.dispatch({ type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } });

    expect(getBlock(initial.document, paraId)?.type).toBe("heading");
    expect(getBlock(initial.document, paraId)?.attrs).toEqual({ level: 1 });
  });

  it("converts paragraph → list-item without throwing", () => {
    const initial = createEditor(config);
    const paraId = firstChildId(initial.document) as BlockId;

    initial.dispatch({ type: "SET_BLOCK_TYPE", blockType: "list-item", properties: { listType: "unordered" } });

    expect(getBlock(initial.document, paraId)?.type).toBe("list-item");
    expect(getBlock(initial.document, paraId)?.attrs).toEqual({ listType: "unordered" });
  });

  // E-A13 / 2026-05-23 audit: cursor inside a nested block (e.g., a
  // list-item inside a list, a paragraph inside a table cell) should
  // retype the LEAF the cursor is actually in — NOT the outermost
  // ancestor. Pre-fix walked up to the document's direct child,
  // retyping the LIST instead of the list-item (cross-kind: container
  // → leaf, refused by setBlockType per T11 → silently no-op or
  // throw). Post-fix: the leaf is retyped.
  it("E-A13: cursor inside a list-item retypes the list-item", () => {
    // Flat list model: the list-item is a direct child of the document,
    // carrying listId/listLevel attrs — there is no wrapping `list` container.
    // Default initial doc is just `document → paragraph`, so we construct
    // directly via buildDocument.
    const initialDocument = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "li" }),
        buildBlock({ id: "li", type: "list-item", parentId: "doc", attrs: { listId: "L1", listLevel: 0, listType: "unordered" }, inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    // Phase 0b: core's `Editor` is geometry-free — build only the
    // geometry-free fields (the handler reads no layout).
    const initial: Editor = createEditor(config, { document: initialDocument, selection: { anchor: { blockId: "li" as BlockId, offset: 0 }, focus: { blockId: "li" as BlockId, offset: 0 } } });
    // Action: SET_BLOCK_TYPE heading. Targets "li" (same-kind: list-item is
    // inline-bearing-leaf, heading is inline-bearing-leaf → succeeds).
    initial.dispatch({ type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } });
    // The list-item became a heading.
    expect(getBlock(initial.document, "li" as BlockId)?.type).toBe("heading");
  });

  it("re-invoking with the same block type reverts to paragraph", () => {
    let s = createEditor(config);
    const paraId = firstChildId(s.document) as BlockId;
    s.dispatch({ type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 2 } });
    expect(getBlock(s.document, paraId)?.type).toBe("heading");

    s.dispatch({ type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 2 } });
    expect(getBlock(s.document, paraId)?.type).toBe("paragraph");
    expect(getBlock(s.document, paraId)?.attrs).toEqual({});
  });
});

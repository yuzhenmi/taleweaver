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
import { getBlock } from "../../state/state";
import type { BlockId } from "../../state/block-id";

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

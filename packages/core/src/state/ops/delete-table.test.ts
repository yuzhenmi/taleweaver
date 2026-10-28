import { describe, it, expect } from "vitest";
import { deleteTable } from "./delete-table";
import { getBlock } from "../state";
import { buildFlowDoc, finalSectionOf } from "../../test-utils/state-builders";
import { flowShape, assertInvariantI } from "../../test-utils/invariant-i";
import type { BlockId } from "../block-id";

/**
 * Deleting a whole table (or any block object). Under invariant I (Word / GDocs: a
 * paragraph follows every table) the paragraph after the table
 * always exists, so removing the table never empties a flow — no replacement
 * paragraph is ever needed.
 */
describe("deleteTable", () => {
  it("a lone table is followed by its mandatory paragraph; removing the table leaves that paragraph", () => {
    const state = buildFlowDoc([{ table: "table", cells: ["cp"] }]);
    expect(flowShape(state, "doc")).toMatch(/^\[table\] \S+:""$/);
    const { state: next, dirtyIds } = deleteTable(state, "table" as BlockId);
    expect(flowShape(next, "doc")).toMatch(/^\S+:""$/);
    for (const id of ["table", "table-r", "cp-c", "cp", finalSectionOf(next)]) expect(dirtyIds.has(id as BlockId)).toBe(true);
    for (const id of ["table", "table-r", "cp-c", "cp"]) expect(getBlock(next, id as BlockId)).toBeNull();
    assertInvariantI(next, "storage");
  });

  it("between two paragraphs → plain removal; the neighbours are relinked", () => {
    const state = buildFlowDoc([{ p: "p", t: "a" }, { table: "table", cells: ["cp"] }, { p: "q", t: "b" }]);
    const { state: next, dirtyIds } = deleteTable(state, "table" as BlockId);
    expect(flowShape(next, "doc")).toBe('p:"a" q:"b"');
    expect(dirtyIds.has("p" as BlockId)).toBe(true);
    expect(dirtyIds.has("q" as BlockId)).toBe(true);
    expect(getBlock(next, "p" as BlockId)?.nextSiblingId).toBe("q");
    expect(getBlock(next, "q" as BlockId)?.prevSiblingId).toBe("p");
  });

  it("as the first block → the paragraph after it becomes the first child", () => {
    const state = buildFlowDoc([{ table: "table", cells: ["cp"] }, { p: "q", t: "b" }]);
    const { state: next } = deleteTable(state, "table" as BlockId);
    expect(flowShape(next, "doc")).toBe('q:"b"');
    expect(getBlock(next, finalSectionOf(next))?.firstChildId).toBe("q");
  });
});

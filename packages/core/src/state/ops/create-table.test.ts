import { describe, it, expect } from "vitest";
import { createTable, buildTableSubtreePlan } from "./create-table";
import { getBlock } from "../state";
import { buildBlock, buildState, inlineContent, text, finalSectionOf } from "../../test-utils/state-builders";
import { flowShape, assertInvariantI } from "../../test-utils/invariant-i";
import { createTestAllocator } from "../block-id";
import { createPosition } from "../block-position";
import type { BlockId } from "../block-id";
import type { State } from "../state";

/** doc > single paragraph carrying `content`. */
function paraDoc(content: string): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent(content.length > 0 ? [text(content)] : []),
      }),
    ],
  });
}

/** doc > p0("first") , p1("second"). */
function twoParaDoc(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p1" }),
      buildBlock({ id: "p0", type: "paragraph", parentId: "doc", nextSiblingId: "p1", inlineContent: inlineContent([text("first")]) }),
      buildBlock({ id: "p1", type: "paragraph", parentId: "doc", prevSiblingId: "p0", inlineContent: inlineContent([text("second")]) }),
    ],
  });
}

/** The table block reachable from the doc's first/last child after an insert. */
function tableBlocks(state: State, tableId: BlockId) {
  const table = getBlock(state, tableId);
  if (table === null) throw new Error("table missing");
  const rows: ReturnType<typeof getBlock>[] = [];
  for (let r = table.firstChildId; r !== null; r = getBlock(state, r)?.nextSiblingId ?? null) {
    rows.push(getBlock(state, r));
  }
  return { table, rows };
}

describe("buildTableSubtreePlan", () => {
  it("allocates a rows×cols subtree with equal columnWidths and one paragraph per cell", () => {
    const plan = buildTableSubtreePlan(2, 3, createTestAllocator("t"));
    expect(plan.rows).toHaveLength(2);
    for (const row of plan.rows) expect(row.cells).toHaveLength(3);
    // equal fractions summing to 1.
    expect(plan.columnWidths).toHaveLength(3);
    expect(plan.columnWidths.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(plan.columnWidths.every((w) => w === 1 / 3)).toBe(true);
    // every id distinct.
    const ids = [
      plan.tableId,
      ...plan.rows.flatMap((row) => [row.rowId, ...row.cells.flatMap((c) => [c.cellId, c.paragraphId])]),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("createTable", () => {
  it("builds a well-formed rows×cols subtree (types, widths, empty paragraphs)", () => {
    const state = paraDoc("");
    const { state: next, newTableId, caretInto } = createTable(
      state,
      createPosition("p" as BlockId, 0),
      2,
      3,
      createTestAllocator("t"),
    );

    const { table, rows } = tableBlocks(next, newTableId);
    expect(table.type).toBe("table");
    expect(table.attrs.columnWidths).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(table.inlineContent).toBeNull();
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      if (row === null) throw new Error("row missing");
      expect(row.type).toBe("table-row");
      expect(row.parentId).toBe(newTableId);
      const cells: BlockId[] = [];
      for (let c = row.firstChildId; c !== null; c = getBlock(next, c)?.nextSiblingId ?? null) cells.push(c);
      expect(cells).toHaveLength(3);
      for (const cellId of cells) {
        const cell = getBlock(next, cellId);
        if (cell === null) throw new Error("cell missing");
        expect(cell.type).toBe("table-cell");
        expect(cell.inlineContent).toBeNull();
        // exactly one empty paragraph
        expect(cell.firstChildId).toBe(cell.lastChildId);
        const para = getBlock(next, cell.firstChildId as BlockId);
        if (para === null) throw new Error("cell paragraph missing");
        expect(para.type).toBe("paragraph");
        expect(para.inlineContent).toEqual({ items: [] });
      }
    }

    // caret lands in cell (0,0)'s paragraph at offset 0.
    const firstRow = rows[0];
    if (firstRow === null || firstRow === undefined) throw new Error("row0 missing");
    const firstCell = getBlock(next, firstRow.firstChildId as BlockId);
    expect(caretInto).toEqual(createPosition(firstCell?.firstChildId as BlockId, 0));
  });

  // Placement: at (P, 0) only the table item is written,
  // before P; at (P, k > 0) a ¶ ends the head at the caret, then the table: head H
  // (new id), table, tail P (empty at k = len). A paragraph always follows the table.
  const shapeOf = (s: State, tableId: BlockId) => flowShape(s, "doc").replace(`[${tableId}]`, "[T]");

  it("START (offset 0): the table goes BEFORE the caret's block", () => {
    const { state: next, newTableId } = createTable(paraDoc("hello"), createPosition("p" as BlockId, 0), 1, 1, createTestAllocator("t"));
    expect(shapeOf(next, newTableId)).toBe('[T] p:"hello"');
    expect(getBlock(next, finalSectionOf(next))?.firstChildId).toBe(newTableId);
    expect(getBlock(next, "p" as BlockId)?.prevSiblingId).toBe(newTableId);
    assertInvariantI(next, "storage");
  });

  it("END (offset = length): head H keeps the text, then the table, then the empty tail P", () => {
    const { state: next, newTableId } = createTable(paraDoc("hello"), createPosition("p" as BlockId, 5), 1, 1, createTestAllocator("t"));
    expect(shapeOf(next, newTableId)).toMatch(/^\S+:"hello" \[T\] p:""$/);
    expect(getBlock(next, "p" as BlockId)?.prevSiblingId).toBe(newTableId);
    assertInvariantI(next, "storage");
  });

  it("MID-block: head H = prefix, table, tail P = suffix", () => {
    const { state: next, newTableId } = createTable(paraDoc("hello"), createPosition("p" as BlockId, 2), 1, 1, createTestAllocator("t"));
    expect(shapeOf(next, newTableId)).toMatch(/^\S+:"he" \[T\] p:"llo"$/);
    const head = getBlock(next, newTableId)?.prevSiblingId ?? null;
    expect(head).not.toBeNull();
    expect(getBlock(next, finalSectionOf(next))?.firstChildId).toBe(head);
  });

  it("MID-block on an interior paragraph keeps the following paragraph linked", () => {
    const { state: next, newTableId } = createTable(twoParaDoc(), createPosition("p0" as BlockId, 2), 1, 1, createTestAllocator("t"));
    expect(shapeOf(next, newTableId)).toMatch(/^\S+:"fi" \[T\] p0:"rst" p1:"second"$/);
    expect(getBlock(next, "p1" as BlockId)?.prevSiblingId).toBe("p0");
  });

  it("empty doc (single empty paragraph): the table goes before the empty paragraph", () => {
    const { state: next, newTableId } = createTable(paraDoc(""), createPosition("p" as BlockId, 0), 2, 2, createTestAllocator("t"));
    expect(shapeOf(next, newTableId)).toBe('[T] p:""');
  });

  it("throws for rows < 1 or cols < 1 (precondition; the action layer no-ops)", () => {
    const state = paraDoc("hello");
    expect(() =>
      createTable(state, createPosition("p" as BlockId, 0), 0, 3, createTestAllocator("t")),
    ).toThrow(/at least 1|rows|cols/);
    expect(() =>
      createTable(state, createPosition("p" as BlockId, 0), 2, 0, createTestAllocator("t")),
    ).toThrow(/at least 1|rows|cols/);
  });

  it("throws when the caret block does not exist", () => {
    const state = paraDoc("hello");
    expect(() =>
      createTable(state, createPosition("nope" as BlockId, 0), 1, 1, createTestAllocator("t")),
    ).toThrow(/not found/);
  });

  it("throws when the caret block is a container (non-leaf)", () => {
    const state = paraDoc("hello");
    expect(() =>
      createTable(state, createPosition("doc" as BlockId, 0), 1, 1, createTestAllocator("t")),
    ).toThrow(/container|leaf/);
  });

  it("throws (main-body only) when the caret block lives in a non-main tree", () => {
    // A header-body paragraph (templateContents) — v1 refuses tables outside the
    // main document body with a clear error, not a misleading "not found".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
      templateContents: [
        buildBlock({ id: "hdr", type: "header", firstChildId: "hp", lastChildId: "hp" }),
        buildBlock({ id: "hp", type: "paragraph", parentId: "hdr", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    expect(() =>
      createTable(state, createPosition("hp" as BlockId, 0), 1, 1, createTestAllocator("t")),
    ).toThrow(/main document body only/);
  });
});

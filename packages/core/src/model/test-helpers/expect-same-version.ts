import { expect } from "vitest";
import type { Block } from "../block";
import type { Document, TreeKind } from "../document/types";
import { typeId } from "../storage/item-id";

/** Each flow's internal state, comparable across versions / peers (pieces by item id). */
function flowStates(d: Document): unknown[] {
  return [...d.flows.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([id, fs]) => ({
      id,
      tree: fs.tree,
      isRoot: fs.isRoot,
      synthetic: fs.synthetic,
      sections: fs.sections.map((s) => s.id),
      segments: fs.segments.map((s) => ({
        piece: typeId(s.piece),
        start: s.start,
        len: s.len,
        depth: s.depth,
        tokens: s.tokens.map((t) => (t.k === "run" ? `run:${t.len}:${t.inert.join(",")}` : `${t.k}:${t.id}:${t.len}`)),
      })),
    }));
}

/** Each table's read grid, comparable across versions / peers. */
function tableStates(d: Document): unknown[] {
  return [...d.tables.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([id, ts]) => ({
      id,
      tree: ts.tree,
      rows: ts.rows.map((r) => `${r.id}:${r.key}:${r.header}`),
      cols: ts.cols.map((c) => c.key),
      cells: ts.cells.map((c) => `${c.id}:${c.row},${c.col}:${c.rowSpan}x${c.colSpan}:${c.flow === null ? "-" : typeId(c.flow)}`),
      headerCount: ts.headerCount,
      widths: ts.widths,
    }));
}

function sortedEntries(d: Document, tree: TreeKind): [string, Block][] {
  return [...d.trees[tree].entries()].map(([k, v]): [string, Block] => [k, v]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Two versions read the same: every tree's records, the flows, the tables and the list defs. */
export function expectSameVersion(actual: Document, expected: Document): void {
  for (const tree of ["block", "embedContent", "templateContent"] satisfies TreeKind[]) {
    expect(sortedEntries(actual, tree)).toEqual(sortedEntries(expected, tree));
  }
  expect(flowStates(actual)).toEqual(flowStates(expected));
  expect(tableStates(actual)).toEqual(tableStates(expected));
  expect([...actual.listDefs]).toEqual([...expected.listDefs]);
}

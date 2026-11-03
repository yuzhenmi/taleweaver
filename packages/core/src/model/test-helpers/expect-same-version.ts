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
      leadsAfter: [...fs.leadsAfter].sort(),
      tables: [...fs.tables.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([id, f]) => [id, { ...f, map: typeId(f.map) }]),
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

function sortedEntries(d: Document, tree: TreeKind): [string, Block][] {
  return [...d.trees[tree].entries()].map(([k, v]): [string, Block] => [k, v]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Two versions read the same: every tree's records, the flows and the list defs. */
export function expectSameVersion(actual: Document, expected: Document): void {
  for (const tree of ["block", "embedContent", "templateContent"] satisfies TreeKind[]) {
    expect(sortedEntries(actual, tree)).toEqual(sortedEntries(expected, tree));
  }
  expect(flowStates(actual)).toEqual(flowStates(expected));
  expect([...actual.listDefs]).toEqual([...expected.listDefs]);
}

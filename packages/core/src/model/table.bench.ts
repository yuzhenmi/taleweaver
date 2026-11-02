/**
 * B10 — table budgets (build plan P2 M2; `npx vitest bench --run src/model/table.bench.ts`
 * in packages/core). Raw Yjs writes (table commands are M3) on a body holding one
 * table of 3 columns; the run FAILS when a budget is exceeded (checked in `afterAll`
 * on the recorded medians; a filtered-out bench records none and is not asserted):
 *   - keystroke into a cell at the middle row, 10⁴ rows ≤ 0.1 ms, ratio vs 10² rows ≤ 1.5;
 *   - remote keystroke (applying a peer's one-character cell update), 10⁴ rows ≤ 0.1 ms;
 *   - first keystroke into an empty (X4) cell, 10⁴ rows ≤ 0.1 ms;
 *   - a row inserted mid-table, 10⁴ rows ≤ 30 ms; with staggered row spans ("bricks":
 *     column a merges rows 2i–2i+1, column b rows 2i+1–2i+2: one span chain) ≤ 60 ms;
 *   - load (the model's first derivation), 10⁴ rows ≤ 1.5 s.
 */
import { afterAll, bench, describe, expect } from "vitest";
import * as Y from "yjs";
import { Model } from "./model";
import { getDocMap } from "./storage/doc-map";
import { ITEM_KINDS, ROWS_KEY } from "./storage/keys";
import { flowOf, kindOf } from "./storage/map-reads";
import { newColMap, newRowMap, newTable } from "./storage/new-table";
import { cellFlowKey, rowSpanKey } from "./storage/table-keys";
import { fixture } from "./test-helpers/fixture";
import { cellPiece, testRow, textFlow } from "./test-helpers/table";

declare const console: { log(...args: unknown[]): void };

const samples = new Map<string, number[]>();
const record = (name: string, ms: number): void => {
  const xs = samples.get(name) ?? [];
  samples.set(name, xs);
  xs.push(ms);
};
function median(name: string): number {
  const xs = [...(samples.get(name) ?? [])].sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)] ?? Number.NaN;
}
/** Times `fn` under `name`, discarding the first `skip` calls (tinybench's probes + warmup). */
function timed(name: string, fn: () => void, skip: number): () => void {
  let calls = 0;
  return () => {
    const t0 = performance.now();
    fn();
    if (calls++ >= skip) record(name, performance.now() - t0);
  };
}

/** A doc whose body holds a `rows` × 3 table: columns a, b with text, c empty (X4); `bricks`: staggered row spans. */
function tableDoc(rows: number, bricks = false): Y.Doc {
  const f = fixture();
  const rs: Y.Map<unknown>[] = [];
  for (let i = 0; i < rows; i++) {
    const keys: Record<string, string> = {};
    if (bricks && i + 1 < rows) keys[rowSpanKey(i % 2 === 0 ? "a" : "b")] = `r${i + 1}`;
    rs.push(testRow(`r${i}`, { a: "Lorem ipsum dolor", b: "sit amet", c: null }, keys));
  }
  f.doc.transact(() => f.piece.insertEmbed(0, newTable(rs, [newColMap("a", 1), newColMap("b", 1), newColMap("c", 1)])));
  return f.doc;
}

function rowsOf(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  const p: unknown = flowOf(getDocMap(doc) ?? new Y.Map())?.get(0);
  const table: unknown = p instanceof Y.Text ? p.toDelta().find((op: { insert: unknown }) => op.insert instanceof Y.Map && kindOf(op.insert) === ITEM_KINDS.table)?.insert : null;
  const rows: unknown = table instanceof Y.Map ? table.get(ROWS_KEY) : null;
  if (!(rows instanceof Y.Array)) throw new Error("bench: no table");
  return rows;
}
const rowAt = (doc: Y.Doc, i: number): Y.Map<unknown> => {
  const r: unknown = rowsOf(doc).get(i);
  if (!(r instanceof Y.Map)) throw new Error("bench: no row");
  return r;
};

function cellKeystroke(rows: number): () => void {
  const doc = tableDoc(rows);
  new Model(doc);
  const piece = cellPiece(rowAt(doc, rows / 2), "a");
  let offset = 5;
  return () => doc.transact(() => piece.insert(offset++, "x"));
}

function remoteKeystroke(rows: number, skip: number): () => void {
  const a = tableDoc(rows);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  new Model(a);
  const pb = cellPiece(rowAt(b, rows / 2), "a");
  let u: Uint8Array | null = null;
  b.on("update", (x: Uint8Array) => {
    u = x;
  });
  let offset = 5;
  let calls = 0;
  return () => {
    b.transact(() => pb.insert(offset++, "x"));
    const x: Uint8Array | null = u;
    if (x === null) throw new Error("bench: no update");
    const t0 = performance.now();
    Y.applyUpdate(a, x);
    if (calls++ >= skip) record("remote", performance.now() - t0);
  };
}

/** Each call materialises the next row's empty cell (X4 → its first ¶ and character). */
function firstKeystroke(rows: number): () => void {
  const doc = tableDoc(rows);
  new Model(doc);
  let i = 0;
  return () => {
    const row = rowAt(doc, i++ % rows);
    const flow = textFlow("x");
    doc.transact(() => row.set(cellFlowKey("c"), flow));
  };
}

function insertRow(rows: number, bricks = false): () => void {
  const doc = tableDoc(rows, bricks);
  new Model(doc);
  const arr = rowsOf(doc);
  let n = 0;
  return () => doc.transact(() => arr.insert(arr.length >> 1, [newRowMap(`n${n++}`, ["a", "b", "c"])]));
}

function load(rows: number): () => void {
  const doc = tableDoc(rows);
  return () => new Model(doc).destroy();
}

const WARMUP = 200;
const opts = { iterations: 2000, warmupIterations: WARMUP, warmupTime: 0 };

describe("B10 tables (3 columns)", () => {
  bench("keystroke in a cell, 10² rows", timed("k100", cellKeystroke(100), WARMUP + 2), opts);
  bench("keystroke in a cell, 10⁴ rows", timed("k1e4", cellKeystroke(10_000), WARMUP + 2), opts);
  bench("remote keystroke in a cell, 10⁴ rows", remoteKeystroke(10_000, WARMUP + 2), opts);
  bench("first keystroke into an empty cell, 10⁴ rows", timed("first", firstKeystroke(10_000), 52), { iterations: 2000, warmupIterations: 50, warmupTime: 0 });
  bench("insert a row mid-table, 10⁴ rows", timed("insertRow", insertRow(10_000), 7), { iterations: 20, warmupIterations: 5, time: 0, warmupTime: 0 });
  bench("insert a row mid-table, staggered spans, 10⁴ rows", timed("insertRowBricks", insertRow(10_000, true), 7), { iterations: 20, warmupIterations: 5, time: 0, warmupTime: 0 });
  bench("load, 10⁴ rows", timed("load", load(10_000), 3), { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 });
});

afterAll(() => {
  const report = {
    keystroke100: median("k100"),
    keystroke1e4: median("k1e4"),
    keystrokeRatio: median("k1e4") / median("k100"),
    remote1e4: median("remote"),
    firstKeystroke1e4: median("first"),
    insertRow1e4: median("insertRow"),
    insertRowBricks1e4: median("insertRowBricks"),
    load1e4: median("load"),
  };
  console.log("B10 medians (ms)", report);
  const budgets: [keyof typeof report, number][] = [
    ["keystroke1e4", 0.1],
    ["keystrokeRatio", 1.5],
    ["remote1e4", 0.1],
    ["firstKeystroke1e4", 0.1],
    ["insertRow1e4", 30],
    ["insertRowBricks1e4", 60], // one span chain through every row: the band is the whole table (O(R), accepted)
    ["load1e4", 1.5e3],
  ];
  // NaN = nothing recorded (filtered out).
  for (const [k, max] of budgets) if (!Number.isNaN(report[k])) expect(report[k], k).toBeLessThanOrEqual(max);
});

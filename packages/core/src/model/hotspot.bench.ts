/**
 * B4 — hot spot: 10⁴ interleaved inserts + deletes (type two characters, Backspace
 * one) at ONE spot of a 110-page document
 * (`npx vitest bench --run src/model/hotspot.bench.ts`).
 *
 * Budget (build plan P1): last-1k median ≤ 2 × first-1k median, the median op within
 * B1's 0.1 ms, and a plain keystroke after the hot spot within 0.1 ms. Asserted in
 * `afterAll` for the WITH-sub-flows rows (the piece-size rule, X12); the run fails
 * when exceeded. The no-sub-flow rows are the X12 decision evidence (writes go
 * straight into the full piece): reported, not asserted.
 *
 *   - single client;
 *   - three clients: without sub-flows, three synced replicas alternating at the same
 *     spot (the model on A; A's local writes and its applies of B / C updates are
 *     timed); with sub-flows, one replica whose clientID rotates over three ids each
 *     write — the same struct fragmentation (items of different clients never merge).
 */
import { afterAll, bench, describe, expect } from "vitest";
import * as Y from "yjs";
import { Model } from "./model";
import { createEditorOrigin, flowOf, getDocMap, pieceStructCount, writablePoint, type PiecePoint } from "./storage";
import { buildPages } from "./test-helpers";

declare const console: { log(...args: unknown[]): void };

const OPS = 10_000;
const results = new Map<string, number[]>();

const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN;

/** The piece at the same flow index in a synced replica. */
function samePiece(doc: Y.Doc, idx: number): Y.Text {
  const flow = getDocMap(doc) === null ? null : flowOf(getDocMap(doc) ?? new Y.Map());
  const p = flow?.get(idx);
  if (!(p instanceof Y.Text)) throw new Error("hotspot: no piece");
  return p;
}

function singleClient(): number[] {
  const { doc, piece, at } = buildPages(110);
  new Model(doc);
  const origin = createEditorOrigin();
  const times: number[] = [];
  let pos = at;
  for (let i = 0; i < OPS; i++) {
    const t0 = performance.now();
    if (i % 3 === 2) {
      doc.transact(() => piece.delete(pos - 1, 1), origin);
      pos--;
    } else {
      doc.transact(() => piece.insert(pos, "x"), origin);
      pos++;
    }
    times.push(performance.now() - t0);
  }
  results.set("structs:single", [pieceStructCount(piece)]);
  return times;
}

function threeClients(): number[] {
  const { doc: a, piece, at } = buildPages(110);
  const flow = flowOf(getDocMap(a) ?? new Y.Map());
  const idx = flow === null ? -1 : flow.toArray().indexOf(piece);
  const peers = [a, new Y.Doc(), new Y.Doc()];
  peers.forEach((d, i) => {
    d.clientID = 100 + i;
    if (i > 0) Y.applyUpdate(d, Y.encodeStateAsUpdate(a));
  });
  new Model(a);
  const pieces = peers.map((d) => samePiece(d, idx));
  const times: number[] = [];
  let pos = at;
  for (let i = 0; i < OPS; i++) {
    const c = i % 3;
    const d = peers[c];
    const p = pieces[c];
    if (d === undefined || p === undefined) throw new Error("hotspot: peer");
    const sv = Y.encodeStateVector(a);
    const t0 = performance.now();
    if (i % 3 === 2) {
      d.transact(() => p.delete(pos - 1, 1));
      pos--;
    } else {
      d.transact(() => p.insert(pos, "x"));
      pos++;
    }
    const local = performance.now() - t0;
    // sync this write everywhere; time A's share (its local write, or its apply)
    let applyA = 0;
    if (c !== 0) {
      const u = Y.encodeStateAsUpdate(d, sv);
      const t1 = performance.now();
      Y.applyUpdate(a, u);
      applyA = performance.now() - t1;
    }
    for (const other of peers) if (other !== d && other !== a) Y.applyUpdate(other, Y.encodeStateAsUpdate(d, Y.encodeStateVector(other)));
    times.push(c === 0 ? local : applyA);
  }
  results.set("structs:three", [pieceStructCount(pieces[0] ?? piece)]);
  return times;
}

/** With the piece-size rule: inserts through `writablePoint`; Backspace deletes before the cursor. */
function withSubflows(rotateClients: boolean): number[] {
  const { doc, piece, at } = buildPages(110);
  new Model(doc);
  const origin = createEditorOrigin();
  const times: number[] = [];
  let cur: PiecePoint = { piece, index: at };
  const write = (i: number): void => {
    if (rotateClients) doc.clientID = 500 + (i % 3);
    doc.transact(() => {
      if (i % 3 === 2 && cur.index > 0) {
        cur.piece.delete(cur.index - 1, 1);
        cur = { piece: cur.piece, index: cur.index - 1 };
      } else {
        const p = writablePoint(cur);
        p.piece.insert(p.index, "x");
        cur = { piece: p.piece, index: p.index + 1 };
      }
    }, origin);
  };
  for (let i = 0; i < OPS; i++) {
    const t0 = performance.now();
    write(i);
    times.push(performance.now() - t0);
  }
  const after: number[] = [];
  for (let i = 0; i < 1000; i++) {
    const t0 = performance.now();
    write(0);
    after.push(performance.now() - t0);
  }
  results.set(`after:${rotateClients ? "subThree" : "subSingle"}`, after);
  results.set(`structs:${rotateClients ? "subThree" : "subSingle"}`, [pieceStructCount(cur.piece)]);
  return times;
}

describe("B4 hot spot", () => {
  bench(
    "with sub-flows, single client, 10⁴ ops",
    () => {
      results.set("subSingle", withSubflows(false));
    },
    { iterations: 1, warmupIterations: 0, time: 0, warmupTime: 0 },
  );
  bench(
    "with sub-flows, three clientIDs alternating, 10⁴ ops",
    () => {
      results.set("subThree", withSubflows(true));
    },
    { iterations: 1, warmupIterations: 0, time: 0, warmupTime: 0 },
  );
  bench(
    "no sub-flows, single client, 10⁴ ops",
    () => {
      results.set("single", singleClient());
    },
    { iterations: 1, warmupIterations: 0, time: 0, warmupTime: 0 },
  );
  bench(
    "no sub-flows, three clients alternating, 10⁴ ops",
    () => {
      results.set("three", threeClients());
    },
    { iterations: 1, warmupIterations: 0, time: 0, warmupTime: 0 },
  );
});

afterAll(() => {
  const report: Record<string, number> = {};
  for (const name of ["single", "three", "subSingle", "subThree"]) {
    const xs = results.get(name) ?? [];
    report[`${name}:after`] = median(results.get(`after:${name}`) ?? []);
    report[`${name}:first1k`] = median(xs.slice(0, 1000));
    report[`${name}:last1k`] = median(xs.slice(-1000));
    report[`${name}:median`] = median(xs);
    report[`${name}:structs`] = results.get(`structs:${name}`)?.[0] ?? Number.NaN;
  }
  console.log("B4 medians (ms)", report);
  for (const name of ["subSingle", "subThree"]) {
    expect(report[`${name}:after`] ?? Infinity).toBeLessThanOrEqual(0.1);
    expect(report[`${name}:last1k`] ?? Infinity).toBeLessThanOrEqual(2 * (report[`${name}:first1k`] ?? 0));
    expect(report[`${name}:median`] ?? Infinity).toBeLessThanOrEqual(0.1);
  }
});

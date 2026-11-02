/**
 * B2 / B3 / B5 / B7 / B8 — the rest of build plan P1's budgets
 * (`npx vitest bench --run src/model/budgets.bench.ts` in packages/core; B8 needs a
 * GC-exposed worker, `NODE_OPTIONS=--expose-gc npx vitest bench --run src/model/budgets.bench.ts`,
 * and is skipped with a warning without one). The run FAILS when a budget is exceeded —
 * checked in `afterAll` on the medians this file recorded (a skipped or filtered-out
 * bench records none and is not asserted):
 *   - B2 remote keystroke: applying one other peer's one-character update, model
 *     deriving; ≤ 0.1 ms median at 110 and 1000 pages, ratio ≤ 1.5 (`yjs only` rows:
 *     the same apply with no model, reported);
 *   - B3 dense piece: a raw keystroke into a piece of PIECE_SOFT_MAX structs (one
 *     character per struct: alternating bold, a ¶ every 10) ≤ 0.5 ms median;
 *   - B5 tombstones: a C1 keystroke at a spot where 10⁵ one-character tombstones were
 *     made (typed then deleted, three clientIDs alternating, through the piece-size
 *     rule) ≤ 2 × the same keystroke with none;
 *   - B7 undo of a 50-page deletion (C9 through ModelHistory, 1000-page doc) ≤ 100 ms;
 *   - B8 retained heap of 128 consecutive versions after 128 keystrokes (1000 pages),
 *     measured with `gc()` + `heapUsed` (includes the doc's own growth) ≤ 2 MB.
 */
import { afterAll, bench, describe, expect } from "vitest";
import * as Y from "yjs";
import { Model } from "./model";
import type { Document } from "./derive";
import { ModelHistory } from "./history";
import { PIECE_SOFT_MAX, createEditorOrigin, flowOf, getDocMap, newParagraphMark, pieceStructCount, writablePoint, type PiecePoint } from "./storage";
import { PARAS_PER_PAGE, buildPages } from "./test-helpers";
import { deleteSelection, insertText } from "./commands";
import { applyPlan } from "./plan";
import { positionAtPoint, caretAt, type ModelSelection } from "./position";

declare const console: { log(...args: unknown[]): void; warn(...args: unknown[]): void };
declare const process: { memoryUsage(): { heapUsed: number } };

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
/** Times `fn` under `name`, discarding the first `skip` calls (tinybench's probes + warmup, as in keystroke.bench.ts). */
function timed(name: string, fn: () => void, skip: number): () => void {
  let calls = 0;
  return () => {
    const t0 = performance.now();
    fn();
    if (calls++ >= skip) record(name, performance.now() - t0);
  };
}

function flowIndex(doc: Y.Doc, piece: Y.Text): number {
  const flow = flowOf(getDocMap(doc) ?? new Y.Map());
  return flow === null ? -1 : flow.toArray().indexOf(piece);
}
function pieceAt(doc: Y.Doc, idx: number): Y.Text {
  const p = flowOf(getDocMap(doc) ?? new Y.Map())?.get(idx);
  if (!(p instanceof Y.Text)) throw new Error("bench: no piece");
  return p;
}

/** B2: peer B types one character; A (with the model) applies B's update — only A's apply is timed. */
function remoteKeystroke(pages: number, name: string, skip: number, withModel = true): () => void {
  const { doc: a, piece, at } = buildPages(pages);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  if (withModel) new Model(a);
  const pb = pieceAt(b, flowIndex(a, piece));
  let u: Uint8Array | null = null;
  b.on("update", (x: Uint8Array) => {
    u = x;
  });
  let offset = at;
  let calls = 0;
  return () => {
    b.transact(() => pb.insert(offset++, "x"));
    const x: Uint8Array | null = u;
    if (x === null) throw new Error("bench: no update");
    const t0 = performance.now();
    Y.applyUpdate(a, x);
    if (calls++ >= skip) record(name, performance.now() - t0);
  };
}

/** B3: a fresh piece of PIECE_SOFT_MAX one-character structs mid-document; raw keystrokes into its middle. */
function denseKeystroke(): () => void {
  const { doc, piece } = buildPages(110);
  const flow = flowOf(getDocMap(doc) ?? new Y.Map());
  if (flow === null) throw new Error("bench: no flow");
  const dense = new Y.Text();
  doc.transact(() => {
    flow.insert(flowIndex(doc, piece), [dense]); // pieces start at paragraph starts: a whole-paragraph piece fits between
    for (let i = 0; pieceStructCount(dense) < PIECE_SOFT_MAX; i++) {
      if (i % 10 === 9) dense.insertEmbed(dense.length, newParagraphMark());
      else dense.insert(dense.length, "a", i % 2 === 0 ? { bold: true } : {});
    }
    if (dense.length > 0) dense.insertEmbed(dense.length, newParagraphMark());
  });
  if (pieceStructCount(dense) < PIECE_SOFT_MAX) throw new Error("bench: piece not dense");
  new Model(doc);
  const origin = createEditorOrigin();
  let offset = Math.floor(dense.length / 2);
  return () => {
    doc.transact(() => dense.insert(offset++, "x"), origin);
  };
}

/** B5: a C1 keystroke at the mid-document caret, with (or without) 10⁵ one-character tombstones made there first. */
function tombstoneKeystroke(tombstones: number): () => void {
  const { doc, piece, at } = buildPages(110);
  let cur: PiecePoint = { piece, index: at };
  for (let i = 0; i < tombstones; i++) {
    doc.clientID = 900 + (i % 3);
    doc.transact(() => {
      const p = writablePoint(cur);
      p.piece.insert(p.index, "x");
      p.piece.delete(p.index, 1);
      cur = p;
    });
  }
  let dead = 0;
  // Test-only Yjs introspection outside the X14 list: `StructStore.clients`.
  doc.store.clients.forEach((structs) => {
    for (const s of structs) if (s instanceof Y.Item && s.content instanceof Y.ContentDeleted) dead++;
  });
  if (dead < tombstones) throw new Error(`bench: only ${dead} tombstone structs`);
  doc.clientID = 999;
  const model = new Model(doc);
  const origin = createEditorOrigin();
  const fs = model.version.flows.get(model.version.rootId);
  const start = fs === undefined ? null : positionAtPoint(model.version, fs, piece, at, 1);
  if (start === null) throw new Error("bench: no caret");
  let selection: ModelSelection = caretAt(start.blockId, start.offset);
  return () => {
    const plan = insertText({ version: model.version, selection }, "x");
    const next = plan === null ? null : applyPlan(model, plan, origin);
    if (next === null) throw new Error("bench: keystroke did nothing");
    selection = next;
  };
}

/** The root's paragraphs in order. */
function paragraphs(d: Document): string[] {
  const out: string[] = [];
  const first = d.trees.block.get(d.flows.get(d.rootId)?.sections[0]?.id ?? "")?.firstChildId ?? null;
  for (let id = first; id !== null; id = d.trees.block.get(id)?.nextSiblingId ?? null) out.push(id);
  return out;
}

const ONE_SHOT = { iterations: 5, warmupIterations: 0, time: 0, warmupTime: 0 };

describe("B2 remote keystroke apply", () => {
  const WARMUP = 200;
  const opts = { iterations: 2000, warmupIterations: WARMUP, warmupTime: 0 };
  bench("110 pages", remoteKeystroke(110, "r110", WARMUP + 2), opts);
  bench("1000 pages", remoteKeystroke(1000, "r1000", WARMUP + 2), opts);
  bench("110 pages, yjs only (not asserted)", remoteKeystroke(110, "ry110", WARMUP + 2, false), opts);
  bench("1000 pages, yjs only (not asserted)", remoteKeystroke(1000, "ry1000", WARMUP + 2, false), opts);
});

describe("B3 dense piece", () => {
  const WARMUP = 200;
  bench("keystroke into a piece of PIECE_SOFT_MAX structs", timed("dense", denseKeystroke(), WARMUP + 2), { iterations: 2000, warmupIterations: WARMUP, warmupTime: 0 });
});

describe("B5 tombstones near the caret", () => {
  const WARMUP = 200;
  const opts = { iterations: 2000, warmupIterations: WARMUP, warmupTime: 0 };
  bench("C1 keystroke, none", timed("t0", tombstoneKeystroke(0), WARMUP + 2), opts);
  bench("C1 keystroke, 10⁵ tombstones", timed("t1e5", tombstoneKeystroke(100_000), WARMUP + 2), opts);
});

// Each iteration builds its own fixture; the row includes it, the recorded median is the undo alone.
describe("B7 undo of a 50-page deletion (1000 pages)", () => {
  bench(
    "undo (row includes the fixture build and the deletion)",
    () => {
      const { doc } = buildPages(1000);
      const model = new Model(doc);
      const history = new ModelHistory(model, createEditorOrigin());
      const ps = paragraphs(model.version);
      const from = ps[100];
      const to = ps[100 + 50 * PARAS_PER_PAGE];
      if (from === undefined || to === undefined) throw new Error("bench: too few paragraphs");
      const selection: ModelSelection = { anchor: caretAt(from, 0).anchor, focus: caretAt(to, 0).focus };
      const plan = deleteSelection({ version: model.version, selection });
      if (plan === null || history.apply(plan, "command", selection) === null) throw new Error("bench: deletion did nothing");
      const t0 = performance.now();
      if (history.undo() === null) throw new Error("bench: nothing undone");
      record("undo50", performance.now() - t0);
      if (paragraphs(model.version).length !== ps.length) throw new Error("bench: undo did not restore");
      history.destroy();
      model.destroy();
    },
    ONE_SHOT,
  );
});

const exposedGc: unknown = Reflect.get(globalThis, "gc");
if (typeof exposedGc !== "function") console.warn("\n*** B8 SKIPPED: no gc() — run with NODE_OPTIONS=--expose-gc to measure retained memory ***\n");

describe("B8 retained memory of 128 consecutive versions (1000 pages)", () => {
  (typeof exposedGc === "function" ? bench : bench.skip)(
    "128 keystrokes, every version kept",
    () => {
      const gc = exposedGc;
      if (typeof gc !== "function") return;
      const { doc, piece, at } = buildPages(1000);
      const model = new Model(doc);
      const origin = createEditorOrigin();
      const kept: Document[] = [model.version];
      gc();
      gc();
      const h0 = process.memoryUsage().heapUsed;
      for (let i = 0; i < 128; i++) {
        doc.transact(() => piece.insert(at + i, "x"), origin);
        kept.push(model.version);
      }
      gc();
      gc();
      record("mem128", (process.memoryUsage().heapUsed - h0) / (1024 * 1024));
      if (new Set(kept).size !== 129) throw new Error("bench: versions did not change");
      model.destroy();
    },
    { iterations: 3, warmupIterations: 0, time: 0, warmupTime: 0 },
  );
});

afterAll(() => {
  const report = {
    remote110: median("r110"),
    remote1000: median("r1000"),
    remoteRatio: median("r1000") / median("r110"),
    remoteYjsOnly110: median("ry110"),
    remoteYjsOnly1000: median("ry1000"),
    densePiece: median("dense"),
    tombstonesNone: median("t0"),
    tombstones1e5: median("t1e5"),
    tombstoneRatio: median("t1e5") / median("t0"),
    undo50Pages: median("undo50"),
    retained128VersionsMB: median("mem128"),
  };
  console.log("B2/B3/B5/B7/B8 medians (ms; MB for B8)", report);
  const budgets: [keyof typeof report, number][] = [
    ["remote110", 0.1],
    ["remote1000", 0.1],
    ["remoteRatio", 1.5],
    ["densePiece", 0.5],
    ["tombstoneRatio", 2],
    ["undo50Pages", 100],
    ["retained128VersionsMB", 2],
  ];
  // NaN = nothing recorded (skipped / filtered out).
  for (const [k, max] of budgets) if (!Number.isNaN(report[k])) expect(report[k], k).toBeLessThanOrEqual(max);
});

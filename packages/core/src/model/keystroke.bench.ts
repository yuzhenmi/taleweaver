/**
 * B1 — local keystroke derive cost, 110 vs 1000 pages; plus section-break and load
 * (`npx vitest bench --run src/model/keystroke.bench.ts` in packages/core).
 *
 * The run FAILS when a plan budget (build plan P1) is exceeded — checked in
 * `afterAll` on medians this file records itself:
 *   - keystroke ≤ 0.1 ms median at both sizes; 1000-page / 110-page median ratio ≤ 1.5 —
 *     for the raw write and for the C1 command path (Plan + Apply + derive);
 *   - section break at 1000 pages ≤ 50 ms;
 *   - load (from-scratch derive) 110 pages ≤ 200 ms, 1000 pages ≤ 1.5 s.
 *
 * A keystroke = one raw `Y.Text.insert` of one character into a mid-document
 * paragraph, in a local transaction, with the model deriving the next version in the
 * transaction's observer. The `yjs only` rows are the same write with no model, so
 * (model − yjs only) is the derive cost. A page ≈ 45 paragraphs of 80 chars (the
 * eager-model proof's 110-page fixture: 5000 paragraphs); every 25th paragraph is a
 * heading, every 10th has a bold run, every 100th holds a footnote.
 */
import { afterAll, bench, describe, expect } from "vitest";
import { Model } from "./model";
import { deriveDocument } from "./derive/derive-document";
import { BUILTIN_OBJECT_KINDS } from "./object-kinds";
import * as Y from "yjs";
import { createDocMap, getDocMap } from "./storage/doc-map";
import { createEditorOrigin } from "./storage/history-hooks";
import { PIECE_SOFT_MAX } from "./storage/limits";
import { flowOf } from "./storage/map-reads";
import { newParagraphMark, newSectionBreak } from "./storage/new-items";
import { pieceDepth, pieceStructCount } from "./storage/pieces";
import { type PiecePoint, writablePoint } from "./storage/writable-point";
import { buildPages as build } from "./test-helpers/build-pages";
import { insertText } from "./commands/insert-text";
import { applyPlan } from "./plan";
import { type ModelSelection, caretAt } from "./position/model-position";
import { positionAtPoint } from "./position/position-at-point";

// Module-scoped: core's headless lib has no `console` typing.
declare const console: { log(...args: unknown[]): void };


const samples = new Map<string, number[]>();
/**
 * Record `fn`'s times under `name`, discarding the first `skip` calls: tinybench probes a
 * task with one call at the start of the warmup loop and another at the start of the
 * measured loop (2 probes, tinybench 2.9), and runs its warmup iterations in between.
 */
function timed(name: string, fn: () => void, skip: number): () => void {
  const xs: number[] = [];
  samples.set(name, xs);
  let calls = 0;
  return () => {
    const t0 = performance.now();
    fn();
    if (calls++ >= skip) xs.push(performance.now() - t0);
  };
}
function median(name: string): number {
  const xs = [...(samples.get(name) ?? [])].sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)] ?? Number.NaN;
}

function keystroke(pages: number, withModel: boolean, sections = false): () => void {
  const { doc, piece, at } = build(pages, sections);
  if (withModel) new Model(doc);
  const origin = createEditorOrigin();
  let offset = at;
  return () => {
    doc.transact(() => piece.insert(offset++, "x"), origin);
  };
}

/**
 * A keystroke through the C1 command path: Plan (read the version) + Apply (one
 * transaction, piece-size rule included) + derive. Typed into the FIRST piece, which
 * both fixtures build identically, so the two sizes differ only in document size (the
 * mid piece's fill differs between them, and a full piece sends typing to a fresh one).
 */
function commandKeystroke(pages: number): () => void {
  const { doc } = build(pages);
  const docMap = getDocMap(doc);
  const piece = docMap === null ? null : flowOf(docMap)?.get(0);
  if (!(piece instanceof Y.Text)) throw new Error("bench: no first piece");
  const at = Math.floor(piece.length / 2);
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

/**
 * One paragraph of 2000 alternating plain / bold runs (spread over pieces at the cap),
 * typed into its middle via the command path: the Plan reads only the items around
 * the caret, so the paragraph's size does not show.
 */
function longParagraphKeystroke(): () => void {
  const doc = new Y.Doc();
  const docMap = createDocMap(doc);
  const flow = flowOf(docMap);
  const first = flow?.get(0);
  if (flow === null || !(first instanceof Y.Text)) throw new Error("bench: bad root");
  doc.transact(() => {
    let piece = first;
    let idx = 0;
    for (let i = 0; i < 2000; i++) {
      if (pieceStructCount(piece) + 4 > PIECE_SOFT_MAX) {
        const fresh = new Y.Text();
        flow.insert(flow.length - 1, [fresh]); // before the piece holding the ¶
        piece = fresh;
        idx = 0;
      }
      piece.insert(idx, "word ", i % 2 === 0 ? { bold: true } : {});
      idx += 5;
    }
  });
  const model = new Model(doc);
  const origin = createEditorOrigin();
  const id = model.version.trees.block.get(model.version.flows.get(model.version.rootId)?.sections[0]?.id ?? "")?.firstChildId;
  if (id === undefined || id === null) throw new Error("bench: no paragraph");
  let selection: ModelSelection = caretAt(id, 5000 + 2);
  return () => {
    const plan = insertText({ version: model.version, selection }, "x");
    const next = plan === null ? null : applyPlan(model, plan, origin);
    if (next === null) throw new Error("bench: keystroke did nothing");
    selection = next;
  };
}

/** Typing at a spot whose piece is full: after 2·10⁴ hot-spot writes from three clientIDs, writes land in nested sub-flow pieces. */
function subflowKeystroke(): () => void {
  const { doc, piece, at } = build(1000);
  new Model(doc);
  const origin = createEditorOrigin();
  let cur: PiecePoint = { piece, index: at };
  const type = (): void => {
    doc.transact(() => {
      const p = writablePoint(cur);
      p.piece.insert(p.index, "x");
      cur = { piece: p.piece, index: p.index + 1 };
    }, origin);
  };
  for (let i = 0; i < 20_000; i++) {
    doc.clientID = 700 + (i % 3);
    type();
  }
  if (pieceDepth(cur.piece) === 0) throw new Error("bench: the hot spot made no sub-flow");
  return type;
}

describe("B1 keystroke: raw insert + derive", () => {
  const WARMUP = 200;
  const opts = { iterations: 2000, warmupIterations: WARMUP, warmupTime: 0 };
  const skip = WARMUP + 2;
  bench("110 pages, model", timed("k110", keystroke(110, true), skip), opts);
  bench("1000 pages, model", timed("k1000", keystroke(1000, true), skip), opts);
  bench("1000 pages, one section per page, model", timed("kSections", keystroke(1000, true, true), skip), opts);
  bench("1000 pages, typing inside a sub-flowed hot spot, model", timed("kSub", subflowKeystroke(), skip), opts);
  bench("110 pages, C1 command (plan + apply + derive)", timed("c110", commandKeystroke(110), skip), opts);
  bench("1000 pages, C1 command (plan + apply + derive)", timed("c1000", commandKeystroke(1000), skip), opts);
  bench("one paragraph of 2000 runs, C1 command", timed("cLong", longParagraphKeystroke(), skip), opts);
  bench("110 pages, yjs only", keystroke(110, false), opts);
  bench("1000 pages, yjs only", keystroke(1000, false), opts);
});

// vitest passes no per-iteration hook to tinybench, so each iteration builds its own
// fresh document; the row's time includes that build, the recorded (asserted) median
// is the section-break transaction alone.
describe("section break (C15 shape: ¶ + [S] mid-paragraph), first break in a one-section document", () => {
  for (const pages of [110, 1000]) {
    const xs: number[] = [];
    samples.set(`s${pages}`, xs);
    bench(
      `${pages} pages, model (row includes the fixture build)`,
      () => {
        const { doc, piece, at } = build(pages);
        new Model(doc);
        const t0 = performance.now();
        doc.transact(() => {
          piece.insertEmbed(at, newParagraphMark());
          piece.insertEmbed(at + 1, newSectionBreak());
        });
        xs.push(performance.now() - t0);
      },
      { iterations: 5, warmupIterations: 0, time: 0, warmupTime: 0 },
    );
  }
});

describe("load: from-scratch derive", () => {
  const d110 = build(110).doc;
  const d1000 = build(1000).doc;
  bench("110 pages", timed("l110", () => void deriveDocument(d110, BUILTIN_OBJECT_KINDS), 2), { iterations: 10, warmupIterations: 0, warmupTime: 0 });
  bench("1000 pages", timed("l1000", () => void deriveDocument(d1000, BUILTIN_OBJECT_KINDS), 2), { iterations: 3, warmupIterations: 0, warmupTime: 0 });
});

afterAll(() => {
  const k110 = median("k110");
  const k1000 = median("k1000");
  const report = {
    keystroke110: k110,
    keystroke1000: k1000,
    keystroke1000Sections: median("kSections"),
    keystrokeSubflow: median("kSub"),
    command110: median("c110"),
    command1000: median("c1000"),
    commandRatio: median("c1000") / median("c110"),
    commandLongParagraph: median("cLong"),
    ratio: k1000 / k110,
    sectionBreak110: median("s110"),
    sectionBreak1000: median("s1000"),
    load110: median("l110"),
    load1000: median("l1000"),
  };
  console.log("B1 medians (ms)", report);
  expect(report.keystroke110).toBeLessThanOrEqual(0.1);
  expect(report.keystroke1000).toBeLessThanOrEqual(0.1);
  expect(report.ratio).toBeLessThanOrEqual(1.5);
  expect(report.keystroke1000Sections).toBeLessThanOrEqual(0.1);
  expect(report.keystrokeSubflow).toBeLessThanOrEqual(0.1);
  expect(report.command110).toBeLessThanOrEqual(0.1);
  expect(report.command1000).toBeLessThanOrEqual(0.1);
  expect(report.commandRatio).toBeLessThanOrEqual(1.5);
  expect(report.commandLongParagraph).toBeLessThanOrEqual(0.1);
  expect(report.sectionBreak1000).toBeLessThanOrEqual(50);
  expect(report.load110).toBeLessThanOrEqual(200);
  expect(report.load1000).toBeLessThanOrEqual(1500);
});

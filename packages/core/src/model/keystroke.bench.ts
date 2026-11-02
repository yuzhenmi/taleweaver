/**
 * B1 — local keystroke derive cost, 110 vs 1000 pages; plus section-break and load
 * (`npx vitest bench --run src/model/keystroke.bench.ts` in packages/core).
 *
 * The run FAILS when a plan budget (build plan P1) is exceeded — checked in
 * `afterAll` on medians this file records itself:
 *   - keystroke ≤ 0.1 ms median at both sizes; 1000-page / 110-page median ratio ≤ 1.5;
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
import { deriveDocument } from "./derive";
import { BUILTIN_OBJECT_KINDS } from "./object-kinds";
import { createEditorOrigin, newParagraphMark, newSectionBreak, pieceDepth, writablePoint, type PiecePoint } from "./storage";
import { buildPages as build } from "./test-helpers";

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
  expect(report.sectionBreak1000).toBeLessThanOrEqual(50);
  expect(report.load110).toBeLessThanOrEqual(200);
  expect(report.load1000).toBeLessThanOrEqual(1500);
});

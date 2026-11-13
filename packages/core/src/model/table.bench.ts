/**
 * N1 table load / size (kill signal; P2 plan B10 / B11 load and size rows), run with
 * `npx vitest bench --run src/model/table.bench.ts` in packages/core. The run FAILS when
 * a budget is exceeded (checked in `afterAll` on the recorded medians):
 *   - load (applyUpdate into a fresh doc + Model derive) of 10⁴ × 3 and of 50 × 10³
 *     tables, each cell holding 10 characters: ≤ 1.5 s;
 *   - encoded size of the 50 × 10³ table: ≤ 6 MB (K4's schema-3 ratio is
 *     `src/k4-table.bench.ts`, outside model/).
 * N2 (K-d, the structural incremental update; raw writes + derive):
 *   - a keystroke in a cell's first paragraph at row 5000 of 10⁴ × 3: ≤ 0.1 ms, and
 *     ≤ 1.5 × the same in a 10² × 3 table; a keystroke right after the table: ≤ 0.1 ms;
 *   - a first keystroke into an empty cell (`⟨c⟩¶`) at row 5000: ≤ 0.1 ms;
 *   - insert / delete a row at row 5000 of 10⁴ × 3: ≤ 30 ms each.
 * N4 (the real command, plan + apply + derive; a fresh document each iteration, not timed):
 *   - insert a column (`insertColumn`, caret in a middle-row cell) in 1000 × 50: ≤ 100 ms. Both ops' 10⁴ × 3 is
 *     reported, not budgeted: tables past ~1000 rows are not realistic in a word processor; the cost is O(rows), as in Word.
 *   - delete a column (`deleteColumn`): reported, not budgeted. About half its time is Yjs's own transaction cleanup
 *     (`tryToMergeWithLefts` splicing the struct array once per deleted cell range), outside the engine.
 */
import { afterAll, bench, describe, expect } from "vitest";
import * as Y from "yjs";
import type { CommandContext } from "./commands/command-context";
import { deleteColumn } from "./commands/table/delete-column";
import { insertColumn } from "./commands/table/insert-column";
import { Model } from "./model";
import { applyPlan } from "./plan";
import { caretAt } from "./position/model-position";
import { createEditorOrigin } from "./storage/history-hooks";
import { getDocMap } from "./storage/doc-map";
import { flowOf } from "./storage/map-reads";
import { newParagraphMark } from "./storage/new-items";
import { newCellMark, newRowMark } from "./storage/table-marks";
import { buildTable } from "./test-helpers/build-table";

declare const console: { log(...args: unknown[]): void };

const samples = new Map<string, number[]>();
function median(name: string): number {
  const xs = [...(samples.get(name) ?? [])].sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)] ?? Number.NaN;
}

const CELL = "0123456789";
const SHAPES = [
  { name: "10⁴ × 3", rows: 10_000, cols: 3 },
  { name: "50 × 10³", rows: 1_000, cols: 50 },
] as const;
const updates = new Map(SHAPES.map((s) => [s.name, Y.encodeStateAsUpdate(buildTable(s.rows, s.cols, CELL))]));

describe("N1 table load", () => {
  for (const s of SHAPES) {
    const update = updates.get(s.name) ?? new Uint8Array();
    bench(
      `load ${s.name}`,
      () => {
        const t0 = performance.now();
        const doc = new Y.Doc();
        Y.applyUpdate(doc, update);
        const m = new Model(doc);
        const xs = samples.get(s.name) ?? [];
        samples.set(s.name, xs);
        xs.push(performance.now() - t0);
        m.destroy();
      },
      { iterations: 5, warmupIterations: 0, warmupTime: 0, time: 0 },
    );
  }
});

/**
 * A live model over a `rows × 3` table; `mid`: the piece holding row ≈ rows / 2, and `at`: the index right after
 * its first ⟨c⟩ (a small table has one piece, which starts with the ⟦).
 */
function liveTable(rows: number, text: string): { doc: Y.Doc; mid: Y.Text; at: number; last: Y.Text; model: Model } {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(buildTable(rows, 3, text)));
  const docMap = getDocMap(doc);
  const pieces = (docMap === null ? null : flowOf(docMap))?.toArray() ?? [];
  const mid = pieces[Math.floor((pieces.length - 1) / 2)];
  const last = pieces[pieces.length - 1];
  if (!(mid instanceof Y.Text) || !(last instanceof Y.Text)) throw new Error("bench: no pieces");
  return { doc, mid, at: mid === pieces[0] ? 3 : 2, last, model: new Model(doc) };
}

function timed(name: string, fn: () => void): () => void {
  const xs: number[] = [];
  samples.set(name, xs);
  return () => {
    const t0 = performance.now();
    fn();
    xs.push(performance.now() - t0);
  };
}

const opts = { iterations: 200, warmupIterations: 20, time: 0 };
const origin = createEditorOrigin();

describe("N2 K-d: keystrokes and row edits in a large table", () => {
  for (const rows of [100, 10_000]) {
    const t = liveTable(rows, CELL);
    bench(`keystroke in a cell's first paragraph, ${rows} × 3`, timed(`k${rows}`, () => t.doc.transact(() => t.mid.insert(t.at, "x"), origin)), opts);
  }
  const after = liveTable(10_000, CELL);
  // The flow's own last piece holds the ¶ after the table: typing there has the ⟧ as its left anchor.
  bench("keystroke right after the table, 10⁴ × 3", timed("kAfter", () => after.doc.transact(() => after.last.insert(0, "x"), origin)), opts);
  const empty = liveTable(10_000, "");
  bench("first keystroke into an empty cell, 10⁴ × 3", timed("kEmpty", () => empty.doc.transact(() => empty.mid.insert(empty.at, "x"), origin)), opts);
  const rowT = liveTable(10_000, CELL);
  let inserted = false;
  const units = (): (string | Y.Map<unknown>)[] => [newRowMark(0), ...[0, 1, 2].flatMap(() => [newCellMark(0), CELL, newParagraphMark()])];
  const rowLength = 1 + 3 * (2 + CELL.length);
  const rowEdit = (): void =>
    rowT.doc.transact(() => {
      if (inserted) rowT.mid.delete(0, rowLength);
      else {
        let i = 0;
        for (const u of units()) {
          if (typeof u === "string") rowT.mid.insert(i, u);
          else rowT.mid.insertEmbed(i, u);
          i += typeof u === "string" ? u.length : 1;
        }
      }
      inserted = !inserted;
    }, origin);
  bench("insert / delete a row at row ≈ 5000, 10⁴ × 3", timed("row", rowEdit), { iterations: 40, warmupIterations: 4, time: 0 });
});

const COLUMN_OPS = [
  { key: "col", label: "insert a column", run: (ctx: CommandContext) => insertColumn(ctx, "right") },
  { key: "del", label: "delete a column", run: deleteColumn },
] as const;

describe("N4: insert / delete a column through the command", () => {
  for (const { op, s } of COLUMN_OPS.flatMap((op) => SHAPES.map((s) => ({ op, s })))) {
    const update = updates.get(s.name) ?? new Uint8Array();
    const all: number[] = [];
    const plans: number[] = [];
    samples.set(`${op.key} ${s.name}`, all);
    samples.set(`${op.key}Plan ${s.name}`, plans);
    bench(
      `${op.label}, ${s.name}`,
      () => {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, update);
        const model = new Model(doc);
        const d = model.version;
        // A caret in the first cell of the middle row.
        const tableId = d.trees.block.get(d.trees.block.get(d.rootId)?.firstChildId ?? "")?.firstChildId ?? "";
        let row = d.trees.block.get(tableId)?.firstChildId ?? null;
        for (let i = 0; i < s.rows / 2 && row !== null; i++) row = d.trees.block.get(row)?.nextSiblingId ?? null;
        const cell = d.trees.block.get(row ?? "")?.firstChildId ?? "";
        const para = d.trees.block.get(cell)?.firstChildId ?? "";
        const t0 = performance.now();
        const plan = op.run({ version: d, selection: caretAt(para, 0) });
        const t1 = performance.now();
        if (plan === null || applyPlan(model, plan, origin) === null) throw new Error(`bench: ${op.label} did not apply`);
        all.push(performance.now() - t0);
        plans.push(t1 - t0);
        model.destroy();
      },
      { iterations: 5, warmupIterations: 1, warmupTime: 0, time: 0 },
    );
  }
});

afterAll(() => {
  const size = updates.get("50 × 10³")?.length ?? Number.NaN;
  console.log(`N1 tables: load 10⁴×3 ${median("10⁴ × 3").toFixed(0)} ms, 50×10³ ${median("50 × 10³").toFixed(0)} ms; 50×10³ encoded ${(size / 1e6).toFixed(2)} MB`);
  for (const s of SHAPES) if (samples.has(s.name)) expect(median(s.name)).toBeLessThanOrEqual(1500);
  if (samples.has("10⁴ × 3")) expect(size).toBeLessThanOrEqual(6e6);
  for (const op of COLUMN_OPS) {
    if ((samples.get(`${op.key} 10⁴ × 3`)?.length ?? 0) === 0) continue;
    const line = SHAPES.map((x) => `${x.name} ${median(`${op.key} ${x.name}`).toFixed(1)} ms (plan ${median(`${op.key}Plan ${x.name}`).toFixed(1)} ms)`).join(", ");
    console.log(`N4 ${op.label}: ${line}`);
    if (op.key === "col") expect(median("col 50 × 10³")).toBeLessThanOrEqual(100);
  }
  if (samples.has("k10000")) {
    console.log(
      `N2 K-d: keystroke 10²×3 ${median("k100").toFixed(4)} ms, 10⁴×3 ${median("k10000").toFixed(4)} ms; after the table ${median("kAfter").toFixed(4)} ms; ` +
        `empty cell ${median("kEmpty").toFixed(4)} ms; row insert / delete ${median("row").toFixed(2)} ms`,
    );
    expect(median("k10000")).toBeLessThanOrEqual(0.1);
    expect(median("k10000")).toBeLessThanOrEqual(1.5 * median("k100"));
    expect(median("kAfter")).toBeLessThanOrEqual(0.1);
    expect(median("kEmpty")).toBeLessThanOrEqual(0.1);
    expect(median("row")).toBeLessThanOrEqual(30);
  }
});

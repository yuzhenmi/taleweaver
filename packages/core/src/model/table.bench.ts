/**
 * N1 table load / size (kill signal; P2 plan B10 / B11 load and size rows), run with
 * `npx vitest bench --run src/model/table.bench.ts` in packages/core. The run FAILS when
 * a budget is exceeded (checked in `afterAll` on the recorded medians):
 *   - load (applyUpdate into a fresh doc + Model derive) of 10⁴ × 3 and of 50 × 10³
 *     tables, each cell holding 10 characters: ≤ 1.5 s;
 *   - encoded size of the 50 × 10³ table: ≤ 6 MB (K4's schema-3 ratio is
 *     `src/k4-table.bench.ts`, outside model/).
 */
import { afterAll, bench, describe, expect } from "vitest";
import * as Y from "yjs";
import { Model } from "./model";
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

afterAll(() => {
  const size = updates.get("50 × 10³")?.length ?? Number.NaN;
  console.log(`N1 tables: load 10⁴×3 ${median("10⁴ × 3").toFixed(0)} ms, 50×10³ ${median("50 × 10³").toFixed(0)} ms; 50×10³ encoded ${(size / 1e6).toFixed(2)} MB`);
  for (const s of SHAPES) if (samples.has(s.name)) expect(median(s.name)).toBeLessThanOrEqual(1500);
  if (samples.size > 0) expect(size).toBeLessThanOrEqual(6e6);
});

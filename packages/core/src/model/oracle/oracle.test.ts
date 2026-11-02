/**
 * The oracle (r7 §10): CI runs ORACLE_SEEDS (default 200) seeds × ORACLE_STEPS (200)
 * steps, each seed once with 3 peers and once as a single-user run; the classified
 * firing counts are printed (multi-peer firings are reported, never failed), with the
 * `yjs-undo` bucket: known stock-Yjs UndoManager inexactness at undo / redo steps. The
 * default range (200 × 200) has none, and CI asserts that; other ranges (surveys)
 * only report it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { deriveDocument } from "../derive";
import { BUILTIN_OBJECT_KINDS } from "../object-kinds";
import { ITEM_KINDS, KIND_KEY } from "../storage";
import { fixture } from "../test-helpers";
import { envNumber } from "./generate";
import { firingsOf, runSeed } from "./oracle";

declare const console: { log(...args: unknown[]): void };

// Yield between chunks: long synchronous chunks starve the worker's RPC (vitest's onTaskUpdate timeout).
beforeEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const seeds = envNumber("ORACLE_SEEDS", 200);
const steps = envNumber("ORACLE_STEPS", 200);
const CHUNK = 25;
/** The default range, whose yjs-undo count is asserted (0). */
const ci = seeds === 200 && steps === 200;

describe("oracle: firingsOf", () => {
  // Seed 4480: an inert map after the final ¶ counted as debris, though the read skips it.
  it("skips maps the read treats as inert (unknown kind, invalid marker)", () => {
    for (const fields of [{ [KIND_KEY]: "nope" }, { [KIND_KEY]: ITEM_KINDS.marker, ns: "bm", id: "1", edge: "middle" }]) {
      const f = fixture(1, undefined, false);
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(fields)) m.set(k, v);
      f.piece.insertEmbed(f.piece.length, m);
      const fs = deriveDocument(f.doc, BUILTIN_OBJECT_KINDS).flows.get(f.rootId);
      expect(fs).toBeDefined();
      if (fs !== undefined) expect(firingsOf(fs)).toEqual([]);
    }
  });
});

describe("oracle: O1–O7", () => {
  // 572 / 3708 / 4709 / 7172 / 7473: fullSync left structs pending.
  it("regression seeds (3 peers)", () => {
    for (const seed of [572, 3708, 4709, 7172, 7473]) runSeed(seed, 3, steps);
  }, 600_000);
  const total = new Map<string, number>();
  const yjsUndo: string[] = [];
  for (let from = 1; from <= seeds; from += CHUNK) {
    const to = Math.min(seeds, from + CHUNK - 1);
    it(`seeds ${from}–${to} × ${steps} steps: 3 peers (partial / shuffled delivery) and single user`, () => {
      const chunkYjsUndo: string[] = [];
      for (let seed = from; seed <= to; seed++) {
        const one = runSeed(seed, 1, steps);
        const three = runSeed(seed, 3, steps);
        for (const [q, n] of three.quirks) total.set(q, (total.get(q) ?? 0) + n);
        // Known stock-Yjs UndoManager inexactness (accepted; counted, asserted 0 on the default range).
        for (const [run, r] of [["1", one], ["3", three]] as const) {
          for (const x of r.yjsUndo) {
            const k = `yjs-undo:${run}p:${x.slice(x.lastIndexOf(" ") + 1)}`;
            total.set(k, (total.get(k) ?? 0) + 1);
            yjsUndo.push(`${run}p ${x}`);
            chunkYjsUndo.push(`${run}p ${x}`);
          }
        }
      }
      if (to === seeds) {
        console.log(`oracle: ${seeds} seeds × ${steps} steps, quirk instances`, Object.fromEntries([...total].sort()));
        if (yjsUndo.length > 0) console.log("oracle: yjs-undo events (an O1 one stops that peer's early checks)", yjsUndo.slice(0, 50).join("\n"));
      }
      if (ci) expect(chunkYjsUndo).toEqual([]);
    }, 600_000);
  }
});

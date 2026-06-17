// F-3: the §4.4 width-convergence driver. A pure iterate-to-fixpoint that grows
// page-field reservations until every field's resolved value width fits its
// reservation (or a bound/oscillation backstop fires). Tested with a SYNTHETIC
// `runIteration` returning controlled page counts + widths, so the control flow
// (converge / grow / bound / 2-cycle pin) is locked deterministically — independent
// of the real layout plumbing (which the producer integration test exercises).

import { describe, it, expect } from "vitest";
import {
  runFieldConvergence,
  MAX_FIELD_CONVERGENCE_ITERATIONS,
  type ConvergenceField,
} from "./field-convergence";

/** A field reserved at `reservedWidth` px. */
function field(embedKey: string, reservedWidth: number): ConvergenceField {
  return { embedKey, reservedWidth };
}

describe("runFieldConvergence (F-3 §4.4)", () => {
  it("converges in ONE pass when no value overflows its reservation", () => {
    const fields = [field("f", 16)];
    let calls = 0;
    const out = runFieldConvergence(fields, (grownWidths) => {
      calls += 1;
      expect(grownWidths.size).toBe(0); // never grows
      return { pageCount: 3, maxValueWidthByKey: new Map([["f", 8]]) }; // 8 ≤ 16
    });
    expect(calls).toBe(1);
    expect(out.converged).toBe(true);
    expect(out.iterations).toBe(1);
    expect(out.grownWidths.size).toBe(0);
    expect(out.result.pageCount).toBe(3);
  });

  it("grows an overflowing field's reservation and re-runs until it fits", () => {
    const fields = [field("f", 16)];
    const widthsSeen: number[] = [];
    const out = runFieldConvergence(fields, (grownWidths) => {
      const reserved = grownWidths.get("f") ?? 16;
      widthsSeen.push(reserved);
      // The value needs 24px (3 glyphs). It fits only once the reservation is grown to ≥ 24.
      return { pageCount: 120, maxValueWidthByKey: new Map([["f", 24]]) };
    });
    expect(out.converged).toBe(true);
    expect(widthsSeen).toEqual([16, 24]); // pass 1 at reserved 16 (overflow) → grow to 24 → fits
    expect(out.grownWidths.get("f")).toBe(24);
    expect(out.iterations).toBe(2);
  });

  it("grows ONLY the overflowing field, leaving a fitting field at its reservation", () => {
    const fields = [field("a", 16), field("b", 16)];
    const out = runFieldConvergence(fields, () => ({
      pageCount: 100,
      maxValueWidthByKey: new Map([
        ["a", 8], // always fits 16 ⇒ never grown
        ["b", 24], // always needs 24 ⇒ grown from 16 to 24, then fits
      ]),
    }));
    expect(out.converged).toBe(true);
    expect(out.grownWidths.has("a")).toBe(false); // never grown
    expect(out.grownWidths.get("b")).toBe(24);
  });

  it("is grow-only: a reservation never shrinks even if a later value is narrower", () => {
    // Models roman non-monotonicity: pass 1 value is wide ("viii" 32px), the grown
    // header adds a page so the value becomes narrow ("ix" 16px) — the reservation
    // stays at 32 (grow-only), never dropping back.
    const fields = [field("r", 16)];
    let pass = 0;
    const out = runFieldConvergence(fields, (grownWidths) => {
      pass += 1;
      const reserved = grownWidths.get("r") ?? 16;
      if (reserved < 32) return { pageCount: 8, maxValueWidthByKey: new Map([["r", 32]]) }; // "viii"
      return { pageCount: 9, maxValueWidthByKey: new Map([["r", 16]]) }; // "ix" — fits 32
    });
    expect(out.converged).toBe(true);
    expect(out.grownWidths.get("r")).toBe(32); // grown, not shrunk back to 16
    expect(out.result.pageCount).toBe(9);
    expect(pass).toBe(2);
  });

  it("stops at MAX_FIELD_CONVERGENCE_ITERATIONS and returns the largest (safe over-)reservation", () => {
    // A pathological field whose required width ALWAYS exceeds its reservation by 1px
    // (never converges). The loop must terminate at the bound, returning the largest seen.
    const fields = [field("f", 10)];
    let calls = 0;
    const out = runFieldConvergence(fields, (grownWidths) => {
      calls += 1;
      const reserved = grownWidths.get("f") ?? 10;
      return { pageCount: 100 + calls, maxValueWidthByKey: new Map([["f", reserved + 1]]) };
    });
    expect(out.converged).toBe(false);
    expect(out.iterations).toBe(MAX_FIELD_CONVERGENCE_ITERATIONS);
    // grow-only ⇒ final reservation is the largest produced.
    expect(out.grownWidths.get("f")).toBeGreaterThanOrEqual(10);
  });

  it("pins to the larger page count on a 2-cycle oscillation (count A→B→A)", () => {
    // Force an oscillation: the synthetic iteration alternates page count 8↔9 while
    // always demanding more width. The pin must stop and return the LARGER count (9).
    const fields = [field("f", 10)];
    const counts = [8, 9, 8, 9, 8];
    let i = 0;
    const out = runFieldConvergence(fields, (grownWidths) => {
      const reserved = grownWidths.get("f") ?? 10;
      const pageCount = counts[Math.min(i, counts.length - 1)] ?? 8;
      i += 1;
      return { pageCount, maxValueWidthByKey: new Map([["f", reserved + 1]]) };
    });
    // The pin fires when a previously-seen count (8) reappears; it returns the
    // result of a final pass with the larger reservations, whose count is the larger (9).
    expect(out.result.pageCount).toBe(9);
  });

  it("never exceeds the bound even when the pin fires (no MAX+1 overrun)", () => {
    // Oscillate from iteration 1 (8↔9) AND always grow, so the pin would fire early
    // every time. Assert the total `runIteration` count never exceeds the bound.
    const fields = [field("f", 10)];
    let calls = 0;
    const out = runFieldConvergence(
      fields,
      (grownWidths) => {
        calls += 1;
        const reserved = grownWidths.get("f") ?? 10;
        return { pageCount: calls % 2 === 0 ? 9 : 8, maxValueWidthByKey: new Map([["f", reserved + 1]]) };
      },
      3, // small explicit bound
    );
    expect(calls).toBeLessThanOrEqual(3);
    expect(out.iterations).toBe(calls);
    expect(out.iterations).toBeLessThanOrEqual(3);
  });

  it("handles an empty field list as a single pass (no convergence work)", () => {
    let calls = 0;
    const out = runFieldConvergence([], () => {
      calls += 1;
      return { pageCount: 5, maxValueWidthByKey: new Map() };
    });
    expect(calls).toBe(1);
    expect(out.converged).toBe(true);
    expect(out.result.pageCount).toBe(5);
  });

  it("tolerates sub-pixel float widths within epsilon (no spurious growth)", () => {
    const fields = [field("f", 16)];
    let calls = 0;
    runFieldConvergence(fields, (grownWidths) => {
      calls += 1;
      expect(grownWidths.size).toBe(0);
      return { pageCount: 2, maxValueWidthByKey: new Map([["f", 16.0001]]) }; // within epsilon of 16
    });
    expect(calls).toBe(1); // did not grow on a sub-pixel overflow
  });
});

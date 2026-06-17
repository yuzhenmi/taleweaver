import { describe, it, expect, beforeEach } from "vitest";
import {
  setPerfTraceEnabled, isPerfTraceEnabled,
  markStart, markEnd, report, resetPerfTrace,
  recordSample,
} from "./perf-trace";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

describe("PerfTrace", () => {
  beforeEach(() => {
    setPerfTraceEnabled(false);
    resetPerfTrace();
  });

  it("is a no-op when disabled", () => {
    expect(isPerfTraceEnabled()).toBe(false);
    const t = markStart("foo");
    markEnd("foo", t);
    expect(report().entries).toEqual([]);
  });

  it("accumulates totals when enabled", () => {
    setPerfTraceEnabled(true);
    const t = markStart("foo");
    markEnd("foo", t);
    const r = report();
    expect(r.entries.length).toBe(1);
    expect(nth(r.entries, 0, "entry").label).toBe("foo");
    expect(nth(r.entries, 0, "entry").count).toBe(1);
    expect(nth(r.entries, 0, "entry").totalMs).toBeGreaterThanOrEqual(0);
  });

  it("sorts report by descending totalMs", () => {
    setPerfTraceEnabled(true);
    // Run "fast" 100 times and "slow" 1 time; "slow" sleeps via busy wait.
    for (let i = 0; i < 100; i++) {
      const t = markStart("fast");
      markEnd("fast", t);
    }
    const t = markStart("slow");
    const start = performance.now();
    while (performance.now() - start < 5) { /* spin 5ms */ }
    markEnd("slow", t);

    const r = report();
    expect(nth(r.entries, 0, "entry").label).toBe("slow");
  });

  it("resets cleanly", () => {
    setPerfTraceEnabled(true);
    const t = markStart("foo");
    markEnd("foo", t);
    resetPerfTrace();
    expect(report().entries).toEqual([]);
  });

  it("recordSample accumulates pre-measured durations", () => {
    setPerfTraceEnabled(true);
    recordSample("foo", 5);
    recordSample("foo", 7);
    const r = report();
    expect(nth(r.entries, 0, "entry").label).toBe("foo");
    expect(nth(r.entries, 0, "entry").count).toBe(2);
    expect(nth(r.entries, 0, "entry").totalMs).toBe(12);
    expect(nth(r.entries, 0, "entry").avgMs).toBe(6);
  });

  it("recordSample is a no-op when disabled", () => {
    setPerfTraceEnabled(false);
    recordSample("foo", 5);
    expect(report().entries).toEqual([]);
  });
});

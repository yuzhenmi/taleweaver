import { describe, it, expect, beforeEach } from "vitest";
import {
  setPerfTraceEnabled, isPerfTraceEnabled,
  markStart, markEnd, report, resetPerfTrace,
} from "./perf-trace";

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
    expect(r.entries[0].label).toBe("foo");
    expect(r.entries[0].count).toBe(1);
    expect(r.entries[0].totalMs).toBeGreaterThanOrEqual(0);
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
    expect(r.entries[0].label).toBe("slow");
  });

  it("resets cleanly", () => {
    setPerfTraceEnabled(true);
    const t = markStart("foo");
    markEnd("foo", t);
    resetPerfTrace();
    expect(report().entries).toEqual([]);
  });
});

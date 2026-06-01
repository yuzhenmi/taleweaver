let enabled = false;
const counts = new Map<string, number>();
const totals = new Map<string, number>();

export function setPerfTraceEnabled(value: boolean): void {
  enabled = value;
}

export function isPerfTraceEnabled(): boolean {
  return enabled;
}

/** Start a measurement region. Returns a token to pass to `markEnd`. */
export function markStart(_label: string): number {
  if (!enabled) return 0;
  return performance.now();
}

/** End a measurement region. The token must come from a paired `markStart`. */
export function markEnd(label: string, startToken: number): void {
  if (!enabled) return;
  const elapsed = performance.now() - startToken;
  counts.set(label, (counts.get(label) ?? 0) + 1);
  totals.set(label, (totals.get(label) ?? 0) + elapsed);
}

export interface PerfReport {
  readonly entries: ReadonlyArray<{
    readonly label: string;
    readonly count: number;
    readonly totalMs: number;
    readonly avgMs: number;
  }>;
}

/** Snapshot the current accumulated measurements. */
export function report(): PerfReport {
  const entries = [];
  for (const [label, total] of totals) {
    const count = counts.get(label) ?? 0;
    entries.push({ label, count, totalMs: total, avgMs: count > 0 ? total / count : 0 });
  }
  entries.sort((a, b) => b.totalMs - a.totalMs);
  return { entries };
}

/** Record a pre-measured duration. Useful for callbacks that already provide elapsed ms (e.g., React.Profiler). */
export function recordSample(label: string, ms: number): void {
  if (!enabled) return;
  counts.set(label, (counts.get(label) ?? 0) + 1);
  totals.set(label, (totals.get(label) ?? 0) + ms);
}

/** Reset all measurements (useful between scenarios). */
export function resetPerfTrace(): void {
  counts.clear();
  totals.clear();
}

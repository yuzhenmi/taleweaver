# Plan 3.K.1 — Performance Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 10K-paragraph perf fixture, instrument the mutation and read paths with `performance.mark`, capture baseline measurements, and identify the top performance offenders. Output is a dataset that drives Plan 3.K.2's fix prioritization. No fixes ship in this phase — measurement only.

**Architecture:** Add a `PerfTrace` module in `packages/core` that wraps `performance.mark`/`measure` and is gated by a runtime flag. Instrument every major pass on both the mutation path (cascade, layout, IFC, paint) and the read path (cursor-position, hit-test, selection-geometry, React subscription, React render). Add a fixture loader to the React example app that constructs an N-paragraph synthetic document. Run measurements at 1K / 5K / 10K paragraph fixture sizes and capture the per-phase ms breakdown for character insertion and cursor movement.

**Spec reference:** `docs/superpowers/specs/2026-04-29-plan-3k-performance-design.md`.

**Branch:** `feature/dom-architecture-redesign`.

---

## Worktree discipline

All work in `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign`. Pre-flight check on every task. Use absolute paths and `git -C <worktree>` for git.

---

## Task list overview

| Task | Subject |
|---|---|
| **1** | `PerfTrace` module: flag-gated `markStart` / `markEnd` / `report` with zero overhead when off |
| **2** | Perf fixture: synthetic N-paragraph document generator + React example loader |
| **3** | Instrument mutation path: cascade, layout dispatch, per-FC, IFC re-wrap, paint walk + draw |
| **4** | Instrument read path: cursor-position, hit-test, selection-geometry, React subscription + render |
| **5** | Baseline measurement: 1K / 5K / 10K paragraph fixture, capture insertion + cursor + selection numbers |
| **6** | Analyze data; write `2026-04-29-plan-3k1-baseline-results.md`; recommend Plan 3.K.2 priority |

---

## Task 1: `PerfTrace` module

**Files:**
- Create: `packages/core/src/perf/perf-trace.ts`
- Test: `packages/core/src/perf/perf-trace.test.ts`
- Export: `packages/core/src/index.ts`

**Design:** A small module with a runtime-toggleable flag. When off, all `markStart`/`markEnd` calls are no-ops with negligible overhead. When on, they call `performance.mark` and `performance.measure` and accumulate into named buckets that can be reported as a per-pass total.

```ts
// packages/core/src/perf/perf-trace.ts

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
export function markStart(label: string): number {
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

/** Reset all measurements (useful between scenarios). */
export function resetPerfTrace(): void {
  counts.clear();
  totals.clear();
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/perf/perf-trace.test.ts
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
```

- [ ] **Step 2: Implement `perf-trace.ts`** (code above)

- [ ] **Step 3: Run tests**

```bash
npm test --workspace=packages/core -- src/perf/
```

Expected: 4/4 pass.

- [ ] **Step 4: Add export to `packages/core/src/index.ts`**

```ts
export {
  setPerfTraceEnabled, isPerfTraceEnabled,
  markStart, markEnd, report, resetPerfTrace,
  type PerfReport,
} from "./perf/perf-trace";
```

- [ ] **Step 5: Build core package**

```bash
npm run build --workspace=packages/core
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/perf/ packages/core/src/index.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(core): PerfTrace module for runtime-flagged latency tracking"
```

## Task 2: Perf fixture + React example loader

**Files:**
- Create: `examples/react/src/perf-fixture.ts`
- Modify: `examples/react/src/main.tsx` (or wherever the editor is initialized) — detect `?perfFixture=N` query param and load the fixture instead of the default doc.

**Design:** A function that builds an `EditorState` containing N paragraphs of synthetic text (e.g., "Lorem ipsum dolor sit amet, consectetur ..." truncated/repeated to ~80 chars per paragraph).

- [ ] **Step 1: Read existing example app structure**

```bash
ls examples/react/src/ ; cat examples/react/src/main.tsx
```

Identify how the default `EditorState` is constructed.

- [ ] **Step 2: Write `perf-fixture.ts`**

```ts
// examples/react/src/perf-fixture.ts
import type { EditorState } from "@taleweaver/core";
// Use whichever createInitialEditorState helper the example app already uses.
// (Look in examples/react/src/main.tsx for the pattern.)

const SAMPLE_TEXT = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.";
// ~88 chars; truncate to 80 in the generator.

export function buildPerfFixture(paragraphCount: number, charsPerParagraph: number = 80): EditorState {
  const paragraphs: Array<{ type: "paragraph"; children: Array<{ type: "text"; text: string }> }> = [];
  const text = SAMPLE_TEXT.slice(0, charsPerParagraph);
  for (let i = 0; i < paragraphCount; i++) {
    paragraphs.push({ type: "paragraph", children: [{ type: "text", text }] });
  }
  // Use the same factory the example app uses to wrap into a doc state.
  // (Pattern to follow: see examples/react/src/main.tsx default-state construction.)
  return /* createInitialEditorState({ children: paragraphs }) */ null as never;
}

export function tryLoadPerfFixtureFromUrl(): EditorState | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const n = params.get("perfFixture");
  if (!n) return null;
  const count = parseInt(n, 10);
  if (Number.isNaN(count) || count <= 0) return null;
  return buildPerfFixture(count);
}
```

(Subagent: read the actual `main.tsx` to wire `buildPerfFixture` into the same shape the existing default state uses.)

- [ ] **Step 3: Wire into `main.tsx`**

In the example app's entry point, replace the default-state construction with:

```ts
import { tryLoadPerfFixtureFromUrl } from "./perf-fixture";

const initialState = tryLoadPerfFixtureFromUrl() ?? buildDefaultState();
```

- [ ] **Step 4: Smoke-test**

```bash
npm run dev --workspace=examples/react
```

In browser:
- `http://localhost:5173/` → default doc loads.
- `http://localhost:5173/?perfFixture=100` → 100-paragraph doc loads.
- `http://localhost:5173/?perfFixture=10000` → 10K-paragraph doc loads (will be slow on first paint; that's expected).

- [ ] **Step 5: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add examples/react/src/
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(examples/react): perf fixture loader via ?perfFixture=N URL param"
```

## Task 3: Instrument mutation path

**Files to instrument:**
- `packages/core/src/cascade/cascade-pass.ts` — wrap `cascadePass` body.
- `packages/core/src/layout/dispatch.ts` — wrap `layoutTree` and `layoutTreeIncremental` bodies, plus per-FC dispatch.
- `packages/core/src/layout/bfc.ts` — wrap `layoutBlock` entry.
- `packages/core/src/layout/ifc.ts` — wrap `layoutInlineContent` and `wrapAll` entries.
- `packages/core/src/layout/table-fc.ts` — wrap `layoutTable` entry.
- `packages/dom/src/canvas-renderer.ts` — wrap `paintCanvas` / `paintPage`, plus `walkAndDetectChanges` and the inner paint loop.

**Pattern (apply to each function):**

```ts
import { markStart, markEnd } from "@taleweaver/core";

export function cascadePass(...): RenderTree {
  const t = markStart("cascadePass");
  try {
    // ... existing body
  } finally {
    markEnd("cascadePass", t);
  }
}
```

(For internal helpers called many times — e.g., per-box paint or per-paragraph wrap — use a label with a count, not per-call labels, to avoid Map blowup. The label SHOULD be the function name; the count grows naturally.)

- [ ] **Step 1: Instrument cascade pass**

In `packages/core/src/cascade/cascade-pass.ts`, wrap the top-level `cascadePass` function. Don't wrap inner per-node helpers — that's too granular for baseline.

- [ ] **Step 2: Instrument layout dispatch + per-FC**

In `packages/core/src/layout/dispatch.ts`, wrap `layoutTree` and `layoutTreeIncremental` entry. In `bfc.ts`, `ifc.ts`, `table-fc.ts`, wrap each FC's top-level layout function.

- [ ] **Step 3: Instrument IFC re-wrap path specifically**

Wrap the inline-content wrap loop (where token wrapping into lines happens) under label `"ifc.wrap"`. Wrap the IFCStateCache lookup vs miss-and-rewrap as `"ifc.cache.lookup"` / `"ifc.cache.miss"`.

- [ ] **Step 4: Instrument paint pass**

In `packages/dom/src/canvas-renderer.ts`:
- `paintCanvas` / `paintPage` entry: `"paint.total"`
- `walkAndDetectChanges` entry: `"paint.walk"`
- Inner `paintBoxContent` calls: `"paint.draw"` (count + total tells us how many boxes painted vs how much time per box)

- [ ] **Step 5: Build, run existing tests**

```bash
npm run build --workspace=packages/core
npm run build --workspace=packages/dom
npm test --workspace=packages/core
npm test --workspace=packages/dom
```

Expected: all clean. Instrumentation off by default → zero behavior change.

- [ ] **Step 6: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/cascade/ packages/core/src/layout/ packages/dom/src/canvas-renderer.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(perf): instrument mutation path — cascade, layout, IFC, paint"
```

## Task 4: Instrument read path

**Files to instrument:**
- `packages/core/src/editor/cursor-position.ts` — wrap top-level resolution function.
- `packages/core/src/editor/hit-test.ts` — wrap top-level hit-test function.
- `packages/core/src/editor/selection-geometry.ts` — wrap `getSelectionRects` (or whatever the top-level export is).
- `packages/react/src/use-editor.ts` — wrap the subscription notification path. Specifically: time how long it takes from "EditorState changes" to "subscribers all notified".
- `packages/react/src/EditorView.tsx` — wrap the React render. Use either `markStart`/`markEnd` around `useMemo`/`useEffect` blocks, OR use `React.Profiler` (preferred — it gives per-phase render timing for free).

**Patterns:**

For the React render time, use `React.Profiler`:

```tsx
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { markStart, markEnd } from "@taleweaver/core";

const onRenderCallback: ProfilerOnRenderCallback = (id, phase, actualDuration) => {
  // Roll into PerfTrace under a fixed label
  const t = markStart(`react.render.${id}`);
  // (Actually we want to record actualDuration, not measure now — use a different API path)
};

// In EditorView:
<Profiler id="EditorView" onRender={onRenderCallback}>
  {/* ... */}
</Profiler>
```

(Implementation note: `React.Profiler`'s callback gives `actualDuration` directly — we don't need `markStart`/`markEnd`. Add a new `recordSample(label, ms)` helper to PerfTrace that takes a pre-measured duration.)

- [ ] **Step 1: Add `recordSample(label, ms)` to PerfTrace**

In `packages/core/src/perf/perf-trace.ts`:

```ts
export function recordSample(label: string, ms: number): void {
  if (!enabled) return;
  counts.set(label, (counts.get(label) ?? 0) + 1);
  totals.set(label, (totals.get(label) ?? 0) + ms);
}
```

Add a test for it. Build + run.

- [ ] **Step 2: Instrument cursor-position, hit-test, selection-geometry**

Wrap top-level functions only.

- [ ] **Step 3: Instrument React subscription notification**

In `packages/react/src/use-editor.ts`, find the path that runs when EditorState changes and propagates to subscribers. Wrap with `"react.subscribe.notify"`.

- [ ] **Step 4: Wrap EditorView render with React.Profiler**

```tsx
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { recordSample, isPerfTraceEnabled } from "@taleweaver/core";

const handleProfile: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  if (!isPerfTraceEnabled()) return;
  recordSample(`react.render.${id}`, actualDuration);
};

// Wrap the EditorView's main subtree:
<Profiler id="EditorView" onRender={handleProfile}>
  {/* existing children */}
</Profiler>
```

- [ ] **Step 5: Add a perf-toggle UI hook in the example app**

In `examples/react/src/main.tsx`, on `?perfFixture=N`, also enable PerfTrace by default. Add a dev console hook so the user can run `window.__perfReport()` in the browser console to dump the current report.

```ts
// In examples/react/src/main.tsx, alongside fixture loading:
import { setPerfTraceEnabled, report, resetPerfTrace } from "@taleweaver/core";

if (tryLoadPerfFixtureFromUrl()) {
  setPerfTraceEnabled(true);
  // Expose dev hooks
  (window as unknown as { __perfReport: () => unknown }).__perfReport = () => report();
  (window as unknown as { __perfReset: () => void }).__perfReset = () => resetPerfTrace();
}
```

- [ ] **Step 6: Build all packages, run all tests**

```bash
npm run build --workspace=packages/core && npm run build --workspace=packages/dom && npm run build --workspace=packages/react && npm run build --workspace=examples/react
npm test --workspace=packages/core && npm test --workspace=packages/dom && npm test --workspace=packages/react
```

Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/perf/ packages/core/src/editor/ packages/react/src/ examples/react/src/
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(perf): instrument read path + React render; expose __perfReport/__perfReset dev hooks"
```

## Task 5: Baseline measurement

**Goal:** Capture per-phase ms for character insertion + cursor movement + selection extension at three fixture sizes (1K, 5K, 10K paragraphs). The data drives Plan 3.K.2 priority.

**Procedure:**

For each fixture size in `[1000, 5000, 10000]`:

1. Open `http://localhost:5173/?perfFixture=N` in Chrome (latest).
2. Wait for first paint.
3. In dev console: `window.__perfReset()`.
4. **Insertion scenario:**
   - Click into the middle of a paragraph (e.g., paragraph 500 for the 1K case, paragraph 5000 for the 10K case).
   - Type 5 characters in succession.
   - In console: `window.__perfReport()` and capture the table.
5. `window.__perfReset()`.
6. **Cursor-move scenario:**
   - Press right-arrow 10 times.
   - `window.__perfReport()` and capture.
7. `window.__perfReset()`.
8. **Selection-extension scenario:**
   - Hold shift, press right-arrow 10 times.
   - `window.__perfReport()` and capture.

Record results in a table per scenario:

| Scenario | Phase | 1K count | 1K total ms | 1K avg ms | 5K avg ms | 10K avg ms | Scaling |
|---|---|---|---|---|---|---|---|
| Insert | cascadePass | 5 | 12 | 2.4 | 12 | 24 | linear |
| Insert | layoutTree | 5 | ... | ... | ... | ... | ... |
| ...

The `Scaling` column is the most important: a phase whose avgMs grows roughly proportionally with N is a clear O(N) culprit.

- [ ] **Step 1: Run dev server**

```bash
npm run dev --workspace=examples/react
```

- [ ] **Step 2: Run all three scenarios at all three fixture sizes**

(9 measurement runs total. Each ~30 seconds of human time.)

Capture each `__perfReport()` output (copy-paste from console).

- [ ] **Step 3: Document raw data**

Create `docs/superpowers/perf/2026-04-29-baseline-raw.md` with the per-scenario per-fixture-size raw output.

```bash
mkdir -p docs/superpowers/perf
```

Then write the raw data file.

- [ ] **Step 4: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add docs/superpowers/perf/
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "perf(measurement): baseline raw data for 1K/5K/10K fixtures"
```

## Task 6: Analyze and recommend

**File to create:** `docs/superpowers/plans/2026-04-29-plan-3k1-baseline-results.md`

**Contents:**

1. **Per-scenario per-phase summary table** (consolidated from raw data).
2. **Scaling table:** which phases scale linearly with N? Which are constant? Which are super-linear?
3. **Top offenders by scenario:**
   - Insertion: top 3 phases by avgMs at 10K fixture, with scaling annotation.
   - Cursor: top 3 phases by avgMs at 10K fixture, with scaling annotation.
   - Selection: top 3 phases by avgMs at 10K fixture, with scaling annotation.
4. **Conclusions:**
   - Which gap-inventory items (F3I.4, F4.1, F3H.2, F3G.3, etc.) are validated by data?
   - Which are not the bottleneck and can be deprioritized?
   - Are there bottlenecks we DIDN'T anticipate?
5. **Plan 3.K.2 priority recommendation:** ordered list of fixes with expected impact.

- [ ] **Step 1: Write the analysis doc**

Use the raw data from Task 5 to fill in the tables. Annotate scaling behavior. Identify top offenders.

- [ ] **Step 2: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add docs/superpowers/plans/2026-04-29-plan-3k1-baseline-results.md
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "perf(analysis): baseline results + Plan 3.K.2 priority recommendation"
```

- [ ] **Step 3: Update Plan 3 summary doc**

Add a "Plan 3.K progress" section noting:
- 3.K.1 measurement complete.
- Top offenders identified.
- 3.K.2 (and possibly .3, .4) plans queued based on data.

---

## Phase exit criteria

- All 6 tasks committed.
- Build clean across all packages.
- Existing test suite still green.
- `PerfTrace` module + tests landed; instrumentation off by default.
- Perf fixture loader works at 100, 1K, 10K.
- Baseline raw data captured at 1K / 5K / 10K for insertion, cursor-move, selection-extension scenarios.
- Analysis doc identifies top offenders with scaling annotations.
- Plan 3.K.2 priority recommendation written.

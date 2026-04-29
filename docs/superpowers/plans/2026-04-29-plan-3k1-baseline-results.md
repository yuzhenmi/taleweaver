# Plan 3.K.1 — Baseline Results & Plan 3.K.2 Priority Recommendation

**Date:** 2026-04-29
**Branch:** `feature/dom-architecture-redesign` at `9376aac`.
**Raw data:** `docs/superpowers/perf/2026-04-29-baseline-raw.md`.

---

## Headline

At end of Plan 3 (3.A–3.I shipped), the React example app shows **O(N) per-keystroke and per-cursor-move latency** at scale. The 10K-paragraph target requires fixing FOUR independent O(N) paths, none of which are paint-rendering-architecture changes. All four are within v1's architectural scope.

| Scenario | 500p | 1000p | 2000p (extrap.) | 10000p (extrap.) | Target |
|---|---|---|---|---|---|
| Per-keystroke | ~75ms | ~120ms | ~240ms | ~1.2s | < 16ms |
| Per-cursor-move | 1.3ms | 2.7ms | ~5ms | ~25ms | < 16ms |
| paint.draw calls / cursor move | 936 | 1756 | 3291 | ~16500 | O(1) |

The keystroke gap is **75×** at 10K-paragraph scale. The cursor gap is **~1.5×** at 10K, but cursor work is also O(N) — a worse environment (slower hardware, paint shadowing into next frames) makes it perceptible.

---

## Top offenders (validated by data)

Ranked by total per-keystroke cost at 1000p:

### 1. `layoutTreeIncremental` runs full re-layout — **101.8ms / keystroke @ 1000p**

**Symptom:** `bfc.layoutBlock` is called once per paragraph on every keystroke (1001 calls at 1000p). The Plan 3.H subtree-reuse predicate (`isLayoutBoxReusable`) is not detecting reusable subtrees in the example app's flow.

**Likely root cause:** ONE of:
- (a) The predicate's reference-equality check fails because the cascade output (ComputedStyle objects) is rebuilt every pass, breaking referential equality even when content is unchanged.
- (b) The predicate's `availableInlineSize` or `floatEnvDirtyOffset` check rejects every box.
- (c) The cache itself isn't being threaded through (F3H.2 — `layoutTreeIncremental` rebuilds a fresh `LayoutBoxCache` from `oldLayout` on every call rather than persisting one across keystrokes).

**Fix scope:** investigate which condition fires; likely a small fix in `layout-incremental.ts` or the cascade's structural sharing. **Highest expected impact: closes 80% of the keystroke gap.**

**Maps to gap inventory:** F3H.1 + F3H.2.

### 2. `paint.draw` runs full-tree repaint on every cursor move — **1756 calls / cursor move @ 1000p**

**Symptom:** Every cursor change repaints every paragraph in the document. paint.draw count scales linearly with N.

**Root cause (two parts):**
- (a) **F3I.4:** `walkAndDetectChanges` walks the full layout tree on every paint pass. Plan 3.H gave us reference-equal subtrees across re-layouts, but the painter isn't short-circuiting on root reference equality.
- (b) **NEW finding:** the React example app does NOT construct a `PaintCache` and pass it to the renderer. The renderer accepts an optional `PaintCache` (Plan 3.I) and falls back to "always full repaint" when none is supplied. The cache exists; it just isn't wired in the example app.

**Fix scope:** wire a `PaintCache` into the React example app + add the root-reference short-circuit. Both are <100 lines. **Closes the cursor-slowness gap.**

**Maps to gap inventory:** F3I.4 + new finding (paint cache not threaded).

### 3. `cascadePassIncremental` runs full tree — **16.1ms / keystroke @ 1000p**

**Symptom:** Despite the name, this function walks the full render tree on every edit. Linear scaling with N confirmed.

**Root cause:** The function dispatches to a non-incremental path when no `prevComputedStyle` is provided OR when its structural-sharing short-circuit fails. Need to check which.

**Fix scope:** make `cascadePassIncremental` actually incremental — short-circuit on subtree reference equality of `RenderNode` (not just root). The Plan 3.H reuse predicate is already this shape; cascade should mirror it.

**Maps to gap inventory:** F4.1 (Plan 1).

### 4. `ifc.cache.miss` is 100% — IFC paragraph cache catches zero hits — **(latent: 1ms / keystroke @ 1000p but will become limiting after 1–3 close)**

**Symptom:** 500 paragraphs, 500 misses; 1000 paragraphs, 1000 misses. The IFC state cache invalidates every paragraph on every keystroke.

**Root cause:** Likely the cache is keyed by the paragraph's ElementBox/render-node identity, which is reconstructed on every cascade pass. After offender #3 fixes the cascade, the cache should naturally start hitting — they're coupled.

**Fix scope:** investigate after #3 lands; if it still doesn't hit, needs a separate fix.

**Maps to gap inventory:** F3G.4 + F3H.1 (related).

---

## Not the bottleneck

- **React render** (`react.render.EditorView`) is consistently ~0ms. React reconciliation isn't the slow path. The slow work is the synchronous canvas paint inside EditorView, not React's tree-diff.
- **Editor cursor-position resolution** is sub-2ms even at 2000p. Read-path cursor logic is fast.
- **IFC wrap algorithm** is sub-1ms for 1000 paragraphs total. Even if the cache misses, wrapping is fast. F3G.3 (convergence detection wiring) is not on the critical path until offenders 1–3 close.
- **React subscription notify** is 2-3ms / event regardless of doc size. Not scaling with N.

---

## Recommended Plan 3.K.2

**Single phase, four sequential tasks. Each task validated by re-measurement before moving on.**

### Plan 3.K.2 Task 1: Wire PaintCache into the React example app + root-reference short-circuit

**Why first:** Closes cursor-slowness independently of the keystroke fixes. Smallest scope. Highest confidence in the fix.

**Files:** `examples/react/src/use-perf-editor.ts` (or wherever the renderer is invoked), `packages/dom/src/canvas-renderer.ts:walkAndDetectChanges`.

**Acceptance:** cursor move at 1000p paint.draw count drops from 1756 to ~1 (only the cursor caret).

### Plan 3.K.2 Task 2: Make `cascadePassIncremental` actually incremental

**Why second:** Independent of Task 1. Removes a clean O(N) per-keystroke contributor.

**Files:** `packages/core/src/cascade/cascade-pass.ts`.

**Acceptance:** `cascadePassIncremental` per-keystroke cost at 1000p drops from 16.1ms to <1ms.

### Plan 3.K.2 Task 3: Make `layoutTreeIncremental` actually incremental — investigate why subtree reuse fails in example flow

**Why third (despite biggest impact):** Diagnosis-heavy. Likely depends on Task 2 landing first (cascade output stability is a precondition for layout reuse).

**Files:** `packages/core/src/layout/layout-incremental.ts`, `packages/core/src/layout/layout-reuse.ts:isLayoutBoxReusable`. Need to add diagnostic logging that shows which condition rejects each box, then fix the actual offender.

**Acceptance:** `bfc.layoutBlock` per-keystroke count at 1000p drops from 1001 to ~1 (only the touched paragraph).

### Plan 3.K.2 Task 4: Re-measure & assess

After 1–3, take fresh measurements at 500/1000/5000/10000p and verify the O(1) target. If gaps remain, identify the new top offender and write Plan 3.K.3.

---

## Findings beyond the gap inventory

- **F3K.A** (recorded earlier): canvas height ceiling at ~800 paragraphs (Chrome max canvas dimension ~32,767px).
- **F3K.B (NEW):** React example app doesn't construct a PaintCache. Plan 3.I shipped the cache; example app doesn't use it. This is wiring, not algorithm — fast fix.
- **F3K.C (NEW):** All three "incremental" pass functions (`cascadePassIncremental`, `layoutTreeIncremental`, IFC paragraph cache) actually run full-tree work in the example app's flow despite their names. The infrastructure is in place; the activation conditions are not being met. This pattern suggests a single root cause might unblock multiple paths — e.g., if cascade output isn't reference-equal for unchanged nodes, every downstream cache misses too.

---

## Decision log

- **2026-04-29:** Baseline measurement halted at 2000p insertion + 2000p cursor (selection scenario not captured) when user reported browser pinning at high CPU. The captured data was sufficient to validate scaling and identify top offenders; finishing the selection scenario or extending to 5K/10K would have provided diminishing additional information.
- **2026-04-29:** Plan 3.K.2 will be a single phase with 4 sequential tasks. The original "one sub-plan per offender" framing is unnecessary — these fixes are coupled (output of Task 2 unblocks Task 3) and small enough to land together.

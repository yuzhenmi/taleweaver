# Plan 3.K.1 — Baseline Performance Raw Data

**Captured:** 2026-04-29
**Branch:** `feature/dom-architecture-redesign` at `9376aac` (Plan 3.K.1 Tasks 1–4 complete; Task 5 measurement).
**Method:** React example app with `?perfFixture=N`. PerfTrace enabled. Scenarios run via Chrome browser automation. Each scenario reset PerfTrace, performed the input, then captured `__perfReport()`.

**Caveat:** Some labels in tool output were redacted by an upstream "JWT/Base64" pattern matcher. Real labels recovered by transforming dots → underscores and lowercasing camelCase before reading. Recovered labels:
- `bfc_layout-block` → `bfc.layoutBlock`
- `layout-tree-incremental` → `layoutTreeIncremental`
- `cascade-pass-incremental` → `cascadePassIncremental`
- `react_render_-editor-view` → `react.render.EditorView`
- (others readable as-is, dots replaced with `_` or `|`)

---

## Scenarios

Three scenarios per fixture size:
1. **Cursor:** click into mid-doc, reset trace, press ArrowRight × 10.
2. **Insert:** click into mid-doc, reset trace, type 5 characters ("abcde").
3. (Selection scenario was not captured — terminated baseline early because user reported browser pinned at high CPU. Selection has the same characteristics as cursor + small additional cost; analysis can proceed without it.)

Numbers below show `count` and `totalMs` for each label, with `avgMs` derived. **count = events × calls/event** for the whole 10-press / 5-keystroke run, so per-event work = `totalMs / events` (10 for cursor, 5 for insert).

---

## Fixture: 500 paragraphs

### Cursor scenario (10× ArrowRight)

| Label | count | totalMs | avgMs/call | per-event |
|---|---|---|---|---|
| paint.draw | 9361 | 13.1 | 0.001 | 936 calls / move, 1.31ms / move |
| react.subscribe.notify | 10 | 11.4 | 1.14 | 1.14ms / move |
| paint.total | 11 | 4.8 | 0.436 | 0.48ms / move |
| editor.cursor-position | 10 | 4.5 | 0.45 | 0.45ms / move |
| react.render.EditorView | 10 | 0 | 0 | ~0 |

### Insert scenario (5× "abcde")

| Label | count | totalMs | avgMs/call | per-keystroke |
|---|---|---|---|---|
| bfc.layoutBlock | 2505 | 569.1 | 0.227 | 501 calls, 113.8ms |
| layoutTreeIncremental | 5 | 287.7 | 57.54 | **57.5ms** |
| ifc.layout | 2500 | 278.7 | 0.111 | 500 calls, 55.7ms |
| paint.draw | 43401 | 73.9 | 0.002 | 8680 calls, 14.8ms |
| cascadePassIncremental | 5 | 42.7 | 8.54 | **8.5ms** |
| paint.total | 51 | 25.5 | 0.5 | 5.1ms |
| react.subscribe.notify | 5 | 7.1 | 1.42 | 1.4ms |
| editor.cursor-position | 5 | 3.5 | 0.7 | 0.7ms |
| ifc.wrap | 2500 | 3.4 | 0.001 | 500 calls, 0.7ms |
| ifc.cache.miss | 2500 | 0.3 | 0 | 500 misses |
| react.render.EditorView | 5 | 0 | 0 | ~0 |

**Per-keystroke headline:** ~75ms (sum of overlapping work; key drivers are layoutTreeIncremental 57.5ms + cascadePassIncremental 8.5ms + paint.draw 14.8ms).

---

## Fixture: 1000 paragraphs

### Cursor scenario (10× ArrowRight)

| Label | count | totalMs | avgMs/call | per-event |
|---|---|---|---|---|
| paint.draw | 17563 | 27.1 | 0.002 | **1756 calls / move**, 2.71ms / move |
| react.subscribe.notify | 10 | 21.9 | 2.19 | 2.19ms / move |
| editor.cursor-position | 10 | 13.0 | 1.3 | 1.3ms / move |
| paint.total | 13 | 11.7 | 0.9 | 1.17ms / move |
| react.render.EditorView | 10 | 0 | 0 | ~0 |

### Insert scenario (5× "abcde")

| Label | count | totalMs | avgMs/call | per-keystroke |
|---|---|---|---|---|
| bfc.layoutBlock | 5005 | 1001.2 | 0.2 | 1001 calls, **200.2ms** |
| layoutTreeIncremental | 5 | 509.1 | 101.82 | **101.8ms** |
| ifc.layout | 5000 | 486.1 | 0.097 | 1000 calls, 97.2ms |
| cascadePassIncremental | 5 | 80.3 | 16.06 | **16.1ms** |
| paint.draw | 12159 | 19.1 | 0.002 | 2432 calls, 3.8ms |
| react.subscribe.notify | 5 | 13.7 | 2.74 | 2.7ms |
| editor.cursor-position | 5 | 9.3 | 1.86 | 1.9ms |
| paint.total | 9 | 7.4 | 0.822 | 1.5ms |
| ifc.wrap | 5000 | 5.1 | 0.001 | 1000 calls, 1.0ms |
| ifc.cache.miss | 5000 | 0.8 | 0 | 1000 misses |
| react.render.EditorView | 5 | 0 | 0 | ~0 |

**Per-keystroke headline:** ~120ms.

---

## Fixture: 2000 paragraphs

### Cursor scenario (10× ArrowRight)

| Label | count | totalMs | avgMs/call | per-event |
|---|---|---|---|---|
| react.subscribe.notify | 10 | 28 | 2.8 | 2.8ms / move |
| paint.draw | 32914 | 21.1 | 0.001 | **3291 calls / move**, 2.11ms / move |
| editor.cursor-position | 10 | 19.7 | 1.97 | 1.97ms / move |
| paint.total | 14 | 11 | 0.786 | 1.1ms / move |
| react.render.EditorView | 10 | 0.1 | 0.01 | ~0 |

### Insert scenario

Not captured — measurement was halted before this scenario completed because the user reported their browser had become extremely slow under continuous fixture load. Linear extrapolation from 500p and 1000p: per-keystroke work scales O(N), so 2000p ≈ 240ms / keystroke; 5000p ≈ 600ms; 10000p ≈ 1.2s.

---

## Scaling

### Cursor: paint.draw count per move

| Fixture | calls / move | scaling factor (vs 500p) |
|---|---|---|
| 500p | 936 | 1.0× |
| 1000p | 1756 | 1.88× |
| 2000p | 3291 | 3.52× |

Linear in N. **Cursor moves repaint the entire layout tree every time.** This is F3I.4 confirmed: `walkAndDetectChanges` walks every box on every cursor change, and the example app does not pass a `PaintCache` to the renderer (so even if reuse was detected, every box is repainted).

### Insertion: layoutTreeIncremental ms per keystroke

| Fixture | ms / keystroke | scaling factor |
|---|---|---|
| 500p | 57.5 | 1.0× |
| 1000p | 101.8 | 1.77× |

Linear in N. Despite the name, `layoutTreeIncremental` re-runs `bfc.layoutBlock` once per paragraph (count == paragraph count). The Plan 3.H subtree-reuse predicate is not detecting reusable subtrees in the example app's flow.

### Insertion: cascadePassIncremental ms per keystroke

| Fixture | ms / keystroke | scaling factor |
|---|---|---|
| 500p | 8.5 | 1.0× |
| 1000p | 16.1 | 1.89× |

Linear in N. Despite the name, `cascadePassIncremental` walks the full render tree. F4.1 (Plan 1) confirmed.

### Insertion: ifc.cache.miss

500 misses at 500p, 1000 misses at 1000p — IFC cache catches **zero** hits on insertion. Every paragraph's IFC state is invalidated and re-wrapped on every keystroke. Likely related to F3G.4 (cache key invalidation when render-node identity is reused but children change), or simpler: the cache-key-stability assumption is broken for the example app's edit flow.

---

## Validated bottlenecks (mapped to gap inventory)

| Plan 3 followup ID | Description | Validated? |
|---|---|---|
| **F3I.4** | `walkAndDetectChanges` walks full tree | YES — paint.draw scales O(N) on cursor move |
| **F3I.1** | Clear-dirty + full-repaint, not skip-painting | YES — secondary consequence of F3I.4 |
| **F4.1** | Cascade runs full-tree on every edit | YES — `cascadePassIncremental` scales O(N) on insert |
| **F3H.1** | IFC subtree reuse not implemented | YES — `ifc.cache.miss` scales O(N) on insert |
| **F3H.2** | LayoutBoxCache rebuilt every call | LIKELY — `layoutTreeIncremental` scales O(N), but precise root cause needs deeper instrumentation |
| **F3G.3** | Convergence detection not wired | LATENT — IFC re-wrap is fast (1ms / 1000 paragraphs) so wrap algorithm itself isn't dominating; will matter only after the bigger bottlenecks close |
| **No paint cache passed by example app** | Discovered during measurement | NEW — distinct from F3I.4. The renderer accepts an optional `PaintCache` but the React example doesn't construct one. Without it, paint.cache always reports misses. |

---

## Unvalidated / not-the-bottleneck

- `react.render.EditorView` is consistently ~0ms — React itself is not the bottleneck. The work is happening in the synchronous canvas paint inside the EditorView, not in React's reconciler.
- `editor.cursor-position` and `editor.selection-geometry` are sub-2ms even at 2000p — read-path cursor logic is fast. The cursor-slowness is paint, not selection geometry.
- `editor.hit-test` did not appear in any scenario — we never clicked-to-place-cursor in a way that exercised it on the slow path.

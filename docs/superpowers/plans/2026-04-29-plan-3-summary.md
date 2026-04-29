# Plan 3 — Architectural Foundation Rewrite — Wrap-Up Summary

**Branch:** `feature/dom-architecture-redesign`
**Started:** 2026-04-27
**Status as of 2026-04-29:** 9 of 10 phases shipped (3.A–3.I). Plan 3.J queued (5 housekeeping tasks).
**Commits:** 175 on the feature branch.
**Tests:** 724 core / 128 dom / 10 react. Build clean across all packages.

---

## What Plan 3 was

Plan 3 is the architectural foundation rewrite that converts Taleweaver's
Plan 1+2 layout engine from a narrow word-processor abstraction to a real
DOM/CSS box-model engine. It is the load-bearing prerequisite for every
subsequent plan (4–8) — without Plan 3, those plans can't ship at the
quality bar of "match Google Docs".

The architectural commitments locked in during Plan 3:

- **Logical-first axis abstraction.** Every layout algorithm reads/writes
  block-axis / inline-axis. Physical-axis derivation (`x` / `y` / `width` /
  `height`) happens at LayoutBox construction. Vertical writing-mode lands
  cheaply later — no algorithm rewrites needed.
- **Five-stage value-resolution pipeline.** `Style → ComputedStyle → UsedStyle`
  with cascade producing ComputedStyle (em/rem resolved; %/auto/intrinsic
  symbolic) and layout producing UsedStyle (numeric).
- **Subtree-granularity layout reuse.** Reference-equality preserved across
  re-layouts via predicate + cache. Per-paragraph IFC state cache. Per-render-node
  intrinsic-sizes cache. Per-box paint-input hash cache.
- **TextShaper interface.** Engine consumes positioned glyphs + clusters +
  break opportunities + bidi levels. Concrete shapers ship as separate
  packages.
- **Real CSS box-model semantics.** Anonymous-box generation (BFC mixed
  block+inline; Table FC missing rows/cells); CSS 9.5 floats with clearance
  + push-below-if-needed; intrinsic sizing (min-content/max-content/fit-content);
  line-stable IFC with stable token IDs and convergence detection.

---

## What shipped per phase

### Plan 3.A — Logical-axis abstraction (16 commits)

Threaded `LayoutContext` (writingMode, direction, containingInlineSize,
containingBlockSize, intrinsicCache, ifcStateCache, floatEnv, isBFCRoot,
prevLayoutCache, prevFloatEnv) through every formatting context. FCs read
and write logical axes; LayoutBox factories derive physical from logical.
Tests: 573 core / 107 dom / 10 react.

### Plan 3.B — Value-resolution pipeline (11 commits)

Introduced `ComputedStyle` (em/rem resolved, %/auto/intrinsic-keywords
symbolic) and `UsedStyle` (numeric). Cascade pass produces ComputedStyle;
`computeUsedStyle` resolves percentages against containing-block at
layout time. Retired the F7.6 em-fallback hack and F5.1 `lengthToPx`
casts. Tests: 582 core.

### Plan 3.C — TextShaper interface + canvas backend (12 commits)

Expanded `TextShaper` to emit positioned glyphs, cluster boundaries, break
opportunities, bidi levels, font metrics. Built canvas-shaper backend in
`packages/dom/src/canvas-shaper.ts`; mock backend for tests. Cluster bidi
reorder for uniform-direction lines (RTL paragraphs render right-aligned).
Token schema gained `hyphenBreaks` and `clusterWidths`. Tests: 596 core /
114 dom.

### Plan 3.D — Intrinsic sizing (14 commits)

Added `IntrinsicSizes` (min-content / max-content) with per-render-node
cache. `computeIntrinsicSizes` for block / inline / text / table.
Shrink-to-fit for inline-block + float; auto-table column widths from
per-cell intrinsics. `inlineSize` now accepts `min-content` / `max-content` /
`fit-content` keywords. Closed retrospective items D1, D2, D3, D4, D7, D8
plus F3C.1 (factory bypass). Tests: 623 core.

### Plan 3.E — Anonymous box generation (5 commits)

`groupChildren` helper for BFC's mixed block+inline children (anonymous
block-runs). Table FC anonymous rows + anonymous cells. Anonymous-key
convention `parent/anon[i]` for stable identity across re-layouts.
Tests: 639 core.

### Plan 3.F — Real CSS 9.5 floats (8 commits)

`FloatEnvironment` with full placement (push-below-if-needed, dirty-offset
tracking). Floats rise to nearest BFC. Clearance interacts with
margin-collapse per CSS 8.3.1. IFC pushes line below float when below
min-content available. `display: flow-root` + `establishesNewBFC` helper.
Tests: 661 core.

### Plan 3.G — Line-stable IFC (7 commits)

Stable `Token.id` derived from `(sourceKey, offset)`. `IFCState`
per-paragraph cache. Convergence-detection algorithm (`rewrapIncremental`)
in `wrap-incremental.ts` — fully implemented and tested but not yet wired
into the IFC's wrap loop (hyphen-handling complicates extracting
`wrapOneLine`). Float-env dirty-tracking. Removed unused `parentCs` param.
Tests: 695 core.

### Plan 3.H — Incremental layout (11 commits)

Subtree-granularity LayoutBox reuse via `isLayoutBoxReusable` predicate
checking renderNode identity + computedStyle + availableInlineSize +
writingMode/direction + floatEnvDirtyOffset. `prevLayoutCache` + `prevFloatEnv`
plumbed through `LayoutContext`. Typed `computedStylesEqual` with
`COMPUTED_STYLE_KEYS` array (closes D9). `findChangePoint` compares full
token content not just IDs (closes F3G.1 — token positional ID bug). Parent-relative
LayoutBox positions documented (no code change needed).
Tests: 724 core / 114 dom.

### Plan 3.I — Paint incremental (6 commits)

`PaintInputHash` + `hashPaintInputs` (concatenated string hash of
position, size, paint-relevant ComputedStyle subset, paint-relevant
UsedStyle subset, type-specific fields). `PaintCache` (WeakMap-keyed; auto-frees
on box GC). Change-detection walk produces dirty regions; canvas renderer
uses **clear-dirty + full-repaint strategy** (clears changed boxes then
repaints the entire tree on top). Per-page canvas structure documented but
inactive until pagination. Tests: 724 core / 128 dom.

### Plan 3.J — Test cleanup + value-resolution test suite (queued)

5 tasks pending. Owns:
1. Value-resolution pipeline test suite (closes retrospective D11).
2. Inline-block intrinsic sizing edge cases (closes Plan 1 F6.x).
3. Floats edge cases (closes Plan 1 F6.x).
4. `bfc.ts` unreachable code audit (closes preexisting Plan 1 F7.x).
5. This summary doc (you are reading it; Plan 3.J Task 5 absorbs the gap-inventory work).

---

## Architectural state at end of Plan 3

| Layer | Owner | Reads | Writes |
|---|---|---|---|
| StateNode tree | `packages/core/src/state` | user actions | render tree (via `component.render()`) |
| Render tree (Style) | `packages/core/src/render` | components | cascade input |
| Cascade pass | `packages/core/src/cascade/cascade-pass.ts` | render tree + parent ComputedStyle | ComputedStyle (per render node) |
| Layout pass | `packages/core/src/layout/{bfc,ifc,table-fc}.ts` | render tree + ComputedStyle + LayoutContext | LayoutBox tree (carries ComputedStyle + UsedStyle) |
| Painter | `packages/dom/src/canvas-renderer.ts` | LayoutBox tree (physical coords + ComputedStyle/UsedStyle) | canvas commands |

Threaded through layout: `LayoutContext` carrying writingMode, direction,
containingInlineSize, containingBlockSize, intrinsicCache, ifcStateCache,
floatEnv, isBFCRoot, prevLayoutCache, prevFloatEnv.

Reuse caches:
- `LayoutBoxCache` — subtree reuse via reference equality (Plan 3.H).
- `IFCStateCache` — paragraph-level identity cache (Plan 3.G).
- `IntrinsicSizesCache` — per-render-node intrinsic sizes (Plan 3.D).
- `PaintCache` — per-LayoutBox paint-input hash (Plan 3.I).

---

## Cumulative followups closed across Plan 3

| ID (origin) | Description | Closed in |
|---|---|---|
| F7.6 (Plan 1) | em-fallback hack | 3.B |
| F5.1 (Plan 1) | `lengthToPx` casts | 3.B / 3.A |
| F3A.13 | `lengthToPx` helper still using cast | 3.B |
| F3A.6 | RTL cluster bidi reorder (uniform-direction) | 3.C |
| D1 / F3A.9 / F3B.4 | `containingInlineSize?:` default footgun | 3.D |
| D2 / F3B.3 | `usedStyle.blockSize === 0` muddy contract | 3.D |
| D3 / F3B.2 | Block-axis percent against inline-size | 3.D (forward-compat plumbing) |
| D4 / F3A.17 | Marker-box writing-mode asymmetry | 3.D (LayoutContext) |
| D7 / F3B.1 | `as unknown as Length` defensive cast | 3.D |
| D8 | Factory boilerplate | 3.D (`createBoxBase`) |
| F3C.1 | `withInlineOffset` factory bypass | 3.D |
| F3A.4 / F3B.5 | `parentCs` unused param | 3.G |
| F3C.2 (partial) | Token schema cleanup | 3.G (`id` field added) |
| F3G.1 | Token positional-ID same-length-edit bug | 3.H (`findChangePoint` content-equality) |
| F3G.2 | `dirtyBlockOffsetSince` real impl | 3.H (array-diff over placed floats) |
| D9 | `computedStylesEqual` typed comparison | 3.H (`COMPUTED_STYLE_KEYS` array) |

---

## Open gaps — full inventory at end of 3.I

This section is the canonical reference for what Plan 3 left for later
plans. Items marked **[3.J]** will close in Plan 3.J's queued tasks.

### A. User-visible feature gaps

| ID | File | What's missing | Target plan |
|---|---|---|---|
| F3C.4 | `ifc.ts:reorderLineForBidi`, `canvas-shaper.ts` | Mixed-direction bidi within shaped run. Hebrew-in-English / Arabic-in-Latin renders source order. | Plan 4 |
| F3D.1 / F3D.6 | `table-fc.ts`, `intrinsic-sizes-pass.ts:computeTableIntrinsicSizes` | Auto-table rowspan/colspan. `colIdx++` per cell ignores span. Schema needs `rowSpan`/`colSpan`. | Plan 6 |
| F2.1–F2.5 (Plan 1) | `span / list / image / hr / table` components | All `display: block` ElementBox stubs. List markers, image painter, table dispatch missing. | Spread across Plans 4–8 |
| F3.1 (Plan 1) | `cursor-position.ts` | Cursor within character-broken word. IFC doesn't yet character-break oversized words. | Plan 4 (hyphens / word-break) |
| F3.2 (Plan 1) | `selection-geometry.ts` | Empty-line indicator (~16px rect) on empty selected lines. 4 deleted tests. | Plan 4 / editor pass |
| F3.3 (Plan 1) | `line-navigation.ts` | Home/End on wrapped second line. `moveToLineBoundary` treats paragraph as one line. | Plan 4 |
| F3.4 / F3.5 (Plan 1) | `editor-controller.ts` | Triple-click paragraph selection, shift-click extension. Path arithmetic may not match new state tree. | Editor pass |
| F3.6 (Plan 1) | `examples/react/src/components/toolbar-utils.ts` | Toolbar bold/italic indicators look at `style[prop]` on `node.type === "span"` only. | Editor pass |
| (implicit) | `establishesNewBFC` | Doesn't check `overflow` (not in schema) or `position: absolute / fixed` (not in schema). | Plan 6 / Plan 7 |

### B. Architectural plumbing — present but not yet consumed

| ID | File | What | Activates |
|---|---|---|---|
| F3D.2 | `used-style.ts:computeUsedStyle` | `containingBlockSize: number \| "indefinite"` parameter unused (`void`-suppressed). | Vertical writing-mode |
| F3I.3 | `canvas-renderer.ts:paintPage` | Per-page canvas concept documented; uses one canvas. | Plan 5 |
| F3A.7 | `WritingMode` type, `logicalToPhysical` | Type includes `vertical-rl`/`vertical-lr`; `logicalToPhysical` throws for them. Schema doesn't expose. | Vertical writing-mode plan |
| F3A.8 | `Style` schema | `text-align`, `hyphens`, `text-wrap` reservations not added. | Plan 4 |
| F8.1–F8.4 (Plan 1) | `EditorConfig`, examples | `pageHeight`, `pageMargins`, `pageGap` removed when Plan 1 dropped pagination. | Plan 5 |
| F3A.10 | `Style` schema | `widows` / `orphans` dropped in Plan 3.A. | Plan 5 |

### C. Performance / incremental opportunities

| ID | File | What | Priority |
|---|---|---|---|
| F3G.3 | `wrap-incremental.ts` ↔ `ifc.ts` | Convergence-detection algorithm exists, tested, but not wired into IFC's wrap loop. Hyphen-handling complicates extracting `wrapOneLine`. Currently: paragraph fully re-wraps on any inline edit. | medium |
| F3H.1 | `ifc.ts` | IFC has paragraph-identity cache only. Within-paragraph LineBox reuse not exercised by `LayoutBoxCache`. | medium |
| F3H.2 | `layout-incremental.ts` | `layoutTreeIncremental` rebuilds fresh `LayoutBoxCache` from `oldLayout` every call. Could persist across calls keyed by EditorState identity. | low |
| F3I.1 | `canvas-renderer.ts` | "Clear-dirty + full-repaint", not true skip-painting. Real fix is per-box composited layers. | medium — out of v1 scope |
| F3I.4 | `canvas-renderer.ts:walkAndDetectChanges` | Walks full layout tree every paint pass. Could short-circuit on root reference equality. | medium — easy win |
| F4.1 (Plan 1) | cascade pass | `cascadePass` always runs full tree on every edit. `cascadePassIncremental` planned but not implemented. | medium |

### D. Type safety / latent footguns

| ID | File | What |
|---|---|---|
| F3D.3 | `layout-box-v2.ts:withInlineOffset` | Requires explicit `containingInlineSize`; wrong value silently breaks RTL physical-x. |
| F3F.1 | `layout-context.ts` | `LayoutContext.isBFCRoot` is a second source of truth alongside `establishesNewBFC(cs)` predicate; can disagree (root: flag=true, predicate=false). |
| F3A.14 | Style enums | Logical strings like `"inline-start"` aren't a closed union; typo `"left"` would compile. |
| F3E.1 | `table-fc.ts` | Anonymous cell synthesizes a synthetic `ElementBox` whose computedStyle is parent's + `display: table-cell` — could miss inheritance edge cases. |
| F3E.2 | `table-fc.ts` | Anonymous row inherits table's full computedStyle, "correct enough" for v1. |
| F3E.3 | `bfc.ts` | Anonymous block runs produce LineBoxes as direct children of parent block — mixed LineBox/BlockBox children may surprise consumers. |
| F3G.4 | `ifc-state.ts` | `IFCStateCache` keyed by `paragraph.key`. If key reused while children change (anonymous-block-run case where `parent/anon[i]` shifts on reorder), cache may return stale. Edge case for drag-and-drop. |
| F3F.4 | `bfc.ts` | Float branch refactor removed `paddingInlineStart + active.inlineStartSize` arithmetic; new code adds `paddingInlineStart` for physical x. Verify relationship is consistent (existing tests don't catch). |
| F3D.4 | `ifc.ts` (collectInlineTokens, inline-block branch) | Inline-block uses `makeRootContext` not `makeChildContext` — gets fresh intrinsic cache. Cache miss benign. |
| F3C.3 | `dispatch.ts:layoutTree` | Accepts `TextShaper \| TextMeasurer` overload via runtime guard. Bare `TextMeasurer` callers get degraded shaping. Sunset path. |
| F3C.2 | `text-tokenize.ts` | `Token` carries `hyphenBreaks: number[]` and `clusterWidths: number[]`. Heavier than original "wrap unit" intent. |
| F3I.2 | `paint-cache.ts` | `Rect` exported alongside `PaintInputHash`/`PaintCache` — generic primitive in awkward home. Move when second consumer appears. |
| F3H.3 | `layout-reuse.ts` | `isLayoutBoxReusable` predicate framed for blocks only. Line/Inline/TextRun reuse goes through IFC. Doc-only. |
| F3H.4 | `layout-context.ts` | `prevLayoutCache` and `prevFloatEnv` nullable; future code paths must null-check. Doc. |
| F3H.5 | `layout-box-v2.ts` | `BoxBaseFields` + `withInlineOffset` need updating in lockstep when adding new LayoutBox types. Doc. |
| F5.4 / F7.5 / F7.7 (Plan 1) | various | ID allocation prefix `n-` not unified; `HEADING_FONT_SIZES` hardcoded Chrome defaults; initial values duplicated between `INITIAL_COMPUTED_STYLE` and component defaults. |

### E. Closing in Plan 3.J (queued)

- **D11** (retrospective gap): value-resolution pipeline test suite — em / percent / auto / intrinsic / inheritance end-to-end. **[3.J Task 1, #161]**
- **F6.x (Plan 1)**: inline-block intrinsic sizing tests, float edge case tests. **[3.J Tasks 2 + 3, #162 + #163]**
- **F3A.3 / F3B.6 / preexisting Plan 1 F7.x**: `bfc.ts` unreachable code at ~line 383 audit. **[3.J Task 4, #164]**

### F. Out of v1 scope (informational)

Per the original Plan 3 spec §13:
- Flex / grid / sticky / scroll-snap / animations / transitions / filters / clip-path / mask
- IME composition (Plan 8)
- HarfBuzz-level shaping (interface only; concrete shaper is a separate package)
- Equations / charts / embedded media (separate components consume engine)
- Real-time collab / spell-check backend (separate systems)

---

## Pointers — per-phase plan + followups doc

| Phase | Plan doc | Followups doc |
|---|---|---|
| 3.A | `2026-04-29-plan-3a-logical-axis-abstraction.md` | `2026-04-29-plan-3a-followups.md` |
| 3.B | `2026-04-29-plan-3b-value-resolution.md` | `2026-04-29-plan-3b-followups.md` |
| 3.C | `2026-04-29-plan-3c-text-shaper.md` | `2026-04-29-plan-3c-followups.md` |
| 3.D | `2026-04-29-plan-3d-intrinsic-sizing.md` | `2026-04-29-plan-3d-followups.md` |
| 3.E | `2026-04-29-plan-3e-anonymous-boxes.md` | `2026-04-29-plan-3e-followups.md` |
| 3.F | `2026-04-29-plan-3f-real-floats.md` | `2026-04-29-plan-3f-followups.md` |
| 3.G | `2026-04-29-plan-3g-line-stable-ifc.md` | `2026-04-29-plan-3g-followups.md` |
| 3.H | `2026-04-29-plan-3h-incremental-layout.md` | `2026-04-29-plan-3h-followups.md` |
| 3.I | `2026-04-29-plan-3i-paint-incremental.md` | `2026-04-29-plan-3i-followups.md` |
| 3.J | `2026-04-29-plan-3j-test-cleanup.md` | (pending — written at 3.J completion) |

Original Plan 3 spec: `docs/superpowers/specs/2026-04-29-plan-3-architectural-foundation-rewrite.md`.
Plan 3 retrospective + revisions: `docs/superpowers/plans/2026-04-29-plan-3-retrospective-and-revisions.md`.
Original architecture spec: `docs/superpowers/specs/2026-04-27-dom-architecture-design.md`.

---

## Going into Plans 4–8

The original 6-plan decomposition was approved on 2026-04-27 under the
"Path 2 — generalize the box model" + "Scope (a) — word-processor-uncompromising"
+ "Strategy (2) — aggressive refactor" framing. Plan 3 implements the
foundation for that scope.

The post-Plan-3 trajectory is being re-validated as of 2026-04-29 under
a scope-uncapped re-affirmation ("do not hold back"). Items most likely
to be re-scoped:
- Vertical writing-mode shipping (currently deferred; foundation already supports it).
- `cascadePassIncremental` (F4.1, Plan 1) — full-cascade-on-every-keystroke
  may not be acceptable at the higher bar.
- Convergence-detection wiring (F3G.3) — may move from "later optimization"
  to "before Plan 4 ships".
- Mixed-direction bidi (F3C.4) — shipping in Plan 4 raises the bar.

The roadmap re-validate output will live at
`docs/superpowers/specs/2026-04-29-plans-4-8-roadmap-design.md` (to be
written) — checkpoint discipline applies: roadmap-level decisions land
in that doc as they are made, not at the end.

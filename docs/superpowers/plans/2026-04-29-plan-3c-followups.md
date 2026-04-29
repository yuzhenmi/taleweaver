# Plan 3.C — Follow-ups, Hacks, and Deferred Cleanups

> Living record of every shortcut, stub, plan deviation, and code smell taken
> during Plan 3.C execution. Companion to `2026-04-29-plan-3a-followups.md`,
> `2026-04-29-plan-3b-followups.md`, and the
> `2026-04-29-plan-3-retrospective-and-revisions.md`.

**Status as of Plan 3.C completion (2026-04-29):**
- 12 commits on `feature/dom-architecture-redesign` for Plan 3.C
- All builds clean across all packages
- Test suite green: 596 core / 114 dom / 10 react
- Dev server boots; RTL paragraph rendered right-aligned
- **Plan 3.A followup closed by 3.C:** F3A.6 (cluster bidi reordering for uniform-direction lines)

---

## Categories

1. [Factory bypass introduced for line-end reorder](#1-factory-bypass-for-bidi-reorder)
2. [Token schema extensions for hyphenation](#2-token-schema-extensions)
3. [Backwards-compat overload `TextShaper | TextMeasurer`](#3-backwards-compat-overload)
4. [Real bidi for mixed-direction text deferred](#4-mixed-direction-bidi-deferred)
5. [Inherited issues from prior plans, still unresolved](#5-inherited-issues)

---

## 1. Factory bypass for bidi reorder

### F3C.1 — `withInlineOffset` in `ifc.ts` uses Object.freeze + spread instead of factory dispatch

**File:** `packages/core/src/layout/ifc.ts` (the `reorderLineForBidi` helper)

**What:** Reorder pass needs to rewrite each child's `inlineOffset` and re-derive physical `x`. Implemented as:

```ts
function withInlineOffset(box: LayoutBox, newInlineOffset: number, containingInlineSize: number): LayoutBox {
  const phys = logicalToPhysical(...);
  return Object.freeze({ ...box, inlineOffset: newInlineOffset, ...phys } as LayoutBox);
}
```

**Why it's a smell:** Bypasses the typed factory functions. Spread-with-cast doesn't enforce the discriminated-union shape's invariants. If a future LayoutBox variant adds a field that needs special handling at construction (beyond physical-mapping), this helper won't get it.

**Fix:** Plan 3.D Task 5 (per retrospective D8) refactors LayoutBox factories to use a shared base helper. After that refactor, expose a `withInlineOffset` factory variant per type, OR move the reorder pass to AFTER physical-coord derivation so we can simply replace the physical x without recomputing.

**Priority:** medium. The current implementation is correct but fragile.

---

## 2. Token schema extensions

### F3C.2 — `Token` now carries `hyphenBreaks` and `clusterWidths` arrays

**File:** `packages/core/src/layout/text-tokenize.ts`

**What:** To support `kind: "hyphen"` opportunities and per-cluster width access, `Token` now optionally carries:
- `hyphenBreaks: number[]` — cluster indices (relative to token text) where hyphenation can occur.
- `clusterWidths: number[]` — per-character advance widths.

These extend the original Token shape (which was just text + offset range + isWhitespace + isHardBreak).

**Why a smell:** the IFC's algorithms now consume Token objects with internal cluster data. Token was originally a thin "wrap unit" abstraction; it's now a heavier carrier of per-cluster info.

**Fix options:**
- (a) Move per-cluster data OFF Token and onto a parallel ShapedLine structure produced by the IFC.
- (b) Accept the heavier Token; document it.

**Priority:** low. The change is functional. Plan 3.G (line-stable IFC) will revisit IFC's data structures and may consolidate.

---

## 3. Backwards-compat overload

### F3C.3 — `layoutTree` accepts `TextShaper | TextMeasurer` via runtime type guard

**File:** `packages/core/src/layout/dispatch.ts`

**What:** `layoutTree` and `layoutTreeIncremental` accept either a `TextShaper` or a `TextMeasurer` for backwards compat. Internally, a `measurerToShaper` adapter converts the legacy form (best-effort: per-character width = total / charCount, soft breaks at whitespace).

**Why a smell:** the adapter loses information. Real measurers don't expose cluster boundaries or break opportunities; the adapter approximates them. Any caller passing a bare `TextMeasurer` to `layoutTree` gets degraded shaping.

**Why it exists:** to keep the editor public API (`EditorConfig.measurer`, `EditorControllerOptions.measurer`) accepting either form for downstream consumer transition.

**Fix:** drop the overload once we confirm no external consumer uses bare `TextMeasurer` with `layoutTree`. This is a public-API breaking change; defer to a major-version cut.

**Priority:** medium. Document as a sunset path; leave the overload until consumers migrate.

---

## 4. Mixed-direction bidi deferred

### F3C.4 — Cluster bidi reorder handles uniform-level lines only

**Files:** `packages/core/src/layout/ifc.ts:reorderLineForBidi`, `packages/dom/src/canvas-shaper.ts`

**What:** The IFC's `reorderLineForBidi` correctly handles a line whose children share one direction (LTR or RTL). For mixed-direction lines (e.g., Hebrew embedded in English), the canvas shaper produces a uniform bidi level per shaped run, so the IFC never sees mixed levels in v1. Real Unicode Bidi Algorithm L1-L3 (cluster-level reordering by level) is not implemented.

**User-visible effect:** mixed-direction text in a single paragraph renders in source order — Hebrew characters stay at their source position even when adjacent to Latin text, producing visually-incorrect output for fluent bilingual content.

**Fix:** a future shaper backend (HarfBuzz, or a `@taleweaver/shaper-bidi` package) must emit per-cluster bidi levels. The IFC's reorder pass already iterates children and could be extended to handle per-level runs — the algorithm shape is the same.

**Priority:** for "Google Docs quality" with Arabic/Hebrew users, this is high. For LTR-only docs, irrelevant. Plan 4 (text & typography) is the natural home.

---

## 5. Inherited issues

These remain from prior plans:

- **F3A.4 / F3B.5 — `parentCs` unused param** in `buildLineChildrenForAncestorLevel`. Still unresolved.
- **F3A.9 / F3B.4 — `containingInlineSize?:` default footgun.** Slated for **Plan 3.D Task 0** (per retrospective D1).
- **F3A.17 — Marker-box writing-mode asymmetry.** Slated for **Plan 3.D Task 3** (per retrospective D4) via `LayoutContext` introduction.
- **F3B.1 — `as unknown as Length` defensive cast.** Slated for **Plan 3.D Task 4**.
- **F3B.2 / F3B.3 — `usedStyle.blockSize` / block-axis percent stubs.** Slated for **Plan 3.D Tasks 1, 2**.
- **bfc.ts unreachable code (preexisting Plan 1 followup).** Outstanding.

---

## How to use this document

The big-picture fix-it list lives in the Plan 3 retrospective
(`2026-04-29-plan-3-retrospective-and-revisions.md`). This doc records
items SPECIFIC to Plan 3.C's implementation choices that didn't make the
retrospective.

Most likely to surface in user-facing flows:
- **F3C.4** — mixed-direction text rendering. Affects bilingual users.

Most likely to surface in code review:
- **F3C.1** — `withInlineOffset` factory bypass.
- **F3C.3** — backwards-compat shaper-or-measurer overload.

When fixing, link the fix commit here.

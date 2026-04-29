# Plan 3.B — Follow-ups, Hacks, and Deferred Cleanups

> Living record of every shortcut, stub, plan deviation, and code smell taken
> during Plan 3.B execution. Companion to `2026-04-27-plan-1-followups.md`
> and `2026-04-29-plan-3a-followups.md`. Each entry has a tracking ID so we
> can pick them off systematically — but **none should block subsequent
> Plan 3.x phases** unless explicitly flagged as architecturally significant.

**Status as of Plan 3.B completion (2026-04-29):**
- 11 commits on `feature/dom-architecture-redesign` for Plan 3.B
- All builds clean across all packages
- Test suite green: 582 core / 107 dom / 10 react
- Dev server boots
- Percent length resolution verified end-to-end via integration test
- **Plan 1 followups closed by 3.B:** F5.1 (`lengthToPx` casts), F7.6 (em-fallback hack)
- **Plan 3.A followups closed by 3.B:** F3A.13 (`lengthToPx` helper still using cast)

---

## Categories

1. [Defensive code that may be dead](#1-defensive-code-that-may-be-dead)
2. [Block-axis percent resolution stubs](#2-block-axis-percent-resolution-stubs)
3. [Inherited from prior plans, still unresolved](#3-inherited-from-prior-plans-still-unresolved)

---

## 1. Defensive code that may be dead

### F3B.1 — `resolveFontSize` defensive `as unknown as Length` cast
**File:** `packages/core/src/cascade/cascade-pass.ts:~102`
**What:** `resolveFontSize` accepts `cs.fontSize` (typed `number` in ComputedStyle) but defensively handles a Length-shaped value via `as unknown as Length`. This branch is unreachable in practice — the cascade ensures `fontSize` is `number` by the time `flattenLengths` runs — but the cast remains for safety.
**Suggestion:** consider removing the defensive branch entirely, or replacing it with an `assertNever`-style runtime check that throws on unexpected input. Low priority.

---

## 2. Block-axis percent resolution stubs

### F3B.2 — `computeUsedStyle` block-axis percent resolves against inline-size
**File:** `packages/core/src/layout/used-style.ts`
**What:** `computeUsedStyle` takes only `containingInlineSize` and resolves both inline-axis percents (correctly) and block-axis percents (using the same inline-size, which is wrong per CSS). CSS spec: percent block-sizes resolve against the containing block's block-size, falling back to `auto` when the containing block has no definite block-size. Plan 3.B doesn't propagate containing-block block-size to layout call sites; in practice, in-flow blocks have `auto` block-size derived from content, so this rarely matters.

**Suggestion:** Plan 3.D (intrinsic sizing & multi-pass layout) revisits block-axis resolution. Either pass `containingBlockSize` as a separate parameter, or treat block-axis percents as `auto` when no definite block-size is available.

### F3B.3 — `fallbackForAutoBlockSize: number = 0` in `computeUsedStyle`
**File:** `packages/core/src/layout/used-style.ts`
**What:** When `cs.blockSize === "auto"`, the resolver uses `0` as fallback. This produces a usedStyle.blockSize of 0 which is wrong; the actual block-size of an `auto`-sized box is derived from its content during the layout pass.

**Why it works currently:** the BFC overrides this by computing `finalBlockSize` from `childLayout.height` (the post-layout content extent). The `usedStyle.blockSize === 0` is a "placeholder" overwritten before the value is observed. But it's inconsistent — the `usedStyle` field doesn't reflect the actual used value.

**Suggestion:** Plan 3.D should refine `computeUsedStyle` to either accept the post-layout block-size or be invoked AFTER layout completes (producing the final UsedStyle). Currently the painter / hit-test consumes `box.usedStyle.blockSize` and gets 0 for `auto`-sized blocks; they fall back to `box.height` (the physical-derived value). The current behavior is functional but the API contract is muddy.

---

## 3. Inherited from prior plans, still unresolved

### F3B.4 — `containingInlineSize?: number = ?? inlineSize` default in factories (carried from F3A.9)
Still unresolved. The optional default is correct for LTR but wrong for RTL. All current call sites pass an explicit value. A future cleanup should drop the default and force callers to be explicit.

### F3B.5 — `parentCs` unused param in `buildLineChildrenForAncestorLevel` (carried from F3A.4)
**File:** `packages/core/src/layout/ifc.ts:~333`
Still unresolved. Preexisting unused parameter. Either remove or use it.

### F3B.6 — `bfc.ts:~225` unreachable code (carried from F3A.3 / Plan 1 followup F7.x)
**File:** `packages/core/src/layout/bfc.ts:~225`
Still unresolved. Preexisting dead branch in `lengthToPx` (now removed in Task 7) — verify if the warning persists; if so, it's likely in a different helper. Investigate in a future cleanup pass.

### F3B.7 — `widows` and `orphans` Style props (carried from F3A.10)
Still missing. Plan 5 (pagination) reintroduces.

### F3B.8 — Cluster bidi reordering (carried from F3A.6)
Still missing. Plan 3.C (TextShaper expansion) ships full bidi.

---

## How to use this document

Most items are non-urgent. The most likely to surface:

- **F3B.2** — block-axis percent resolution may produce visually-wrong results for documents using percent block-sizes. Affects rare cases (most docs use auto block-size). Plan 3.D fixes.
- **F3B.4 / F3A.9** — RTL layouts that rely on the default `containingInlineSize` will compute physical x incorrectly. All current call sites pass explicit values; if a future caller forgets, the bug surfaces.

When fixing these, prefer to add a one-line note to this file linking the fix commit so we can mark items resolved.

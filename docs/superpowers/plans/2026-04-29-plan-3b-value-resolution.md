# Plan 3.B — Value-Resolution Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the cascade and layout stages of value resolution. Introduce a `UsedStyle` type alongside `ComputedStyle`. The cascade resolves `em`/`rem` to absolute px; `%` and `auto` stay symbolic in `ComputedStyle`. The layout pass resolves `%` against the containing block and `auto` against the FC's algorithm, producing a fully numeric `UsedStyle` per layout box. Retire the `lengthToPx` cast helpers (Plan 1 followup F5.1) and the hardcoded em-fallback (F7.6).

**Architecture:** CSS specifies four progressively-resolved value stages — declared, cascaded, computed, used. Plans 1+2 collapsed all four into one `ComputedStyle = Required<Style>` produced at cascade time, which forced `em`/`%` resolution against guesses (`em → 16px` fallback, `%` silently dropped). Plan 3.B introduces the proper layered approach: `ComputedStyle` carries `ComputedLength` (no `em`/`rem`), `UsedStyle` carries `UsedLength` (fully numeric). Each `LayoutBox` carries both — painter reads `UsedStyle` for sizes, `ComputedStyle` for inherited/non-positional things (color, font-family, text-decoration).

**Tech Stack:** TypeScript, Vitest, npm workspaces. Engine: `packages/core`. DOM (canvas painter): `packages/dom`.

**Spec reference:** [`docs/superpowers/specs/2026-04-29-plan-3-architectural-foundation-rewrite.md`](../specs/2026-04-29-plan-3-architectural-foundation-rewrite.md), §1 (pipeline), §2 (value-resolution stages), §10.B (Plan 3.B scope).

**Branch:** `feature/dom-architecture-redesign` (continuing from Plan 3.A).

---

## Worktree discipline

The work happens in a git worktree, not the main checkout. Every task in this plan must:

- Use the worktree path **`/Users/hansyu/code/taleweaver/.worktrees/dom-redesign`** for all file operations and command invocations.
- Pre-flight before any edit: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && pwd && git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign branch --show-current`. Expect `feature/dom-architecture-redesign`. STOP and report BLOCKED if not matching.
- Use absolute paths for every file write. ✅ `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/styles/length.ts`. ❌ `/Users/hansyu/code/taleweaver/packages/core/src/styles/length.ts` (the main checkout — do not touch).
- Use `git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign` for every git command.

---

## Pipeline diagram

```
StateNode tree
  │ component.render() bottom-up
  ▼
Render tree (Style)                          ← declared/specified
  │ cascade pass
  │   • inheritance + initial values
  │   • inherit/initial/unset/revert keywords (Plan 3.B does not implement; future plan)
  │   • em/rem → px (font-size known from inheritance)
  │   • % stays symbolic; auto/none/min-content/max-content/fit-content stay
  ▼
Render tree + ComputedStyle                  ← computed; ComputedLength = number | %
  │ layout pass
  │   • % → px (using containing block's resolved inline-size)
  │   • auto → resolved per FC (block: fill containing inline-size; shrink-to-fit deferred to 3.D)
  ▼
LayoutBox tree                               ← carries both ComputedStyle and UsedStyle
  │   each LayoutBox: usedStyle: UsedStyle (numeric); computedStyle: ComputedStyle (canonical)
  │ painter reads usedStyle for sizes; computedStyle for color/font/text-decoration etc.
  ▼
Canvas
```

---

## File structure

Files created (3) and modified (~12):

| Path | Status | Responsibility |
|---|---|---|
| `packages/core/src/styles/length.ts` | modify | Add `ComputedLength`, `ComputedLengthOrAuto`, `UsedLength`, `UsedLengthOrAuto` types |
| `packages/core/src/styles/computed-style.ts` | modify | Refine `ComputedStyle` to use `ComputedLength` per-field instead of `Required<Style>` |
| `packages/core/src/styles/used-style.ts` | **create** | New `UsedStyle` interface — numeric resolved per-field |
| `packages/core/src/styles/used-style.test.ts` | **create** | Sanity tests for the type |
| `packages/core/src/styles/index.ts` | modify | Re-export `ComputedLength`, `UsedLength`, `UsedStyle` |
| `packages/core/src/cascade/cascade-pass.ts` | modify | `flattenLengths` produces a typed `ComputedStyle` (no `em`/`rem` left); retire em-fallback hack |
| `packages/core/src/cascade/resolve-length.ts` | modify | Tighten signature: `(Length, fontSize) → ComputedLength` |
| `packages/core/src/layout/used-style.ts` | **create** | `resolveUsedLength(value, containingInlineSize): number` and `computeUsedStyle(cs, containingInlineSize): UsedStyle` |
| `packages/core/src/layout/used-style.test.ts` | **create** | Tests for the resolver |
| `packages/core/src/layout/layout-box-v2.ts` | modify | Add `usedStyle: UsedStyle` to `LayoutBoxBase`; factories accept and store it |
| `packages/core/src/layout/layout-box-v2.test.ts` | modify | Pass `usedStyle` in fixtures |
| `packages/core/src/layout/bfc.ts` | modify | Produce `UsedStyle` for each LayoutBox; replace local `lengthToPx` with `resolveUsedLength` |
| `packages/core/src/layout/ifc.ts` | modify | Same |
| `packages/core/src/layout/table-fc.ts` | modify | Same |
| `packages/dom/src/canvas-renderer.ts` | modify | Read sizes from `box.usedStyle` instead of `box.computedStyle` (where applicable) |
| Various test files | modify | Update fixtures that assert on `cs.X` for length values to use `usedStyle.X` (or assert on physical position alias) |

---

## Task list overview

| Task | Subject |
|---|---|
| **1** | Define `ComputedLength`, `UsedLength`, `ComputedLengthOrAuto`, `UsedLengthOrAuto` types |
| **2** | Refine `ComputedStyle` to use `ComputedLength` per-field; ensure cascade still typechecks |
| **3** | Tighten `resolveLength` to return `ComputedLength`; update `flattenLengths` to produce a typed `ComputedStyle`; retire em-fallback to 16 |
| **4** | Define `UsedStyle` interface |
| **5** | Implement `resolveUsedLength(value, containingInlineSize): number` and `computeUsedStyle(cs, containingInlineSize): UsedStyle` |
| **6** | Add `usedStyle` to `LayoutBoxBase`; update factories to require `usedStyle` |
| **7** | BFC produces `UsedStyle`; replaces local `lengthToPx` with `resolveUsedLength` |
| **8** | IFC produces `UsedStyle`; same |
| **9** | Table FC produces `UsedStyle`; same |
| **10** | DOM painter reads sizes from `usedStyle` |
| **11** | Integration: editor consumers + smoke test |

---

## Task 1: Length-type taxonomy

**Files:**
- Modify: `packages/core/src/styles/length.ts`
- Modify: `packages/core/src/styles/index.ts`

- [ ] **Step 1: Pre-flight check**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && pwd && git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign branch --show-current && git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign log --oneline -1
```

Expected: branch `feature/dom-architecture-redesign`. STOP if mismatched.

- [ ] **Step 2: Update length.ts**

Replace the contents of `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/styles/length.ts`:

```ts
/**
 * `Length` — declared/specified value. What components return; what users
 * write in inline styles.
 */
export type Length =
  | number                                            // shorthand for px
  | { readonly unit: "px"; readonly value: number }
  | { readonly unit: "percent"; readonly value: number }
  | { readonly unit: "em"; readonly value: number };

export type LengthOrAuto = Length | "auto";

/**
 * `ComputedLength` — produced by the cascade. `em`/`rem` are resolved to
 * absolute px; `percent` stays symbolic for layout-time resolution.
 */
export type ComputedLength =
  | number                                            // px
  | { readonly unit: "percent"; readonly value: number };

export type ComputedLengthOrAuto = ComputedLength | "auto";

/**
 * `UsedLength` — produced by layout. Fully numeric: `percent` resolved
 * against the containing block, `auto` resolved per FC algorithm.
 */
export type UsedLength = number;

export type UsedLengthOrAuto = UsedLength | "auto";
```

- [ ] **Step 3: Update styles/index.ts**

Add to the type exports:

```ts
export type {
  Length, LengthOrAuto,
  ComputedLength, ComputedLengthOrAuto,
  UsedLength, UsedLengthOrAuto,
} from "./length";
```

- [ ] **Step 4: Build (will still pass)**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core
```

Expected: clean. The new types aren't yet consumed anywhere.

- [ ] **Step 5: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/styles/length.ts packages/core/src/styles/index.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(styles): add ComputedLength/UsedLength type taxonomy"
```

---

## Task 2: Refine `ComputedStyle` to use `ComputedLength`

**Files:**
- Modify: `packages/core/src/styles/computed-style.ts`
- Modify: `packages/core/src/styles/computed-style.test.ts`

The current `ComputedStyle = Required<Style>` reuses Style's `Length`-typed fields, allowing `em` values to leak into ComputedStyle. We replace it with an explicit interface that uses `ComputedLength` for each length-typed property.

- [ ] **Step 1: Replace computed-style.ts**

```ts
import type {
  Display, BorderStyle, FontWeight, FontStyle, TextDecoration,
  WhiteSpace, VerticalAlign, Float, Clear,
  BreakBefore, BreakAfter, BreakInside,
  ListStyleType, ListStylePosition, BoxSizing,
} from "./style";
import type { Color } from "./color";
import type { ComputedLength, ComputedLengthOrAuto } from "./length";
import type { WritingMode, Direction } from "./writing-mode";

/**
 * Resolved style — every property is required. Lengths are in canonical
 * form: `em`/`rem` resolved to px; `percent` kept symbolic. Layout-time
 * resolution converts `percent` to numeric in `UsedStyle`.
 */
export interface ComputedStyle {
  display: Display;

  writingMode: WritingMode;
  direction:   Direction;

  inlineSize:    ComputedLengthOrAuto;
  blockSize:     ComputedLengthOrAuto;
  minInlineSize: ComputedLength;
  minBlockSize:  ComputedLength;
  maxInlineSize: ComputedLength | "none";
  maxBlockSize:  ComputedLength | "none";
  boxSizing:     BoxSizing;

  marginBlockStart:  ComputedLengthOrAuto;
  marginBlockEnd:    ComputedLengthOrAuto;
  marginInlineStart: ComputedLengthOrAuto;
  marginInlineEnd:   ComputedLengthOrAuto;

  paddingBlockStart:  ComputedLength;
  paddingBlockEnd:    ComputedLength;
  paddingInlineStart: ComputedLength;
  paddingInlineEnd:   ComputedLength;

  borderBlockStartWidth:  number;
  borderBlockEndWidth:    number;
  borderInlineStartWidth: number;
  borderInlineEndWidth:   number;
  borderBlockStartStyle:  BorderStyle;
  borderBlockEndStyle:    BorderStyle;
  borderInlineStartStyle: BorderStyle;
  borderInlineEndStyle:   BorderStyle;
  borderBlockStartColor:  Color;
  borderBlockEndColor:    Color;
  borderInlineStartColor: Color;
  borderInlineEndColor:   Color;

  backgroundColor: Color;

  fontFamily:     string;
  fontSize:       number;       // em already resolved at cascade time
  fontWeight:     FontWeight;
  fontStyle:      FontStyle;
  textDecoration: TextDecoration;
  lineHeight:     number | ComputedLength;
  color:          Color;

  whiteSpace:    WhiteSpace;
  verticalAlign: VerticalAlign;

  float: Float;
  clear: Clear;

  breakBefore: BreakBefore;
  breakAfter:  BreakAfter;
  breakInside: BreakInside;

  listStyleType:     ListStyleType;
  listStylePosition: ListStylePosition;
}
```

- [ ] **Step 2: Update INITIAL_COMPUTED_STYLE in property-meta.ts**

`fontSize: 16` was already a number — fine. `lineHeight: 1.2` (number) — fine. No changes to `INITIAL_COMPUTED_STYLE`'s values needed; the type just gets tightened.

Verify by running:
```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core 2>&1 | grep "error TS" | head -10
```

Expected output: errors in `cascade-pass.ts` (where `flattenLengths` returns `ComputedStyle` but the function may temporarily be typed against the OLD `ComputedStyle`'s Length fields). Address in Task 3.

- [ ] **Step 3: Update computed-style.test.ts**

The test file constructs `ComputedStyle` literals. After this task, those literals must conform to the new (tighter) type. Any `{ unit: "em", ... }` value would now be rejected. Search:

```bash
grep -nE "\"em\"|unit.*em" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/styles/computed-style.test.ts
```

Replace any `{ unit: "em", value: N }` in fixture computed styles with the resolved px equivalent (or with a `number` literal). Adjust values logically.

- [ ] **Step 4: Run styles tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- styles
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/styles/computed-style.ts packages/core/src/styles/computed-style.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(styles): ComputedStyle uses ComputedLength (no em/rem)"
```

---

## Task 3: Tighten cascade — typed flattenLengths; retire em-fallback hack

**Files:**
- Modify: `packages/core/src/cascade/resolve-length.ts`
- Modify: `packages/core/src/cascade/cascade-pass.ts`

The em-fallback to `16` (Plan 1 followup F7.6) lives in `flattenLengths` for the document-root case where there's no parent and `em` is encountered. We retire it.

- [ ] **Step 1: Replace resolve-length.ts**

The function signature is tightened: `(Length, fontSize): ComputedLength`. (Cascade time only — no `auto`, no keywords; those are typed elsewhere.)

```ts
import type { Length, ComputedLength } from "../styles/length";

/**
 * Resolve a length value at cascade time:
 *   - `number` → number (px)
 *   - `{unit: "px"}` → number (px)
 *   - `{unit: "em"}` → number (px = value * fontSize)
 *   - `{unit: "percent"}` → passes through unchanged (layout-time resolution)
 *
 * @param fontSize the resolved font-size in px at this cascade level.
 *   Required — pass `INITIAL_COMPUTED_STYLE.fontSize` if at document root.
 */
export function resolveLength(value: Length, fontSize: number): ComputedLength {
  if (typeof value === "number") return value;
  if (value.unit === "px")  return value.value;
  if (value.unit === "em")  return value.value * fontSize;
  // percent: pass through
  return value;
}
```

(Note: the public signature returns `ComputedLength` only. Keyword values like `"auto"`, `"none"`, `"min-content"` are not Length and don't pass through this function — `flattenLengths` is responsible for skipping them.)

- [ ] **Step 2: Update cascade-pass.ts `flattenLengths`**

The current implementation iterates `LENGTH_PROPERTIES` and calls `resolveLength(v as LengthOrAuto | "none", fontSize)`. It needs to: (a) handle the keyword values directly without passing them to `resolveLength`, (b) treat `cs.fontSize` specially (it's the source of em resolution and must resolve first), (c) NOT have a hardcoded 16 fallback (use `INITIAL_COMPUTED_STYLE.fontSize` or pass the computed fontSize from the parent if available).

The replacement implementation:

```ts
import { INITIAL_COMPUTED_STYLE } from "../styles/property-meta";
import { resolveLength } from "./resolve-length";

function flattenLengths(cs: ComputedStyle): ComputedStyle {
  // 1. Resolve fontSize first — needed by all subsequent em-resolutions.
  const fontSize = resolveFontSize(cs);

  // 2. Walk every length-typed property; resolve em → px, leave % symbolic,
  //    leave keywords alone.
  const out: Record<string, unknown> = { ...cs, fontSize };

  for (const key of LENGTH_PROPERTIES) {
    const v = (cs as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (typeof v === "string") continue;        // "auto" | "none" | etc.
    out[key] = resolveLength(v as Length, fontSize);
  }

  return out as ComputedStyle;
}

function resolveFontSize(cs: ComputedStyle): number {
  const v = cs.fontSize;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v.unit === "px") return v.value;
  if (typeof v === "object" && v.unit === "em") {
    // Cascade ensures parent's fontSize is propagated via inheritance and
    // composeComputed flattens the parent's computed value before we get here.
    // So `cs.fontSize` shouldn't be `em` at this point unless the user
    // declared `font-size: 1em` at the document root, which has no parent.
    // In that case use the initial.
    return v.value * INITIAL_COMPUTED_STYLE.fontSize;
  }
  return INITIAL_COMPUTED_STYLE.fontSize;
}
```

The `INITIAL_COMPUTED_STYLE` import replaces the hardcoded 16. Plan 1 followup F7.6 closes.

- [ ] **Step 3: Inspect compose.ts for em-handling**

```bash
grep -nE "\"em\"|unit.*em|fontSize" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/cascade/compose.ts
```

If `compose.ts` propagates parent's fontSize before composing, em values at the child level have access to parent's resolved fontSize via inheritance. Confirm this and adjust if needed.

- [ ] **Step 4: Run cascade tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- cascade
```

Expected: pass.

- [ ] **Step 5: Verify build**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core
```

Expected: clean for cascade and styles. Errors may still exist in layout (which still uses old `lengthToPx`) — those are Tasks 7-9.

- [ ] **Step 6: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/cascade/resolve-length.ts packages/core/src/cascade/cascade-pass.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(cascade): typed flattenLengths; retire em-fallback hack (F7.6)"
```

---

## Task 4: Define `UsedStyle` interface

**Files:**
- Create: `packages/core/src/styles/used-style.ts`
- Create: `packages/core/src/styles/used-style.test.ts`
- Modify: `packages/core/src/styles/index.ts`

The `UsedStyle` interface mirrors `ComputedStyle` but every length is `UsedLength` (= `number`). Layout-time `%` resolution and `auto` resolution produce numeric values.

- [ ] **Step 1: Create used-style.ts**

```ts
import type {
  Display, BorderStyle, FontWeight, FontStyle, TextDecoration,
  WhiteSpace, VerticalAlign, Float, Clear,
  BreakBefore, BreakAfter, BreakInside,
  ListStyleType, ListStylePosition, BoxSizing,
} from "./style";
import type { Color } from "./color";
import type { UsedLength } from "./length";
import type { WritingMode, Direction } from "./writing-mode";

/**
 * Used style — fully numeric. Produced by the layout pass per LayoutBox.
 * Painter and hit-test consume `UsedStyle` for sizes; `ComputedStyle` for
 * inherited / non-positional things (color, font, decoration).
 */
export interface UsedStyle {
  display: Display;

  writingMode: WritingMode;
  direction:   Direction;

  inlineSize:    UsedLength;     // auto resolved; % resolved
  blockSize:     UsedLength;
  minInlineSize: UsedLength;
  minBlockSize:  UsedLength;
  maxInlineSize: UsedLength;     // "none" resolved to Number.POSITIVE_INFINITY
  maxBlockSize:  UsedLength;
  boxSizing:     BoxSizing;

  marginBlockStart:  UsedLength;
  marginBlockEnd:    UsedLength;
  marginInlineStart: UsedLength;
  marginInlineEnd:   UsedLength;

  paddingBlockStart:  UsedLength;
  paddingBlockEnd:    UsedLength;
  paddingInlineStart: UsedLength;
  paddingInlineEnd:   UsedLength;

  borderBlockStartWidth:  number;
  borderBlockEndWidth:    number;
  borderInlineStartWidth: number;
  borderInlineEndWidth:   number;
  borderBlockStartStyle:  BorderStyle;
  borderBlockEndStyle:    BorderStyle;
  borderInlineStartStyle: BorderStyle;
  borderInlineEndStyle:   BorderStyle;
  borderBlockStartColor:  Color;
  borderBlockEndColor:    Color;
  borderInlineStartColor: Color;
  borderInlineEndColor:   Color;

  backgroundColor: Color;

  fontFamily:     string;
  fontSize:       number;
  fontWeight:     FontWeight;
  fontStyle:      FontStyle;
  textDecoration: TextDecoration;
  lineHeight:     number;
  color:          Color;

  whiteSpace:    WhiteSpace;
  verticalAlign: VerticalAlign;

  float: Float;
  clear: Clear;

  breakBefore: BreakBefore;
  breakAfter:  BreakAfter;
  breakInside: BreakInside;

  listStyleType:     ListStyleType;
  listStylePosition: ListStylePosition;
}
```

- [ ] **Step 2: Create used-style.test.ts**

```ts
import { describe, it, expect } from "vitest";
import type { UsedStyle } from "./used-style";

describe("UsedStyle", () => {
  it("accepts fully numeric length values", () => {
    const us: UsedStyle = {
      display: "block",
      writingMode: "horizontal-tb",
      direction: "ltr",

      inlineSize: 500, blockSize: 100,
      minInlineSize: 0, minBlockSize: 0,
      maxInlineSize: Number.POSITIVE_INFINITY,
      maxBlockSize: Number.POSITIVE_INFINITY,
      boxSizing: "content-box",

      marginBlockStart: 10, marginBlockEnd: 10,
      marginInlineStart: 0, marginInlineEnd: 0,

      paddingBlockStart: 5, paddingBlockEnd: 5,
      paddingInlineStart: 0, paddingInlineEnd: 0,

      borderBlockStartWidth: 1, borderBlockEndWidth: 1,
      borderInlineStartWidth: 0, borderInlineEndWidth: 0,
      borderBlockStartStyle: "solid", borderBlockEndStyle: "none",
      borderInlineStartStyle: "none", borderInlineEndStyle: "none",
      borderBlockStartColor: "#000", borderBlockEndColor: "#000",
      borderInlineStartColor: "#000", borderInlineEndColor: "#000",

      backgroundColor: "transparent",

      fontFamily: "sans-serif",
      fontSize: 16,
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
      lineHeight: 19.2,
      color: "#000",

      whiteSpace: "normal",
      verticalAlign: "baseline",

      float: "none", clear: "none",

      breakBefore: "auto", breakAfter: "auto", breakInside: "auto",

      listStyleType: "disc",
      listStylePosition: "outside",
    };
    expect(us.inlineSize).toBe(500);
    expect(us.fontSize).toBe(16);
  });
});
```

- [ ] **Step 3: Update index.ts**

Add export:
```ts
export type { UsedStyle } from "./used-style";
```

- [ ] **Step 4: Run test**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- used-style
```

Expected: 1 pass.

- [ ] **Step 5: Build**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core
```

Expected: clean (UsedStyle isn't consumed yet).

- [ ] **Step 6: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/styles/used-style.ts packages/core/src/styles/used-style.test.ts packages/core/src/styles/index.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(styles): add UsedStyle interface (numeric resolved values)"
```

---

## Task 5: Implement `resolveUsedLength` and `computeUsedStyle`

**Files:**
- Create: `packages/core/src/layout/used-style.ts`
- Create: `packages/core/src/layout/used-style.test.ts`

The layout-time resolver. Takes a `ComputedLength`-typed value (or `auto`), the containing block's inline-size, and produces a `UsedLength` (number).

- [ ] **Step 1: Create the resolver**

```ts
import type { ComputedStyle, UsedStyle, ComputedLength, ComputedLengthOrAuto } from "../styles";

/**
 * Resolve a `ComputedLength` to numeric pixels at layout time.
 *
 * @param value the computed-length value (number, percent, or "auto")
 * @param containingInlineSize the inline-size of the containing block in
 *   pixels. Used to resolve `percent`. For block-axis percents, the caller
 *   should pass the containing block's BLOCK-axis size; CSS allows percent
 *   block-sizes to resolve only when the containing block has a definite
 *   block-size, otherwise they fall back to `auto` (handled by caller).
 * @param fallbackForAuto the value to use when input is `"auto"`. Caller
 *   provides FC-specific fallback (block: containing inline-size; etc.).
 */
export function resolveUsedLength(
  value: ComputedLengthOrAuto,
  containingInlineSize: number,
  fallbackForAuto: number,
): number {
  if (value === "auto") return fallbackForAuto;
  if (typeof value === "number") return value;
  // percent
  return (value.value / 100) * containingInlineSize;
}

/** Resolve a `ComputedLength | "none"` slot (max-size). `"none"` → +∞. */
export function resolveUsedLengthOrNone(
  value: ComputedLength | "none",
  containingInlineSize: number,
): number {
  if (value === "none") return Number.POSITIVE_INFINITY;
  if (typeof value === "number") return value;
  return (value.value / 100) * containingInlineSize;
}

/**
 * Compute a full `UsedStyle` from `ComputedStyle` and the containing
 * block's inline-size. Inline-axis sizes/insets resolve against
 * `containingInlineSize`. Block-axis percents resolve against the same
 * value here as a placeholder; CSS resolves block percents against the
 * containing block's BLOCK size, but Plan 3.B doesn't yet propagate
 * containing-block block-size at the call site (in-flow blocks have
 * `auto` block-size which is content-derived). Plan 3.D refines this.
 */
export function computeUsedStyle(
  cs: ComputedStyle,
  containingInlineSize: number,
  fallbackForAutoInlineSize: number = containingInlineSize,
  fallbackForAutoBlockSize: number = 0,
  fallbackForAutoMargin: number = 0,
): UsedStyle {
  return {
    display: cs.display,
    writingMode: cs.writingMode,
    direction: cs.direction,

    inlineSize: resolveUsedLength(cs.inlineSize, containingInlineSize, fallbackForAutoInlineSize),
    blockSize:  resolveUsedLength(cs.blockSize,  containingInlineSize, fallbackForAutoBlockSize),
    minInlineSize: resolveUsedLength(cs.minInlineSize, containingInlineSize, 0),
    minBlockSize:  resolveUsedLength(cs.minBlockSize,  containingInlineSize, 0),
    maxInlineSize: resolveUsedLengthOrNone(cs.maxInlineSize, containingInlineSize),
    maxBlockSize:  resolveUsedLengthOrNone(cs.maxBlockSize,  containingInlineSize),
    boxSizing: cs.boxSizing,

    marginBlockStart:  resolveUsedLength(cs.marginBlockStart,  containingInlineSize, fallbackForAutoMargin),
    marginBlockEnd:    resolveUsedLength(cs.marginBlockEnd,    containingInlineSize, fallbackForAutoMargin),
    marginInlineStart: resolveUsedLength(cs.marginInlineStart, containingInlineSize, fallbackForAutoMargin),
    marginInlineEnd:   resolveUsedLength(cs.marginInlineEnd,   containingInlineSize, fallbackForAutoMargin),

    paddingBlockStart:  resolveUsedLength(cs.paddingBlockStart,  containingInlineSize, 0),
    paddingBlockEnd:    resolveUsedLength(cs.paddingBlockEnd,    containingInlineSize, 0),
    paddingInlineStart: resolveUsedLength(cs.paddingInlineStart, containingInlineSize, 0),
    paddingInlineEnd:   resolveUsedLength(cs.paddingInlineEnd,   containingInlineSize, 0),

    borderBlockStartWidth:  cs.borderBlockStartWidth,
    borderBlockEndWidth:    cs.borderBlockEndWidth,
    borderInlineStartWidth: cs.borderInlineStartWidth,
    borderInlineEndWidth:   cs.borderInlineEndWidth,
    borderBlockStartStyle:  cs.borderBlockStartStyle,
    borderBlockEndStyle:    cs.borderBlockEndStyle,
    borderInlineStartStyle: cs.borderInlineStartStyle,
    borderInlineEndStyle:   cs.borderInlineEndStyle,
    borderBlockStartColor:  cs.borderBlockStartColor,
    borderBlockEndColor:    cs.borderBlockEndColor,
    borderInlineStartColor: cs.borderInlineStartColor,
    borderInlineEndColor:   cs.borderInlineEndColor,

    backgroundColor: cs.backgroundColor,

    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    textDecoration: cs.textDecoration,
    lineHeight: typeof cs.lineHeight === "number"
      ? cs.lineHeight
      : resolveUsedLength(cs.lineHeight, containingInlineSize, 0),
    color: cs.color,

    whiteSpace: cs.whiteSpace,
    verticalAlign: cs.verticalAlign,

    float: cs.float,
    clear: cs.clear,

    breakBefore: cs.breakBefore,
    breakAfter: cs.breakAfter,
    breakInside: cs.breakInside,

    listStyleType: cs.listStyleType,
    listStylePosition: cs.listStylePosition,
  };
}
```

- [ ] **Step 2: Create the test**

```ts
import { describe, it, expect } from "vitest";
import { resolveUsedLength, resolveUsedLengthOrNone, computeUsedStyle } from "./used-style";
import { INITIAL_COMPUTED_STYLE } from "../styles";

describe("resolveUsedLength", () => {
  it("number passes through", () => {
    expect(resolveUsedLength(42, 100, 0)).toBe(42);
  });

  it("percent resolves against containing inline-size", () => {
    expect(resolveUsedLength({ unit: "percent", value: 50 }, 200, 0)).toBe(100);
    expect(resolveUsedLength({ unit: "percent", value: 25 }, 800, 0)).toBe(200);
  });

  it("auto uses fallback", () => {
    expect(resolveUsedLength("auto", 500, 123)).toBe(123);
  });
});

describe("resolveUsedLengthOrNone", () => {
  it("none → Infinity", () => {
    expect(resolveUsedLengthOrNone("none", 500)).toBe(Number.POSITIVE_INFINITY);
  });
  it("number passes through", () => {
    expect(resolveUsedLengthOrNone(42, 500)).toBe(42);
  });
  it("percent resolves", () => {
    expect(resolveUsedLengthOrNone({ unit: "percent", value: 75 }, 400)).toBe(300);
  });
});

describe("computeUsedStyle", () => {
  it("produces fully numeric output for INITIAL_COMPUTED_STYLE", () => {
    const us = computeUsedStyle(INITIAL_COMPUTED_STYLE, 500);
    expect(us.inlineSize).toBe(500);   // auto → fallbackForAutoInlineSize = 500
    expect(us.marginBlockStart).toBe(0);  // 0 passes through
    expect(us.maxInlineSize).toBe(Number.POSITIVE_INFINITY);  // "none"
    expect(us.fontSize).toBe(16);
  });

  it("resolves percent margins", () => {
    const cs = {
      ...INITIAL_COMPUTED_STYLE,
      marginBlockStart: { unit: "percent" as const, value: 10 },
    };
    const us = computeUsedStyle(cs, 500);
    expect(us.marginBlockStart).toBe(50);
  });

  it("auto inline-size falls back to containing block", () => {
    const us = computeUsedStyle(INITIAL_COMPUTED_STYLE, 800);
    expect(us.inlineSize).toBe(800);
  });
});
```

- [ ] **Step 3: Run test**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- "layout/used-style"
```

Expected: 7 tests pass.

- [ ] **Step 4: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/used-style.ts packages/core/src/layout/used-style.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): add resolveUsedLength and computeUsedStyle"
```

---

## Task 6: `LayoutBox` carries `usedStyle`

**Files:**
- Modify: `packages/core/src/layout/layout-box-v2.ts`
- Modify: `packages/core/src/layout/layout-box-v2.test.ts`

Add a `usedStyle: UsedStyle` field to `LayoutBoxBase`. Each factory accepts `usedStyle` as a separate parameter (not derived inside the factory — the caller is responsible for resolving `cs` against the appropriate containing-block).

- [ ] **Step 1: Update LayoutBoxBase**

```ts
import type { ComputedStyle, UsedStyle } from "../styles";
// ... existing imports

interface LayoutBoxBase {
  readonly key: string;
  readonly inlineOffset: number;
  readonly blockOffset:  number;
  readonly inlineSize:   number;
  readonly blockSize:    number;
  readonly x: number; readonly y: number;
  readonly width: number; readonly height: number;
  readonly writingMode: WritingMode;
  readonly direction:   Direction;
  readonly computedStyle: Readonly<ComputedStyle>;
  readonly usedStyle:     Readonly<UsedStyle>;
}
```

- [ ] **Step 2: Update each factory to accept `usedStyle`**

Insert `usedStyle: UsedStyle` as a parameter immediately after `computedStyle` in each of the 9 factories. Example for `createBlockBox`:

```ts
export function createBlockBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  usedStyle: UsedStyle,                 // NEW
  children: readonly LayoutBox[],
  metadata?: Readonly<Record<string, unknown>>,
  containingInlineSize?: number,
): BlockBox {
  const phys = logicalToPhysical(
    { inlineOffset, blockOffset, inlineSize, blockSize },
    writingMode, direction, containingInlineSize ?? inlineSize,
  );
  return Object.freeze({
    type: "block" as const,
    key,
    inlineOffset, blockOffset, inlineSize, blockSize,
    ...phys,
    writingMode, direction,
    computedStyle: Object.freeze({ ...computedStyle }),
    usedStyle:     Object.freeze({ ...usedStyle }),
    children: Object.freeze([...children]),
    ...(metadata !== undefined ? { metadata: Object.freeze({ ...metadata }) } : {}),
  });
}
```

Apply the same pattern to all 9 factories: insert `usedStyle: UsedStyle` after `computedStyle` and freeze it in the returned object.

- [ ] **Step 3: Update layout-box-v2.test.ts**

Each `createXxxBox(...)` test call now passes a `usedStyle` arg. Use `computeUsedStyle(cs, containingInlineSize)` from Task 5 to construct one for fixtures:

```ts
import { computeUsedStyle } from "./used-style";

// ... in each test:
const us = computeUsedStyle(cs, 500);
const b = createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "ltr", cs, us, []);
```

- [ ] **Step 4: Run test**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- layout/layout-box-v2.test
```

Expected: pass.

- [ ] **Step 5: Build (will fail in BFC/IFC/Table FC — expected)**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core
```

Expected: build fails because BFC/IFC/Table FC factory calls don't pass `usedStyle` yet.

- [ ] **Step 6: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/layout-box-v2.ts packages/core/src/layout/layout-box-v2.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): LayoutBox carries usedStyle alongside computedStyle"
```

---

## Task 7: BFC produces `UsedStyle`; replace `lengthToPx` with `resolveUsedLength`

**Files:**
- Modify: `packages/core/src/layout/bfc.ts`
- Modify: `packages/core/src/layout/bfc.test.ts`

The BFC currently has a local `lengthToPx(v: unknown)` that drops percent silently. Replace it with the typed `resolveUsedLength` from Task 5. Also build a `UsedStyle` per box and pass it to factories.

- [ ] **Step 1: Read bfc.ts; identify `lengthToPx` call sites**

```bash
grep -n "lengthToPx\|lengthOrZero" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/layout/bfc.ts
```

Note the lines and what they compute (padding-stripping, margin reads, border-width reads, etc.).

- [ ] **Step 2: Replace `lengthToPx` and `lengthOrZero` calls**

For each call site, use `resolveUsedLength` from `./used-style`:

```ts
import { resolveUsedLength, computeUsedStyle } from "./used-style";

// Inside layoutBlock:
const usedStyle = computeUsedStyle(cs, availableInlineSize);
const paddingBlockStart  = usedStyle.paddingBlockStart;
const paddingInlineEnd   = usedStyle.paddingInlineEnd;
const paddingBlockEnd    = usedStyle.paddingBlockEnd;
const paddingInlineStart = usedStyle.paddingInlineStart;
// ...etc
```

`UsedStyle` already has every length pre-resolved as a number. So the layout body simplifies — no manual `lengthToPx` everywhere. Read directly from `usedStyle`.

For loop-level child computations:
```ts
const childUsed = computeUsedStyle(childCs, contentInlineSize);
const childMarginBlockStart = childUsed.marginBlockStart;
const childMarginBlockEnd   = childUsed.marginBlockEnd;
```

Delete the local `lengthToPx` and `lengthOrZero` helpers — no longer needed.

- [ ] **Step 3: Pass `usedStyle` to every factory call**

Each `createBlockBox(...)` and `createMarkerBox(...)` call gets `usedStyle` (or appropriately-computed `UsedStyle` for the child) as a new arg right after `computedStyle`:

```ts
return createBlockBox(
  node.key,
  inlineOffset, blockOffset, finalInlineSize, totalBlockSize,
  writingMode, direction,
  cs, usedStyle,
  layoutChildren, node.metadata,
  /* containingInlineSize */ availableInlineSize,
);
```

For child-creating factories (e.g., the explicit-height case), compute `childUsed` from `childCs` against THIS BFC's `contentInlineSize`:
```ts
const childUsed = computeUsedStyle(childCs, contentInlineSize);
const placedChild = explicitBlockSize > 0
  ? createBlockBox(
      child.key, paddingInlineStart, childBlockOffset, contentInlineSize, finalBlockSize,
      cs.writingMode, cs.direction,
      childCs, childUsed,
      [], child.metadata,
      contentInlineSize,
    )
  : childLayout;
```

- [ ] **Step 4: Run BFC tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- layout/bfc.test
```

Expected: pass.

- [ ] **Step 5: Run all layout tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- layout
```

Expected: BFC and dependent tests pass; IFC/Table FC tests fail because factories now require `usedStyle`. That's Tasks 8 and 9.

- [ ] **Step 6: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/bfc.ts packages/core/src/layout/bfc.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): BFC produces UsedStyle; retire lengthToPx (F5.1)"
```

---

## Task 8: IFC produces `UsedStyle`

**Files:**
- Modify: `packages/core/src/layout/ifc.ts`
- Modify: `packages/core/src/layout/ifc.test.ts`

Same pattern as Task 7 applied to IFC. Each line/text-run/inline-block factory call gets a `usedStyle` argument computed from the relevant ComputedStyle.

- [ ] **Step 1: Identify IFC's `lengthToPx` (or equivalent) calls and physical reads**

```bash
grep -nE "lengthToPx|cs\.padding|cs\.margin|cs\.border" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/layout/ifc.ts
```

- [ ] **Step 2: Compute `UsedStyle` per box**

For the parent's `LineBox`: `parentUsedStyle = computeUsedStyle(parent.computedStyle, availableInlineSize)`.
For each child within the line: `childUsed = computeUsedStyle(childCs, lineInlineSize)`.

- [ ] **Step 3: Update factory calls**

Insert `usedStyle` after `computedStyle` in every `createLineBox`, `createTextRunBox`, `createInlineBox`, `createInlineBlockBox` call.

- [ ] **Step 4: Replace any local length-resolving helpers with `resolveUsedLength` / `computeUsedStyle`**

Delete `lengthToPx` if it exists in ifc.ts.

- [ ] **Step 5: Run tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- layout
```

Expected: BFC + IFC pass; Table FC may still fail.

- [ ] **Step 6: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/ifc.ts packages/core/src/layout/ifc.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): IFC produces UsedStyle"
```

---

## Task 9: Table FC produces `UsedStyle`

**Files:**
- Modify: `packages/core/src/layout/table-fc.ts`
- Modify: `packages/core/src/layout/table-fc.test.ts`

Same pattern as Tasks 7 and 8 applied to Table FC.

- [ ] **Step 1: Apply the changes**

For each factory call in table-fc.ts (`createTableBox`, `createTableRowBox`, `createTableCellBox`):
- Compute appropriate `UsedStyle` for the box (containing-block inline-size depends on the box's parent: outer table uses `availableInlineSize`; rows use `tableInlineSize`; cells use `tableInlineSize`).
- Insert `usedStyle` after `computedStyle` in each call.

Delete any local `lengthToPx` if present.

- [ ] **Step 2: Run tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- layout
```

Expected: ALL layout tests pass.

- [ ] **Step 3: Run full core suite**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core
```

Expected: pass.

- [ ] **Step 4: Build**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/table-fc.ts packages/core/src/layout/table-fc.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): Table FC produces UsedStyle"
```

---

## Task 10: DOM painter reads sizes from `usedStyle`

**Files:**
- Modify: `packages/dom/src/canvas-renderer.ts`
- Modify: `packages/dom/src/canvas-measurer.ts` (if it reads sizes)

The painter currently reads sizes from `box.computedStyle` (paddings, borders). After Plan 3.B, those values may be `ComputedLength` (could be percent objects), so direct access wouldn't work. Switch all size reads to `box.usedStyle`, which is fully numeric.

- [ ] **Step 1: Identify size reads**

```bash
grep -nE "computedStyle\.(padding|margin|border|inlineSize|blockSize|fontSize|lineHeight)" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/dom/src/canvas-renderer.ts
```

For each match where the property is a length-typed size value, replace `computedStyle` with `usedStyle`.

For non-size properties (color, font-family, font-style, text-decoration, border-style, etc.), keep `computedStyle`.

- [ ] **Step 2: Update `physicalBorderSides` helper (from Plan 3.A) to use `UsedStyle`**

The helper currently reads `cs.borderBlockStartWidth` etc. — those are `number`-typed in `ComputedStyle` so don't need changing for borders. But padding (`paddingBlockStart` etc.) is `ComputedLength`-typed in `ComputedStyle` — switch to `usedStyle.paddingBlockStart` (which is `number`).

- [ ] **Step 3: Run dom tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/dom
```

Expected: pass.

- [ ] **Step 4: Build all**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspaces --if-present
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/dom/src/
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(dom): painter reads sizes from usedStyle"
```

---

## Task 11: Editor consumers + smoke test

**Files:**
- Modify: `packages/core/src/editor/cursor-position.ts` (if it reads sizes from computedStyle)
- Modify: `packages/core/src/editor/hit-test.ts`
- Modify: `packages/core/src/editor/selection-geometry.ts`
- Modify: `packages/core/src/editor/layout-utils.ts`
- Modify: `packages/core/src/editor/line-navigation.ts`

The editor utilities consume `LayoutBox.x/y/width/height` (numeric, from physical-derivation) — those don't change. They may also consume `box.computedStyle.fontSize`, `box.computedStyle.lineHeight`, etc. — `fontSize` is `number` in `ComputedStyle` so still OK; `lineHeight` is `number | ComputedLength` so may need switching to `usedStyle.lineHeight`.

- [ ] **Step 1: Search for length-typed reads**

```bash
grep -rnE "computedStyle\.(fontSize|lineHeight|inlineSize|blockSize|padding|margin|border)" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/editor/
```

For each, decide:
- `fontSize`, `borderXxxWidth` → keep `computedStyle` (already number)
- `paddingXxx`, `marginXxx`, `inlineSize`, `blockSize`, `lineHeight` (when used as a numeric size) → switch to `usedStyle`

- [ ] **Step 2: Update references**

Apply the rule above. The change is small — most editor utilities consume LayoutBox positions, not styles.

- [ ] **Step 3: Run all tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/dom
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/react
```

Expected: all pass.

- [ ] **Step 4: Build all**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspaces --if-present
```

Expected: clean.

- [ ] **Step 5: Smoke-test the dev server**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && timeout 15 npm run dev --workspace=examples/react 2>&1 | head -30
```

Expected: prints local URL within 15s without errors.

- [ ] **Step 6: Verify percent values now work**

Add a temporary test: a paragraph with `marginInlineStart: { unit: "percent", value: 10 }` should be positioned 10% of the containing block's inline-size from the inline-start edge. Assert via a layout-pass test, then revert if you don't want to keep it. (Optional but helpful as a smoke check.)

- [ ] **Step 7: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add -A
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(editor): editor consumers read sizes from usedStyle where applicable"
```

---

## Phase exit criteria

After all 11 tasks:

- [ ] `npm run build --workspaces --if-present` is clean.
- [ ] `npm test --workspace=packages/core` is green.
- [ ] `npm test --workspace=packages/dom` is green.
- [ ] `npm test --workspace=packages/react` is green.
- [ ] No occurrence of `lengthToPx` or `lengthOrZero` in any `packages/core/src/layout/*.ts` file:
  ```bash
  grep -rn "lengthToPx\|lengthOrZero" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/layout/
  ```
  (Empty expected.)
- [ ] No occurrence of em-fallback constants in `cascade-pass.ts`:
  ```bash
  grep -n " 16" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/cascade/cascade-pass.ts
  ```
  (Empty for hardcoded `16`. The actual `16` is now sourced from `INITIAL_COMPUTED_STYLE.fontSize`.)
- [ ] A `marginInlineStart: { unit: "percent", value: N }` style on an in-flow block produces a layout box with `usedStyle.marginInlineStart === containingInlineSize * N / 100`.
- [ ] `dev` server boots and renders the default document.

## Plan 3.A followups closed by 3.B

- F5.1 (`lengthToPx` casts using `as { value: number }`) — closed in Tasks 7-9.
- F7.6 (hardcoded em-fallback to 16) — closed in Task 3.
- F3A.13 (lengthToPx helper still using cast) — closed in Tasks 7-9.

## Plan 3.A followups deferred

- F3A.6 (cluster bidi reordering) — Plan 3.C.
- F3A.7 (vertical writing modes) — Plan 4 or later.
- F3A.10 (widows/orphans dropped) — Plan 5.
- F3A.13–F3A.15 (containingInlineSize default footgun) — could be tightened in 3.B if scope permits, but Plan 3.D's intrinsic-sizing makes this less urgent.

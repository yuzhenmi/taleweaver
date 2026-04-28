# Plan 3.A — Logical-Axis Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename Style schema, ComputedStyle, LayoutBox, and all formatting contexts from physical inset/sizing properties (`marginTop`, `width`, `paddingLeft`, `x`, `y`) to logical-axis equivalents (`marginBlockStart`, `inlineSize`, `paddingInlineStart`, `inlineOffset`, `blockOffset`), with direction-aware physical mapping for `horizontal-tb LTR` (identity) and `horizontal-tb RTL` (inline-axis mirrored).

**Architecture:** Plans 1+2 wrote layout in physical terms (`marginTop`, `x`, `y`); the algorithms hard-code horizontal-tb LTR. Plan 3.A flips this: the canonical layout vocabulary is logical (block/inline axes), the Style schema is logical-only, and physical coordinates are derived per-box at finalization based on writing-mode + direction. Vertical writing modes are not yet exposed (Plan 4); RTL is end-to-end (per spec §9.6).

**Tech Stack:** TypeScript, Vitest, npm workspaces. Engine package: `packages/core`. DOM (canvas painter): `packages/dom`.

**Spec reference:** [`docs/superpowers/specs/2026-04-29-plan-3-architectural-foundation-rewrite.md`](../specs/2026-04-29-plan-3-architectural-foundation-rewrite.md), §3.2 (Style schema is logical-only), §3.4 (LayoutBox carries both), §3.5 (v1 mapping), §10.A (phase 3.A scope).

**Branch:** `feature/dom-architecture-redesign` (the existing Plans 1+2 worktree).

---

## Worktree discipline

The work happens in a git worktree, not the main checkout. Every task in this plan must:

- Use the worktree path **`/Users/hansyu/code/taleweaver/.worktrees/dom-redesign`** for all file operations and command invocations.
- Pre-flight before any edit: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && pwd && git branch --show-current`. Expect `feature/dom-architecture-redesign`. STOP and report BLOCKED if not matching.
- Use absolute paths for every file write. ✅ `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/styles/style.ts`. ❌ `/Users/hansyu/code/taleweaver/packages/core/src/styles/style.ts` (the main checkout — do not touch).
- Use `git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign` for every git command. Subagent cwd does not persist between tool calls.

---

## File structure

Files created (3) and modified (~25) by this phase:

| Path | Status | Responsibility |
|---|---|---|
| `packages/core/src/styles/writing-mode.ts` | **create** | `WritingMode` and `Direction` types; logical/physical mapping helper |
| `packages/core/src/styles/style.ts` | modify | Logical-only Style schema; physical names removed |
| `packages/core/src/styles/property-meta.ts` | modify | `PROPERTY_META` and `INITIAL_COMPUTED_STYLE` keyed by logical names |
| `packages/core/src/styles/computed-style.ts` | modify (small) | Re-export still works; `ComputedStyle = Required<Style>` shape unchanged |
| `packages/core/src/styles/index.ts` | modify | Re-export `WritingMode`, `Direction` |
| `packages/core/src/styles/style.test.ts` | modify | Logical-named test cases |
| `packages/core/src/styles/property-meta.test.ts` | modify | Logical-named test cases |
| `packages/core/src/styles/computed-style.test.ts` | modify | Logical-named test cases |
| `packages/core/src/cascade/cascade-pass.ts` | modify | `flattenLengths` indexes logical names; em-resolution paths reference logical |
| `packages/core/src/cascade/compose.ts` | modify | Inheritance copies logical-named properties |
| `packages/core/src/cascade/resolve-length.ts` | modify | If any physical-named callers; mostly a rename |
| `packages/core/src/cascade/cascade-pass.test.ts` | modify | Tests reference logical names |
| `packages/core/src/layout/layout-box-v2.ts` | modify | LayoutBox carries `inlineOffset`/`blockOffset`/`inlineSize`/`blockSize` + `writingMode`/`direction` + derived `x`/`y`/`width`/`height` |
| `packages/core/src/layout/layout-box-v2.test.ts` | modify | Tests construct logical-args; assert derived physical |
| `packages/core/src/layout/bfc.ts` | modify | Logical names internally; uses logical Style fields; derives physical for output box |
| `packages/core/src/layout/bfc.test.ts` | modify | Logical-named test cases |
| `packages/core/src/layout/ifc.ts` | modify | Logical names internally |
| `packages/core/src/layout/ifc.test.ts` | modify | Logical-named test cases |
| `packages/core/src/layout/table-fc.ts` | modify | Logical names internally |
| `packages/core/src/layout/table-fc.test.ts` | modify | Logical-named test cases |
| `packages/core/src/layout/float-context.ts` | modify | Sides are `inline-start`/`inline-end`; logical block-offset semantics |
| `packages/core/src/layout/float-context.test.ts` | modify | Logical-side test cases |
| `packages/core/src/layout/dispatch.ts` | modify | Threads writingMode/direction into layout context |
| `packages/core/src/layout/layout-engine.ts` | modify | Top-level entry initializes writingMode/direction context |
| `packages/core/src/components/*.ts` (12 files) | modify | All component renderers set logical-named properties |
| `packages/core/src/components/factories.ts` | modify | Factory styles use logical names |
| `packages/core/src/editor/cursor-position.ts` | modify | Read physical (still derived); algorithm unchanged |
| `packages/core/src/editor/hit-test.ts` | modify | Read physical |
| `packages/core/src/editor/selection-geometry.ts` | modify | Read physical |
| `packages/core/src/editor/layout-utils.ts` | modify | Whatever consumes layout-box positions |
| `packages/dom/src/canvas-renderer.ts` | modify | Read physical (no semantic change since LTR identity) |
| `packages/dom/src/canvas-measurer.ts` | modify | Width/height inputs renamed at boundaries |
| `examples/react/src/**/*` | modify | Toolbar/menu/state setup uses logical-named styles |

Reads-only (no edits): cascade incremental, layout incremental wrappers (their internals delegate to renamed APIs).

**The rename is mostly mechanical search-and-replace.** Tasks 2–10 are scoped tightly so each commit is reviewable.

---

## Task list overview

| Task | Subject |
|---|---|
| **1** | Add `WritingMode` and `Direction` types and the logical→physical mapping helper |
| **2** | Rename Style schema: physical inset/sizing properties → logical |
| **3** | Update PROPERTY_META and INITIAL_COMPUTED_STYLE for logical names |
| **4** | Update cascade pass for logical names |
| **5** | Add logical fields to LayoutBox; factories accept logical args; derive physical for LTR identity |
| **6** | BFC reasons in logical |
| **7** | IFC reasons in logical |
| **8** | Table FC reasons in logical |
| **9** | FloatContext uses `inline-start` / `inline-end` sides |
| **10** | Components and factories produce logical-named styles |
| **11** | Direction-aware physical mapping: RTL `horizontal-tb` inverts inline-axis |
| **12** | Editor consumers (cursor-position, hit-test, selection-geometry, layout-utils) and DOM painter |

---

## Task 1: Add `WritingMode` and `Direction` types and mapping helper

**Files:**
- Create: `packages/core/src/styles/writing-mode.ts`
- Create: `packages/core/src/styles/writing-mode.test.ts`
- Modify: `packages/core/src/styles/index.ts`

- [ ] **Step 1: Pre-flight check**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && pwd && git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign branch --show-current
```

Expected output: `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign` and branch `feature/dom-architecture-redesign`. STOP if mismatched.

- [ ] **Step 2: Write the failing test**

Create `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/styles/writing-mode.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { logicalToPhysical, type LogicalRect, type PhysicalRect } from "./writing-mode";

describe("logicalToPhysical", () => {
  it("identity for horizontal-tb LTR", () => {
    const logical: LogicalRect = {
      inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
    };
    const out: PhysicalRect = logicalToPhysical(
      logical, "horizontal-tb", "ltr", /* containingInlineSize */ 500,
    );
    expect(out).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("inverts inline axis for horizontal-tb RTL", () => {
    const logical: LogicalRect = {
      inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
    };
    const out: PhysicalRect = logicalToPhysical(
      logical, "horizontal-tb", "rtl", /* containingInlineSize */ 500,
    );
    expect(out).toEqual({ x: 500 - 10 - 100, y: 20, width: 100, height: 50 });
  });

  it("RTL with offset 0 places box at right edge", () => {
    const logical: LogicalRect = {
      inlineOffset: 0, blockOffset: 0, inlineSize: 80, blockSize: 30,
    };
    const out = logicalToPhysical(logical, "horizontal-tb", "rtl", 200);
    expect(out).toEqual({ x: 200 - 0 - 80, y: 0, width: 80, height: 30 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- writing-mode
```

Expected: FAIL with "Cannot find module './writing-mode'".

- [ ] **Step 4: Implement the module**

Create `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/styles/writing-mode.ts`:

```ts
export type WritingMode = "horizontal-tb" | "vertical-rl" | "vertical-lr";
export type Direction = "ltr" | "rtl";

export interface LogicalRect {
  readonly inlineOffset: number;
  readonly blockOffset: number;
  readonly inlineSize: number;
  readonly blockSize: number;
}

export interface PhysicalRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Map a logical rect to a physical rect based on writing-mode + direction.
 *
 * Plan 3.A only implements `horizontal-tb` (vertical writing modes activate
 * in Plan 4):
 *   - LTR: identity. inlineOffset = x, blockOffset = y, etc.
 *   - RTL: inline axis is mirrored. The inline-start edge is on the right;
 *          x = containingInlineSize - inlineOffset - inlineSize.
 *
 * @param containingInlineSize the inline-size of the containing block
 *   (e.g., parent box's content-area inline-size). Required for RTL inversion;
 *   ignored for LTR.
 */
export function logicalToPhysical(
  logical: LogicalRect,
  writingMode: WritingMode,
  direction: Direction,
  containingInlineSize: number,
): PhysicalRect {
  if (writingMode !== "horizontal-tb") {
    throw new Error(`writing-mode "${writingMode}" not implemented in Plan 3.A`);
  }
  if (direction === "ltr") {
    return {
      x: logical.inlineOffset,
      y: logical.blockOffset,
      width: logical.inlineSize,
      height: logical.blockSize,
    };
  }
  return {
    x: containingInlineSize - logical.inlineOffset - logical.inlineSize,
    y: logical.blockOffset,
    width: logical.inlineSize,
    height: logical.blockSize,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- writing-mode
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Re-export from styles index**

In `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/styles/index.ts`, add:

```ts
export type { WritingMode, Direction, LogicalRect, PhysicalRect } from "./writing-mode";
export { logicalToPhysical } from "./writing-mode";
```

- [ ] **Step 7: Verify the build still passes**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/styles/writing-mode.ts packages/core/src/styles/writing-mode.test.ts packages/core/src/styles/index.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(styles): add WritingMode/Direction types and logical→physical mapping"
```

---

## Task 2: Rename Style schema — physical → logical

**Files:**
- Modify: `packages/core/src/styles/style.ts:42-79` (sizing, margin, padding, border-width sections)
- Modify: `packages/core/src/styles/style.ts:90-92` (float and clear value types)
- Modify: `packages/core/src/styles/style.ts` (top of file: type definitions for `Float`, `Clear`)
- Modify: `packages/core/src/styles/style.test.ts`

- [ ] **Step 1: Update Float and Clear value types**

In `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/styles/style.ts`, replace the existing type aliases:

```ts
export type Float = "none" | "left" | "right";
export type Clear = "none" | "left" | "right" | "both";
```

with:

```ts
export type Float = "none" | "inline-start" | "inline-end";
export type Clear = "none" | "inline-start" | "inline-end" | "both";
```

- [ ] **Step 2: Replace the Style interface body**

In the same file, replace the `interface Style { ... }` block entirely. The new body, in order:

```ts
export interface Style {
  // Display & layout participation
  readonly display?: Display;

  // Writing-mode and direction (Plan 3.A: horizontal-tb only; ltr/rtl both supported)
  readonly writingMode?: WritingMode;
  readonly direction?:   Direction;

  // Sizing — logical
  readonly inlineSize?:    LengthOrAuto;
  readonly blockSize?:     LengthOrAuto;
  readonly minInlineSize?: Length;
  readonly minBlockSize?:  Length;
  readonly maxInlineSize?: Length | "none";
  readonly maxBlockSize?:  Length | "none";
  readonly boxSizing?:     BoxSizing;

  // Margin — logical
  readonly marginBlockStart?:  LengthOrAuto;
  readonly marginBlockEnd?:    LengthOrAuto;
  readonly marginInlineStart?: LengthOrAuto;
  readonly marginInlineEnd?:   LengthOrAuto;

  // Padding — logical
  readonly paddingBlockStart?:  Length;
  readonly paddingBlockEnd?:    Length;
  readonly paddingInlineStart?: Length;
  readonly paddingInlineEnd?:   Length;

  // Border — logical
  readonly borderBlockStartWidth?:  number;
  readonly borderBlockEndWidth?:    number;
  readonly borderInlineStartWidth?: number;
  readonly borderInlineEndWidth?:   number;
  readonly borderBlockStartStyle?:  BorderStyle;
  readonly borderBlockEndStyle?:    BorderStyle;
  readonly borderInlineStartStyle?: BorderStyle;
  readonly borderInlineEndStyle?:   BorderStyle;
  readonly borderBlockStartColor?:  Color;
  readonly borderBlockEndColor?:    Color;
  readonly borderInlineStartColor?: Color;
  readonly borderInlineEndColor?:   Color;

  // Background
  readonly backgroundColor?: Color;

  // Typography (unchanged)
  readonly fontFamily?:     string;
  readonly fontSize?:       Length;
  readonly fontWeight?:     FontWeight;
  readonly fontStyle?:      FontStyle;
  readonly textDecoration?: TextDecoration;
  readonly lineHeight?:     number | Length;
  readonly color?:          Color;

  // Inline / text (unchanged)
  readonly whiteSpace?:    WhiteSpace;
  readonly verticalAlign?: VerticalAlign;

  // Float / clear (sides are logical now)
  readonly float?: Float;
  readonly clear?: Clear;

  // Fragmentation (unchanged)
  readonly breakBefore?: BreakBefore;
  readonly breakAfter?:  BreakAfter;
  readonly breakInside?: BreakInside;

  // List
  readonly listStyleType?:     ListStyleType;
  readonly listStylePosition?: ListStylePosition;
}
```

- [ ] **Step 3: Add the WritingMode/Direction import to style.ts**

Add at the top of `style.ts`, after the existing `Length`/`Color` imports:

```ts
import type { WritingMode, Direction } from "./writing-mode";
```

- [ ] **Step 4: Update style.test.ts**

In `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/styles/style.test.ts`, replace any test that uses physical names with logical equivalents. The full file should look like:

```ts
import { describe, it, expect } from "vitest";
import type { Style } from "./style";

describe("Style", () => {
  it("accepts logical inset and sizing properties", () => {
    const s: Style = {
      display: "block",
      inlineSize: 100,
      blockSize: 50,
      marginBlockStart: 10, marginBlockEnd: 10,
      marginInlineStart: 10, marginInlineEnd: 10,
      paddingBlockStart: 5, paddingBlockEnd: 5,
      paddingInlineStart: 5, paddingInlineEnd: 5,
      borderBlockStartWidth: 1, borderBlockEndWidth: 1,
      borderInlineStartWidth: 1, borderInlineEndWidth: 1,
      borderBlockStartStyle: "solid",
      borderBlockStartColor: "#000",
    };
    expect(s.marginInlineStart).toBe(10);
    expect(s.inlineSize).toBe(100);
  });

  it("accepts writingMode and direction", () => {
    const s: Style = { writingMode: "horizontal-tb", direction: "rtl" };
    expect(s.writingMode).toBe("horizontal-tb");
    expect(s.direction).toBe("rtl");
  });

  it("accepts logical float and clear values", () => {
    const s: Style = { float: "inline-start", clear: "both" };
    expect(s.float).toBe("inline-start");
  });
});
```

- [ ] **Step 5: Run the style.test.ts suite**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- styles/style.test
```

Expected: 3 tests pass.

- [ ] **Step 6: Verify build (will fail elsewhere — expected)**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core
```

Expected: build fails with type errors elsewhere (PROPERTY_META, components, layout still use physical names). This is expected; subsequent tasks fix them.

- [ ] **Step 7: Commit (intermediate — schema only)**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/styles/style.ts packages/core/src/styles/style.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(styles): rename Style schema physical inset/sizing to logical names

Plan 3.A. Float and clear values are now inline-start / inline-end.
Build is broken elsewhere; subsequent tasks fix."
```

---

## Task 3: PROPERTY_META and INITIAL_COMPUTED_STYLE for logical names

**Files:**
- Modify: `packages/core/src/styles/property-meta.ts`
- Modify: `packages/core/src/styles/property-meta.test.ts`
- Modify: `packages/core/src/styles/computed-style.test.ts`

- [ ] **Step 1: Replace the PROPERTY_META and INITIAL_COMPUTED_STYLE definitions**

In `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/styles/property-meta.ts`, the file should look like (replace contents):

```ts
import type { Style } from "./style";
import type { ComputedStyle } from "./computed-style";

export const PROPERTY_META: Record<keyof Style, { inherits: boolean }> = {
  display:         { inherits: false },

  writingMode:     { inherits: true },
  direction:       { inherits: true },

  inlineSize:      { inherits: false },
  blockSize:       { inherits: false },
  minInlineSize:   { inherits: false },
  minBlockSize:    { inherits: false },
  maxInlineSize:   { inherits: false },
  maxBlockSize:    { inherits: false },
  boxSizing:       { inherits: false },

  marginBlockStart:  { inherits: false },
  marginBlockEnd:    { inherits: false },
  marginInlineStart: { inherits: false },
  marginInlineEnd:   { inherits: false },

  paddingBlockStart:  { inherits: false },
  paddingBlockEnd:    { inherits: false },
  paddingInlineStart: { inherits: false },
  paddingInlineEnd:   { inherits: false },

  borderBlockStartWidth:  { inherits: false },
  borderBlockEndWidth:    { inherits: false },
  borderInlineStartWidth: { inherits: false },
  borderInlineEndWidth:   { inherits: false },
  borderBlockStartStyle:  { inherits: false },
  borderBlockEndStyle:    { inherits: false },
  borderInlineStartStyle: { inherits: false },
  borderInlineEndStyle:   { inherits: false },
  borderBlockStartColor:  { inherits: false },
  borderBlockEndColor:    { inherits: false },
  borderInlineStartColor: { inherits: false },
  borderInlineEndColor:   { inherits: false },

  backgroundColor: { inherits: false },

  fontFamily:     { inherits: true },
  fontSize:       { inherits: true },
  fontWeight:     { inherits: true },
  fontStyle:      { inherits: true },
  textDecoration: { inherits: true },
  lineHeight:     { inherits: true },
  color:          { inherits: true },

  whiteSpace:    { inherits: true },
  verticalAlign: { inherits: false },

  float: { inherits: false },
  clear: { inherits: false },

  breakBefore: { inherits: false },
  breakAfter:  { inherits: false },
  breakInside: { inherits: false },

  listStyleType:     { inherits: true },
  listStylePosition: { inherits: true },
};

export const INITIAL_COMPUTED_STYLE: ComputedStyle = {
  display: "inline",

  writingMode: "horizontal-tb",
  direction:   "ltr",

  inlineSize:    "auto",
  blockSize:     "auto",
  minInlineSize: 0,
  minBlockSize:  0,
  maxInlineSize: "none",
  maxBlockSize:  "none",
  boxSizing:     "content-box",

  marginBlockStart:  0,
  marginBlockEnd:    0,
  marginInlineStart: 0,
  marginInlineEnd:   0,

  paddingBlockStart:  0,
  paddingBlockEnd:    0,
  paddingInlineStart: 0,
  paddingInlineEnd:   0,

  borderBlockStartWidth:  0,
  borderBlockEndWidth:    0,
  borderInlineStartWidth: 0,
  borderInlineEndWidth:   0,
  borderBlockStartStyle:  "none",
  borderBlockEndStyle:    "none",
  borderInlineStartStyle: "none",
  borderInlineEndStyle:   "none",
  borderBlockStartColor:  "currentColor",
  borderBlockEndColor:    "currentColor",
  borderInlineStartColor: "currentColor",
  borderInlineEndColor:   "currentColor",

  backgroundColor: "transparent",

  fontFamily:     "sans-serif",
  fontSize:       16,
  fontWeight:     "normal",
  fontStyle:      "normal",
  textDecoration: "none",
  lineHeight:     1.2,
  color:          "#000",

  whiteSpace:    "normal",
  verticalAlign: "baseline",

  float: "none",
  clear: "none",

  breakBefore: "auto",
  breakAfter:  "auto",
  breakInside: "auto",

  listStyleType:     "disc",
  listStylePosition: "outside",
};
```

- [ ] **Step 2: Update property-meta.test.ts**

In `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/styles/property-meta.test.ts`, replace physical-name references. Updated test contents:

```ts
import { describe, it, expect } from "vitest";
import { PROPERTY_META, INITIAL_COMPUTED_STYLE } from "./property-meta";

describe("PROPERTY_META", () => {
  it("marks layout properties as non-inheriting", () => {
    expect(PROPERTY_META.marginBlockStart.inherits).toBe(false);
    expect(PROPERTY_META.paddingInlineStart.inherits).toBe(false);
    expect(PROPERTY_META.inlineSize.inherits).toBe(false);
    expect(PROPERTY_META.borderBlockStartWidth.inherits).toBe(false);
  });

  it("marks typography as inheriting", () => {
    expect(PROPERTY_META.fontFamily.inherits).toBe(true);
    expect(PROPERTY_META.fontSize.inherits).toBe(true);
    expect(PROPERTY_META.color.inherits).toBe(true);
  });

  it("marks writing-mode and direction as inheriting", () => {
    expect(PROPERTY_META.writingMode.inherits).toBe(true);
    expect(PROPERTY_META.direction.inherits).toBe(true);
  });
});

describe("INITIAL_COMPUTED_STYLE", () => {
  it("has zero margins, paddings, and borders", () => {
    expect(INITIAL_COMPUTED_STYLE.marginBlockStart).toBe(0);
    expect(INITIAL_COMPUTED_STYLE.marginInlineEnd).toBe(0);
    expect(INITIAL_COMPUTED_STYLE.paddingBlockStart).toBe(0);
    expect(INITIAL_COMPUTED_STYLE.borderBlockStartWidth).toBe(0);
  });

  it("has writing-mode horizontal-tb and direction ltr", () => {
    expect(INITIAL_COMPUTED_STYLE.writingMode).toBe("horizontal-tb");
    expect(INITIAL_COMPUTED_STYLE.direction).toBe("ltr");
  });
});
```

- [ ] **Step 3: Update computed-style.test.ts**

In `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/styles/computed-style.test.ts`, replace any test that constructs a ComputedStyle inline. The relevant sections become:

```ts
const cs: ComputedStyle = {
  ...INITIAL_COMPUTED_STYLE,
  display: "block",
  marginBlockStart: 10, marginBlockEnd: 10,
  marginInlineStart: 0, marginInlineEnd: 0,
  paddingBlockStart: 5, paddingBlockEnd: 5,
  paddingInlineStart: 0, paddingInlineEnd: 0,
  borderBlockStartWidth: 1, borderBlockEndWidth: 1,
  borderInlineStartWidth: 0, borderInlineEndWidth: 0,
};
```

(Replace the prior block at lines 11–14 and any other call sites.) The test file's overall structure stays the same — only the property names change.

- [ ] **Step 4: Run the styles tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- styles
```

Expected: all tests in `packages/core/src/styles/*.test.ts` pass.

- [ ] **Step 5: Build (still failing elsewhere)**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core
```

Expected: still fails outside `styles/` (cascade, layout, components reference old names).

- [ ] **Step 6: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/styles/property-meta.ts packages/core/src/styles/property-meta.test.ts packages/core/src/styles/computed-style.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(styles): logical-named PROPERTY_META and INITIAL_COMPUTED_STYLE"
```

---

## Task 4: Cascade pass uses logical names

**Files:**
- Modify: `packages/core/src/cascade/cascade-pass.ts`
- Modify: `packages/core/src/cascade/compose.ts`
- Modify: `packages/core/src/cascade/resolve-length.ts` (if it references physical names)
- Modify: `packages/core/src/cascade/cascade-pass.test.ts`

- [ ] **Step 1: Inspect cascade-pass.ts for physical-name references**

```bash
grep -nE "marginTop|marginBottom|marginLeft|marginRight|paddingTop|paddingBottom|paddingLeft|paddingRight|width|height|borderTopWidth|borderBottomWidth|borderLeftWidth|borderRightWidth|borderTopStyle|borderBottomStyle|borderLeftStyle|borderRightStyle|borderTopColor|borderBottomColor|borderLeftColor|borderRightColor|float.*left|float.*right|clear.*left|clear.*right" packages/core/src/cascade/cascade-pass.ts packages/core/src/cascade/compose.ts packages/core/src/cascade/resolve-length.ts
```

Note the lines reported. Update each one to use the logical name. For example, `flattenLengths` references `marginTop` → becomes `marginBlockStart`, etc.

- [ ] **Step 2: Update `flattenLengths` in cascade-pass.ts**

The `flattenLengths` helper iterates length-typed properties and resolves `em`/`rem` against font-size. Find the property-name list (it's an array constant); replace physical names with logical names. The list, in full:

```ts
const LENGTH_PROPERTIES = [
  "inlineSize", "blockSize",
  "minInlineSize", "minBlockSize",
  "maxInlineSize", "maxBlockSize",
  "marginBlockStart", "marginBlockEnd",
  "marginInlineStart", "marginInlineEnd",
  "paddingBlockStart", "paddingBlockEnd",
  "paddingInlineStart", "paddingInlineEnd",
  "fontSize",
  "lineHeight",
  // borderXxxWidth are number-typed (per Style schema), not Length, so not in this list
] as const;
```

Replace the existing list. If `flattenLengths` was named-iterating with hardcoded property names, update each property reference to its logical equivalent.

- [ ] **Step 3: Update compose.ts**

Inheritance composition reads PROPERTY_META, which now lists logical names — so the iteration is implicit. But check compose.ts for any hardcoded property names:

```bash
grep -nE "marginTop|paddingTop|width|height|borderTopWidth" packages/core/src/cascade/compose.ts
```

If any matches, replace with the logical equivalent.

- [ ] **Step 4: Update cascade-pass.test.ts**

Replace any test fixtures that set physical-named properties. The pattern is:

```ts
// before
const style: Style = { marginTop: 10, paddingLeft: 5 };
// after
const style: Style = { marginBlockStart: 10, paddingInlineStart: 5 };
```

Walk every test case and apply the rename.

- [ ] **Step 5: Run cascade tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- cascade
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/cascade/
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(cascade): use logical-named properties in flattenLengths and compose"
```

---

## Task 5: LayoutBox carries logical fields; factories accept logical args (LTR identity)

**Files:**
- Modify: `packages/core/src/layout/layout-box-v2.ts`
- Modify: `packages/core/src/layout/layout-box-v2.test.ts`

This task changes the LayoutBox shape and factories. Physical (`x`, `y`, `width`, `height`) is still present but **derived as identity from logical** (because Plan 3.A's RTL inversion happens in Task 11, not here). LTR documents work end-to-end after this task.

- [ ] **Step 1: Update LayoutBoxBase to carry both logical and physical**

In `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/layout/layout-box-v2.ts`, replace the `LayoutBoxBase` interface (lines 5–12):

```ts
import type { ComputedStyle } from "../styles";
import type { WritingMode, Direction } from "../styles/writing-mode";

export type LayoutBox = BlockBox | LineBox | TextRunBox | InlineBox | InlineBlockBox | MarkerBox | TableBox | TableRowBox | TableCellBox;

interface LayoutBoxBase {
  readonly key: string;

  // Logical (FCs read+write these)
  readonly inlineOffset: number;
  readonly blockOffset:  number;
  readonly inlineSize:   number;
  readonly blockSize:    number;

  // Physical (painter / hit-test / selection-geometry read these)
  // In Plan 3.A: derived as identity for LTR; Task 11 adds RTL inversion.
  readonly x: number;
  readonly y: number;
  readonly width:  number;
  readonly height: number;

  // Containing-block writing-mode + direction at this point
  readonly writingMode: WritingMode;
  readonly direction:   Direction;

  readonly computedStyle: Readonly<ComputedStyle>;
}
```

- [ ] **Step 2: Replace every `createXxxBox` factory**

Each factory's signature changes from `(key, x, y, width, height, ...)` to `(key, inlineOffset, blockOffset, inlineSize, blockSize, writingMode, direction, ...)`. Physical is computed inside; LTR is identity. (Task 11 will swap in `logicalToPhysical` from Task 1; for now, keep it inline as identity to keep this task scoped.)

Replace the entire body of `layout-box-v2.ts` after the type definitions with the following factory implementations:

```ts
function deriveIdentityPhysical(
  inlineOffset: number, blockOffset: number,
  inlineSize: number, blockSize: number,
): { x: number; y: number; width: number; height: number } {
  // Plan 3.A LTR-only identity. Task 11 replaces with logicalToPhysical.
  return {
    x: inlineOffset, y: blockOffset,
    width: inlineSize, height: blockSize,
  };
}

export function createBlockBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
  metadata?: Readonly<Record<string, unknown>>,
): BlockBox {
  const phys = deriveIdentityPhysical(inlineOffset, blockOffset, inlineSize, blockSize);
  return Object.freeze({
    type: "block" as const,
    key,
    inlineOffset, blockOffset, inlineSize, blockSize,
    ...phys,
    writingMode, direction,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
    ...(metadata !== undefined ? { metadata: Object.freeze({ ...metadata }) } : {}),
  });
}

export function createLineBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
  baseline: number = blockSize,
): LineBox {
  const phys = deriveIdentityPhysical(inlineOffset, blockOffset, inlineSize, blockSize);
  return Object.freeze({
    type: "line" as const,
    key,
    inlineOffset, blockOffset, inlineSize, blockSize,
    ...phys,
    writingMode, direction,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
    baseline,
  });
}

export function createTextRunBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  text: string,
): TextRunBox {
  const phys = deriveIdentityPhysical(inlineOffset, blockOffset, inlineSize, blockSize);
  return Object.freeze({
    type: "text-run" as const,
    key,
    inlineOffset, blockOffset, inlineSize, blockSize,
    ...phys,
    writingMode, direction,
    computedStyle: Object.freeze({ ...computedStyle }),
    text,
  });
}

export function createInlineBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
  fragmentEdge: InlineFragmentEdge,
): InlineBox {
  const phys = deriveIdentityPhysical(inlineOffset, blockOffset, inlineSize, blockSize);
  return Object.freeze({
    type: "inline" as const,
    key,
    inlineOffset, blockOffset, inlineSize, blockSize,
    ...phys,
    writingMode, direction,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
    fragmentEdge,
  });
}

export function createInlineBlockBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
): InlineBlockBox {
  const phys = deriveIdentityPhysical(inlineOffset, blockOffset, inlineSize, blockSize);
  return Object.freeze({
    type: "inline-block" as const,
    key,
    inlineOffset, blockOffset, inlineSize, blockSize,
    ...phys,
    writingMode, direction,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
  });
}

export function createMarkerBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  text: string,
): MarkerBox {
  const phys = deriveIdentityPhysical(inlineOffset, blockOffset, inlineSize, blockSize);
  return Object.freeze({
    type: "marker" as const,
    key,
    inlineOffset, blockOffset, inlineSize, blockSize,
    ...phys,
    writingMode, direction,
    computedStyle: Object.freeze({ ...computedStyle }),
    text,
  });
}

export function createTableBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
  columnPxWidths: readonly number[],
): TableBox {
  const phys = deriveIdentityPhysical(inlineOffset, blockOffset, inlineSize, blockSize);
  return Object.freeze({
    type: "table" as const,
    key,
    inlineOffset, blockOffset, inlineSize, blockSize,
    ...phys,
    writingMode, direction,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
    columnPxWidths: Object.freeze([...columnPxWidths]),
  });
}

export function createTableRowBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
): TableRowBox {
  const phys = deriveIdentityPhysical(inlineOffset, blockOffset, inlineSize, blockSize);
  return Object.freeze({
    type: "table-row" as const,
    key,
    inlineOffset, blockOffset, inlineSize, blockSize,
    ...phys,
    writingMode, direction,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
  });
}

export function createTableCellBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
): TableCellBox {
  const phys = deriveIdentityPhysical(inlineOffset, blockOffset, inlineSize, blockSize);
  return Object.freeze({
    type: "table-cell" as const,
    key,
    inlineOffset, blockOffset, inlineSize, blockSize,
    ...phys,
    writingMode, direction,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
  });
}
```

(The interface declarations for `BlockBox`, `LineBox`, `TextRunBox`, `InlineBox`, `InlineBlockBox`, `MarkerBox`, `TableBox`, `TableRowBox`, `TableCellBox` stay as before — they extend `LayoutBoxBase`, so they automatically pick up the new fields.)

- [ ] **Step 3: Update layout-box-v2.test.ts**

The tests construct boxes via factories. Update each call to use the new logical-args signature:

```ts
// before
createBlockBox("k", 0, 0, 100, 50, computedStyle, [])
// after
createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "ltr", computedStyle, [])
```

Walk every `createXxxBox` call in the test file. After the update, all factories take `(key, inlineOffset, blockOffset, inlineSize, blockSize, writingMode, direction, ...)`. Use `"horizontal-tb"` and `"ltr"` for all v1 tests.

Add one new test asserting the LTR identity:

```ts
it("derives identity physical for LTR horizontal-tb", () => {
  const cs: ComputedStyle = INITIAL_COMPUTED_STYLE;
  const b = createBlockBox(
    "k", 10, 20, 100, 50, "horizontal-tb", "ltr", cs, [],
  );
  expect(b.inlineOffset).toBe(10);
  expect(b.blockOffset).toBe(20);
  expect(b.inlineSize).toBe(100);
  expect(b.blockSize).toBe(50);
  expect(b.x).toBe(10);
  expect(b.y).toBe(20);
  expect(b.width).toBe(100);
  expect(b.height).toBe(50);
});
```

(Add the appropriate import for `INITIAL_COMPUTED_STYLE` from `"../styles"`.)

- [ ] **Step 4: Run the layout-box tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- layout/layout-box-v2.test
```

Expected: PASS.

- [ ] **Step 5: Build (will still fail in FCs)**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core
```

Expected: build fails because BFC, IFC, Table FC, FloatContext still call factories with the old signature. This is expected; Tasks 6-9 fix them.

- [ ] **Step 6: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/layout-box-v2.ts packages/core/src/layout/layout-box-v2.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): LayoutBox carries logical+physical; factories accept logical args"
```

---

## Task 6: BFC reasons in logical

**Files:**
- Modify: `packages/core/src/layout/bfc.ts`
- Modify: `packages/core/src/layout/bfc.test.ts`

The BFC algorithm in `bfc.ts` reads `paddingTop` / `paddingLeft` / `marginTop` / `borderTopWidth` etc. from ComputedStyle. After this task it reads `paddingBlockStart` / `paddingInlineStart` / `marginBlockStart` / `borderBlockStartWidth`. The variable names inside the function also change: `childY` → `childBlockOffset`, `paddingTop` → `paddingBlockStart`, etc.

- [ ] **Step 1: Identify BFC's physical-name references**

```bash
grep -nE "paddingTop|paddingLeft|paddingBottom|paddingRight|marginTop|marginBottom|marginLeft|marginRight|borderTopWidth|borderBottomWidth|borderLeftWidth|borderRightWidth|childX|childY|width|height" packages/core/src/layout/bfc.ts | head -80
```

Note every line; each gets a logical-name replacement.

- [ ] **Step 2: Replace bfc.ts contents**

Open `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/layout/bfc.ts` and apply the following transformations across the whole file:

| Old | New |
|---|---|
| `paddingTop` | `paddingBlockStart` |
| `paddingBottom` | `paddingBlockEnd` |
| `paddingLeft` | `paddingInlineStart` |
| `paddingRight` | `paddingInlineEnd` |
| `marginTop` | `marginBlockStart` |
| `marginBottom` | `marginBlockEnd` |
| `marginLeft` | `marginInlineStart` |
| `marginRight` | `marginInlineEnd` |
| `borderTopWidth` | `borderBlockStartWidth` |
| `borderBottomWidth` | `borderBlockEndWidth` |
| `borderLeftWidth` | `borderInlineStartWidth` |
| `borderRightWidth` | `borderInlineEndWidth` |
| `cs.width` (Style read) | `cs.inlineSize` |
| `cs.height` (Style read) | `cs.blockSize` |
| `availableWidth` (function param) | `availableInlineSize` |
| `contentWidth` (local) | `contentInlineSize` |
| `finalWidth` (local) | `finalInlineSize` |
| `childY` (local) | `childBlockOffset` |
| `childX` (local) | `childInlineOffset` |
| `lineMaxY` (local) | `lineMaxBlockEdge` |
| `floatBottom` (local) | `floatBlockEnd` |
| `inFlowHeight` (local) | `inFlowBlockSize` |
| `totalHeight` (local) | `totalBlockSize` |
| `lengthOrZero(cs.borderTopWidth)` | `lengthOrZero(cs.borderBlockStartWidth)` |
| `cs.float === "left"` | `cs.float === "inline-start"` |
| `cs.float === "right"` | `cs.float === "inline-end"` |
| `cs.clear !== "none"` (left as-is) | `cs.clear !== "none"` (logical clear values are still strings; FloatContext side resolution updates in Task 9) |

The FC entry signature changes too. The `layoutBlock` function's signature becomes:

```ts
export function layoutBlock(
  node: ElementBox,
  inlineOffset: number,
  blockOffset: number,
  availableInlineSize: number,
  measurer: TextMeasurer,
  writingMode: WritingMode = "horizontal-tb",
  direction: Direction = "ltr",
): BlockBox {
  // ...
}
```

Add the `WritingMode`/`Direction` import at top:

```ts
import type { WritingMode, Direction } from "../styles/writing-mode";
```

Pass `writingMode` and `direction` into every factory call (`createBlockBox`, `createMarkerBox`) within the function. For example:

```ts
return createBlockBox(
  node.key,
  inlineOffset, blockOffset, finalInlineSize, totalBlockSize,
  writingMode, direction,
  cs, layoutChildren, node.metadata,
);
```

When recursing into children, pass `cs.writingMode` and `cs.direction` (THIS node's, not the function's parameters). The child's containing block is THIS node, so the child's coordinate system is THIS node's writing-mode / direction. The function's `writingMode` / `direction` parameters are the **parent's** axes (used only for the factory call that creates THIS node's box, since THIS node's containing block is the parent).

```ts
const childLayout = childCs.display === "table"
  ? layoutTable(child, paddingInlineStart, childBlockOffset, contentInlineSize, measurer, cs.writingMode, cs.direction)
  : layoutBlock(child, paddingInlineStart, childBlockOffset, contentInlineSize, measurer, cs.writingMode, cs.direction);
```

(Cascade has already inherited `writingMode`/`direction`, so for documents with uniform direction this is equivalent to pass-through. The distinction matters when a paragraph mid-document overrides direction — Plan 3.A doesn't ship that case in the example app, but the algorithm is correct for it.)

- [ ] **Step 3: Update bfc.test.ts**

Walk every test fixture in `bfc.test.ts`. Replace physical-name property assignments in test ComputedStyles:

```ts
// before
{ ...INITIAL_COMPUTED_STYLE, marginTop: 10, paddingLeft: 5 }
// after
{ ...INITIAL_COMPUTED_STYLE, marginBlockStart: 10, paddingInlineStart: 5 }
```

Update test assertions on box positions. `out.x`, `out.y`, `out.width`, `out.height` still work (LTR identity). Tests that read these can stay; tests should also assert logical equivalents:

```ts
expect(box.x).toBe(10);              // still works (LTR)
expect(box.inlineOffset).toBe(10);    // also assert logical
expect(box.blockOffset).toBe(20);
```

Update `layoutBlock` invocations to pass writingMode/direction (default args make them optional, but be explicit in tests):

```ts
const out = layoutBlock(node, 0, 0, 500, measurer, "horizontal-tb", "ltr");
```

- [ ] **Step 4: Run bfc tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- layout/bfc.test
```

Expected: PASS.

- [ ] **Step 5: Build**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core
```

Expected: still fails — IFC, Table FC, FloatContext, components, dispatch.ts not yet updated.

- [ ] **Step 6: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/bfc.ts packages/core/src/layout/bfc.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): BFC reasons in logical-axis terms"
```

---

## Task 7: IFC reasons in logical

**Files:**
- Modify: `packages/core/src/layout/ifc.ts`
- Modify: `packages/core/src/layout/ifc.test.ts`

The IFC builds line boxes from inline content. Current code uses `lineX`, `lineY`, `availableWidth`, `lineHeight` etc. Apply the same renaming as BFC, plus `lineX → lineInlineCursor`, `lineY → lineBlockOffset`.

- [ ] **Step 1: Identify physical references in ifc.ts**

```bash
grep -nE "paddingTop|paddingLeft|paddingBottom|paddingRight|marginTop|marginBottom|marginLeft|marginRight|borderTopWidth|borderBottomWidth|borderLeftWidth|borderRightWidth|width|height|lineX|lineY|availableWidth|cursorX|cursorY|x:|y:" packages/core/src/layout/ifc.ts | head -100
```

- [ ] **Step 2: Apply rename throughout ifc.ts**

Rename rules (apply across whole file):

| Old | New |
|---|---|
| `paddingTop`, `paddingLeft` (style reads) | `paddingBlockStart`, `paddingInlineStart` |
| `paddingBottom`, `paddingRight` (style reads) | `paddingBlockEnd`, `paddingInlineEnd` |
| `marginTop`/etc. (style reads) | logical equivalents |
| `borderTopWidth`/etc. | `borderBlockStartWidth`/etc. |
| `cs.width`, `cs.height` (style reads) | `cs.inlineSize`, `cs.blockSize` |
| function param `availableWidth` | `availableInlineSize` |
| function param `containerY` (or similar block-offset) | `containerBlockOffset` |
| local `lineX` | `lineInlineCursor` |
| local `lineY` | `lineBlockOffset` |
| local `lineHeight` | `lineBlockSize` |
| local `cursorX` / `cursorY` | `cursorInlineOffset` / `cursorBlockOffset` |
| factory args `(x, y, width, height, ...)` | `(inlineOffset, blockOffset, inlineSize, blockSize, writingMode, direction, ...)` |

The `layoutInlineContent` function signature becomes:

```ts
export function layoutInlineContent(
  parent: ElementBox,
  inlineOffset: number,
  blockOffset: number,
  availableInlineSize: number,
  measurer: TextMeasurer,
  floatCtx: FloatContext,
  writingMode: WritingMode = "horizontal-tb",
  direction: Direction = "ltr",
): readonly LineBox[] {
  // ...
}
```

Add the import:

```ts
import type { WritingMode, Direction } from "../styles/writing-mode";
```

Every factory call (`createLineBox`, `createTextRunBox`, `createInlineBox`, `createInlineBlockBox`) within the function passes `writingMode, direction`. Example:

```ts
return createLineBox(
  parent.key + "/line-" + i,
  inlineOffset, lineBlockOffset, lineInlineSize, lineBlockSize,
  writingMode, direction,
  parent.computedStyle,
  lineChildren,
  baseline,
);
```

- [ ] **Step 3: Update ifc.test.ts**

Same pattern as bfc.test.ts: replace physical-named properties, update assertions to also use logical names where helpful, pass writingMode/direction through `layoutInlineContent` calls.

- [ ] **Step 4: Run ifc tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- layout/ifc.test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/ifc.ts packages/core/src/layout/ifc.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): IFC reasons in logical-axis terms"
```

---

## Task 8: Table FC reasons in logical

**Files:**
- Modify: `packages/core/src/layout/table-fc.ts`
- Modify: `packages/core/src/layout/table-fc.test.ts`

- [ ] **Step 1: Apply rename throughout table-fc.ts**

Same rename rules as Tasks 6 and 7. Variable names like `tableX` → `tableInlineOffset`, `rowY` → `rowBlockOffset`, `cellWidth` → `cellInlineSize`, `cellHeight` → `cellBlockSize`. Style reads use logical names.

The `layoutTable` function signature:

```ts
export function layoutTable(
  node: ElementBox,
  inlineOffset: number,
  blockOffset: number,
  availableInlineSize: number,
  measurer: TextMeasurer,
  writingMode: WritingMode = "horizontal-tb",
  direction: Direction = "ltr",
): TableBox {
  // ...
}
```

Pass `writingMode, direction` through to `createTableBox`, `createTableRowBox`, `createTableCellBox`, and any nested `layoutBlock` / `layoutInlineContent` calls inside cells.

- [ ] **Step 2: Update table-fc.test.ts**

Replace physical names. Test fixtures setting `width: 200` for a table become `inlineSize: 200`. `columnPxWidths` is internally a per-column inline-size array — already the right semantic.

- [ ] **Step 3: Run table-fc tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- layout/table-fc.test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/table-fc.ts packages/core/src/layout/table-fc.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): Table FC reasons in logical-axis terms"
```

---

## Task 9: FloatContext uses inline-start / inline-end sides

**Files:**
- Modify: `packages/core/src/layout/float-context.ts`
- Modify: `packages/core/src/layout/float-context.test.ts`

The FloatContext methods today take `side: "left" | "right"`. The values become `"inline-start" | "inline-end"`. The internal logic is unchanged — both LTR-mapping and RTL-mapping happen at the BFC's `cs.float === "inline-start"` check, which is already done by Task 6.

- [ ] **Step 1: Replace the FloatContext interface and implementation**

Open `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/layout/float-context.ts` and replace its contents:

```ts
export interface PlacedFloat {
  readonly side: "inline-start" | "inline-end";
  readonly inlineOffset: number;
  readonly blockOffset: number;
  readonly inlineSize: number;
  readonly blockSize: number;
}

export interface FloatContext {
  placeFloat(f: PlacedFloat): void;
  /**
   * @returns the inline-size occupied at `blockOffset` by floats on each side.
   * Caller subtracts these from the containing inline-size to get the free
   * inline-size at that block-offset.
   */
  activeAt(blockOffset: number): { inlineStartSize: number; inlineEndSize: number };
  /**
   * @returns the block-offset at which all floats on the cleared side(s) end.
   * Used by `clear: inline-start | inline-end | both`.
   */
  clearY(side: "inline-start" | "inline-end" | "both", blockOffset: number): number;
  lowestBottom(): number;
}

export function createFloatContext(): FloatContext {
  const placed: PlacedFloat[] = [];
  return {
    placeFloat(f) {
      placed.push(f);
    },
    activeAt(blockOffset) {
      let inlineStartSize = 0;
      let inlineEndSize = 0;
      for (const f of placed) {
        if (blockOffset < f.blockOffset) continue;
        if (blockOffset >= f.blockOffset + f.blockSize) continue;
        if (f.side === "inline-start") inlineStartSize = Math.max(inlineStartSize, f.inlineOffset + f.inlineSize);
        else inlineEndSize = Math.max(inlineEndSize, f.inlineSize);
      }
      return { inlineStartSize, inlineEndSize };
    },
    clearY(side, blockOffset) {
      let bottom = blockOffset;
      for (const f of placed) {
        const isMatch =
          side === "both" ||
          (side === "inline-start" && f.side === "inline-start") ||
          (side === "inline-end" && f.side === "inline-end");
        if (!isMatch) continue;
        bottom = Math.max(bottom, f.blockOffset + f.blockSize);
      }
      return bottom;
    },
    lowestBottom() {
      let b = 0;
      for (const f of placed) b = Math.max(b, f.blockOffset + f.blockSize);
      return b;
    },
  };
}
```

(Note: `activeAt`'s return value uses logical edge names. Plan 2's `activeAt` returned `{ leftWidth, rightWidth }`; the new shape is `{ inlineStartSize, inlineEndSize }`. BFC and IFC callers updated in Tasks 6 and 7 must use the new keys — make a follow-up edit if missed.)

- [ ] **Step 2: Search-and-update callers**

Find any remaining BFC or IFC code that reads `.leftWidth` or `.rightWidth` from the float context's return value:

```bash
grep -nE "leftWidth|rightWidth|\.left|\.right" packages/core/src/layout/bfc.ts packages/core/src/layout/ifc.ts
```

Replace with `inlineStartSize` / `inlineEndSize`. This is a small follow-up to Tasks 6 and 7.

- [ ] **Step 3: Update float-context.test.ts**

Replace test fixtures to use the new shape:

```ts
const ctx = createFloatContext();
ctx.placeFloat({
  side: "inline-start",
  inlineOffset: 0, blockOffset: 100,
  inlineSize: 80, blockSize: 60,
});
expect(ctx.activeAt(120)).toEqual({ inlineStartSize: 80, inlineEndSize: 0 });
expect(ctx.clearY("inline-start", 50)).toBe(160); // 100 + 60
```

- [ ] **Step 4: Run float-context tests + dependent BFC/IFC tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- layout
```

Expected: all layout tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/float-context.ts packages/core/src/layout/float-context.test.ts packages/core/src/layout/bfc.ts packages/core/src/layout/ifc.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): FloatContext uses inline-start/inline-end sides"
```

---

## Task 10: Components and factories use logical names

**Files:**
- Modify: `packages/core/src/components/document.ts`
- Modify: `packages/core/src/components/paragraph.ts`
- Modify: `packages/core/src/components/heading.ts`
- Modify: `packages/core/src/components/list.ts`
- Modify: `packages/core/src/components/list-item.ts`
- Modify: `packages/core/src/components/span.ts`
- Modify: `packages/core/src/components/text.ts`
- Modify: `packages/core/src/components/image.ts`
- Modify: `packages/core/src/components/horizontal-line.ts`
- Modify: `packages/core/src/components/table.ts`
- Modify: `packages/core/src/components/table-row.ts`
- Modify: `packages/core/src/components/table-cell.ts`
- Modify: `packages/core/src/components/factories.ts`
- Modify: `packages/core/src/components/components.test.ts`

- [ ] **Step 1: Find all physical-name property assignments in components**

```bash
grep -nE "marginTop|marginBottom|marginLeft|marginRight|paddingTop|paddingBottom|paddingLeft|paddingRight|borderTopWidth|borderBottomWidth|borderLeftWidth|borderRightWidth|borderTopStyle|borderBottomStyle|borderLeftStyle|borderRightStyle|borderTopColor|borderBottomColor|borderLeftColor|borderRightColor|width:|height:|float.*\"left\"|float.*\"right\"|clear.*\"left\"|clear.*\"right\"" packages/core/src/components/
```

- [ ] **Step 2: Apply rename to every component file**

For each component (paragraph.ts, heading.ts, etc.), find each property assignment and rename:

| Old | New |
|---|---|
| `marginTop: { unit: "em", value: 0.5 }` | `marginBlockStart: { unit: "em", value: 0.5 }` |
| `marginBottom: ...` | `marginBlockEnd: ...` |
| `marginLeft: ...` | `marginInlineStart: ...` |
| `marginRight: ...` | `marginInlineEnd: ...` |
| `paddingTop: 10` | `paddingBlockStart: 10` |
| `paddingLeft: 20` | `paddingInlineStart: 20` |
| (etc.) | (etc.) |
| `width: 100` | `inlineSize: 100` |
| `height: 50` | `blockSize: 50` |
| `borderTopWidth: 1` | `borderBlockStartWidth: 1` |
| `float: "left"` | `float: "inline-start"` |

E.g., `paragraph.ts` becomes (illustrative):

```ts
export const paragraphComponent: ComponentDefinition = {
  type: "paragraph",
  render(node, children) {
    return createElementBox(
      node.id,
      "paragraph",
      {
        display: "block",
        marginBlockStart: { unit: "em", value: 0.5 },
        marginBlockEnd: { unit: "em", value: 0.5 },
        ...node.style,
      },
      children,
    );
  },
};
```

Walk every component; apply uniformly.

- [ ] **Step 3: Update factories.ts**

`createList` may set `paddingLeft` for the gutter. Rename to `paddingInlineStart`. Other factories: same pattern.

- [ ] **Step 4: Update components.test.ts**

Test assertions on component output may inspect `style.marginTop` — update to `style.marginBlockStart`. Test fixtures (state nodes' inline styles) that set physical names: rename.

- [ ] **Step 5: Run components tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- components
```

Expected: PASS.

- [ ] **Step 6: Verify the full core build**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core
```

Expected: clean — all of `packages/core` now uses logical names.

- [ ] **Step 7: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/components/ 
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(components): all components and factories use logical-named styles"
```

---

## Task 11: Direction-aware physical mapping for RTL

**Files:**
- Modify: `packages/core/src/layout/layout-box-v2.ts`
- Modify: `packages/core/src/layout/layout-box-v2.test.ts`
- Modify: `packages/core/src/layout/bfc.ts` (factory call sites pass containingInlineSize)
- Modify: `packages/core/src/layout/ifc.ts` (same)
- Modify: `packages/core/src/layout/table-fc.ts` (same)

Task 5 left `deriveIdentityPhysical` as identity. Now it becomes direction-aware. For RTL, the physical `x` is `containingInlineSize - inlineOffset - inlineSize`. The factory must receive `containingInlineSize` to do this.

- [ ] **Step 1: Write the failing test**

Add to `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/layout/layout-box-v2.test.ts`:

```ts
it("RTL horizontal-tb inverts physical x from inline-offset", () => {
  const cs: ComputedStyle = INITIAL_COMPUTED_STYLE;
  // Place a 100px box at inline-offset 30 in a 500px-inline-size container.
  // RTL: physical x = 500 - 30 - 100 = 370
  const b = createBlockBox(
    "k", 30, 0, 100, 50, "horizontal-tb", "rtl", cs, [],
    /* containingInlineSize */ 500,
  );
  expect(b.inlineOffset).toBe(30);
  expect(b.x).toBe(370);
  expect(b.y).toBe(0);
  expect(b.width).toBe(100);
  expect(b.height).toBe(50);
});

it("LTR horizontal-tb is unaffected by containingInlineSize", () => {
  const cs: ComputedStyle = INITIAL_COMPUTED_STYLE;
  const b = createBlockBox(
    "k", 30, 0, 100, 50, "horizontal-tb", "ltr", cs, [],
    /* containingInlineSize */ 500,
  );
  expect(b.x).toBe(30);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- layout/layout-box-v2.test
```

Expected: FAIL — `containingInlineSize` is not yet a parameter on `createBlockBox`.

- [ ] **Step 3: Update factories to accept `containingInlineSize` and use logicalToPhysical**

In `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/layout/layout-box-v2.ts`:

Replace the `deriveIdentityPhysical` helper with the real `logicalToPhysical` import:

```ts
import { logicalToPhysical } from "../styles/writing-mode";
```

Remove `deriveIdentityPhysical`.

Add a `containingInlineSize` parameter to every factory. Each factory becomes:

```ts
export function createBlockBox(
  key: string,
  inlineOffset: number, blockOffset: number, inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
  metadata?: Readonly<Record<string, unknown>>,
  containingInlineSize: number = inlineSize,
): BlockBox {
  const phys = logicalToPhysical(
    { inlineOffset, blockOffset, inlineSize, blockSize },
    writingMode, direction, containingInlineSize,
  );
  return Object.freeze({
    type: "block" as const,
    key,
    inlineOffset, blockOffset, inlineSize, blockSize,
    ...phys,
    writingMode, direction,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
    ...(metadata !== undefined ? { metadata: Object.freeze({ ...metadata }) } : {}),
  });
}
```

Apply the same pattern to `createLineBox`, `createTextRunBox`, `createInlineBox`, `createInlineBlockBox`, `createMarkerBox`, `createTableBox`, `createTableRowBox`, `createTableCellBox`. Each gets a `containingInlineSize` parameter (default to `inlineSize` for the LTR case, which makes the call equivalent to identity even when callers don't pass it).

The default `containingInlineSize = inlineSize` is **only correct for LTR**. For RTL, callers MUST pass the actual containing-block inline-size (the parent's content inline-size). Step 4 updates BFC/IFC/Table FC to pass it.

- [ ] **Step 4: Run the failing test from Step 1**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- layout/layout-box-v2.test
```

Expected: PASS.

- [ ] **Step 5: Update BFC, IFC, Table FC to pass `containingInlineSize`**

For every factory call, the `containingInlineSize` argument is the inline-size of THAT BOX'S CONTAINING BLOCK — i.e., the inline-size of the box's parent content area. For RTL: physical `x = containingInlineSize - inlineOffset - inlineSize`. Pick the right value at each call site.

**BFC (`bfc.ts`):**

For the outer factory call (creating the CURRENT block — this node — its containing block is the parent, whose content inline-size was passed to this function as `availableInlineSize`):

```ts
return createBlockBox(
  node.key,
  inlineOffset, blockOffset, finalInlineSize, totalBlockSize,
  writingMode, direction,
  cs, layoutChildren, node.metadata,
  /* containingInlineSize */ availableInlineSize,
);
```

For inner factory calls within the BFC loop (creating MarkerBoxes and float positions — their containing block is THIS node's content area, whose inline-size is `contentInlineSize`):

```ts
const markerBox = createMarkerBox(
  `${child.key}-marker`,
  markerInlineOffset, childBlockOffset,
  markerInlineSize, markerBlockSize,
  writingMode, direction,
  childCs, markerText,
  /* containingInlineSize */ contentInlineSize,
);
```

For recursing into block children (their containing block is also THIS node's content area):

```ts
const childLayout = childCs.display === "table"
  ? layoutTable(child, paddingInlineStart, childBlockOffset, contentInlineSize, measurer, cs.writingMode, cs.direction)
  : layoutBlock(child, paddingInlineStart, childBlockOffset, contentInlineSize, measurer, cs.writingMode, cs.direction);
```

(Note: pass `cs.writingMode` / `cs.direction` — THIS node's, since this node IS the child's containing block. Not `writingMode`/`direction` from function params, which are the parent's.)

**IFC (`ifc.ts`):**

For each `createLineBox` call (the line's containing block is THIS node — the BFC parent — whose content inline-size was passed in as `availableInlineSize`):

```ts
return createLineBox(
  parent.key + "/line-" + i,
  inlineOffset, lineBlockOffset, lineInlineSize, lineBlockSize,
  writingMode, direction,
  parent.computedStyle,
  lineChildren,
  baseline,
  /* containingInlineSize */ availableInlineSize,
);
```

For factory calls inside a line (TextRunBox, InlineBox, InlineBlockBox — their containing block is the LINE, whose inline-size is `lineInlineSize`):

```ts
return createTextRunBox(
  textRunKey,
  cursorInlineOffset, cursorBlockOffset,
  textInlineSize, textBlockSize,
  writingMode, direction,
  childCs, textValue,
  /* containingInlineSize */ lineInlineSize,
);
```

**Table FC (`table-fc.ts`):**

For the table itself (containing block = parent, with `availableInlineSize`):

```ts
return createTableBox(
  node.key,
  inlineOffset, blockOffset, tableInlineSize, tableBlockSize,
  writingMode, direction,
  cs, rowBoxes, columnPxWidths,
  /* containingInlineSize */ availableInlineSize,
);
```

For table rows (containing block = the table, with `tableInlineSize`):

```ts
createTableRowBox(
  rowKey, 0, rowBlockOffset, tableInlineSize, rowBlockSize,
  writingMode, direction,
  rowCs, cells,
  /* containingInlineSize */ tableInlineSize,
);
```

For table cells (containing block = the row, with `tableInlineSize` since cells span the row):

```ts
createTableCellBox(
  cellKey, cellInlineOffset, 0, columnPxWidths[col], rowBlockSize,
  writingMode, direction,
  cellCs, cellChildren,
  /* containingInlineSize */ tableInlineSize,
);
```

**General rule (memorize):** `containingInlineSize` argument = the inline-size of the box's PARENT'S content area = the value you'd pass as `availableInlineSize` if you recursed `layoutBlock(box, ...)`.

- [ ] **Step 6: Add an integration test for RTL block placement**

Add to `bfc.test.ts`:

```ts
it("RTL paragraph block is placed at right edge", () => {
  const node = createElementBox("doc", "document", { display: "block", direction: "rtl" }, [
    createElementBox("p", "paragraph", { display: "block", inlineSize: 200 }, []),
  ]);
  // Cascade should propagate direction:rtl to the paragraph
  cascadePass(node);
  const out = layoutBlock(node, 0, 0, 800, mockMeasurer, "horizontal-tb", "rtl");
  expect(out.type).toBe("block");
  if (out.type !== "block") throw new Error();
  expect(out.children[0].type).toBe("block");
  if (out.children[0].type !== "block") throw new Error();
  // Paragraph: inline-offset = 0 (start of inline axis); inline-size = 200
  // RTL physical x = 800 - 0 - 200 = 600
  expect(out.children[0].inlineOffset).toBe(0);
  expect(out.children[0].x).toBe(600);
});
```

(Imports needed: `createElementBox` from render, `cascadePass` from cascade, `mockMeasurer` from test helpers.)

- [ ] **Step 7: Run all layout tests**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- layout
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): direction-aware physical mapping; RTL inverts inline-axis"
```

---

## Task 12: Editor consumers and DOM painter

**Files:**
- Modify: `packages/core/src/editor/cursor-position.ts`
- Modify: `packages/core/src/editor/hit-test.ts`
- Modify: `packages/core/src/editor/selection-geometry.ts`
- Modify: `packages/core/src/editor/layout-utils.ts`
- Modify: `packages/core/src/editor/line-navigation.ts`
- Modify: `packages/core/src/layout/dispatch.ts`
- Modify: `packages/core/src/layout/layout-engine.ts`
- Modify: `packages/dom/src/canvas-renderer.ts`
- Modify: `packages/dom/src/canvas-measurer.ts`
- Modify: `examples/react/src/**/*.ts(x)` if any sets physical-named styles

The editor utilities and painter consume LayoutBox positions. They read `box.x`, `box.y`, `box.width`, `box.height` — these still work after Task 11 (LTR identity, RTL inverted). No semantic change needed except where they read style fields directly.

- [ ] **Step 1: Update layout-engine.ts and dispatch.ts**

`layoutTree` and `dispatch` currently call `layoutBlock(root, 0, 0, containerWidth, measurer)`. Update to pass the cascaded `writingMode` and `direction`:

```ts
const rootCs = root.computedStyle ?? INITIAL_COMPUTED_STYLE;
const writingMode = rootCs.writingMode;
const direction = rootCs.direction;
return layoutBlock(root, 0, 0, containerInlineSize, measurer, writingMode, direction);
```

(The parameter `containerWidth` should also be renamed `containerInlineSize` for consistency.)

- [ ] **Step 2: Update editor utilities**

In `cursor-position.ts`, `hit-test.ts`, `selection-geometry.ts`, `layout-utils.ts`, `line-navigation.ts`: search for any direct ComputedStyle reads that use physical names:

```bash
grep -nE "computedStyle\.(marginTop|paddingLeft|width|height|borderTopWidth|float|clear)" packages/core/src/editor/
```

Replace with logical equivalents. The position reads (`.x`, `.y`, `.width`, `.height` on LayoutBox) stay as-is.

- [ ] **Step 3: Update DOM painter**

In `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/dom/src/canvas-renderer.ts`:

```bash
grep -nE "marginTop|paddingLeft|borderTopWidth|borderTopStyle|borderTopColor|borderRightWidth|borderRightStyle|borderRightColor|borderBottomWidth|borderBottomStyle|borderBottomColor|borderLeftWidth|borderLeftStyle|borderLeftColor" packages/dom/src/canvas-renderer.ts
```

Each instance of physical border-side property: rename to logical. The painter then needs to derive **physical sides** for canvas drawing (which is always physical-coord-based). Helper:

```ts
import { logicalToPhysical } from "@taleweaver/core";

function physicalSides(cs: ComputedStyle): {
  topWidth: number; rightWidth: number; bottomWidth: number; leftWidth: number;
  topStyle: BorderStyle; rightStyle: BorderStyle; bottomStyle: BorderStyle; leftStyle: BorderStyle;
  topColor: Color; rightColor: Color; bottomColor: Color; leftColor: Color;
} {
  // Plan 3.A: horizontal-tb only.
  // LTR: blockStart=top, blockEnd=bottom, inlineStart=left, inlineEnd=right.
  // RTL: blockStart=top, blockEnd=bottom, inlineStart=right, inlineEnd=left.
  const isRtl = cs.direction === "rtl";
  return {
    topWidth: cs.borderBlockStartWidth, bottomWidth: cs.borderBlockEndWidth,
    leftWidth: isRtl ? cs.borderInlineEndWidth : cs.borderInlineStartWidth,
    rightWidth: isRtl ? cs.borderInlineStartWidth : cs.borderInlineEndWidth,
    topStyle: cs.borderBlockStartStyle, bottomStyle: cs.borderBlockEndStyle,
    leftStyle: isRtl ? cs.borderInlineEndStyle : cs.borderInlineStartStyle,
    rightStyle: isRtl ? cs.borderInlineStartStyle : cs.borderInlineEndStyle,
    topColor: cs.borderBlockStartColor, bottomColor: cs.borderBlockEndColor,
    leftColor: isRtl ? cs.borderInlineEndColor : cs.borderInlineStartColor,
    rightColor: isRtl ? cs.borderInlineStartColor : cs.borderInlineEndColor,
  };
}
```

Use `physicalSides(box.computedStyle)` wherever the painter currently reads `borderTopWidth`/etc. directly. Padding helpers similarly: `paddingTop = paddingBlockStart`, `paddingLeft` is either `paddingInlineStart` (LTR) or `paddingInlineEnd` (RTL).

- [ ] **Step 4: Update canvas-measurer.ts**

```bash
grep -nE "marginTop|paddingLeft|width|height|borderTopWidth" packages/dom/src/canvas-measurer.ts
```

Apply the same rename (logical names for property reads).

- [ ] **Step 5: Update example app**

```bash
grep -nrE "marginTop|paddingLeft|width:|height:|borderTopWidth|float.*\"left\"|float.*\"right\"" examples/react/src/
```

Replace with logical names. The toolbar's "set bold" or "insert image" actions may construct inline styles — rename those. Check `app.tsx`, `editor-view.tsx`, `toolbar/*.tsx`, `menu-bar.tsx`.

- [ ] **Step 6: Run the entire test suite**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/dom
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/react
```

Expected: all pass.

- [ ] **Step 7: Build all packages**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspaces --if-present
```

Expected: clean.

- [ ] **Step 8: Smoke-test the example app**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run dev --workspace=examples/react &
```

Open the URL printed; verify:
- The default document loads and renders correctly.
- Typing inserts characters; layout updates.
- Toolbar bold/italic still works.

Stop the dev server. (If anything is broken, debug before committing.)

- [ ] **Step 9: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/editor/ packages/core/src/layout/dispatch.ts packages/core/src/layout/layout-engine.ts packages/dom/src/canvas-renderer.ts packages/dom/src/canvas-measurer.ts examples/react/
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(editor+dom+example): editor consumers and painter use logical-named ComputedStyle"
```

---

## Phase exit criteria

After all 12 tasks:

- [ ] `npm run build --workspaces --if-present` is clean.
- [ ] `npm test --workspace=packages/core` is green.
- [ ] `npm test --workspace=packages/dom` is green.
- [ ] `npm test --workspace=packages/react` is green.
- [ ] `npm run dev --workspace=examples/react` boots and renders the default document with no visual regression from before Plan 3.A.
- [ ] No occurrence of the following strings in `packages/core/src/`, `packages/dom/src/`, `examples/react/src/`:

```bash
grep -rE "marginTop|marginBottom|marginLeft|marginRight|paddingTop|paddingBottom|paddingLeft|paddingRight|borderTopWidth|borderBottomWidth|borderLeftWidth|borderRightWidth|borderTopStyle|borderBottomStyle|borderLeftStyle|borderRightStyle|borderTopColor|borderBottomColor|borderLeftColor|borderRightColor|float.*\"left\"|float.*\"right\"|clear.*\"left\"|clear.*\"right\"" packages/core/src/ packages/dom/src/ examples/react/src/
```

(Empty output expected. Helper functions in painter that compute `topWidth`/etc. as derived locals are fine — only Style/ComputedStyle property accesses are the concern.)

- [ ] An RTL document (`direction: "rtl"` on the document state node) renders with paragraph blocks aligned to the right edge of the container. Cluster bidi reordering is not yet implemented (lands in Plan 3.C); for ASCII text the line characters still appear left-to-right, but the paragraph itself is right-aligned.

---

## Coordination notes for subagent-driven execution

- Tasks 1–11 are sequential (each builds on prior). Task 12 can technically split into 12.A (editor) and 12.B (painter + example), but they're small enough to keep together.
- Each task commits independently; if a task's review surfaces issues, fix in a follow-up commit on top, not by amending.
- Tasks 6, 7, 8, 10 are mostly mechanical search-and-replace. The implementer can move fast on these if they keep the rename table from Task 6 handy.
- Task 11 is the one that actually changes RTL behavior end-to-end. Spend extra review attention here.

---

## Self-review

**Spec coverage check:**

| Spec section | Covered by |
|---|---|
| §3.2 Style schema is logical-only | Tasks 2, 3 |
| §3.3 ComputedStyle logical canonical | Tasks 3, 4 |
| §3.4 LayoutBox carries both | Task 5 |
| §3.5 v1 behavior (horizontal-tb LTR identity, RTL inverted) | Tasks 5 (identity), 11 (RTL) |
| §10.A Logical-axis abstraction phase | All 12 tasks |
| Direction-aware float-side resolution (10.A bullet) | Tasks 9 (interface) + 6 (BFC reads it) |
| Painter reads physical | Task 12 (`physicalSides` helper) |

**Type/method consistency check:**

- Factory signatures: all 9 take `(key, inlineOffset, blockOffset, inlineSize, blockSize, writingMode, direction, computedStyle, ...specificFields, containingInlineSize?)`. Verified across Tasks 5 and 11.
- `layoutBlock`, `layoutInlineContent`, `layoutTable` all take `(node, inlineOffset, blockOffset, availableInlineSize, measurer, writingMode, direction)`. Verified across Tasks 6–8.
- `FloatContext.activeAt` returns `{ inlineStartSize, inlineEndSize }`. Verified Task 9.
- `FloatContext.placeFloat`, `clearY` use side `"inline-start" \| "inline-end"`. Verified Task 9.

No placeholder text, no "TBD"/"TODO" — searched the document.

---

## Plan 3.A complete

After landing all tasks, write a short note to the Plan 3 followups (a new `docs/superpowers/plans/2026-04-29-plan-3a-followups.md`) capturing any shortcuts or surprises encountered. Then move on to Plan 3.B (value resolution).

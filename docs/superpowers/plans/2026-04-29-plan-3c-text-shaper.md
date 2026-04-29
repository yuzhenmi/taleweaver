# Plan 3.C — TextShaper Interface Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the narrow `TextMeasurer` (returns string width and font height) with a `TextShaper` that produces positioned glyph clusters, break opportunities, font metrics, and bidi levels per shaped run. Ship a default canvas-based backend in `packages/dom` and a mock backend in `packages/core` for tests. Expand the IFC tokenizer to consume break opportunities and produce per-cluster line layout. Pull bidi reordering into the IFC line-end pass (spec §9.6 forward-pull).

**Architecture:** The current measurer interface assumes one `width` per string and one `height` per font — fine for greedy Latin wrap, but loses information needed for ligatures, complex scripts, bidi, hyphenation, and accurate intrinsic sizing (Plan 3.D). Plan 3.C expands the interface to expose what real engines need: `ShapedRun = { clusters[], breakOpportunities[], bidiLevel, ascent, descent, lineGap, minClusterInlineSize, unbreakableRunInlineSize }` per `(text, computedStyle, baseDirection)` shape call. Backends ship as packages: `@taleweaver/shaper-canvas` (default, bundled in `packages/dom`), `@taleweaver/shaper-mock` (tests, in `packages/core`). The engine consumes the shaper interface; the backend choice is a runtime decision.

**Tech Stack:** TypeScript, Vitest, npm workspaces. Engine: `packages/core`. DOM (canvas painter + canvas shaper): `packages/dom`.

**Spec reference:** [`docs/superpowers/specs/2026-04-29-plan-3-architectural-foundation-rewrite.md`](../specs/2026-04-29-plan-3-architectural-foundation-rewrite.md) §9 (TextShaper interface), §9.6 (bidi pulled forward), §9.7 (hyphenation interface reservation), §10.C (Plan 3.C scope).

**Branch:** `feature/dom-architecture-redesign` (continuing from Plan 3.B).

---

## Worktree discipline

The work happens in a git worktree, not the main checkout. Every task in this plan must:

- Use the worktree path **`/Users/hansyu/code/taleweaver/.worktrees/dom-redesign`** for all file operations and command invocations.
- Pre-flight before any edit: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && pwd && git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign branch --show-current`. Expect `feature/dom-architecture-redesign`. STOP and report BLOCKED if not matching.
- Use absolute paths for every file write. ✅ `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/layout/text-shaper.ts`. ❌ `/Users/hansyu/code/taleweaver/packages/core/src/layout/text-shaper.ts` (the main checkout — do not touch).
- Use `git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign` for every git command.

---

## File structure

| Path | Status | Responsibility |
|---|---|---|
| `packages/core/src/layout/text-shaper.ts` | **create** | `TextShaper` interface, `ShapedRun`, `Cluster`, `BreakOpportunity`, `FontMetrics`, `Direction` (re-exported) types |
| `packages/core/src/layout/text-shaper.test.ts` | **create** | Type-shape sanity checks |
| `packages/core/src/layout/mock-shaper.ts` | **create** | `createMockShaper(charWidth, lineHeight)` — deterministic, replaces `createMockMeasurer` |
| `packages/core/src/layout/mock-shaper.test.ts` | **create** | Tests |
| `packages/core/src/layout/text-measurer.ts` | modify | Becomes a thin wrapper over `TextShaper` for backwards compatibility (callers that just want `measureWidth` keep working) |
| `packages/core/src/layout/ifc.ts` | modify | Consume `breakOpportunities` for tokenization; per-cluster layout; bidi-level reordering at line-end |
| `packages/core/src/layout/text-tokenize.ts` | modify | Tokenizer accepts shaper output; can stay broadly the same shape (whitespace + LINE_BREAK + hyphen tokens) |
| `packages/core/src/layout/bfc.ts` | modify | Marker measurement uses shaper (or measurer wrapper) |
| `packages/core/src/layout/table-fc.ts` | modify | Same as BFC if it does any text measurement (unlikely) |
| `packages/core/src/index.ts` | modify | Re-export `TextShaper`, types, and `createMockShaper` |
| `packages/dom/src/canvas-shaper.ts` | **create** | `createCanvasShaper(canvas)` — uses `canvas.measureText` for cluster widths; simple Unicode UAX-14 break-opportunity detection; LTR-only bidi (level 0) for v1; full HarfBuzz/bidi deferred to a separate package |
| `packages/dom/src/canvas-shaper.test.ts` | **create** | Tests using a JSDOM canvas |
| `packages/dom/src/canvas-measurer.ts` | modify | Wrap canvas shaper; still satisfies `TextMeasurer` interface |
| `packages/dom/src/index.ts` | modify | Export `createCanvasShaper` |
| Many test files | modify | Replace `createMockMeasurer(...)` with `createMockShaper(...)` |

---

## Task list overview

| Task | Subject |
|---|---|
| **1** | Define TextShaper interface and types |
| **2** | Implement `createMockShaper` in core; backwards-compat `TextMeasurer` wrapper |
| **3** | IFC consumes shaper output: tokenizer + cluster-based line layout (no behavioral change for ASCII LTR; new UAX-14 break-opportunity surface) |
| **4** | Bidi reordering at line-end (spec §9.6 forward-pull) |
| **5** | BFC marker measurement uses shaper |
| **6** | Implement `createCanvasShaper` in `packages/dom` |
| **7** | DOM `canvas-measurer.ts` wraps the canvas shaper |
| **8** | Update all test fixtures: `createMockMeasurer` → `createMockShaper` |
| **9** | Hyphenation interface reservation (`BreakOpportunity.kind: "hyphen"`); IFC supports hyphen rendering at break-end (no algorithm yet, spec §9.7) |
| **10** | Smoke test: dev server boots; an Arabic-tagged paragraph (`direction: "rtl"`) renders with cluster-bidi reordering |

---

## Task 1: TextShaper interface and types

**Files:**
- Create: `packages/core/src/layout/text-shaper.ts`
- Create: `packages/core/src/layout/text-shaper.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Pre-flight check** (worktree + branch).

- [ ] **Step 2: Create text-shaper.ts**

```ts
import type { ComputedStyle, Direction } from "../styles";

export type GlyphId = number;

/**
 * A grapheme cluster in a shaped run. May correspond to multiple codepoints
 * (combining marks, ligatures, emoji ZWJ sequences). The cursor lands at
 * cluster boundaries — never inside a cluster.
 */
export interface Cluster {
  /** Source-text offset range (start inclusive, end exclusive). */
  readonly start: number;
  readonly end:   number;
  /** Inline-axis advance through this cluster (px). */
  readonly inlineAdvance: number;
  /** True if this cluster spans multiple codepoints rendered as one glyph. */
  readonly isLigature: boolean;
  /** Opaque glyph IDs — passed through to the painter. */
  readonly glyphs: readonly GlyphId[];
}

/**
 * A break opportunity in a shaped run. The IFC consults these when
 * choosing line-wrap points. UAX-14 line-break-opportunity-spec is the
 * source of truth for canonical implementations.
 */
export interface BreakOpportunity {
  /** Cluster index where the break can occur (break is BEFORE this cluster). */
  readonly clusterIndex: number;
  /**
   * The kind of break:
   *  - "hard": forced break (newline, after period if rules say so)
   *  - "soft": regular UAX-14 wrap point
   *  - "hyphen": hyphenation point — IFC inserts hyphen glyph at line end
   *    (Plan 3.C reserves this kind; canvas backend does not produce them
   *     until a hyphenation backend is wired in)
   */
  readonly kind: "hard" | "soft" | "hyphen";
}

export interface FontMetrics {
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
  /** For vertical-align: text-top */
  readonly capHeight: number;
  /** For vertical-align: middle */
  readonly xHeight: number;
}

/**
 * The shaped output of one (text, style, direction) call. Logical-order
 * clusters; bidi reordering happens at line-end in the IFC.
 */
export interface ShapedRun {
  readonly text: string;
  readonly computedStyle: Readonly<ComputedStyle>;

  readonly clusters: readonly Cluster[];

  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;

  /** Widest single cluster (paragraph min-content input). */
  readonly minClusterInlineSize: number;
  /** Total run inline-size with no breaks (max-content sum input). */
  readonly unbreakableRunInlineSize: number;

  /** UAX-14 break opportunities in the run (sorted by clusterIndex). */
  readonly breakOpportunities: readonly BreakOpportunity[];

  /** 0 = LTR, 1 = RTL, etc. (Unicode Bidi Algorithm). */
  readonly bidiLevel: number;
}

export interface TextShaper {
  shape(
    text: string,
    style: Readonly<ComputedStyle>,
    baseDirection: Direction,
  ): ShapedRun;

  measureFontMetrics(style: Readonly<ComputedStyle>): FontMetrics;
}
```

- [ ] **Step 3: Test (sanity)**

```ts
import { describe, it, expect } from "vitest";
import type { TextShaper, ShapedRun, Cluster } from "./text-shaper";

describe("TextShaper types", () => {
  it("compiles a minimal ShapedRun fixture", () => {
    const cluster: Cluster = {
      start: 0, end: 1, inlineAdvance: 8,
      isLigature: false, glyphs: [42],
    };
    expect(cluster.inlineAdvance).toBe(8);
  });
});
```

- [ ] **Step 4: Re-export from `packages/core/src/index.ts`**

```ts
export type {
  TextShaper, ShapedRun, Cluster, BreakOpportunity, FontMetrics, GlyphId,
} from "./layout/text-shaper";
```

- [ ] **Step 5: Build + test + commit**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core && npm test --workspace=packages/core -- text-shaper
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/text-shaper.ts packages/core/src/layout/text-shaper.test.ts packages/core/src/index.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): add TextShaper interface and supporting types"
```

---

## Task 2: `createMockShaper` and `TextMeasurer` backwards-compat wrapper

**Files:**
- Create: `packages/core/src/layout/mock-shaper.ts`
- Create: `packages/core/src/layout/mock-shaper.test.ts`
- Modify: `packages/core/src/layout/text-measurer.ts`
- Modify: `packages/core/src/index.ts`

The mock shaper produces deterministic output: each character is one cluster with `inlineAdvance = charWidth`; break opportunities at every whitespace; LTR (bidiLevel 0).

- [ ] **Step 1: Implement createMockShaper**

```ts
// mock-shaper.ts
import type { ComputedStyle, Direction } from "../styles";
import type { TextShaper, ShapedRun, Cluster, BreakOpportunity, FontMetrics } from "./text-shaper";

export function createMockShaper(charWidth: number, lineHeight: number): TextShaper {
  const fontMetrics: FontMetrics = {
    ascent: lineHeight * 0.8,
    descent: lineHeight * 0.2,
    lineGap: 0,
    capHeight: lineHeight * 0.7,
    xHeight: lineHeight * 0.5,
  };

  function shape(text: string, style: Readonly<ComputedStyle>, baseDirection: Direction): ShapedRun {
    const clusters: Cluster[] = [];
    const breakOpportunities: BreakOpportunity[] = [];
    let max = 0;
    for (let i = 0; i < text.length; i++) {
      clusters.push({
        start: i, end: i + 1,
        inlineAdvance: charWidth,
        isLigature: false,
        glyphs: [text.charCodeAt(i)],
      });
      if (charWidth > max) max = charWidth;
      // Break opportunity at every whitespace (before whitespace cluster)
      if (i > 0 && /\s/.test(text[i])) {
        breakOpportunities.push({ clusterIndex: i, kind: "soft" });
      }
    }
    // Hard break at LF, CR
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n" || text[i] === "\r") {
        breakOpportunities.push({ clusterIndex: i, kind: "hard" });
      }
    }
    breakOpportunities.sort((a, b) => a.clusterIndex - b.clusterIndex);

    return {
      text,
      computedStyle: style,
      clusters,
      ascent: fontMetrics.ascent,
      descent: fontMetrics.descent,
      lineGap: fontMetrics.lineGap,
      minClusterInlineSize: max,
      unbreakableRunInlineSize: text.length * charWidth,
      breakOpportunities,
      bidiLevel: baseDirection === "rtl" ? 1 : 0,
    };
  }

  function measureFontMetrics(_style: Readonly<ComputedStyle>): FontMetrics {
    return fontMetrics;
  }

  return { shape, measureFontMetrics };
}
```

- [ ] **Step 2: Backwards-compat `TextMeasurer` wrapper**

Replace `text-measurer.ts` contents:

```ts
import type { ComputedStyle } from "../styles";
import type { TextShaper } from "./text-shaper";

/** Narrow legacy interface — width and height only. Layout-internal callers
 * should prefer `TextShaper` directly for correctness. */
export interface TextMeasurer {
  measureWidth(text: string, style: Readonly<ComputedStyle>): number;
  measureHeight(style: Readonly<ComputedStyle>): number;
}

/** Adapt a `TextShaper` to the narrow `TextMeasurer` interface for legacy
 * callers (e.g., simple marker measurement). */
export function adaptShaperToMeasurer(shaper: TextShaper): TextMeasurer {
  return {
    measureWidth(text, style) {
      const run = shaper.shape(text, style, style.direction);
      return run.clusters.reduce((s, c) => s + c.inlineAdvance, 0);
    },
    measureHeight(style) {
      const fm = shaper.measureFontMetrics(style);
      return fm.ascent + fm.descent + fm.lineGap;
    },
  };
}

/** Legacy helper — for tests that just want a fixed-char-width measurer.
 * Internally builds a mock shaper and adapts it. */
export function createMockMeasurer(charWidth: number, lineHeight: number): TextMeasurer {
  // Lazy import to avoid circular deps (mock-shaper imports types only)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createMockShaper } = require("./mock-shaper");
  return adaptShaperToMeasurer(createMockShaper(charWidth, lineHeight));
}
```

(Avoid the `require` if possible — use a static import. The `lazy require` is shown as a fallback if there's a circular-dep issue. Confirm with the actual import graph.)

- [ ] **Step 3: Tests + commit**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- "mock-shaper|text-measurer"
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/mock-shaper.ts packages/core/src/layout/mock-shaper.test.ts packages/core/src/layout/text-measurer.ts packages/core/src/index.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): add createMockShaper and TextMeasurer wrapper for shaper"
```

---

## Task 3: IFC consumes shaper output

**Files:**
- Modify: `packages/core/src/layout/text-tokenize.ts`
- Modify: `packages/core/src/layout/ifc.ts`
- Modify: `packages/core/src/layout/ifc.test.ts`

The IFC currently:
1. Tokenizes inline content into "words" via `text-tokenize.ts` (whitespace-based).
2. Walks tokens, calls `measurer.measureWidth(word, style)` per token.
3. Builds line boxes by accumulating until line-width is exceeded.

After Task 3:
1. The IFC accepts a `TextShaper` (alongside or replacing `TextMeasurer`).
2. For each text run, calls `shaper.shape(text, style, baseDirection)` once.
3. Tokens are derived from `breakOpportunities`: each token is a slice of clusters between consecutive break opportunities.
4. Line layout uses per-cluster `inlineAdvance` instead of per-string width — mostly a no-op for ASCII LTR but correct for ligatures.

- [ ] **Step 1: Add a `shaper` parameter to `layoutInlineContent`**

Either replace `measurer: TextMeasurer` with `shaper: TextShaper`, or pass both (since marker measurement in BFC uses a measurer). Pick the simpler: pass `shaper`, and if a `TextMeasurer` is needed elsewhere, derive it locally with `adaptShaperToMeasurer`.

- [ ] **Step 2: Update text-tokenize.ts**

If the tokenizer currently splits text by whitespace boundaries, refactor to accept `breakOpportunities` (slice clusters between them). Keep the same Token shape (start, end, isWhitespace, isHardBreak) so downstream IFC code doesn't change.

- [ ] **Step 3: Per-cluster line layout in IFC**

Where the IFC currently does `measurer.measureWidth(token.text, cs)` to get the token's inline-size, switch to summing the relevant clusters' `inlineAdvance` from the ShapedRun.

- [ ] **Step 4: Update ifc.test.ts to pass a shaper**

Replace `createMockMeasurer(...)` calls with `createMockShaper(...)`. The mock shaper's per-character output makes assertions on per-cluster behavior easy.

- [ ] **Step 5: Run all layout + integration tests; commit**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): IFC consumes shaper for tokenization and cluster-based line layout"
```

---

## Task 4: Bidi reordering at line-end

**Files:**
- Modify: `packages/core/src/layout/ifc.ts`
- Modify: `packages/core/src/layout/ifc.test.ts`

After IFC builds a line in logical order, reorder clusters per bidi level for visual rendering. For mixed-direction text (Arabic in an LTR paragraph, or vice versa), the line's children get rearranged so the painter draws them left-to-right correctly.

- [ ] **Step 1: Implement reorder pass**

After the line's logical-order clusters are determined and positioned (logical inline-offsets assigned), apply a final pass that:
1. Walks clusters by bidi level.
2. For runs of higher bidi level inside a lower-level container, reverse the cluster order at level boundaries.
3. Updates each cluster's `inlineOffset` to its visual position.

Implementation note: for v1, the canvas-shaper produces uniform bidi-level (0 for LTR-base, 1 for RTL-base; no embedded mixed-direction text yet). Real bidi reordering activates when shapers emit varied levels per cluster. The IFC's reorder pass should be correct for the uniform case AND ready for mixed levels.

- [ ] **Step 2: Add a test for RTL paragraph**

Construct a paragraph with `direction: "rtl"` and assert that the line's first cluster's physical x is at the right edge of the line (cluster bidi reorders + RTL physical mapping from Plan 3.A combine).

- [ ] **Step 3: Run all tests; commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): IFC reorders clusters at line-end per bidi level"
```

---

## Task 5: BFC marker measurement uses shaper

**Files:**
- Modify: `packages/core/src/layout/bfc.ts`

The BFC measures the marker text (`•`, `1.`, etc.) for size. Currently uses `measurer.measureWidth/measureHeight`. After Task 5, derive these from the shaper.

- [ ] **Step 1: Update BFC**

Either: (a) accept a shaper, derive measurer-shaped helpers locally; or (b) keep accepting a measurer (the legacy interface) since marker measurement is simple. Either is fine. Pick (a) for consistency with IFC and to avoid maintaining two interfaces in the engine.

- [ ] **Step 2: Test + commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/bfc.ts packages/core/src/layout/bfc.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): BFC uses shaper for marker measurement"
```

---

## Task 6: `createCanvasShaper` in `packages/dom`

**Files:**
- Create: `packages/dom/src/canvas-shaper.ts`
- Create: `packages/dom/src/canvas-shaper.test.ts`
- Modify: `packages/dom/src/index.ts`

The canvas-based shaper. For each call, sets the canvas font and measures via `ctx.measureText(text)`. Each codepoint is one cluster (no real ligature detection). Break opportunities are computed via a simple Unicode-character-class rule (whitespace + a small list of soft-break-after characters).

For v1 we accept the simplification: canvas backend doesn't do real ligatures or complex scripts. A future `@taleweaver/shaper-harfbuzz` package replaces it for production use.

- [ ] **Step 1: Implement createCanvasShaper**

```ts
import type {
  ComputedStyle, Direction,
  TextShaper, ShapedRun, Cluster, BreakOpportunity, FontMetrics,
} from "@taleweaver/core";

export function createCanvasShaper(canvas: HTMLCanvasElement | OffscreenCanvas): TextShaper {
  const ctx = (canvas as HTMLCanvasElement).getContext("2d")!;
  // ...
  function shape(text, style, baseDirection): ShapedRun { /* ... */ }
  function measureFontMetrics(style): FontMetrics { /* uses ctx.measureText with em/cap-height/x-height heuristics */ }
  return { shape, measureFontMetrics };
}
```

(Detail: cluster boundaries = codepoint boundaries. Cluster `inlineAdvance` = `ctx.measureText(text.slice(start, end)).width`. UAX-14 simplified break opportunities: whitespace + after `-`, `/`, etc. Bidi level is 0 (no real bidi in canvas backend); paragraphs with `direction: "rtl"` get bidiLevel 1 as a uniform whole.)

- [ ] **Step 2: Test (in JSDOM)**

Create tests that use a JSDOM canvas to verify the shaper output shape. (`@taleweaver/dom`'s tests already use JSDOM; follow the existing pattern.)

- [ ] **Step 3: Update dom index.ts; commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/dom/src/canvas-shaper.ts packages/dom/src/canvas-shaper.test.ts packages/dom/src/index.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(dom): canvas-based TextShaper (default backend)"
```

---

## Task 7: DOM `canvas-measurer.ts` wraps the canvas shaper

**Files:**
- Modify: `packages/dom/src/canvas-measurer.ts`
- Modify: `packages/dom/src/canvas-measurer.test.ts`

`createCanvasMeasurer(canvas)` becomes a thin alias for `adaptShaperToMeasurer(createCanvasShaper(canvas))`. Existing consumers (e.g., `editor-controller.ts`) keep working unchanged.

- [ ] **Step 1: Update implementation**

```ts
import { adaptShaperToMeasurer } from "@taleweaver/core";
import { createCanvasShaper } from "./canvas-shaper";

export function createCanvasMeasurer(canvas: HTMLCanvasElement | OffscreenCanvas) {
  return adaptShaperToMeasurer(createCanvasShaper(canvas));
}
```

- [ ] **Step 2: Test + commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/dom/src/canvas-measurer.ts packages/dom/src/canvas-measurer.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(dom): canvas-measurer wraps canvas-shaper"
```

---

## Task 8: Migrate test fixtures to mock shaper

**Files:**
- Modify: every test file using `createMockMeasurer(...)` (the legacy form, now backward-compat)

Find them:
```bash
grep -rl "createMockMeasurer" /Users/hansyu/code/taleweaver/.worktrees/dom-redesign/packages/core/src/
```

For each, replace with `createMockShaper(...)`. The fixture either now passes a shaper directly (for IFC/BFC tests after Task 3+5) OR uses the backwards-compat `adaptShaperToMeasurer` if the test fixture's API needs the narrower interface.

- [ ] **Step 1-N: rename per file**
- [ ] **Step final: run full suite + commit**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core && npm test --workspace=packages/dom && npm test --workspace=packages/react
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add -A
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "test: migrate fixtures from createMockMeasurer to createMockShaper"
```

---

## Task 9: Hyphenation interface reservation

**Files:**
- Modify: `packages/core/src/layout/text-shaper.ts` (already done in Task 1; the `BreakOpportunity.kind` already has `"hyphen"`)
- Modify: `packages/core/src/layout/ifc.ts`

When the IFC chooses to wrap at a `BreakOpportunity.kind === "hyphen"`, it should insert a hyphen glyph (`-`) at the line end. Plan 3.C reserves the value but the canvas backend never produces `"hyphen"` — the hyphen rendering is reserved for when a future shaper backend (e.g., HarfBuzz or a hyphenation-dictionary package) emits them.

- [ ] **Step 1: IFC supports hyphen-glyph rendering at break-end**

When a line break is chosen at a `kind: "hyphen"` opportunity, append a synthetic cluster containing the `-` character to the end of the line, sized via `shaper.shape("-", style, direction)`.

(For v1 with canvas backend, no `kind: "hyphen"` opportunities are produced, so this code path is dormant. It exists for forward-compatibility.)

- [ ] **Step 2: Test (synthetic) + commit**

Construct a test where the mock shaper is configured to emit a `kind: "hyphen"` opportunity mid-text. Assert the IFC inserts a hyphen at line end.

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/ifc.ts packages/core/src/layout/ifc.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): IFC inserts hyphen glyph at break-of-kind-hyphen line end (interface reservation)"
```

---

## Task 10: Smoke test — RTL paragraph with bidi reordering

**Files:**
- Modify: `examples/react/src/...` (or the example state tree) — add a paragraph with `direction: "rtl"` and Hebrew/Arabic-shaped text
- Verify in the dev server

- [ ] **Step 1: Add an RTL paragraph to the example doc**

In the example app's initial document, add a paragraph with `direction: "rtl"` and some text containing Latin + Hebrew characters (`"שלום world"` or similar).

- [ ] **Step 2: Boot dev server**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && timeout 15 npm run dev --workspace=examples/react 2>&1 | head -30
```

Expected: prints local URL within 15s. Visually inspect — the RTL paragraph should be right-aligned, with Hebrew chars in their natural visual order. (Note: the canvas backend doesn't do real bidi, so the v1 result may not be perfect for mixed-direction text. Document any imperfections for the followups doc.)

- [ ] **Step 3: Final commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add examples/react/
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "example: add RTL paragraph for visual smoke test"
```

---

## Phase exit criteria

After all 10 tasks:

- [ ] `npm run build --workspaces --if-present` is clean.
- [ ] All test suites pass (core, dom, react).
- [ ] No occurrence of `TextMeasurer` as a direct interface in IFC/BFC/Table FC source files (excluding the legacy-wrapper module). Engine code uses `TextShaper`.
- [ ] An RTL paragraph in the example app renders right-aligned with cluster-bidi reordering working for the uniform-direction case.
- [ ] Dev server boots without errors.

## Plan 3.A / 3.B followups closed by 3.C

- F3A.6 (cluster bidi reordering) — closed in Task 4.

## Plan 3.A / 3.B followups deferred

- Most of F3A.x and F3B.x remain (they're for later phases).

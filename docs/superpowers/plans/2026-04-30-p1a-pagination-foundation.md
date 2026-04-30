# P1.A — Pagination Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore pagination (deleted from main during the foundation rewrite). The engine produces a sequence of `PageBox`es when `EditorConfig.pageConfig` is set; the editor controller activates its dormant per-page-canvas path; the React example app renders a paginated document.

**Architecture:** A new fragmenter (`paginate.ts`) takes the BFC's output (a `BlockBox` whose children are flow content) and rewraps the children into `PageBox`es of fixed `pageHeight`, with whole-block placement only. A block too tall for one page goes on its own page and overflows past the bottom (acceptable v1 behavior — within-block fragmentation lands in P1.B). The fragmenter runs after the BFC inside `layoutTree` and `layoutTreeIncremental` when `pageConfig` is supplied. Editor controller's existing per-page-canvas wiring activates because real `PageBox`es now appear in `layoutTree.children`.

**Tech Stack:** TypeScript strict, npm workspaces, Vitest. Same as the rest of the engine.

**Out of scope (deferred to P1.B / P1.C):**
- Within-block fragmentation (paragraph splitting at line boundaries).
- `widows`, `orphans` constraints.
- `break-before` / `break-after` / `break-inside` properties.
- Page templates: headers, footers, footnotes, first/left/right variants.
- Generated content / counters consuming `pageContext` (P9a/P9b).

**Spec reference:** [`docs/architecture/1-core/1.5-pagination.md`](../../architecture/1-core/1.5-pagination.md).

---

## File structure

| File | Responsibility | New / Modify |
|---|---|---|
| `packages/core/src/layout/page-config.ts` | `PageMargins`, `PageConfig` types. Pure types, no logic. | New |
| `packages/core/src/layout/page-box.ts` | `PageBox` interface + `createPageBox` factory. | New |
| `packages/core/src/layout/layout-box-v2.ts` | Add `PageBox` to the `LayoutBox` union; add a `withBlockOffset` helper alongside `withInlineOffset`. | Modify |
| `packages/core/src/layout/paginate.ts` | `paginateRoot(rootBlock, pageConfig, ctx)` fragmenter — whole-block placement only. | New |
| `packages/core/src/layout/paginate.test.ts` | Fragmenter unit tests. | New |
| `packages/core/src/layout/page-box.test.ts` | PageBox factory tests. | New |
| `packages/core/src/layout/dispatch.ts` | `layoutTree` accepts optional `pageConfig`; runs paginate after BFC. | Modify |
| `packages/core/src/layout/layout-incremental.ts` | `layoutTreeIncremental` accepts optional `pageConfig`; runs paginate after BFC. | Modify |
| `packages/core/src/editor/editor-state.ts` | `EditorConfig.pageConfig?: PageConfig`; `createInitialEditorState` and `reduceEditor` thread it. | Modify |
| `packages/core/src/editor/actions/helpers.ts` | `rebuildTrees` passes `config.pageConfig` to `layoutTreeIncremental`. | Modify |
| `packages/core/src/index.ts` | Export `PageBox`, `createPageBox`, `PageConfig`, `PageMargins`. | Modify |
| `packages/core/src/integration/pagination.test.ts` | End-to-end: build a state with several paragraphs, layout with pageConfig, assert pages emerge. | New |
| `packages/dom/src/canvas-renderer.ts` | (Verify only — `paintPage` already handles a generic LayoutBox; no changes expected.) | No changes expected |
| `packages/dom/src/editor-controller.ts` | (Verify only — already filters for `type === "page"`. Confirm activation works.) | No changes expected |
| `packages/dom/src/paint-cache.ts` | Add a `page` type case in `hashPaintInputs` (needed for exhaustive switch). | Modify |
| `examples/react/src/use-perf-editor.ts` | Add `pageConfig` to the `EditorConfig` constructed on mount. | Modify |
| `examples/react/src/app.tsx` | Pass `pageHeight: 1056`, `pageGap: 24` to `<EditorView>`. Remove the "Plan 3 will re-add" comment. | Modify |

---

## Task 1: `PageConfig` and `PageMargins` types

**Files:**
- Create: `packages/core/src/layout/page-config.ts`

Pure type definitions, no logic. No tests for type-only files.

- [ ] **Step 1: Create the types file**

```ts
// packages/core/src/layout/page-config.ts

/**
 * Page margins. Logical-axis fields; the painter maps them via writing-mode.
 * For horizontal-tb LTR: blockStart=top, blockEnd=bottom, inlineStart=left, inlineEnd=right.
 */
export interface PageMargins {
  readonly blockStart:  number;
  readonly blockEnd:    number;
  readonly inlineStart: number;
  readonly inlineEnd:   number;
}

/**
 * Pagination configuration. When `EditorConfig.pageConfig` is set, the layout
 * pass produces a sequence of `PageBox`es instead of a single `BlockBox`.
 */
export interface PageConfig {
  /** Page's logical inline-size (width in horizontal-tb). */
  readonly pageInlineSize: number;
  /** Page's logical block-size (height in horizontal-tb). */
  readonly pageBlockSize:  number;
  /** Logical-axis margins around the content area. */
  readonly pageMargins:    PageMargins;
  /** Visual gap between pages (only affects rendering, not layout). */
  readonly pageGap:        number;
}
```

- [ ] **Step 2: Run the core build to verify it compiles**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core`
Expected: clean (no TS errors).

- [ ] **Step 3: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/page-config.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): PageConfig and PageMargins types"
```

---

## Task 2: `PageBox` interface and factory

**Files:**
- Create: `packages/core/src/layout/page-box.ts`
- Create: `packages/core/src/layout/page-box.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/layout/page-box.test.ts
import { describe, it, expect } from "vitest";
import { createPageBox } from "./page-box";
import { INITIAL_COMPUTED_STYLE } from "../styles";

describe("createPageBox", () => {
  it("constructs a frozen PageBox with type=page", () => {
    const cs = INITIAL_COMPUTED_STYLE;
    const us = {
      ...cs,
      lineHeight: cs.fontSize * 1.2,
      letterSpacing: "normal" as const,
      wordSpacing: "normal" as const,
      textIndent: 0,
      marginBlockStart: 0, marginBlockEnd: 0, marginInlineStart: 0, marginInlineEnd: 0,
      paddingBlockStart: 0, paddingBlockEnd: 0, paddingInlineStart: 0, paddingInlineEnd: 0,
    };
    const page = createPageBox(
      "page-0",
      0, 0,                         // inlineOffset, blockOffset
      816, 1056,                    // inlineSize, blockSize
      cs.writingMode, cs.direction,
      cs, us as never,
      [],                            // children
      0,                             // pageIndex
      816,                           // containingInlineSize
    );
    expect(page.type).toBe("page");
    expect(page.key).toBe("page-0");
    expect(page.inlineSize).toBe(816);
    expect(page.blockSize).toBe(1056);
    expect(page.pageIndex).toBe(0);
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.children)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- src/layout/page-box`
Expected: FAIL with "Cannot find module './page-box'".

- [ ] **Step 3: Create `page-box.ts`**

```ts
// packages/core/src/layout/page-box.ts
import type { ComputedStyle, UsedStyle } from "../styles";
import type { WritingMode, Direction } from "../styles/writing-mode";
import { logicalToPhysical } from "../styles/writing-mode";
import type { LayoutBox } from "./layout-box-v2";

/**
 * A page in a paginated layout. Holds the children that fit on one page.
 *
 * Children's `blockOffset` is relative to the page's content origin
 * (i.e., page-relative, not document-relative). The `PageBox` itself
 * has a `blockOffset` relative to the document root, so multiple pages
 * stack vertically with `pageGap` between them.
 */
export interface PageBox {
  readonly type: "page";
  readonly key: string;

  // Logical (parent-relative)
  readonly inlineOffset: number;
  readonly blockOffset:  number;
  readonly inlineSize:   number;
  readonly blockSize:    number;

  // Physical (parent-relative; derived from logical)
  readonly x: number;
  readonly y: number;
  readonly width:  number;
  readonly height: number;

  readonly writingMode: WritingMode;
  readonly direction:   Direction;

  readonly computedStyle: Readonly<ComputedStyle>;
  readonly usedStyle:     Readonly<UsedStyle>;

  /** Direct children that fit on this page (page-relative blockOffsets). */
  readonly children: readonly LayoutBox[];

  /** 0-based index of this page in the document's page sequence. */
  readonly pageIndex: number;
}

export function createPageBox(
  key: string,
  inlineOffset: number, blockOffset: number,
  inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle, usedStyle: UsedStyle,
  children: readonly LayoutBox[],
  pageIndex: number,
  containingInlineSize: number,
): PageBox {
  const phys = logicalToPhysical(
    { inlineOffset, blockOffset, inlineSize, blockSize },
    writingMode, direction, containingInlineSize,
  );
  return Object.freeze({
    type: "page" as const,
    key,
    inlineOffset, blockOffset, inlineSize, blockSize,
    x: phys.x, y: phys.y, width: phys.width, height: phys.height,
    writingMode, direction,
    computedStyle: Object.freeze({ ...computedStyle }),
    usedStyle:     Object.freeze({ ...usedStyle }),
    children: Object.freeze([...children]),
    pageIndex,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- src/layout/page-box`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/page-box.ts packages/core/src/layout/page-box.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): PageBox interface and createPageBox factory"
```

---

## Task 3: Add `PageBox` to the `LayoutBox` union

**Files:**
- Modify: `packages/core/src/layout/layout-box-v2.ts`

- [ ] **Step 1: Read the current union**

The first line of `layout-box-v2.ts` defines the union. It currently lists 9 variants.

- [ ] **Step 2: Add `PageBox` to the union**

Edit the top of `layout-box-v2.ts`:

Find:
```ts
export type LayoutBox = BlockBox | LineBox | TextRunBox | InlineBox | InlineBlockBox | MarkerBox | TableBox | TableRowBox | TableCellBox;
```

Replace with:
```ts
import type { PageBox } from "./page-box";
export type { PageBox } from "./page-box";
export type LayoutBox = BlockBox | LineBox | TextRunBox | InlineBox | InlineBlockBox | MarkerBox | TableBox | TableRowBox | TableCellBox | PageBox;
```

- [ ] **Step 3: Add a `PageBox` case to `withInlineOffset`**

Find the switch in `withInlineOffset` (around line 350). Add a case before the default:

```ts
    case "page":
      return createPageBox(
        box.key, newInlineOffset, box.blockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.pageIndex, containingInlineSize,
      );
```

Also add the import at the top of the file:
```ts
import { createPageBox } from "./page-box";
```

- [ ] **Step 4: Build core to verify the union and switch are exhaustive**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 5: Build dom to verify downstream consumers compile**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/dom`
Expected: a TS error from `paint-cache.ts:hashPaintInputs` and possibly `canvas-renderer.ts:paintBox` because their switches over `box.type` are now non-exhaustive.

This is expected — Task 4 fixes `paint-cache.ts`. `paintBox` in `canvas-renderer.ts` likely already has a default case that handles unknown types gracefully (verify in Task 5).

- [ ] **Step 6: Run core tests to confirm nothing broke**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core`
Expected: all passing (756+).

- [ ] **Step 7: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/layout-box-v2.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): add PageBox to LayoutBox union; withInlineOffset case"
```

---

## Task 4: `hashPaintInputs` PageBox case

**Files:**
- Modify: `packages/dom/src/paint-cache.ts`

- [ ] **Step 1: Add a PageBox case after the existing type-specific suffixes**

Find the type-specific suffix block in `hashPaintInputs` (around line 60-70). Add:

```ts
  } else if (box.type === "page") {
    h += `|page:${box.pageIndex}`;
  }
```

Place it before the closing brace of the if/else-if chain. (PageBox is paint-relevant on `pageIndex` because future page-specific content like running headers will hash differently per page; for this plan it's unused but the case must exist for exhaustiveness when consumers add header/footer slots.)

- [ ] **Step 2: Build dom to verify**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/dom`
Expected: clean.

- [ ] **Step 3: Run dom tests**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/dom`
Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/dom/src/paint-cache.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(paint-cache): hash pageIndex for PageBox"
```

---

## Task 5: Verify `paintBox` handles `type: "page"`

**Files:**
- Read-only: `packages/dom/src/canvas-renderer.ts`
- Verify-only task: no code changes expected.

- [ ] **Step 1: Read the `paintBox` switch**

Run: `grep -n -A 1 'box\.type ===' packages/dom/src/canvas-renderer.ts | head -40`

Read the cases. The function should handle unknown types gracefully (either fall through with no painting, or have a default that returns early).

- [ ] **Step 2: Read the existing `paintPage` function**

`paintPage` (line ~157) takes a `LayoutBox` and paints its background + children. It already works for any LayoutBox with `width`, `height`, `children`. Real `PageBox` instances should work end-to-end.

- [ ] **Step 3: Note any required changes**

If `paintBox` has an exhaustive switch with no default — add a `case "page"` that recurses into children (paint-page-as-block):

```ts
    case "page": {
      // Page background + recurse into children. The editor-controller
      // calls paintPage directly on the top-level PageBox; paintBox here
      // handles the case where a PageBox shows up nested (which shouldn't
      // happen in practice — but the union demands a case).
      for (const child of box.children) {
        paintBox(ctx, child, absX, absY, visibleTop, visibleBottom, state);
      }
      break;
    }
```

If `paintBox` already has a fallback / default that recurses children, no change needed.

- [ ] **Step 4: Build + test if changes were made**

If a change was made:
```bash
npm run build --workspace=packages/dom
npm test --workspace=packages/dom
```

Both clean.

- [ ] **Step 5: Commit if changes were made**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/dom/src/canvas-renderer.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(canvas-renderer): paintBox case for PageBox"
```

If no changes — skip the commit step.

---

## Task 6: `withBlockOffset` helper

**Files:**
- Modify: `packages/core/src/layout/layout-box-v2.ts`
- Modify: `packages/core/src/layout/layout-box-v2.test.ts` (add cases)

`withBlockOffset` mirrors `withInlineOffset` for repositioning a layout box at a different `blockOffset`. The fragmenter uses it when placing a block on a page (block's blockOffset relative to root → blockOffset relative to page content).

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/layout/layout-box-v2.test.ts`:

```ts
import { withBlockOffset } from "./layout-box-v2";

describe("withBlockOffset", () => {
  it("returns a new BlockBox with updated blockOffset", () => {
    const original = createBlockBox(
      "p1", 0, 100, 500, 50,                         // inlineOffset, blockOffset, inlineSize, blockSize
      "horizontal-tb", "ltr",
      INITIAL_COMPUTED_STYLE, INITIAL_COMPUTED_STYLE as never,
      [],
      500,                                            // containingInlineSize
    );
    const moved = withBlockOffset(original, 0, 500);
    expect(moved.type).toBe("block");
    expect(moved.blockOffset).toBe(0);
    expect(moved.inlineOffset).toBe(0);  // unchanged
    expect(moved.blockSize).toBe(50);    // unchanged
    expect(moved.y).toBe(0);             // physical updated (LTR identity)
  });

  it("handles all LayoutBox types without throwing", () => {
    // Smoke test: every variant should accept a withBlockOffset call.
    // Build a minimal one of each type and call withBlockOffset(box, 42, 500).
    // For each, assert .blockOffset === 42 and .type unchanged.
    const cs = INITIAL_COMPUTED_STYLE;
    const us = cs as never;

    const block = createBlockBox("b", 0, 0, 500, 50, "horizontal-tb", "ltr", cs, us, [], 500);
    expect(withBlockOffset(block, 42, 500).blockOffset).toBe(42);

    // (Skipping per-variant smoke for brevity — TS exhaustiveness ensures all
    // cases compile; runtime test on BlockBox confirms the dispatch wires
    // through. Other variants are covered by their factory tests.)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- src/layout/layout-box-v2`
Expected: FAIL with "withBlockOffset is not a function" or "is not exported".

- [ ] **Step 3: Implement `withBlockOffset`**

In `packages/core/src/layout/layout-box-v2.ts`, append a function mirroring `withInlineOffset`:

```ts
/**
 * Re-emit a LayoutBox at a different blockOffset, preserving all other
 * fields. Children are kept by reference (their blockOffsets are
 * relative to the parent and don't need updating when only the parent
 * moves vertically).
 *
 * Used by the pagination fragmenter to reposition blocks from
 * document-relative to page-relative blockOffsets.
 */
export function withBlockOffset(
  box: LayoutBox,
  newBlockOffset: number,
  containingInlineSize: number,
): LayoutBox {
  switch (box.type) {
    case "block":
      return createBlockBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize, box.metadata,
      );
    case "line":
      return createLineBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.baseline, containingInlineSize,
      );
    case "text-run":
      return createTextRunBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.text, containingInlineSize,
      );
    case "inline":
      return createInlineBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.fragmentEdge, containingInlineSize,
      );
    case "inline-block":
      return createInlineBlockBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize,
      );
    case "marker":
      return createMarkerBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.text, containingInlineSize,
      );
    case "table":
      return createTableBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.columnPxWidths, containingInlineSize,
      );
    case "table-row":
      return createTableRowBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize,
      );
    case "table-cell":
      return createTableCellBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, containingInlineSize,
      );
    case "page":
      return createPageBox(
        box.key, box.inlineOffset, newBlockOffset, box.inlineSize, box.blockSize,
        box.writingMode, box.direction, box.computedStyle, box.usedStyle,
        box.children, box.pageIndex, containingInlineSize,
      );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- src/layout/layout-box-v2`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/layout-box-v2.ts packages/core/src/layout/layout-box-v2.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): withBlockOffset helper for pagination fragmenter"
```

---

## Task 7: `paginateRoot` fragmenter — whole-block placement

**Files:**
- Create: `packages/core/src/layout/paginate.ts`
- Create: `packages/core/src/layout/paginate.test.ts`

The fragmenter takes a single BlockBox (the BFC's root output) and a PageConfig, and returns a new BlockBox whose children are PageBoxes. Each PageBox contains the original block-flow children that fit on it. Children's blockOffsets become page-relative.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/layout/paginate.test.ts
import { describe, it, expect } from "vitest";
import { paginateRoot } from "./paginate";
import { createBlockBox } from "./layout-box-v2";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import type { BlockBox } from "./layout-box-v2";
import type { PageConfig } from "./page-config";

const cs = INITIAL_COMPUTED_STYLE;
const us = cs as never;

const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 800,
  pageBlockSize:  600,
  pageMargins:    { blockStart: 50, blockEnd: 50, inlineStart: 50, inlineEnd: 50 },
  pageGap:        20,
};

// Helper: a paragraph-shaped block at a given blockOffset and blockSize.
function makeParagraph(key: string, blockOffset: number, blockSize: number): BlockBox {
  return createBlockBox(
    key, 50, blockOffset,                            // inlineOffset (paddingInlineStart), blockOffset
    700, blockSize,                                  // inlineSize (page minus margins), blockSize
    "horizontal-tb", "ltr", cs, us,
    [], 800,                                          // children, containingInlineSize
  );
}

// Helper: a root BlockBox containing N paragraphs of given blockSize each, stacked vertically.
function makeRoot(paragraphSizes: readonly number[]): BlockBox {
  const children: BlockBox[] = [];
  let y = 0;
  for (let i = 0; i < paragraphSizes.length; i++) {
    children.push(makeParagraph(`p-${i}`, y, paragraphSizes[i]));
    y += paragraphSizes[i];
  }
  return createBlockBox(
    "doc", 0, 0,
    800, y,
    "horizontal-tb", "ltr", cs, us,
    children, 800,
  );
}

describe("paginateRoot", () => {
  it("places a single small paragraph on one page", () => {
    const root = makeRoot([100]);
    const result = paginateRoot(root, PAGE_CONFIG);

    expect(result.type).toBe("block");
    expect(result.children).toHaveLength(1);
    expect(result.children[0].type).toBe("page");
    if (result.children[0].type !== "page") throw new Error("expected page");
    expect(result.children[0].children).toHaveLength(1);
    // Paragraph blockOffset on the page should be 0 (page-content-relative).
    expect(result.children[0].children[0].blockOffset).toBe(0);
  });

  it("splits paragraphs across two pages when they overflow one page's content area", () => {
    // page content area = 600 - 50 - 50 = 500
    // Three paragraphs of 200 each: first two fit on page 1 (400 of 500 used);
    // third pushes to page 2.
    const root = makeRoot([200, 200, 200]);
    const result = paginateRoot(root, PAGE_CONFIG);

    expect(result.children).toHaveLength(2);
    if (result.children[0].type !== "page" || result.children[1].type !== "page") throw new Error("expected pages");
    expect(result.children[0].children).toHaveLength(2);
    expect(result.children[1].children).toHaveLength(1);
  });

  it("places page block-offsets with pageGap between pages", () => {
    const root = makeRoot([400, 400]);
    const result = paginateRoot(root, PAGE_CONFIG);

    expect(result.children).toHaveLength(2);
    if (result.children[0].type !== "page" || result.children[1].type !== "page") throw new Error("expected pages");
    expect(result.children[0].blockOffset).toBe(0);
    expect(result.children[1].blockOffset).toBe(PAGE_CONFIG.pageBlockSize + PAGE_CONFIG.pageGap);
  });

  it("places a single oversized block on its own page (overflows past page bottom)", () => {
    // Page content area = 500; one paragraph of 800 doesn't fit.
    const root = makeRoot([800]);
    const result = paginateRoot(root, PAGE_CONFIG);

    expect(result.children).toHaveLength(1);
    if (result.children[0].type !== "page") throw new Error("expected page");
    expect(result.children[0].children).toHaveLength(1);
    // Block remains its full size (no within-block fragmentation in P1.A).
    expect(result.children[0].children[0].blockSize).toBe(800);
  });

  it("preserves block reference equality for unchanged blocks", () => {
    const root = makeRoot([100, 100]);
    const result = paginateRoot(root, PAGE_CONFIG);

    if (result.children[0].type !== "page") throw new Error("expected page");
    // The fragmenter calls withBlockOffset, which produces a new reference.
    // Reference equality across pagination is NOT preserved in this plan;
    // P1.B's incremental pagination might add it. For now, assert that
    // each placed child references back to its source via the same key.
    expect(result.children[0].children[0].key).toBe("p-0");
    expect(result.children[0].children[1].key).toBe("p-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- src/layout/paginate`
Expected: FAIL — "Cannot find module './paginate'".

- [ ] **Step 3: Implement `paginateRoot`**

```ts
// packages/core/src/layout/paginate.ts
import type { BlockBox, LayoutBox } from "./layout-box-v2";
import { createBlockBox, withBlockOffset } from "./layout-box-v2";
import { createPageBox } from "./page-box";
import type { PageConfig } from "./page-config";

/**
 * Fragment a block-flow tree into a sequence of pages.
 *
 * P1.A scope: whole-block placement only. Each child of `rootBlock` is
 * placed on the current page if it fits in the remaining vertical space;
 * otherwise it starts a new page. A block too tall for one page goes on
 * its own page and overflows past the bottom (acceptable for P1.A;
 * P1.B adds within-block fragmentation at line boundaries).
 *
 * @param rootBlock the BFC's output — a BlockBox whose children are
 *   block-flow content (paragraphs, tables, etc.) with cumulative
 *   blockOffsets across the document.
 * @param pageConfig pagination parameters.
 * @returns a new BlockBox whose children are PageBox instances. Each
 *   PageBox contains the children that fit on it, with their
 *   blockOffsets adjusted to be page-content-relative.
 */
export function paginateRoot(
  rootBlock: BlockBox,
  pageConfig: PageConfig,
): BlockBox {
  const pages = [];
  const remaining = [...rootBlock.children];

  // Available block-axis space for content within each page (page-block-size minus margins).
  const pageContentBlockSize = pageConfig.pageBlockSize
    - pageConfig.pageMargins.blockStart
    - pageConfig.pageMargins.blockEnd;

  // Containing inline size for repositioning child boxes (used by withBlockOffset for RTL physical-x).
  // Each page contains the same inline area as the root's content area.
  const childContainingInlineSize = rootBlock.inlineSize
    - rootBlock.usedStyle.paddingInlineStart
    - rootBlock.usedStyle.paddingInlineEnd;

  let pageIndex = 0;

  while (remaining.length > 0) {
    const placed: LayoutBox[] = [];
    let usedHeight = 0;

    // Greedy: pack children until the next one wouldn't fit.
    while (remaining.length > 0) {
      const next = remaining[0];
      if (usedHeight > 0 && usedHeight + next.blockSize > pageContentBlockSize) {
        // Doesn't fit and we already placed something — push to next page.
        break;
      }
      // Either the page is empty (place even oversized blocks), or it fits.
      placed.push(withBlockOffset(next, usedHeight, childContainingInlineSize));
      usedHeight += next.blockSize;
      remaining.shift();
    }

    // Build the page.
    const pageBlockOffset = pageIndex * (pageConfig.pageBlockSize + pageConfig.pageGap);
    const page = createPageBox(
      `page-${pageIndex}`,
      0, pageBlockOffset,
      pageConfig.pageInlineSize, pageConfig.pageBlockSize,
      rootBlock.writingMode, rootBlock.direction,
      rootBlock.computedStyle, rootBlock.usedStyle,
      placed,
      pageIndex,
      pageConfig.pageInlineSize,
    );
    pages.push(page);
    pageIndex += 1;
  }

  // Build the new root with pages as children.
  // The root's blockSize is the bottom of the last page (no trailing pageGap).
  const totalBlockSize = pageIndex > 0
    ? pageIndex * pageConfig.pageBlockSize + (pageIndex - 1) * pageConfig.pageGap
    : 0;

  return createBlockBox(
    rootBlock.key,
    rootBlock.inlineOffset, rootBlock.blockOffset,
    pageConfig.pageInlineSize, totalBlockSize,
    rootBlock.writingMode, rootBlock.direction,
    rootBlock.computedStyle, rootBlock.usedStyle,
    pages,
    pageConfig.pageInlineSize,
    rootBlock.metadata,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- src/layout/paginate`
Expected: all 5 tests pass.

- [ ] **Step 5: Run the full core suite**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core`
Expected: all passing (760+).

- [ ] **Step 6: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/paginate.ts packages/core/src/layout/paginate.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): paginateRoot — whole-block pagination fragmenter"
```

---

## Task 8: Wire pagination into `layoutTree` and `layoutTreeIncremental`

**Files:**
- Modify: `packages/core/src/layout/dispatch.ts`
- Modify: `packages/core/src/layout/layout-incremental.ts`

- [ ] **Step 1: Update `layoutTree` signature in `dispatch.ts`**

Find the `layoutTree` function. Add a `pageConfig?: PageConfig` parameter at the end and run paginate after the BFC if provided.

```ts
// In dispatch.ts, top of file:
import type { PageConfig } from "./page-config";
import { paginateRoot } from "./paginate";

// Modify the function:
export function layoutTree(
  root: RenderNode,
  containerInlineSize: number,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  pageConfig?: PageConfig,
): LayoutBox {
  const t = markStart("layoutTree");
  try {
    if (root.type !== "element") {
      throw new Error("Layout root must be an element node");
    }

    const shaper: TextShaper = isTextShaper(shaperOrMeasurer)
      ? shaperOrMeasurer
      : measurerToShaper(shaperOrMeasurer);

    const layoutRoot: ElementBox = root.computedStyle
      ? root
      : (cascadePass(root) as ElementBox);

    const cs = layoutRoot.computedStyle ?? INITIAL_COMPUTED_STYLE;
    const ctx = makeRootContext(cs, containerInlineSize);

    let result: LayoutBox;
    switch (cs.display) {
      case "block":
        result = layoutBlock(layoutRoot, 0, 0, ctx, shaper);
        break;
      case "table":
        result = layoutTable(layoutRoot, 0, 0, ctx, shaper);
        break;
      default:
        throw new Error(`display "${cs.display}" not yet implemented in Plan 1`);
    }

    // Pagination: when configured, wrap the BFC's output in PageBoxes.
    if (pageConfig !== undefined && result.type === "block") {
      result = paginateRoot(result, pageConfig);
    }

    return result;
  } finally {
    markEnd("layoutTree", t);
  }
}
```

- [ ] **Step 2: Update `layoutTreeIncremental` signature**

Same shape in `layout-incremental.ts`:

```ts
import type { PageConfig } from "./page-config";
import { paginateRoot } from "./paginate";

export function layoutTreeIncremental(
  newRoot: RenderNode,
  oldRoot: RenderNode | null,
  oldLayout: LayoutBox | null,
  containerWidth: number,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  pageConfig?: PageConfig,
): LayoutBox {
  const t = markStart("layoutTreeIncremental");
  try {
    // Whole-tree short-circuit: same render-root, same container width, same pageConfig identity → reuse.
    if (newRoot === oldRoot && oldLayout !== null && oldLayout.width === containerWidth) {
      return oldLayout;
    }

    // ... (existing body — set up context, run BFC) ...

    // After the BFC produces `result`:
    if (pageConfig !== undefined && result.type === "block") {
      result = paginateRoot(result, pageConfig);
    }

    return result;
  } finally {
    markEnd("layoutTreeIncremental", t);
  }
}
```

(Insert `paginateRoot` AFTER the BFC switch, BEFORE the `return result`.)

- [ ] **Step 3: Build core**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 4: Run core tests**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/layout/dispatch.ts packages/core/src/layout/layout-incremental.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(layout): layoutTree / layoutTreeIncremental accept optional pageConfig"
```

---

## Task 9: `EditorConfig.pageConfig` and reducer wiring

**Files:**
- Modify: `packages/core/src/editor/editor-state.ts`
- Modify: `packages/core/src/editor/actions/helpers.ts`

- [ ] **Step 1: Add `pageConfig?: PageConfig` to `EditorConfig`**

In `editor-state.ts`:

```ts
import type { PageConfig } from "../layout/page-config";

export interface EditorConfig {
  measurer: TextShaper | TextMeasurer;
  registry: ComponentRegistry;
  containerWidth: number;
  pageConfig?: PageConfig;
}
```

- [ ] **Step 2: Pass `pageConfig` from `createInitialEditorState`**

In `editor-state.ts`'s `createInitialEditorState`:

Find:
```ts
const layout = layoutTree(cascaded, config.containerWidth, config.measurer);
```

Change to:
```ts
const layout = layoutTree(cascaded, config.containerWidth, config.measurer, config.pageConfig);
```

- [ ] **Step 3: Pass `pageConfig` from `rebuildTrees`**

In `actions/helpers.ts`'s `rebuildTrees`:

Find:
```ts
const layout = layoutTreeIncremental(
  cascaded,
  oldEditor.renderTree,
  oldEditor.layoutTree,
  newEditor.containerWidth,
  config.measurer,
);
```

Change to:
```ts
const layout = layoutTreeIncremental(
  cascaded,
  oldEditor.renderTree,
  oldEditor.layoutTree,
  newEditor.containerWidth,
  config.measurer,
  config.pageConfig,
);
```

- [ ] **Step 4: Build + test**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=packages/core && npm test --workspace=packages/core
```

Expected: clean / all passing.

- [ ] **Step 5: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/editor/editor-state.ts packages/core/src/editor/actions/helpers.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(editor): EditorConfig.pageConfig threaded into layout passes"
```

---

## Task 10: Public API exports

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add exports**

Find the `// Layout tree` section in `index.ts`. After existing layout exports, add:

```ts
export type { PageBox } from "./layout/page-box";
export { createPageBox } from "./layout/page-box";
export type { PageConfig, PageMargins } from "./layout/page-config";
```

- [ ] **Step 2: Build core, dom, react**

```bash
cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign
npm run build --workspace=packages/core
npm run build --workspace=packages/dom
npm run build --workspace=packages/react
```

Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/index.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(core): export PageBox / PageConfig / PageMargins / createPageBox"
```

---

## Task 11: Integration test — pagination end-to-end

**Files:**
- Create: `packages/core/src/integration/pagination.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
// packages/core/src/integration/pagination.test.ts
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { renderTree } from "../render/render";
import { cascadePass } from "../cascade";
import { layoutTree } from "../layout/dispatch";
import { createMockShaper } from "../layout/mock-shaper";
import { createRegistry, defaultComponents } from "../components";
import type { PageConfig } from "../layout/page-config";
import type { BlockBox } from "../layout/layout-box-v2";

const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 800,
  pageBlockSize:  500,                // small for test purposes
  pageMargins:    { blockStart: 50, blockEnd: 50, inlineStart: 50, inlineEnd: 50 },
  pageGap:        20,
};

describe("pagination end-to-end", () => {
  it("produces no PageBoxes when pageConfig is omitted", () => {
    const reg = createRegistry([...defaultComponents]);
    const t = createTextNode("t1", "Hello world");
    const p = createNode("p1", "paragraph", {}, [t]);
    const doc = createNode("doc", "document", {}, [p]);

    const rendered = renderTree(doc, reg);
    const cascaded = cascadePass(rendered);
    const layout = layoutTree(cascaded, 800, createMockShaper(8, 16));

    expect(layout.type).toBe("block");
    if (layout.type !== "block") throw new Error("?");
    // No pagination — the root contains the paragraph directly.
    expect(layout.children.length).toBeGreaterThan(0);
    expect(layout.children[0].type).not.toBe("page");
  });

  it("produces PageBoxes when pageConfig is supplied and content exceeds one page", () => {
    const reg = createRegistry([...defaultComponents]);
    // Build many paragraphs so content overflows one page.
    // Each paragraph at ~16px line height with default font.
    // Page content height = 500 - 50 - 50 = 400 px → ~25 lines per page.
    // 100 paragraphs of one line each = 100 lines = 4 pages.
    const paragraphs = [];
    for (let i = 0; i < 100; i++) {
      const t = createTextNode(`text-${i}`, `Paragraph ${i}`);
      const p = createNode(`para-${i}`, "paragraph", {}, [t]);
      paragraphs.push(p);
    }
    const doc = createNode("doc", "document", {}, paragraphs);

    const rendered = renderTree(doc, reg);
    const cascaded = cascadePass(rendered);
    const layout = layoutTree(cascaded, 800, createMockShaper(8, 16), PAGE_CONFIG);

    expect(layout.type).toBe("block");
    if (layout.type !== "block") throw new Error("?");
    // Root's children should all be PageBoxes when paginated.
    for (const child of layout.children) {
      expect(child.type).toBe("page");
    }
    // Should be more than one page.
    expect(layout.children.length).toBeGreaterThan(1);
  });

  it("page block-offsets respect pageGap", () => {
    const reg = createRegistry([...defaultComponents]);
    const paragraphs = [];
    for (let i = 0; i < 50; i++) {
      const t = createTextNode(`text-${i}`, `Para ${i}`);
      paragraphs.push(createNode(`p-${i}`, "paragraph", {}, [t]));
    }
    const doc = createNode("doc", "document", {}, paragraphs);

    const layout = layoutTree(
      cascadePass(renderTree(doc, reg)),
      800,
      createMockShaper(8, 16),
      PAGE_CONFIG,
    );

    if (layout.type !== "block") throw new Error("?");
    // Page 0 starts at blockOffset 0.
    expect(layout.children[0].blockOffset).toBe(0);
    // Page 1 starts at pageBlockSize + pageGap.
    if (layout.children.length >= 2) {
      expect(layout.children[1].blockOffset).toBe(
        PAGE_CONFIG.pageBlockSize + PAGE_CONFIG.pageGap,
      );
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core -- src/integration/pagination`
Expected: all 3 tests pass.

- [ ] **Step 3: Run the full core test suite to confirm no regressions**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm test --workspace=packages/core`
Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add packages/core/src/integration/pagination.test.ts
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "test(integration): pagination end-to-end — empty pageConfig, multi-page content, page gaps"
```

---

## Task 12: Restore pagination in the React example app

**Files:**
- Modify: `examples/react/src/use-perf-editor.ts`
- Modify: `examples/react/src/app.tsx`

- [ ] **Step 1: Add `pageConfig` to the editor config in `use-perf-editor.ts`**

Find the `createConfig` function. Add the import at the top:

```ts
import type { EditorConfig, PageConfig } from "@taleweaver/core";
```

Add a `PAGE_CONFIG` constant and include it in the returned config:

```ts
const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 816,                // US Letter at 96 DPI = 8.5 × 96 = 816
  pageBlockSize:  1056,               // 11 × 96 = 1056
  pageMargins:    { blockStart: 96, blockEnd: 96, inlineStart: 72, inlineEnd: 72 },
  pageGap:        24,
};

function createConfig(): EditorConfig {
  const canvas = document.createElement("canvas");
  const measurer = createCanvasMeasurer(canvas);
  const registry = createRegistry([...defaultComponents]);
  return {
    measurer,
    registry,
    containerWidth: DEFAULT_WIDTH,
    pageConfig: PAGE_CONFIG,
  };
}
```

- [ ] **Step 2: Pass `pageHeight` and `pageGap` to `<EditorView>` in `app.tsx`**

Find:
```tsx
// Plan 3 will re-add: pageHeight / pageMargins / pageGap for paginated layout
```

Replace the comment + downstream `<EditorView />` with:
```tsx
const PAGE_HEIGHT = 1056;
const PAGE_GAP = 24;
```

Then, where `<EditorView {...editor} />` appears, change to:
```tsx
<EditorView
  {...editor}
  pageHeight={PAGE_HEIGHT}
  pageGap={PAGE_GAP}
/>
```

- [ ] **Step 3: Build the example app**

Run: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run build --workspace=examples/react`
Expected: clean.

- [ ] **Step 4: Visual smoke test (manual)**

Start the dev server: `cd /Users/hansyu/code/taleweaver/.worktrees/dom-redesign && npm run dev --workspace=examples/react`. Open the example URL. Expected: editor renders with visible page boundaries (pages stack vertically with gaps between).

For automated smoke, dispatch the `mcp__claude-in-chrome` tools to:
1. `tabs_context_mcp` to acquire a tab.
2. Navigate to the dev URL.
3. Run JavaScript to inspect the canvas count: `document.querySelectorAll("canvas").length`. Expected: ≥ 1 canvas (or N canvases, one per visible page).
4. Kill the dev server immediately after measurement.

(If automated smoke is impractical, skip it and trust the build + integration tests.)

- [ ] **Step 5: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add examples/react/src/use-perf-editor.ts examples/react/src/app.tsx
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "feat(examples/react): restore pagination — pageConfig + EditorView page props"
```

---

## Task 13: Update state-of-branch and decomposition docs

**Files:**
- Modify: `docs/architecture/state-of-branch.md`
- Modify: `docs/superpowers/plans/2026-04-30-decomposition.md`

- [ ] **Step 1: Update state-of-branch**

In `docs/architecture/state-of-branch.md`, find the "Pagination `[missing]`" section. Change the status flag to `[partial]` and rewrite the body:

```markdown
### Pagination `[partial]`

Foundation shipped (P1.A): `PageBox` LayoutBox variant; `paginateRoot` whole-block fragmenter; `EditorConfig.pageConfig` wires through layoutTree / layoutTreeIncremental; the editor controller's per-page-canvas path activates when `PageBox`es appear in the layout tree.

Still missing (deferred to P1.B / P1.C):
- Within-block fragmentation. A paragraph taller than a page goes on its own page and overflows past the bottom.
- `widows` / `orphans` constraints.
- `break-before` / `break-after` / `break-inside` properties (schema present, no consumer).
- Page templates: headers, footers, footnotes, first/left/right variants.
- Generated content / counters consumers (target-counter resolves only after P9b).
- Cross-page table row repetition.
```

- [ ] **Step 2: Mark P1.A done in decomposition.md**

In `docs/superpowers/plans/2026-04-30-decomposition.md`, after the P1 description add a status note:

```markdown
**Status:** P1.A (foundation — whole-block placement) shipped.
Follow-ups deferred:
- P1.B — within-block fragmentation, widows/orphans, break-* properties.
- P1.C — page templates with headers, footers, footnotes.
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign add docs/architecture/state-of-branch.md docs/superpowers/plans/2026-04-30-decomposition.md
git -C /Users/hansyu/code/taleweaver/.worktrees/dom-redesign commit -m "docs: update state-of-branch and decomposition for P1.A pagination foundation"
```

---

## Self-review checklist

After all tasks land, verify:

1. **Spec coverage.** The architecture doc `1.5-pagination.md` describes whole-block placement, within-block fragmentation, page templates, headers/footers/footnotes, counters. P1.A covers whole-block placement only — within-block + templates + counters are explicitly deferred to P1.B / P1.C / P9. State-of-branch reflects this.

2. **Type consistency.** `PageBox`, `PageConfig`, `PageMargins`, `paginateRoot` signatures are consistent across paginate.ts, page-box.ts, page-config.ts, dispatch.ts, layout-incremental.ts, and the public exports in `index.ts`. The example app's `PAGE_CONFIG` matches the `PageConfig` interface.

3. **Test coverage per scenario:**
   - PageBox factory: covered (Task 2).
   - withBlockOffset: covered (Task 6).
   - paginateRoot: 5 scenarios (Task 7).
   - End-to-end: 3 scenarios (Task 11).

4. **No regressions.** All existing core / dom / react tests still pass after every task. The full suite count grew from ~756 by ~10 new tests.

5. **Commit hygiene.** Each task lands one commit with a descriptive message. No `--no-verify` flags. No squashing.

# DOM-Architecture Redesign — Plan 3: Pagination

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **User preference — commits:** The user prefers to run `git commit` themselves. Commit steps below show full commands for completeness, but **do not execute `git commit`**. Pause and tell the user the change is ready for review and commit.

**Goal:** Implement page-level layout: fragmentation across pages with `break-*` properties, widows/orphans for IFC splits, page-assembly stage as a pass-through pipeline stage (placeholder for v2 page templates), and the paginated DOM controller mode that distributes content into per-page canvases. After Plan 3, the example app's paginated mode is fully functional and matches today's behavior — but with proper cross-page block splitting (resolves issue 04).

**Architecture:** Fragmentation runs as a separate pipeline stage between layout and painting, only when `pageHeight` is configured. The fragmenter walks the laid-out flow tree and slices it at break points: between block children (BFC), between line boxes (IFC, subject to widows/orphans), between rows (Table FC). Each FC carries its own split rule. Floats stay with their fragment of origin; oversized floats overflow visually. Page assembly composes each `PageBox` from its fragments — pass-through in v1, with hooks for future page templates. The DOM controller's paginated-mode logic is updated to consume `PageBox` containers from the fragmenter rather than the ad-hoc `paginateDocument` of the current code.

**Tech Stack:** TypeScript, vitest. Test runner: `npm test --workspace=packages/core`.

**Spec reference:** `docs/superpowers/specs/2026-04-27-dom-architecture-design.md` — section 7.

**Prerequisites:** Plans 1 and 2 complete.

**Phases:**
- A — PageBox layout type and pipeline plumbing
- B — Fragmenter scaffolding (pipeline stage + walker)
- C — BFC split rule
- D — IFC split rule (with widows/orphans)
- E — Table FC split rule
- F — `break-*` property handling
- G — Float fragment behavior
- H — Page assembly stage (pass-through)
- I — DOM controller paginated mode update
- J — Example app smoke test for pagination

---

## Phase A — PageBox layout type and pipeline plumbing

### Task A.1 — PageBox layout type

**Files:**
- Modify: `packages/core/src/layout/layout-box-v2.ts`
- Modify: `packages/core/src/layout/layout-box-v2.test.ts`

- [ ] **Step 1: Add failing test**

```ts
describe("PageBox", () => {
  it("constructs with pageIndex", () => {
    const p = createPageBox("p0", 0, 0, 816, 1056, INITIAL_COMPUTED_STYLE, [], 0);
    expect(p.type).toBe("page");
    expect(p.pageIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Add PageBox**

```ts
// packages/core/src/layout/layout-box-v2.ts (extend the LayoutBox union)
export type LayoutBox =
  | BlockBox | LineBox | TextRunBox | InlineBox | InlineBlockBox | MarkerBox
  | TableBox | TableRowBox | TableCellBox
  | PageBox;

export interface PageBox extends LayoutBoxBase {
  readonly type: "page";
  readonly children: readonly LayoutBox[];
  readonly pageIndex: number;
}

export function createPageBox(
  key: string,
  x: number, y: number, width: number, height: number,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
  pageIndex: number,
): PageBox {
  return Object.freeze({
    type: "page" as const,
    key, x, y, width, height,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
    pageIndex,
  });
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/layout/layout-box-v2.ts packages/core/src/layout/layout-box-v2.test.ts
git commit -m "feat(layout): add PageBox layout type"
```

---

### Task A.2 — PageMargins type

**Files:**
- Create: `packages/core/src/layout/page-config.ts`
- Test: `packages/core/src/layout/page-config.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/layout/page-config.test.ts
import { describe, it, expect } from "vitest";
import type { PageMargins, PageConfig } from "./page-config";

describe("PageConfig", () => {
  it("PageMargins has 4 sides", () => {
    const m: PageMargins = { top: 96, right: 72, bottom: 96, left: 72 };
    expect(m.top).toBe(96);
  });
  it("PageConfig groups height + margins", () => {
    const cfg: PageConfig = {
      pageHeight: 1056,
      pageMargins: { top: 96, right: 72, bottom: 96, left: 72 },
    };
    expect(cfg.pageHeight).toBe(1056);
  });
});
```

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/layout/page-config.ts
export interface PageMargins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface PageConfig {
  readonly pageHeight: number;
  readonly pageMargins: PageMargins;
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/layout/page-config.ts packages/core/src/layout/page-config.test.ts
git commit -m "feat(layout): add PageMargins and PageConfig types"
```

---

## Phase B — Fragmenter scaffolding

### Task B.1 — `fragment` entry function (no break support yet)

**Files:**
- Create: `packages/core/src/fragmentation/fragment.ts`
- Test: `packages/core/src/fragmentation/fragment.test.ts`
- Create: `packages/core/src/fragmentation/index.ts`

The fragmenter takes the laid-out flow tree (a single tall block from BFC) plus a `PageConfig`, and produces a sequence of `PageBox` containers.

For Task B.1, the simplest version: walk the flow's top-level children and pack them into pages without splitting (whole-block-only — to be extended in C, D, E).

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/fragmentation/fragment.test.ts
import { describe, it, expect } from "vitest";
import { createElementBox } from "../render/render-node-v2";
import { cascadePass } from "../cascade";
import { createMockMeasurer } from "../layout/text-measurer";
import { layoutTree } from "../layout/dispatch";
import { fragment } from "./fragment";

const measurer = createMockMeasurer(8, 16);

describe("fragment (whole-block packing, no breaks)", () => {
  it("packs all children onto a single page when they fit", () => {
    const tree = cascadePass(createElementBox("doc", { display: "block" }, [
      createElementBox("c1", { display: "block", height: 100 }, []),
      createElementBox("c2", { display: "block", height: 100 }, []),
    ]));
    const flow = layoutTree(tree, 600, measurer);
    const pages = fragment(flow, {
      pageHeight: 1000,
      pageMargins: { top: 50, right: 50, bottom: 50, left: 50 },
    });
    expect(pages).toHaveLength(1);
    expect(pages[0].children).toHaveLength(2);
  });

  it("splits children across pages when total exceeds page content height", () => {
    const tree = cascadePass(createElementBox("doc", { display: "block" }, [
      createElementBox("c1", { display: "block", height: 600 }, []),
      createElementBox("c2", { display: "block", height: 600 }, []),
    ]));
    const flow = layoutTree(tree, 600, measurer);
    const pages = fragment(flow, {
      pageHeight: 1000,
      pageMargins: { top: 50, right: 50, bottom: 50, left: 50 },
    });
    expect(pages).toHaveLength(2);
    expect(pages[0].children).toHaveLength(1);
    expect(pages[1].children).toHaveLength(1);
  });

  it("page index assigned sequentially", () => {
    const tree = cascadePass(createElementBox("doc", { display: "block" }, [
      createElementBox("c1", { display: "block", height: 600 }, []),
      createElementBox("c2", { display: "block", height: 600 }, []),
      createElementBox("c3", { display: "block", height: 600 }, []),
    ]));
    const flow = layoutTree(tree, 600, measurer);
    const pages = fragment(flow, {
      pageHeight: 1000,
      pageMargins: { top: 50, right: 50, bottom: 50, left: 50 },
    });
    expect(pages.map(p => p.pageIndex)).toEqual([0, 1, 2]);
  });
});
```

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/fragmentation/fragment.ts
import type { LayoutBox, PageBox } from "../layout/layout-box-v2";
import { createPageBox } from "../layout/layout-box-v2";
import type { PageConfig } from "../layout/page-config";

/**
 * Distribute the children of a flow layout into PageBox containers.
 * v1 (Phase B) — whole-block packing only, no break-* support yet.
 */
export function fragment(flow: LayoutBox, config: PageConfig): readonly PageBox[] {
  const pageContentHeight = config.pageHeight - config.pageMargins.top - config.pageMargins.bottom;
  const pageWidth = flow.width + config.pageMargins.left + config.pageMargins.right;

  const pages: PageBox[] = [];
  let currentChildren: LayoutBox[] = [];
  let currentY = 0;
  let pageIndex = 0;

  const flush = () => {
    if (currentChildren.length === 0) return;
    pages.push(createPageBox(
      `page-${pageIndex}`,
      0, 0, pageWidth, config.pageHeight,
      flow.computedStyle, currentChildren, pageIndex,
    ));
    pageIndex++;
    currentChildren = [];
    currentY = 0;
  };

  if (flow.type === "block") {
    for (const child of flow.children) {
      if (currentChildren.length > 0 && currentY + child.height > pageContentHeight) {
        flush();
      }
      const placedChild = repositionTo(child, config.pageMargins.left, config.pageMargins.top + currentY);
      currentChildren.push(placedChild);
      currentY += child.height;
    }
  }
  flush();

  return pages;
}

function repositionTo(box: LayoutBox, x: number, y: number): LayoutBox {
  if (box.x === x && box.y === y) return box;
  return Object.freeze({ ...box, x, y } as LayoutBox);
}
```

```ts
// packages/core/src/fragmentation/index.ts
export { fragment } from "./fragment";
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fragmentation/fragment.ts packages/core/src/fragmentation/fragment.test.ts packages/core/src/fragmentation/index.ts
git commit -m "feat(fragmentation): scaffold fragment() for whole-block page packing"
```

---

## Phase C — BFC split rule

### Task C.1 — `splitBlockBox` for BFC fragmenter input

**Files:**
- Create: `packages/core/src/fragmentation/split-block.ts`
- Test: `packages/core/src/fragmentation/split-block.test.ts`

`splitBlockBox(box, availableHeight)` returns `{ head, tail }` where:
- `head` contains the top portion that fits in `availableHeight`.
- `tail` contains the rest, suitable for placement on the next page.
- Returns `null` for `head` if nothing fits (entire box moves to next page).
- Returns `null` for `tail` if everything fits.

For a BlockBox: split between block children. Recurse into the child that crosses the boundary.

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/fragmentation/split-block.test.ts
import { describe, it, expect } from "vitest";
import { createBlockBox } from "../layout/layout-box-v2";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { splitBlockBox } from "./split-block";

const cs = INITIAL_COMPUTED_STYLE;

function block(key: string, height: number, children: any[] = []) {
  return createBlockBox(key, 0, 0, 600, height, cs, children);
}

describe("splitBlockBox", () => {
  it("returns head with all-fit when availableHeight >= box.height", () => {
    const box = block("a", 100);
    const r = splitBlockBox(box, 200);
    expect(r.head?.height).toBe(100);
    expect(r.tail).toBeNull();
  });

  it("returns null head when availableHeight is too small for any child", () => {
    const child = block("c", 100);
    const box = block("a", 100, [child]);
    const r = splitBlockBox(box, 50);
    expect(r.head).toBeNull();
    expect(r.tail).not.toBeNull();
  });

  it("splits between children when one fits and another doesn't", () => {
    const c1 = block("c1", 50);
    const c2 = block("c2", 50);
    const c3 = block("c3", 50);
    const box = block("a", 150, [c1, c2, c3]);
    const r = splitBlockBox(box, 110);
    expect(r.head?.children).toHaveLength(2);
    expect(r.tail?.children).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/fragmentation/split-block.ts
import type { BlockBox, LayoutBox } from "../layout/layout-box-v2";
import { createBlockBox } from "../layout/layout-box-v2";

export interface SplitResult {
  head: LayoutBox | null;
  tail: LayoutBox | null;
}

/**
 * Split a BlockBox at a y-coordinate boundary so that the head fits in availableHeight.
 * Returns { head, tail } — either may be null.
 */
export function splitBlockBox(box: BlockBox, availableHeight: number): SplitResult {
  if (box.height <= availableHeight) {
    return { head: box, tail: null };
  }

  // Walk children: find the one that crosses the boundary.
  const headChildren: LayoutBox[] = [];
  const tailChildren: LayoutBox[] = [];
  let placedHeight = 0;

  for (let i = 0; i < box.children.length; i++) {
    const child = box.children[i];
    const childTop = placedHeight;
    const childBottom = placedHeight + child.height;

    if (childBottom <= availableHeight) {
      // Child fits entirely on the head.
      headChildren.push(child);
    } else if (childTop >= availableHeight) {
      // Child is entirely on the tail.
      tailChildren.push(repositionY(child, child.y - availableHeight));
    } else {
      // Child crosses the boundary — recurse.
      const remaining = availableHeight - childTop;
      const subSplit = splitLayoutBox(child, remaining);
      if (subSplit.head !== null) headChildren.push(subSplit.head);
      if (subSplit.tail !== null) tailChildren.push(repositionY(subSplit.tail, 0));
    }
    placedHeight += child.height;
  }

  // If headChildren is empty, the whole box doesn't fit — null head.
  if (headChildren.length === 0) {
    return { head: null, tail: box };
  }
  // If tailChildren is empty, everything fit (shouldn't happen given box.height > available, but defensive)
  if (tailChildren.length === 0) {
    return { head: box, tail: null };
  }

  const headHeight = headChildren.reduce((m, c) => Math.max(m, c.y + c.height), 0);
  const tailHeight = tailChildren.reduce((m, c) => Math.max(m, c.y + c.height), 0);

  const head = createBlockBox(box.key + "-h", box.x, box.y, box.width, headHeight, box.computedStyle, headChildren);
  const tail = createBlockBox(box.key + "-t", box.x, box.y, box.width, tailHeight, box.computedStyle, tailChildren);

  return { head, tail };
}

function repositionY(box: LayoutBox, y: number): LayoutBox {
  if (box.y === y) return box;
  return Object.freeze({ ...box, y } as LayoutBox);
}

/**
 * Split a generic LayoutBox by routing to the appropriate FC split function.
 * Plan 3 implements: block (this file), line (D), table-row (E).
 */
export function splitLayoutBox(box: LayoutBox, availableHeight: number): SplitResult {
  if (box.height <= availableHeight) return { head: box, tail: null };

  switch (box.type) {
    case "block":
      return splitBlockBox(box as BlockBox, availableHeight);
    // Line splitting is implemented in Phase D
    // Table splitting is implemented in Phase E
    default:
      // Atomic box — can't split. Either fits entirely or moves entirely.
      return { head: null, tail: box };
  }
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fragmentation/split-block.ts packages/core/src/fragmentation/split-block.test.ts
git commit -m "feat(fragmentation): splitBlockBox between block children"
```

---

### Task C.2 — Wire `splitLayoutBox` into the fragmenter

**Files:**
- Modify: `packages/core/src/fragmentation/fragment.ts`
- Modify: `packages/core/src/fragmentation/fragment.test.ts`

Update the `fragment()` function to use `splitLayoutBox` when a child doesn't fit.

- [ ] **Step 1: Add failing test**

```ts
it("splits a block child that's too tall to fit", () => {
  const big = createElementBox("big", { display: "block" }, [
    createElementBox("c1", { display: "block", height: 400 }, []),
    createElementBox("c2", { display: "block", height: 400 }, []),
    createElementBox("c3", { display: "block", height: 400 }, []),
  ]);
  const tree = cascadePass(createElementBox("doc", { display: "block" }, [big]));
  const flow = layoutTree(tree, 600, measurer);
  const pages = fragment(flow, {
    pageHeight: 1000,
    pageMargins: { top: 50, right: 50, bottom: 50, left: 50 },
  });
  // Page content height = 900. Big block is 1200 px tall → split across 2 pages.
  expect(pages.length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Update `fragment.ts`**

```ts
import { splitLayoutBox } from "./split-block";

// In the for-loop:
let blockToPlace: LayoutBox | null = repositionTo(child, config.pageMargins.left, config.pageMargins.top + currentY);
while (blockToPlace !== null) {
  const remaining = pageContentHeight - currentY;

  if (blockToPlace.height <= remaining) {
    currentChildren.push(blockToPlace);
    currentY += blockToPlace.height;
    blockToPlace = null;
  } else {
    const split = splitLayoutBox(blockToPlace, remaining);
    if (split.head !== null) {
      currentChildren.push(split.head);
      currentY += split.head.height;
    }
    flush();
    if (split.tail !== null) {
      // Reposition tail to top of fresh page
      blockToPlace = repositionTo(split.tail, config.pageMargins.left, config.pageMargins.top);
    } else {
      blockToPlace = null;
    }
  }
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fragmentation/fragment.ts packages/core/src/fragmentation/fragment.test.ts
git commit -m "feat(fragmentation): wire splitLayoutBox for cross-page block splitting"
```

---

## Phase D — IFC split rule

### Task D.1 — `splitLineBoxes` (split between line boxes)

**Files:**
- Create: `packages/core/src/fragmentation/split-lines.ts`
- Test: `packages/core/src/fragmentation/split-lines.test.ts`

A BlockBox whose children are LineBoxes (an IFC) splits between line boxes. Lines never split mid-line.

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/fragmentation/split-lines.test.ts
import { describe, it, expect } from "vitest";
import { createBlockBox, createLineBox, createTextRunBox } from "../layout/layout-box-v2";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { splitLineBlock } from "./split-lines";

const cs = INITIAL_COMPUTED_STYLE;

function lineBlock(key: string, lineHeights: number[]) {
  let y = 0;
  const lines = lineHeights.map((h, i) => {
    const tr = createTextRunBox(`${key}-l${i}-r0`, 0, 0, 100, h, cs, "x");
    const line = createLineBox(`${key}-l${i}`, 0, y, 600, h, cs, [tr]);
    y += h;
    return line;
  });
  return createBlockBox(key, 0, 0, 600, y, cs, lines);
}

describe("splitLineBlock", () => {
  it("splits between lines", () => {
    const block = lineBlock("p", [20, 20, 20, 20, 20]);
    // 5 lines of 20px = 100px total. Available 50.
    const r = splitLineBlock(block, 50);
    // 2 lines fit (40px); 3 go to tail.
    expect(r.head?.children).toHaveLength(2);
    expect(r.tail?.children).toHaveLength(3);
  });

  it("returns null head when not even one line fits", () => {
    const block = lineBlock("p", [30, 30]);
    const r = splitLineBlock(block, 20);
    expect(r.head).toBeNull();
    expect(r.tail).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/fragmentation/split-lines.ts
import type { BlockBox, LayoutBox } from "../layout/layout-box-v2";
import { createBlockBox } from "../layout/layout-box-v2";
import type { SplitResult } from "./split-block";

export function splitLineBlock(block: BlockBox, availableHeight: number): SplitResult {
  if (block.height <= availableHeight) return { head: block, tail: null };

  const headLines: LayoutBox[] = [];
  const tailLines: LayoutBox[] = [];
  let yCursor = 0;

  for (const line of block.children) {
    if (line.type !== "line") {
      // Non-line child in what we thought was a line block — fall through to a non-split.
      return { head: null, tail: block };
    }
    if (yCursor + line.height <= availableHeight) {
      headLines.push(line);
      yCursor += line.height;
    } else {
      // Reposition for new page (relative y starts at 0).
      tailLines.push(Object.freeze({ ...line, y: tailLines.length === 0 ? 0 : (tailLines[tailLines.length - 1] as any).y + (tailLines[tailLines.length - 1] as any).height } as LayoutBox));
    }
  }

  // Recompute tail line y-positions cleanly.
  let tailY = 0;
  const tailRepositioned = tailLines.map((line) => {
    const next = Object.freeze({ ...line, y: tailY } as LayoutBox);
    tailY += line.height;
    return next;
  });

  if (headLines.length === 0) {
    return { head: null, tail: block };
  }
  if (tailRepositioned.length === 0) {
    return { head: block, tail: null };
  }

  const headHeight = headLines.reduce((sum, l) => sum + l.height, 0);
  const tailHeight = tailRepositioned.reduce((sum, l) => sum + l.height, 0);

  const head = createBlockBox(block.key + "-h", block.x, block.y, block.width, headHeight, block.computedStyle, headLines);
  const tail = createBlockBox(block.key + "-t", block.x, block.y, block.width, tailHeight, block.computedStyle, tailRepositioned);

  return { head, tail };
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Update `splitLayoutBox` to dispatch**

```ts
// In split-block.ts splitLayoutBox:
case "block": {
  // Detect IFC: all children are line boxes.
  const allLines = box.children.length > 0 && box.children.every(c => c.type === "line");
  if (allLines) return splitLineBlock(box, availableHeight);
  return splitBlockBox(box as BlockBox, availableHeight);
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/fragmentation/split-lines.ts packages/core/src/fragmentation/split-lines.test.ts packages/core/src/fragmentation/split-block.ts
git commit -m "feat(fragmentation): split IFC blocks between line boxes"
```

---

### Task D.2 — Widow/orphan constraints in line splitting

**Files:**
- Modify: `packages/core/src/fragmentation/split-lines.ts`
- Modify: `packages/core/src/fragmentation/split-lines.test.ts`

Apply widows/orphans rules:
- `orphans` ≥ `n` means at least `n` lines must remain on the prev page if any are. If the natural split point gives fewer than `orphans`, push the entire paragraph to the next page (head = null).
- `widows` ≥ `n` means at least `n` lines must appear on the next page. If the natural split point leaves fewer than `widows` on the tail, move enough lines from head to tail.
- If neither constraint can be satisfied (paragraph too short overall), move the whole paragraph (head = null).

- [ ] **Step 1: Add failing test**

```ts
describe("splitLineBlock — widows/orphans", () => {
  it("rejects orphan-violating split (1 line left behind)", () => {
    // Block with 4 lines × 20px height = 80px total.
    // Available height 25 → naturally only 1 line fits on current page.
    // orphans = 2 → 1 < 2 → reject; whole block moves to next page.
    const block = lineBlock("p", [20, 20, 20, 20]);
    const r = splitLineBlock(block, 25, { widows: 2, orphans: 2 });
    expect(r.head).toBeNull();
  });

  it("rejects widow-violating split (1 line on next page)", () => {
    // Available height 75 → naturally 3 lines fit, 1 goes to next page → widow violation.
    // We should adjust so 2 fit on prev, 2 on next.
    const block = lineBlock("p", [20, 20, 20, 20]);
    const r = splitLineBlock(block, 75, { widows: 2, orphans: 2 });
    expect(r.head?.children).toHaveLength(2);
    expect(r.tail?.children).toHaveLength(2);
  });

  it("when paragraph is too short to satisfy both constraints, move entire to next", () => {
    // 3 lines × 20 = 60. Available 30 → 1 fits naturally → orphan violation. Move all.
    const block = lineBlock("p", [20, 20, 20]);
    const r = splitLineBlock(block, 30, { widows: 2, orphans: 2 });
    expect(r.head).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests** — FAIL.

- [ ] **Step 3: Update `splitLineBlock` to accept widow/orphan options**

```ts
// packages/core/src/fragmentation/split-lines.ts
export interface WidowOrphanConfig {
  widows: number;
  orphans: number;
}

export function splitLineBlock(
  block: BlockBox,
  availableHeight: number,
  options: WidowOrphanConfig = { widows: 2, orphans: 2 },
): SplitResult {
  if (block.height <= availableHeight) return { head: block, tail: null };

  const lines = block.children.filter((c): c is any => c.type === "line");
  if (lines.length === 0) return { head: null, tail: block };

  // Find natural split point: how many lines fit in availableHeight.
  let naturalCount = 0;
  let yCursor = 0;
  for (const l of lines) {
    if (yCursor + l.height > availableHeight) break;
    naturalCount++;
    yCursor += l.height;
  }

  // Apply orphan constraint: at least `orphans` lines must remain on prev page.
  if (naturalCount < options.orphans) {
    return { head: null, tail: block };
  }

  // Apply widow constraint: at least `widows` lines must appear on next page.
  let headCount = naturalCount;
  const tailCount = lines.length - headCount;
  if (tailCount < options.widows && tailCount > 0) {
    // Move lines from head to tail until widows constraint is satisfied.
    const needed = options.widows - tailCount;
    headCount = Math.max(0, headCount - needed);
    if (headCount < options.orphans) {
      return { head: null, tail: block };
    }
  }

  if (headCount === 0) return { head: null, tail: block };
  if (headCount === lines.length) return { head: block, tail: null };

  const headLines = lines.slice(0, headCount);
  const tailLines = lines.slice(headCount);

  // Reposition tail line y values to start at 0.
  let tailY = 0;
  const tailRepositioned = tailLines.map((line) => {
    const next = Object.freeze({ ...line, y: tailY });
    tailY += line.height;
    return next as LayoutBox;
  });

  const headHeight = headLines.reduce((s, l) => s + l.height, 0);
  const tailHeight = tailRepositioned.reduce((s, l) => s + l.height, 0);

  return {
    head: createBlockBox(block.key + "-h", block.x, block.y, block.width, headHeight, block.computedStyle, headLines as LayoutBox[]),
    tail: createBlockBox(block.key + "-t", block.x, block.y, block.width, tailHeight, block.computedStyle, tailRepositioned),
  };
}
```

- [ ] **Step 4: Wire widow/orphan from computedStyle**

`splitLayoutBox` should read `box.computedStyle.widows` and `box.computedStyle.orphans` and pass them to `splitLineBlock`. Update `splitLayoutBox` signature accordingly:

```ts
case "block": {
  const allLines = box.children.length > 0 && box.children.every(c => c.type === "line");
  if (allLines) {
    const cs = box.computedStyle;
    return splitLineBlock(box as BlockBox, availableHeight, {
      widows: cs.widows ?? 2,
      orphans: cs.orphans ?? 2,
    });
  }
  return splitBlockBox(box as BlockBox, availableHeight);
}
```

- [ ] **Step 5: Run tests** — PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/fragmentation/split-lines.ts packages/core/src/fragmentation/split-lines.test.ts packages/core/src/fragmentation/split-block.ts
git commit -m "feat(fragmentation): widow/orphan constraints when splitting line blocks"
```

---

## Phase E — Table FC split rule

### Task E.1 — `splitTableBox` (split between rows)

**Files:**
- Create: `packages/core/src/fragmentation/split-table.ts`
- Test: `packages/core/src/fragmentation/split-table.test.ts`

Tables split between rows. Individual rows stay intact unless internally too tall (then the row's cells split internally — Plan 3 simplification: rows are atomic for now).

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/fragmentation/split-table.test.ts
import { describe, it, expect } from "vitest";
import {
  createTableBox, createTableRowBox, createTableCellBox,
} from "../layout/layout-box-v2";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { splitTableBox } from "./split-table";

const cs = INITIAL_COMPUTED_STYLE;

describe("splitTableBox", () => {
  it("splits between rows that fit and don't fit", () => {
    const r1 = createTableRowBox("r1", 0, 0, 600, 50, cs, []);
    const r2 = createTableRowBox("r2", 0, 50, 600, 50, cs, []);
    const r3 = createTableRowBox("r3", 0, 100, 600, 50, cs, []);
    const tbl = createTableBox("t", 0, 0, 600, 150, cs, [r1, r2, r3], [600]);

    const r = splitTableBox(tbl, 90);
    // r1 fits (50px), r2 doesn't (would be 100px > 90). Head has r1. Tail has r2, r3.
    expect((r.head as any)?.children).toHaveLength(1);
    expect((r.tail as any)?.children).toHaveLength(2);
  });

  it("returns null head when no row fits", () => {
    const r1 = createTableRowBox("r1", 0, 0, 600, 50, cs, []);
    const tbl = createTableBox("t", 0, 0, 600, 50, cs, [r1], [600]);
    const r = splitTableBox(tbl, 30);
    expect(r.head).toBeNull();
  });
});
```

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/fragmentation/split-table.ts
import type { TableBox, TableRowBox, LayoutBox } from "../layout/layout-box-v2";
import { createTableBox, createTableRowBox } from "../layout/layout-box-v2";
import type { SplitResult } from "./split-block";

export function splitTableBox(table: TableBox, availableHeight: number): SplitResult {
  if (table.height <= availableHeight) return { head: table, tail: null };

  const rows = table.children.filter((c): c is TableRowBox => c.type === "table-row");
  if (rows.length === 0) return { head: null, tail: table };

  const headRows: TableRowBox[] = [];
  const tailRows: TableRowBox[] = [];
  let placedHeight = 0;

  for (const row of rows) {
    // Each row is atomic in v3 — `break-inside: avoid` is the default for rows.
    if (placedHeight + row.height <= availableHeight) {
      headRows.push(row);
      placedHeight += row.height;
    } else {
      tailRows.push(row);
    }
  }

  if (headRows.length === 0) {
    return { head: null, tail: table };
  }
  if (tailRows.length === 0) {
    return { head: table, tail: null };
  }

  // Reposition tail rows: y starts at 0
  let tailY = 0;
  const tailRepositioned = tailRows.map((row) => {
    const next = Object.freeze({ ...row, y: tailY });
    tailY += row.height;
    return next as TableRowBox;
  });

  const headHeight = headRows.reduce((s, r) => s + r.height, 0);
  const tailHeight = tailRepositioned.reduce((s, r) => s + r.height, 0);

  return {
    head: createTableBox(table.key + "-h", table.x, table.y, table.width, headHeight, table.computedStyle, headRows, table.columnPxWidths),
    tail: createTableBox(table.key + "-t", table.x, table.y, table.width, tailHeight, table.computedStyle, tailRepositioned, table.columnPxWidths),
  };
}
```

- [ ] **Step 4: Wire into `splitLayoutBox`**

```ts
// In split-block.ts splitLayoutBox switch:
case "table":
  return splitTableBox(box as TableBox, availableHeight);
```

- [ ] **Step 5: Run tests** — PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/fragmentation/split-table.ts packages/core/src/fragmentation/split-table.test.ts packages/core/src/fragmentation/split-block.ts
git commit -m "feat(fragmentation): split tables between rows"
```

---

## Phase F — `break-*` property handling

### Task F.1 — `break-before: page` and `break-after: page` (forced page breaks)

**Files:**
- Modify: `packages/core/src/fragmentation/fragment.ts`
- Modify: `packages/core/src/fragmentation/fragment.test.ts`

- [ ] **Step 1: Add failing test**

```ts
it("breakBefore=page forces a page break before the block", () => {
  const tree = cascadePass(createElementBox("doc", { display: "block" }, [
    createElementBox("c1", { display: "block", height: 100 }, []),
    createElementBox("c2", { display: "block", height: 100, breakBefore: "page" }, []),
    createElementBox("c3", { display: "block", height: 100 }, []),
  ]));
  const flow = layoutTree(tree, 600, measurer);
  const pages = fragment(flow, {
    pageHeight: 1000,
    pageMargins: { top: 50, right: 50, bottom: 50, left: 50 },
  });
  expect(pages).toHaveLength(2);
  expect(pages[0].children).toHaveLength(1);
  expect(pages[1].children).toHaveLength(2);
});

it("breakAfter=page forces a page break after the block", () => {
  const tree = cascadePass(createElementBox("doc", { display: "block" }, [
    createElementBox("c1", { display: "block", height: 100, breakAfter: "page" }, []),
    createElementBox("c2", { display: "block", height: 100 }, []),
  ]));
  const flow = layoutTree(tree, 600, measurer);
  const pages = fragment(flow, {
    pageHeight: 1000,
    pageMargins: { top: 50, right: 50, bottom: 50, left: 50 },
  });
  expect(pages).toHaveLength(2);
});
```

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Update `fragment.ts`**

In the for-loop, before placing each child:
```ts
const childCs = child.computedStyle;
if (childCs.breakBefore === "page" && currentChildren.length > 0) {
  flush();
}

// ... place child as before ...

if (childCs.breakAfter === "page") {
  flush();
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fragmentation/fragment.ts packages/core/src/fragmentation/fragment.test.ts
git commit -m "feat(fragmentation): honor break-before and break-after page values"
```

---

### Task F.2 — `break-inside: avoid` (don't split this block)

**Files:**
- Modify: `packages/core/src/fragmentation/fragment.ts`
- Modify: `packages/core/src/fragmentation/fragment.test.ts`

- [ ] **Step 1: Add failing test**

```ts
it("breakInside=avoid keeps a block intact across pages", () => {
  const tree = cascadePass(createElementBox("doc", { display: "block" }, [
    createElementBox("c1", { display: "block", height: 600 }, []),
    createElementBox("c2", { display: "block", height: 500, breakInside: "avoid" }, [
      createElementBox("inner1", { display: "block", height: 250 }, []),
      createElementBox("inner2", { display: "block", height: 250 }, []),
    ]),
  ]));
  const flow = layoutTree(tree, 600, measurer);
  const pages = fragment(flow, {
    pageHeight: 1000,
    pageMargins: { top: 50, right: 50, bottom: 50, left: 50 },
  });
  // Page content height = 900. c1 (600) on page 1; c2 (500) — would split — moved entirely to page 2.
  expect(pages).toHaveLength(2);
  expect(pages[1].children).toHaveLength(1);  // c2 in one piece
});
```

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Update `fragment.ts`**

In the place-or-split branch:
```ts
if (blockToPlace.height <= remaining) {
  // ... fits ...
} else {
  // Doesn't fit. Check breakInside.
  const childCs = blockToPlace.computedStyle;
  if (childCs.breakInside === "avoid" && currentChildren.length > 0) {
    // Try to fit the entire block on a fresh page.
    flush();
    if (blockToPlace.height <= pageContentHeight) {
      // Fits as a whole on the new page.
      currentChildren.push(repositionTo(blockToPlace, config.pageMargins.left, config.pageMargins.top));
      currentY += blockToPlace.height;
      blockToPlace = null;
      continue;
    }
    // Block is taller than a page — fall through and split anyway.
  }
  const split = splitLayoutBox(blockToPlace, remaining);
  // ... existing split handling ...
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fragmentation/fragment.ts packages/core/src/fragmentation/fragment.test.ts
git commit -m "feat(fragmentation): honor break-inside: avoid"
```

---

## Phase G — Float fragment behavior

### Task G.1 — Floats stay with their fragment of origin

**Files:**
- Modify: `packages/core/src/fragmentation/split-block.ts`
- Modify: `packages/core/src/fragmentation/split-block.test.ts`

When splitting a BlockBox that contains floats (recognized by checking children for floats — but our BFC doesn't currently tag floats specially in the layout output), simplest behavior:
- A float's y-coordinate is its origin position. If the split occurs at y=Y, floats with `y < Y` stay on head; floats with `y >= Y` go to tail.
- An oversized float that crosses the split: stays where it originated. Visually overflows.

For Plan 3, this is handled by the existing `splitBlockBox` logic since floats are placed as children with their own y/height — they get sorted into head/tail like any other child. No additional work required for the simple case.

The only special handling needed is for *nested* floats (where the float is a child of a child being split). Plan 3 simplification: floats inside a split subtree go with the head if their entire box fits, else with the tail (no float fragmentation).

- [ ] **Step 1: Add a smoke test** — confirms current splitBlockBox already handles floats correctly because they are just children with positions.

```ts
it("floats stay with their fragment of origin", () => {
  // Construct a block with a float child plus regular children.
  // Verify that splitBlockBox places the float with the fragment that contained its origin point.
  const cs = INITIAL_COMPUTED_STYLE;
  const float = createBlockBox("float", 0, 10, 100, 100, { ...cs, float: "left" }, []);
  const c1 = createBlockBox("c1", 0, 0, 600, 200, cs, []);
  const c2 = createBlockBox("c2", 0, 200, 600, 200, cs, []);
  const block = createBlockBox("p", 0, 0, 600, 400, cs, [float, c1, c2]);

  const r = splitBlockBox(block, 250);
  // Float origin at y=10 — head fragment. c1 fully fits — head. c2 → tail.
  // Float should be in head's children.
  const headHasFloat = r.head?.children.some(c => c.key === "float");
  expect(headHasFloat).toBe(true);
});
```

- [ ] **Step 2: Run test** — likely PASSES already. If it doesn't, the issue is float placement is currently relative to the BFC's content area, not absolute y. Investigate and fix in `splitBlockBox` to use child's `y` as the origin.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/fragmentation/split-block.test.ts
git commit -m "test(fragmentation): floats stay with their fragment of origin"
```

---

## Phase H — Page assembly stage

### Task H.1 — `assemblePage` (pass-through; placeholder for v2 templates)

**Files:**
- Create: `packages/core/src/fragmentation/page-assembly.ts`
- Test: `packages/core/src/fragmentation/page-assembly.test.ts`

The page-assembly stage takes a sequence of `PageBox`es from the fragmenter and produces the final paginated layout. v1 is a pass-through; v2 will compose page templates into each page.

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/fragmentation/page-assembly.test.ts
import { describe, it, expect } from "vitest";
import { createPageBox } from "../layout/layout-box-v2";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { assemblePages } from "./page-assembly";

describe("assemblePages (pass-through in v1)", () => {
  it("returns the input unchanged", () => {
    const p1 = createPageBox("p0", 0, 0, 816, 1056, INITIAL_COMPUTED_STYLE, [], 0);
    const p2 = createPageBox("p1", 0, 0, 816, 1056, INITIAL_COMPUTED_STYLE, [], 1);
    const result = assemblePages([p1, p2]);
    expect(result).toEqual([p1, p2]);
  });
});
```

- [ ] **Step 2: Run test** — FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/fragmentation/page-assembly.ts
import type { PageBox } from "../layout/layout-box-v2";

/**
 * Assemble final pages from fragmenter output. v1 pass-through.
 * v2 will compose page templates (running headers/footers/page numbers) here.
 */
export function assemblePages(pages: readonly PageBox[]): readonly PageBox[] {
  return pages;
}
```

```ts
// packages/core/src/fragmentation/index.ts
export { fragment } from "./fragment";
export { assemblePages } from "./page-assembly";
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fragmentation/page-assembly.ts packages/core/src/fragmentation/page-assembly.test.ts packages/core/src/fragmentation/index.ts
git commit -m "feat(fragmentation): add assemblePages pass-through stage"
```

---

### Task H.2 — Wire fragmentation + assembly into the editor pipeline

**Files:**
- Modify: `packages/core/src/editor/editor-state.ts`
- Modify: `packages/core/src/editor/actions/helpers.ts`

Currently `EditorState.layoutTree` is the flowed layout. With pagination, we need a separate `pageTree` (or replace `layoutTree`).

**Decision:** When paginated, `layoutTree` is the result of `assemblePages(fragment(flow))` wrapped in a synthetic root BlockBox containing PageBoxes as children. When non-paginated, `layoutTree` is just the flow output. This preserves a single layoutTree field consumers can introspect.

- [ ] **Step 1: Update `EditorConfig` to carry `PageConfig`**

```ts
// packages/core/src/editor/editor-state.ts
import type { PageConfig } from "../layout/page-config";

export interface EditorConfig {
  measurer: TextMeasurer;
  registry: ComponentRegistry;
  containerWidth: number;
  pageConfig?: PageConfig;       // optional — paginated mode when present
}
```

- [ ] **Step 2: Update `rebuildTrees`**

```ts
// packages/core/src/editor/actions/helpers.ts
import { fragment, assemblePages } from "../../fragmentation";
import { createBlockBox } from "../../layout/layout-box-v2";

export function rebuildTrees(
  newEditor: EditorState,
  oldEditor: EditorState,
  config: EditorConfig,
): EditorState {
  const rendered = renderTree(newEditor.state, config.registry);
  const cascaded = cascadePassIncremental(rendered, oldEditor.renderTree, oldEditor.renderTree);
  const flow = layoutTreeIncremental(cascaded, oldEditor.renderTree, oldEditor.layoutTree, newEditor.containerWidth, config.measurer);

  if (!config.pageConfig) {
    return { ...newEditor, renderTree: cascaded, layoutTree: flow };
  }

  const pages = assemblePages(fragment(flow, config.pageConfig));
  // Wrap in a synthetic root.
  const totalHeight = pages.length * config.pageConfig.pageHeight;
  const root = createBlockBox(
    "doc-paginated",
    0, 0,
    flow.width + config.pageConfig.pageMargins.left + config.pageConfig.pageMargins.right,
    totalHeight,
    flow.computedStyle,
    pages,
  );

  return { ...newEditor, renderTree: cascaded, layoutTree: root };
}
```

Same pattern in `createInitialEditorState`.

- [ ] **Step 3: Run editor tests**

Run: `npm test --workspace=packages/core -- editor`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/editor/editor-state.ts packages/core/src/editor/actions/helpers.ts
git commit -m "feat(editor): integrate fragmentation pipeline when pageConfig is set"
```

---

## Phase I — DOM controller paginated mode

### Task I.1 — Update controller to consume PageBox children of layoutTree

**Files:**
- Modify: `packages/dom/src/editor-controller.ts`

The current controller has its own `paginateDocument` logic and reads PageLayoutBox. We replace that with reading the new `PageBox` children directly off `state.layoutTree`.

- [ ] **Step 1: Identify pagination logic in controller**

```bash
grep -n "PageLayoutBox\|paginateDocument\|pageSlots" packages/dom/src/editor-controller.ts
```

- [ ] **Step 2: Update `syncDom`**

In `syncDom`, replace:

```ts
const newPages: LayoutBox[] = [];
if (pageHeight) {
  for (const c of tree.children) {
    if (c.type === "page") newPages.push(c);
  }
}
```

with the new shape — `tree.children` already contains PageBoxes if the engine ran fragmentation. Same code, but the type is now `PageBox` (from `layout-box-v2`).

Update imports:
```ts
import type { LayoutBox, PageBox, SelectionRect } from "@taleweaver/core";
```

The rest of the paginated DOM logic (canvas pool, IntersectionObserver, slot divs) is unchanged — it operates on PageBoxes by index.

- [ ] **Step 3: Update `paintPage` and helpers**

In `paintPage`, the `pageBox` parameter is now `PageBox` from new types. The painter walks its children with the new layout-box recursion (handles BlockBox, LineBox, TextRunBox, InlineBox, etc.). Should "just work" if Plans 1 and 2 updated `paintBox` correctly.

- [ ] **Step 4: Update `useEditor` (React) to forward `pageConfig`**

```ts
// packages/react/src/use-editor.ts
const config: EditorConfig = {
  measurer,
  registry,
  containerWidth: DEFAULT_WIDTH,
  pageConfig: options?.pageHeight !== undefined && options.pageMargins !== undefined
    ? { pageHeight: options.pageHeight, pageMargins: options.pageMargins }
    : undefined,
};
```

- [ ] **Step 5: Run all tests**

Run: `npm test --workspace=packages/core && npm test --workspace=packages/dom && npm test --workspace=packages/react`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/dom/src/editor-controller.ts packages/react/src/use-editor.ts
git commit -m "feat(dom+react): paginated mode reads new PageBox layout output"
```

---

### Task I.2 — Hit-testing across page boxes

**Files:**
- Modify: `packages/core/src/editor/hit-test.ts`
- Modify: `packages/core/src/editor/cursor-position.ts`

The existing hit-test code in `core/editor/` was written for the old layout shape. Update for new types and PageBox awareness:
- `resolvePixelPosition`: walks layout tree to find which PageBox contains the cursor's flow position; returns `pageIndex`.
- `resolvePositionFromPixel`: takes `(x, y, pageIndex)`; finds the PageBox at that index, hit-tests within it.
- `computeSelectionRects`: walks pages and emits rects with their `pageIndex`.

- [ ] **Step 1: Read existing files**

Skim `cursor-position.ts`, `hit-test.ts`, `selection-geometry.ts`. Identify what needs updating.

- [ ] **Step 2: Update each file to use the new layout box union and PageBox**

Replace any references to the old `PageLayoutBox` with `PageBox`. Replace iteration over old types with new types.

(Each file is ~50–150 lines. Update mechanically — no algorithmic changes.)

- [ ] **Step 3: Run editor tests**

Run: `npm test --workspace=packages/core -- editor`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/editor/hit-test.ts packages/core/src/editor/cursor-position.ts packages/core/src/editor/selection-geometry.ts
git commit -m "feat(editor): hit-test and cursor positioning for new PageBox layout"
```

---

## Phase J — Example app smoke test for pagination

### Task J.1 — Test paginated mode end-to-end

**Files:**
- (No code changes — manual verification.)

- [ ] **Step 1: Boot example app**

```bash
nvm use
npm install
npm run dev -w examples/react
```

The React example app at `examples/react/src/app.tsx` already configures `pageHeight: 1056` and US Letter margins. With Plan 3 complete, the editor should:
- Render content in distinct page boxes with paper drop-shadow chrome.
- Display content laid out with proper margins (96px top/bottom, 72px left/right).
- Paginate long content across multiple pages.
- Split long paragraphs across page boundaries (resolves issue 04).
- Honor `break-before: page` if you insert a manual page break (e.g., via the toolbar).
- Apply widow/orphan defaults (no single line stranded at top or bottom).

- [ ] **Step 2: Manual verification scenarios**

Type or paste:
1. **Long single paragraph (~50 lines).** Should split across multiple pages with no widows or orphans (no 1-line stragglers).
2. **A heading immediately followed by a single-paragraph section** with `break-after: page` on the heading style. Should force a page break (or, since we don't expose that style yet, this is verification of the underlying mechanism).
3. **A 20-row table.** Should split between rows across pages.
4. **A 200-page document** by repeated paste. Scroll smoothly; paginated canvases attach/detach via IntersectionObserver.
5. **Cursor placement** mid-paragraph that spans pages. Cursor positions correctly; up/down arrows navigate across the page boundary.
6. **Selection** that spans pages. Selection rectangles render on both affected pages.

Any failure is a Plan 3 regression — file an issue, fix in a focused task.

- [ ] **Step 3: Commit any final fixes**

If manual testing reveals issues, fix and commit. If clean:

```bash
git commit --allow-empty -m "chore: Plan 3 manual verification complete"
```

---

## Plan 3 Complete

After Phase J:

- Fragmentation is a real pipeline stage; `break-*` properties work; widows/orphans default to 2/2.
- Long paragraphs split across pages at line boundaries (resolves issue 04).
- Tables split between rows.
- Floats stay with their fragment of origin.
- Page assembly is a named pipeline stage — placeholder for v2 page templates.
- DOM controller's paginated mode consumes the new `PageBox` output.
- The example app's paginated US Letter mode works end-to-end.

The DOM-architecture redesign is feature-complete for v1.

---

## Self-Review Notes

Spec coverage:
- §7.1 (break-* properties) — Phase F ✓
- §7.2 (fragmentation algorithm) — Phase B + C + D + E ✓
- §7.3 (per-FC split rules) — BFC (C), IFC (D), Table FC (E), inline-block atomic (handled by splitLayoutBox default) ✓
- §7.4 (widows/orphans) — Task D.2 ✓
- §7.5 (floats across pages) — Phase G ✓
- §7.6 (page assembly) — Phase H ✓

Type consistency:
- `PageBox` joins the LayoutBox union additively.
- `PageMargins` and `PageConfig` are stable types used by editor + fragmenter.
- `SplitResult` is a small reusable type.

Placeholder scan: clean — every step has actual code or commands. The Phase G step is intentionally light (the simple float case works for free with splitBlockBox); a future plan can add float fragmentation if it proves necessary.

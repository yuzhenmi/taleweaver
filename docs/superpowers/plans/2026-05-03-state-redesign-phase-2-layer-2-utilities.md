# State module redesign — Phase 2: Layer 2 utilities

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Layer 2 of the new state module — pure utilities that compose Layer 1 primitives. Specifically: `block-traversal.ts` (next/prev block in doc order, ancestor chain, first/last leaf), `block-compare.ts` (LCA-based cross-block compare, position compare, selection-context discovery), `span-iteration.ts` (normalizeSpan, iterateSpan, iterateBlocksInSpan), and `new-extract-text.ts` (extractText for the new state shape, temp name to avoid colliding with existing `state/extract-text.ts`). Phase 2 is purely additive — no existing files modified, build remains green throughout. Layer 3 (state-mutating operations) and the cascade attribute-interpreter pipeline are subsequent phases.

**Architecture:** Per the design spec at `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`. Layer 2 utilities are pure functions over Layer 1 types — no mutation, no allocators required. They form the foundation that Layer 3 operations and downstream consumers (cursor, render, editor) compose on. The cross-block compare uses an LCA walk (no order-maintenance tags, per the recalibrated scale target).

**Tech Stack:** TypeScript 5.7, vitest 3.0, npm workspaces. Test runner: `npm test --workspace=packages/core`. Type checker: `npm run build --workspace=packages/core`.

**Spec reference:** `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`. This plan implements the "Layered API surface > Layer 2" section. Key context: "Multi-block selection" section (lines describing iterateSpan / compareBlocksInDocOrder / selection contexts).

**Phase 1 status (assumed complete):** Phase 1 plan at `docs/superpowers/plans/2026-05-02-state-redesign-phase-1-foundation.md` shipped 18 commits ending at `4230343`. All Layer 1 types exist at `packages/core/src/state/{persistent-map, block-id, attrs, inline-content, block-position, block, state, new-initial-state}.ts` plus `test-utils/state-builders.ts`. Build green; 902 tests passing.

**Per-phase scope notes:**

- New files at top-level paths in `packages/core/src/state/` with a `new-` prefix where the name would collide with existing files. Specifically: this phase adds `new-extract-text.ts` (the existing `state/extract-text.ts` is the old StateNode-based version still in use by editor consumers). Phase 14 cleanup renames `new-extract-text.ts` → `extract-text.ts` after the old file is deleted.
- All other new file names in this phase do not collide with existing files (`block-traversal.ts`, `block-compare.ts`, `span-iteration.ts`).
- Per CLAUDE.md: TDD throughout. Write tests first, see them fail, implement, see them pass, commit.
- Per memory `feedback_no_auto_commit.md`: commit on user's behalf at the end of each task.
- Type safety: no non-null assertions (`!`); use proper narrowing.

**Convention used in tests:** Tests construct state graphs using `buildBlock` / `buildState` / `text` / `embed` from `packages/core/src/test-utils/state-builders.ts` (added in Phase 1).

---

## File structure (this phase)

**Created:**

| Path | Responsibility |
|---|---|
| `packages/core/src/state/block-traversal.ts` | Pure traversal utilities: `nextBlockInDocOrder`, `prevBlockInDocOrder`, `ancestorChain`, `firstLeafBlock`, `lastLeafBlock`. |
| `packages/core/src/state/block-traversal.test.ts` | Unit tests for traversal utilities, including deeply-nested and edge-case structures. |
| `packages/core/src/state/block-compare.ts` | Cross-block comparison: `compareBlocksInDocOrder` (LCA walk), `comparePositions`, `selectionContextOf`. |
| `packages/core/src/state/block-compare.test.ts` | Unit tests for compare utilities, including same-block, ancestor-descendant, and cross-subtree cases. |
| `packages/core/src/state/span-iteration.ts` | Span normalization and iteration: `normalizeSpan`, `iterateSpan` (per-leaf-block ranges), `iterateBlocksInSpan` (all blocks incl. containers). |
| `packages/core/src/state/span-iteration.test.ts` | Unit tests for span iteration including same-block, cross-block, and degenerate (empty span) cases. |
| `packages/core/src/state/new-extract-text.ts` | `extractText(state, span)` — joins per-block content with newlines. Will be renamed to `extract-text.ts` in Phase 14 cleanup. |
| `packages/core/src/state/new-extract-text.test.ts` | Unit tests for extractText with text-only blocks, embed handling, and multi-block spans. |

**Modified:** none (Phase 2 is purely additive).

**Deleted:** none.

---

## Task 1: block-traversal.ts — nextBlockInDocOrder

**Files:**
- Create: `packages/core/src/state/block-traversal.ts`
- Test: `packages/core/src/state/block-traversal.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/block-traversal.test.ts
import { describe, it, expect } from "vitest";
import { nextBlockInDocOrder } from "./block-traversal";
import { buildBlock, buildState, text } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("nextBlockInDocOrder", () => {
  it("returns the first child when the block has children", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    expect(nextBlockInDocOrder(state, "doc" as BlockId)).toBe("p1");
  });

  it("returns the next sibling when no children but has a next sibling", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });
    expect(nextBlockInDocOrder(state, "p1" as BlockId)).toBe("p2");
  });

  it("ascends to find the parent's next sibling when at the end of a subtree", () => {
    // doc > [section1 > [p1, p2], section2 > [p3]]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s1", lastChildId: "s2" }),
        buildBlock({ id: "s1", type: "section", parentId: "doc", nextSiblingId: "s2", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s1", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s1", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "s2", type: "section", parentId: "doc", prevSiblingId: "s1", firstChildId: "p3", lastChildId: "p3" }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "s2", inlineContent: createInlineContent([]) }),
      ],
    });
    // p2 has no next sibling, but parent s1 has next sibling s2; we should land on s2 (the next block in doc order, before descending into its children).
    expect(nextBlockInDocOrder(state, "p2" as BlockId)).toBe("s2");
  });

  it("returns null at the end of the document", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([]) }),
      ],
    });
    expect(nextBlockInDocOrder(state, "p1" as BlockId)).toBeNull();
  });

  it("returns null when called on a non-existent id", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(nextBlockInDocOrder(state, "missing" as BlockId)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- block-traversal`
Expected: FAIL — module `./block-traversal` not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/block-traversal.ts
import type { BlockId } from "./block-id";
import type { State } from "./state";

/**
 * Walk to the next block in document order:
 *   1. If this block has a first child, that's next.
 *   2. Else, walk up via parent pointers until a block with a nextSibling
 *      is found; return that nextSibling.
 *   3. If we exhaust the parent chain, return null (end of document).
 *
 * Each step is O(1) (HAMT lookup + pointer follow).
 */
export function nextBlockInDocOrder(state: State, blockId: BlockId): BlockId | null {
  const block = state.blocks.get(blockId);
  if (!block) return null;
  if (block.firstChildId) return block.firstChildId;
  let cursor = block;
  while (true) {
    if (cursor.nextSiblingId) return cursor.nextSiblingId;
    if (!cursor.parentId) return null;
    const parent = state.blocks.get(cursor.parentId);
    if (!parent) return null;
    cursor = parent;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- block-traversal`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/block-traversal.ts packages/core/src/state/block-traversal.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add nextBlockInDocOrder

Layer 2 traversal utility. Depth-first descent: first child if present,
else next sibling, else ascend to parent's next sibling. Returns null
at end of document.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: block-traversal.ts — prevBlockInDocOrder

**Files:**
- Modify: `packages/core/src/state/block-traversal.ts`
- Modify: `packages/core/src/state/block-traversal.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `block-traversal.test.ts`:

```typescript
import { prevBlockInDocOrder } from "./block-traversal";

describe("prevBlockInDocOrder", () => {
  it("returns the parent when this block is the first child", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([]) }),
      ],
    });
    expect(prevBlockInDocOrder(state, "p1" as BlockId)).toBe("doc");
  });

  it("returns the previous sibling's deepest last leaf when there is a prev sibling", () => {
    // doc > [section1 > [p1, p2], section2 > [p3]]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s1", lastChildId: "s2" }),
        buildBlock({ id: "s1", type: "section", parentId: "doc", nextSiblingId: "s2", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s1", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s1", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "s2", type: "section", parentId: "doc", prevSiblingId: "s1", firstChildId: "p3", lastChildId: "p3" }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "s2", inlineContent: createInlineContent([]) }),
      ],
    });
    // s2 has prev sibling s1; s1's deepest last leaf is p2.
    expect(prevBlockInDocOrder(state, "s2" as BlockId)).toBe("p2");
  });

  it("returns null at the start of the document", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
    });
    expect(prevBlockInDocOrder(state, "doc" as BlockId)).toBeNull();
  });

  it("returns null when called on a non-existent id", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(prevBlockInDocOrder(state, "missing" as BlockId)).toBeNull();
  });

  it("returns the parent when this is the first child of root with siblings present", () => {
    // Confirms parent-return path even when there are subsequent siblings.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });
    expect(prevBlockInDocOrder(state, "p1" as BlockId)).toBe("doc");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- block-traversal`
Expected: FAIL — `prevBlockInDocOrder` not exported.

- [ ] **Step 3: Add the function**

Append to `block-traversal.ts`:

```typescript
/**
 * Walk to the previous block in document order:
 *   1. If this block has a previous sibling, descend into that sibling's
 *      deepest last child (the rightmost leaf of the previous-sibling subtree).
 *   2. Else, return the parent (when this block is its parent's first child).
 *   3. If no parent, return null (this is the document root).
 *
 * Symmetric to nextBlockInDocOrder. Each step is O(1) for the lookup, but
 * the deepest-last-child descent is O(depth) for blocks with deep subtrees.
 */
export function prevBlockInDocOrder(state: State, blockId: BlockId): BlockId | null {
  const block = state.blocks.get(blockId);
  if (!block) return null;
  if (block.prevSiblingId) {
    // Descend to the deepest last child of the previous sibling.
    let cursor = state.blocks.get(block.prevSiblingId);
    if (!cursor) return null;
    while (cursor.lastChildId) {
      const next = state.blocks.get(cursor.lastChildId);
      if (!next) break;
      cursor = next;
    }
    return cursor.id;
  }
  return block.parentId;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- block-traversal`
Expected: PASS (10 tests in `block-traversal.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/block-traversal.ts packages/core/src/state/block-traversal.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add prevBlockInDocOrder

Symmetric to nextBlockInDocOrder. Descends into the previous sibling's
deepest last leaf when one exists; otherwise returns the parent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: block-traversal.ts — ancestorChain

**Files:**
- Modify: `packages/core/src/state/block-traversal.ts`
- Modify: `packages/core/src/state/block-traversal.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `block-traversal.test.ts`:

```typescript
import { ancestorChain } from "./block-traversal";

describe("ancestorChain", () => {
  it("returns [self] for the root block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
    });
    expect(ancestorChain(state, "doc" as BlockId)).toEqual(["doc"]);
  });

  it("returns the chain from the block up to the root", () => {
    // doc > section > p
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "s", inlineContent: createInlineContent([]) }),
      ],
    });
    expect(ancestorChain(state, "p" as BlockId)).toEqual(["p", "s", "doc"]);
  });

  it("returns an empty array for a non-existent id", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(ancestorChain(state, "missing" as BlockId)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- block-traversal`
Expected: FAIL — `ancestorChain` not exported.

- [ ] **Step 3: Add the function**

Append to `block-traversal.ts`:

```typescript
/**
 * Build the ancestor chain from a block up to and including the root.
 * Returns [blockId, parentId, grandparentId, ..., rootId].
 * Returns an empty array if blockId does not exist in state.
 * Throws if a parentId mid-walk references a missing block (malformed
 * state) — silently truncating would mask state corruption.
 */
export function ancestorChain(state: State, blockId: BlockId): BlockId[] {
  if (!state.blocks.has(blockId)) return [];
  const result: BlockId[] = [];
  let current: BlockId | null = blockId;
  while (current) {
    const block = state.blocks.get(current);
    if (!block) {
      throw new Error(
        `ancestorChain: parentId "${current}" references a missing block ` +
        `(malformed state, partial chain: [${result.join(", ")}])`,
      );
    }
    result.push(current);
    current = block.parentId;
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- block-traversal`
Expected: PASS (13 tests in `block-traversal.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/block-traversal.ts packages/core/src/state/block-traversal.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add ancestorChain

Walk parentId pointers to produce [self, parent, ..., root]. Used by
LCA computation and selection-context discovery in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: block-traversal.ts — firstLeafBlock and lastLeafBlock

**Files:**
- Modify: `packages/core/src/state/block-traversal.ts`
- Modify: `packages/core/src/state/block-traversal.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `block-traversal.test.ts`:

```typescript
import { firstLeafBlock, lastLeafBlock } from "./block-traversal";

describe("firstLeafBlock", () => {
  it("returns the block itself when it is a leaf (no children)", () => {
    const state = buildState({
      rootId: "p",
      blocks: [buildBlock({ id: "p", type: "paragraph", inlineContent: createInlineContent([]) })],
    });
    expect(firstLeafBlock(state, "p" as BlockId)).toBe("p");
  });

  it("descends to the first leaf via firstChildId", () => {
    // doc > section > [p1, p2]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });
    expect(firstLeafBlock(state, "doc" as BlockId)).toBe("p1");
  });

  it("returns null when called on a non-existent id", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(firstLeafBlock(state, "missing" as BlockId)).toBeNull();
  });
});

describe("lastLeafBlock", () => {
  it("returns the block itself when it is a leaf", () => {
    const state = buildState({
      rootId: "p",
      blocks: [buildBlock({ id: "p", type: "paragraph", inlineContent: createInlineContent([]) })],
    });
    expect(lastLeafBlock(state, "p" as BlockId)).toBe("p");
  });

  it("descends to the last leaf via lastChildId", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });
    expect(lastLeafBlock(state, "doc" as BlockId)).toBe("p2");
  });

  it("returns null when called on a non-existent id", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(lastLeafBlock(state, "missing" as BlockId)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- block-traversal`
Expected: FAIL — `firstLeafBlock` and `lastLeafBlock` not exported.

- [ ] **Step 3: Add the functions**

Append to `block-traversal.ts`:

```typescript
/**
 * Walk down via firstChildId to the leftmost leaf in the subtree rooted
 * at blockId. Returns blockId itself if it is a leaf (no firstChildId).
 * Returns null if blockId does not exist.
 */
export function firstLeafBlock(state: State, blockId: BlockId): BlockId | null {
  let cursor = state.blocks.get(blockId);
  if (!cursor) return null;
  while (cursor.firstChildId) {
    const next = state.blocks.get(cursor.firstChildId);
    if (!next) break;
    cursor = next;
  }
  return cursor.id;
}

/**
 * Walk down via lastChildId to the rightmost leaf in the subtree rooted
 * at blockId. Returns blockId itself if it is a leaf (no lastChildId).
 * Returns null if blockId does not exist.
 */
export function lastLeafBlock(state: State, blockId: BlockId): BlockId | null {
  let cursor = state.blocks.get(blockId);
  if (!cursor) return null;
  while (cursor.lastChildId) {
    const next = state.blocks.get(cursor.lastChildId);
    if (!next) break;
    cursor = next;
  }
  return cursor.id;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- block-traversal`
Expected: PASS (19 tests in `block-traversal.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/block-traversal.ts packages/core/src/state/block-traversal.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add firstLeafBlock and lastLeafBlock

Walk down via firstChildId / lastChildId to the leftmost / rightmost
leaf in the subtree. Returns the block itself when it is a leaf.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: block-compare.ts — compareBlocksInDocOrder (LCA walk)

**Files:**
- Create: `packages/core/src/state/block-compare.ts`
- Test: `packages/core/src/state/block-compare.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/state/block-compare.test.ts
import { describe, it, expect } from "vitest";
import { compareBlocksInDocOrder } from "./block-compare";
import { buildBlock, buildState } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("compareBlocksInDocOrder", () => {
  // Common test fixture: doc > [section1 > [p1, p2], section2 > [p3, p4]]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s1", lastChildId: "s2" }),
        buildBlock({ id: "s1", type: "section", parentId: "doc", nextSiblingId: "s2", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s1", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s1", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "s2", type: "section", parentId: "doc", prevSiblingId: "s1", firstChildId: "p3", lastChildId: "p4" }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "s2", nextSiblingId: "p4", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p4", type: "paragraph", parentId: "s2", prevSiblingId: "p3", inlineContent: createInlineContent([]) }),
      ],
    });

  it("returns 0 when comparing a block to itself", () => {
    const state = fixture();
    expect(compareBlocksInDocOrder(state, "p1" as BlockId, "p1" as BlockId)).toBe(0);
  });

  it("returns negative when a comes before b at the same level (siblings)", () => {
    const state = fixture();
    expect(compareBlocksInDocOrder(state, "p1" as BlockId, "p2" as BlockId)).toBeLessThan(0);
  });

  it("returns positive when a comes after b at the same level", () => {
    const state = fixture();
    expect(compareBlocksInDocOrder(state, "p2" as BlockId, "p1" as BlockId)).toBeGreaterThan(0);
  });

  it("returns negative when a is in an earlier subtree than b", () => {
    const state = fixture();
    expect(compareBlocksInDocOrder(state, "p1" as BlockId, "p3" as BlockId)).toBeLessThan(0);
    expect(compareBlocksInDocOrder(state, "p2" as BlockId, "p3" as BlockId)).toBeLessThan(0);
  });

  it("returns positive when a is in a later subtree than b", () => {
    const state = fixture();
    expect(compareBlocksInDocOrder(state, "p4" as BlockId, "p1" as BlockId)).toBeGreaterThan(0);
  });

  it("returns negative when a is an ancestor of b (ancestor comes first)", () => {
    const state = fixture();
    expect(compareBlocksInDocOrder(state, "doc" as BlockId, "p1" as BlockId)).toBeLessThan(0);
    expect(compareBlocksInDocOrder(state, "s1" as BlockId, "p1" as BlockId)).toBeLessThan(0);
  });

  it("returns positive when a is a descendant of b (descendant comes after)", () => {
    const state = fixture();
    expect(compareBlocksInDocOrder(state, "p1" as BlockId, "doc" as BlockId)).toBeGreaterThan(0);
    expect(compareBlocksInDocOrder(state, "p1" as BlockId, "s1" as BlockId)).toBeGreaterThan(0);
  });

  it("throws when one of the ids does not exist", () => {
    const state = fixture();
    expect(() => compareBlocksInDocOrder(state, "missing" as BlockId, "p1" as BlockId)).toThrow();
    expect(() => compareBlocksInDocOrder(state, "p1" as BlockId, "missing" as BlockId)).toThrow();
  });

  it("throws when blocks are in disjoint subtrees (no common ancestor)", () => {
    // Two separate roots — should not happen in practice (single rootId), but defensive.
    const state = buildState({
      rootId: "a",
      blocks: [
        buildBlock({ id: "a", type: "document", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "b", type: "document", inlineContent: createInlineContent([]) }), // orphan, no parent
      ],
    });
    expect(() => compareBlocksInDocOrder(state, "a" as BlockId, "b" as BlockId)).toThrow();
  });

  it("compares correctly when one block is much deeper than the other (asymmetric chains)", () => {
    // doc > [shallow, outer > section > subsection > deep]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "shallow", lastChildId: "outer" }),
        buildBlock({ id: "shallow", type: "paragraph", parentId: "doc", nextSiblingId: "outer", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "outer", type: "section", parentId: "doc", prevSiblingId: "shallow", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "outer", firstChildId: "subsection", lastChildId: "subsection" }),
        buildBlock({ id: "subsection", type: "section", parentId: "section", firstChildId: "deep", lastChildId: "deep" }),
        buildBlock({ id: "deep", type: "paragraph", parentId: "subsection", inlineContent: createInlineContent([]) }),
      ],
    });
    // shallow chain depth = 2 (shallow, doc); deep chain depth = 5 (deep, subsection, section, outer, doc).
    expect(compareBlocksInDocOrder(state, "shallow" as BlockId, "deep" as BlockId)).toBeLessThan(0);
    expect(compareBlocksInDocOrder(state, "deep" as BlockId, "shallow" as BlockId)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- block-compare`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/block-compare.ts
import type { BlockId } from "./block-id";
import type { State } from "./state";
import { ancestorChain } from "./block-traversal";

/**
 * Compare two blocks in document order.
 * Returns negative if a is before b, positive if a is after b, zero if equal.
 *
 * Algorithm (LCA walk):
 *   1. Build ancestor chains from each block up to (and including) the root.
 *   2. Walk from the roots downward to find the lowest common ancestor (LCA).
 *      Since chains end at the root, walking back from the end of each chain
 *      gives us the path from root to each block.
 *   3. At the LCA, the two child branches of the LCA are different blocks
 *      (or one is the LCA itself if one is an ancestor of the other).
 *   4. If one block IS the LCA: the LCA (ancestor) comes first.
 *   5. Else: walk LCA's child linked list to determine which branch comes
 *      first; that block (and its subtree) is in document order first.
 *
 * Worst case: O(depth + LCA-fanout). At target scale (depth 3-5, fanout
 * typically <100), bounded by ~100 sibling-pointer hops.
 *
 * Throws if either id does not exist, or if blocks have no common ancestor.
 */
export function compareBlocksInDocOrder(state: State, idA: BlockId, idB: BlockId): number {
  if (idA === idB) return 0;

  const chainA = ancestorChain(state, idA);
  const chainB = ancestorChain(state, idB);
  if (chainA.length === 0) throw new Error(`compareBlocksInDocOrder: block "${idA}" not found`);
  if (chainB.length === 0) throw new Error(`compareBlocksInDocOrder: block "${idB}" not found`);

  // Roots must match for blocks to be comparable.
  const rootA = chainA[chainA.length - 1];
  const rootB = chainB[chainB.length - 1];
  if (rootA !== rootB) {
    throw new Error(
      `compareBlocksInDocOrder: blocks "${idA}" and "${idB}" have no common ancestor`,
    );
  }

  // Walk from root toward each block to find LCA.
  // chainA / chainB go [self, ..., root]; reverse the indexing.
  let i = chainA.length - 1;
  let j = chainB.length - 1;
  while (i >= 0 && j >= 0 && chainA[i] === chainB[j]) {
    i--;
    j--;
  }

  // If one chain ran out, that block is an ancestor of the other; ancestor comes first.
  if (i < 0) return -1; // a is ancestor of b
  if (j < 0) return 1;  // b is ancestor of a

  // chainA[i] and chainB[j] are different children of the LCA (which is chainA[i+1] === chainB[j+1]).
  // Walk the LCA's child linked list to see which child comes first.
  const lcaId = chainA[i + 1];
  const lca = state.blocks.get(lcaId);
  if (!lca) throw new Error(`compareBlocksInDocOrder: LCA "${lcaId}" not found`);

  let cursor: BlockId | null = lca.firstChildId;
  while (cursor) {
    if (cursor === chainA[i]) return -1;
    if (cursor === chainB[j]) return 1;
    const block = state.blocks.get(cursor);
    cursor = block ? block.nextSiblingId : null;
  }

  throw new Error(
    `compareBlocksInDocOrder: branches "${chainA[i]}" / "${chainB[j]}" not found in LCA "${lcaId}" children`,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- block-compare`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/block-compare.ts packages/core/src/state/block-compare.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add compareBlocksInDocOrder via LCA walk

Builds ancestor chains for each block, finds the lowest common ancestor,
then walks the LCA's child linked list to determine which branch comes
first in document order. Worst case O(depth + LCA-fanout); at the
target scale (≤10k blocks, depth 3-5), bounded by ~100 sibling hops.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: block-compare.ts — comparePositions

**Files:**
- Modify: `packages/core/src/state/block-compare.ts`
- Modify: `packages/core/src/state/block-compare.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `block-compare.test.ts`:

```typescript
import { comparePositions } from "./block-compare";
import { createPosition } from "./block-position";

describe("comparePositions", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });

  it("compares offsets within the same block", () => {
    const state = fixture();
    const a = createPosition("p1" as BlockId, 1);
    const b = createPosition("p1" as BlockId, 5);
    expect(comparePositions(state, a, b)).toBeLessThan(0);
    expect(comparePositions(state, b, a)).toBeGreaterThan(0);
    expect(comparePositions(state, a, a)).toBe(0);
  });

  it("delegates to compareBlocksInDocOrder when blocks differ", () => {
    const state = fixture();
    const a = createPosition("p1" as BlockId, 5);
    const b = createPosition("p2" as BlockId, 0);
    expect(comparePositions(state, a, b)).toBeLessThan(0);
    expect(comparePositions(state, b, a)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- block-compare`
Expected: FAIL — `comparePositions` not exported.

- [ ] **Step 3: Add the function**

Append to `block-compare.ts`:

```typescript
import type { Position } from "./block-position";

/**
 * Compare two positions in document order.
 * Same block: compare offsets.
 * Different blocks: delegate to compareBlocksInDocOrder.
 */
export function comparePositions(state: State, a: Position, b: Position): number {
  if (a.blockId === b.blockId) return a.offset - b.offset;
  return compareBlocksInDocOrder(state, a.blockId, b.blockId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- block-compare`
Expected: PASS (13 tests in `block-compare.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/block-compare.ts packages/core/src/state/block-compare.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add comparePositions

Same-block: compare offsets. Different blocks: delegate to
compareBlocksInDocOrder.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: block-compare.ts — selectionContextOf

**Files:**
- Modify: `packages/core/src/state/block-compare.ts`
- Modify: `packages/core/src/state/block-compare.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `block-compare.test.ts`:

```typescript
import { selectionContextOf } from "./block-compare";

describe("selectionContextOf", () => {
  it("returns the root id when called on the root", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
    });
    expect(selectionContextOf(state, "doc" as BlockId)).toBe("doc");
  });

  it("walks parentId to find the context root", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "s", inlineContent: createInlineContent([]) }),
      ],
    });
    expect(selectionContextOf(state, "p" as BlockId)).toBe("doc");
    expect(selectionContextOf(state, "s" as BlockId)).toBe("doc");
  });

  it("returns null when called on a non-existent id", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(selectionContextOf(state, "missing" as BlockId)).toBeNull();
  });

  it("returns the block's own root when it is an orphan (parentId === null)", () => {
    // For Phase 2, all blocks are reachable from state.rootId (no embed-content
    // sub-trees yet). Future phases will add embed-content blocks with
    // parentId === null; selectionContextOf should return them as their own
    // context root.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document" }),
        buildBlock({ id: "orphan", type: "footnote-body", inlineContent: createInlineContent([]) }), // parentId defaults to null
      ],
    });
    expect(selectionContextOf(state, "orphan" as BlockId)).toBe("orphan");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- block-compare`
Expected: FAIL — `selectionContextOf` not exported.

- [ ] **Step 3: Add the function**

Append to `block-compare.ts`:

```typescript
/**
 * Return the id of the selection-context root for the given block.
 *
 * A "selection context" is the root of a sub-tree within which selections
 * may extend (main document body, OR one specific footnote body, etc.).
 * Cross-context spans are not supported.
 *
 * Implementation: walk parentId until null; return the topmost block id.
 * For Phase 2, this is always state.rootId because embed-content sub-trees
 * (with parentId === null) don't exist yet. Future phases will introduce
 * such sub-trees; this function will then correctly return their own root
 * ids as separate contexts.
 *
 * Returns null if blockId does not exist.
 */
export function selectionContextOf(state: State, blockId: BlockId): BlockId | null {
  let cursor = state.blocks.get(blockId);
  if (!cursor) return null;
  while (cursor.parentId) {
    const parent = state.blocks.get(cursor.parentId);
    if (!parent) break;
    cursor = parent;
  }
  return cursor.id;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- block-compare`
Expected: PASS (17 tests in `block-compare.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/block-compare.ts packages/core/src/state/block-compare.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add selectionContextOf

Walks parentId to find the top of the sub-tree containing the given
block. For Phase 2 always returns state.rootId; future embed-content
sub-trees will produce distinct context roots.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: span-iteration.ts — normalizeSpan

**Files:**
- Create: `packages/core/src/state/span-iteration.ts`
- Test: `packages/core/src/state/span-iteration.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/span-iteration.test.ts
import { describe, it, expect } from "vitest";
import { normalizeSpan } from "./span-iteration";
import { buildBlock, buildState } from "../test-utils/state-builders";
import { createPosition, createSpan } from "./block-position";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("normalizeSpan", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });

  it("returns the span unchanged when anchor is already before focus (same block)", () => {
    const state = fixture();
    const a = createPosition("p1" as BlockId, 0);
    const b = createPosition("p1" as BlockId, 5);
    const span = createSpan(a, b);
    const result = normalizeSpan(state, span);
    expect(result.anchor).toBe(a);
    expect(result.focus).toBe(b);
  });

  it("swaps anchor and focus when focus is before anchor (same block)", () => {
    const state = fixture();
    const a = createPosition("p1" as BlockId, 5);
    const b = createPosition("p1" as BlockId, 0);
    const span = createSpan(a, b);
    const result = normalizeSpan(state, span);
    expect(result.anchor).toBe(b);
    expect(result.focus).toBe(a);
  });

  it("returns the span unchanged when anchor is in an earlier block than focus", () => {
    const state = fixture();
    const a = createPosition("p1" as BlockId, 0);
    const b = createPosition("p2" as BlockId, 0);
    const span = createSpan(a, b);
    const result = normalizeSpan(state, span);
    expect(result.anchor).toBe(a);
    expect(result.focus).toBe(b);
  });

  it("swaps when focus is in an earlier block than anchor", () => {
    const state = fixture();
    const a = createPosition("p2" as BlockId, 0);
    const b = createPosition("p1" as BlockId, 0);
    const span = createSpan(a, b);
    const result = normalizeSpan(state, span);
    expect(result.anchor).toBe(b);
    expect(result.focus).toBe(a);
  });

  it("returns the span unchanged when collapsed (anchor === focus)", () => {
    const state = fixture();
    const a = createPosition("p1" as BlockId, 5);
    const span = createSpan(a, a);
    const result = normalizeSpan(state, span);
    expect(result.anchor).toBe(a);
    expect(result.focus).toBe(a);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- span-iteration`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/span-iteration.ts
import type { State } from "./state";
import type { Span } from "./block-position";
import { createSpan } from "./block-position";
import { comparePositions, selectionContextOf } from "./block-compare";

/**
 * Normalize a span so anchor comes before focus in document order.
 * If already normalized, returns the same Span object reference.
 *
 * Precondition: anchor and focus must be in the same selection context.
 * comparePositions throws via compareBlocksInDocOrder if they have no
 * common ancestor (different roots).
 */
export function normalizeSpan(state: State, span: Span): Span {
  if (comparePositions(state, span.anchor, span.focus) <= 0) return span;
  return createSpan(span.focus, span.anchor);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- span-iteration`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/span-iteration.ts packages/core/src/state/span-iteration.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add normalizeSpan

Ensures anchor comes before focus in document order. Uses
comparePositions which delegates to LCA-based block compare for
cross-block spans.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: span-iteration.ts — iterateSpan

**Files:**
- Modify: `packages/core/src/state/span-iteration.ts`
- Modify: `packages/core/src/state/span-iteration.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `span-iteration.test.ts`:

```typescript
import { iterateSpan } from "./span-iteration";
import { text } from "../test-utils/state-builders";

describe("iterateSpan", () => {
  // doc > [p1("hello"), p2("world"), p3("!")]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("world")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("!")]) }),
      ],
    });

  it("yields a single range when span is within one block", () => {
    const state = fixture();
    const span = createSpan(createPosition("p1" as BlockId, 1), createPosition("p1" as BlockId, 4));
    const ranges = [...iterateSpan(state, span)];
    expect(ranges).toHaveLength(1);
    expect(ranges[0].block.id).toBe("p1");
    expect(ranges[0].rangeStart).toBe(1);
    expect(ranges[0].rangeEnd).toBe(4);
  });

  it("yields anchor block from anchor.offset to end, then focus block from 0 to focus.offset (two-block span)", () => {
    const state = fixture();
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    const ranges = [...iterateSpan(state, span)];
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual(expect.objectContaining({
      rangeStart: 2,
      rangeEnd: 5,  // p1's "hello" length is 5
    }));
    expect(ranges[0].block.id).toBe("p1");
    expect(ranges[1]).toEqual(expect.objectContaining({
      rangeStart: 0,
      rangeEnd: 3,
    }));
    expect(ranges[1].block.id).toBe("p2");
  });

  it("yields anchor, all middle full ranges, then focus (three-block span)", () => {
    const state = fixture();
    const span = createSpan(createPosition("p1" as BlockId, 1), createPosition("p3" as BlockId, 1));
    const ranges = [...iterateSpan(state, span)];
    expect(ranges).toHaveLength(3);
    expect(ranges[0].block.id).toBe("p1");
    expect(ranges[0].rangeStart).toBe(1);
    expect(ranges[0].rangeEnd).toBe(5); // p1 full content length

    expect(ranges[1].block.id).toBe("p2");
    expect(ranges[1].rangeStart).toBe(0);
    expect(ranges[1].rangeEnd).toBe(5); // p2 full content length

    expect(ranges[2].block.id).toBe("p3");
    expect(ranges[2].rangeStart).toBe(0);
    expect(ranges[2].rangeEnd).toBe(1);
  });

  it("normalizes the span before iterating (anchor after focus)", () => {
    const state = fixture();
    const span = createSpan(createPosition("p2" as BlockId, 3), createPosition("p1" as BlockId, 2));
    const ranges = [...iterateSpan(state, span)];
    // After normalization: anchor=p1@2, focus=p2@3. Same as the two-block test above.
    expect(ranges).toHaveLength(2);
    expect(ranges[0].block.id).toBe("p1");
    expect(ranges[1].block.id).toBe("p2");
  });

  it("yields a single zero-width range for a collapsed span (anchor === focus)", () => {
    const state = fixture();
    const pos = createPosition("p1" as BlockId, 3);
    const span = createSpan(pos, pos);
    const ranges = [...iterateSpan(state, span)];
    expect(ranges).toHaveLength(1);
    expect(ranges[0].rangeStart).toBe(3);
    expect(ranges[0].rangeEnd).toBe(3);
  });

  it("throws when anchor or focus is on a container block (not a leaf)", () => {
    // doc > section > p1 — section is a container with no inlineContent.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const onContainer = createSpan(createPosition("s" as BlockId, 0), createPosition("p1" as BlockId, 1));
    expect(() => [...iterateSpan(state, onContainer)]).toThrow(/container/);
  });

  it("throws when anchor and focus are in different selection contexts", () => {
    // Two roots — anchor in main doc, focus in a separate sub-tree.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
        // Footnote-body sub-tree with its own root (parentId = null).
        buildBlock({ id: "fn", type: "footnote-body", inlineContent: createInlineContent([text("footnote")]) }),
      ],
    });
    const cross = createSpan(createPosition("p1" as BlockId, 0), createPosition("fn" as BlockId, 1));
    expect(() => [...iterateSpan(state, cross)]).toThrow(/different selection contexts/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- span-iteration`
Expected: FAIL — `iterateSpan` not exported.

- [ ] **Step 3: Add the function**

Append to `span-iteration.ts`:

```typescript
import type { Block } from "./block";
import { inlineContentLength } from "./inline-content";
import { nextBlockInDocOrder } from "./block-traversal";

/**
 * Per-leaf-block range yielded by iterateSpan.
 */
export interface BlockRange {
  block: Block;
  rangeStart: number;
  rangeEnd: number;
}

/**
 * Yield per-leaf-block ranges for a span in document order.
 *
 * Same-block span: yields once with the offset range.
 * Cross-block span: yields anchor block from anchor.offset to end-of-block,
 *   then each intervening leaf block fully (range 0..length), then focus
 *   block from 0 to focus.offset.
 *
 * Container blocks (no inlineContent) encountered between anchor and focus
 * are skipped — only leaves contribute ranges.
 *
 * The span is normalized first (anchor before focus in document order).
 *
 * Preconditions (each throws on violation):
 *   - Both endpoints reference existing blocks.
 *   - Both endpoints reference leaf blocks (with inlineContent). A span
 *     endpoint on a container is nonsensical (offsets don't apply to
 *     containers) and would silently produce a backwards or empty range.
 *   - Both endpoints are in the same selection context (same root via
 *     parentId chain). Cross-context spans are not supported in the data
 *     model; the action-handler layer is responsible for rejecting or
 *     collapsing them, but this function defends against bad input.
 */
export function* iterateSpan(state: State, span: Span): Iterable<BlockRange> {
  // Pre-normalize precondition checks (validate raw endpoints before
  // normalizeSpan does cross-block compare, which itself requires same-context).
  const anchorBlockRaw = state.blocks.get(span.anchor.blockId);
  const focusBlockRaw = state.blocks.get(span.focus.blockId);
  if (!anchorBlockRaw) throw new Error(`iterateSpan: anchor block "${span.anchor.blockId}" not found`);
  if (!focusBlockRaw) throw new Error(`iterateSpan: focus block "${span.focus.blockId}" not found`);
  if (!anchorBlockRaw.inlineContent) {
    throw new Error(`iterateSpan: anchor block "${span.anchor.blockId}" is a container, not a leaf`);
  }
  if (!focusBlockRaw.inlineContent) {
    throw new Error(`iterateSpan: focus block "${span.focus.blockId}" is a container, not a leaf`);
  }
  const anchorCtx = selectionContextOf(state, span.anchor.blockId);
  const focusCtx = selectionContextOf(state, span.focus.blockId);
  if (anchorCtx !== focusCtx) {
    throw new Error(
      `iterateSpan: anchor and focus are in different selection contexts ` +
      `("${anchorCtx}" vs "${focusCtx}")`,
    );
  }

  const normalized = normalizeSpan(state, span);

  if (normalized.anchor.blockId === normalized.focus.blockId) {
    const block = state.blocks.get(normalized.anchor.blockId);
    if (!block) throw new Error(`iterateSpan: block "${normalized.anchor.blockId}" not found`);
    yield { block, rangeStart: normalized.anchor.offset, rangeEnd: normalized.focus.offset };
    return;
  }

  const anchorBlock = state.blocks.get(normalized.anchor.blockId);
  const focusBlock = state.blocks.get(normalized.focus.blockId);
  if (!anchorBlock) throw new Error(`iterateSpan: block "${normalized.anchor.blockId}" not found`);
  if (!focusBlock) throw new Error(`iterateSpan: block "${normalized.focus.blockId}" not found`);

  // Anchor block: from anchor.offset to end-of-block.
  yield {
    block: anchorBlock,
    rangeStart: normalized.anchor.offset,
    rangeEnd: anchorBlock.inlineContent ? inlineContentLength(anchorBlock.inlineContent) : 0,
  };

  // Walk intervening blocks via nextBlockInDocOrder, yielding leaves fully.
  let currentId = nextBlockInDocOrder(state, normalized.anchor.blockId);
  while (currentId && currentId !== normalized.focus.blockId) {
    const current = state.blocks.get(currentId);
    if (current && current.inlineContent) {
      yield {
        block: current,
        rangeStart: 0,
        rangeEnd: inlineContentLength(current.inlineContent),
      };
    }
    currentId = nextBlockInDocOrder(state, currentId);
  }

  // Focus block: from 0 to focus.offset.
  yield { block: focusBlock, rangeStart: 0, rangeEnd: normalized.focus.offset };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- span-iteration`
Expected: PASS (12 tests in `span-iteration.test.ts` — the original 5 normalizeSpan tests plus 7 iterateSpan tests including precondition errors).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/span-iteration.ts packages/core/src/state/span-iteration.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add iterateSpan

Yields per-leaf-block ranges for a span in document order. Single-block:
yields one range. Cross-block: yields anchor (from anchor.offset to end),
each intervening leaf fully, then focus (from 0 to focus.offset).
Container blocks are skipped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: span-iteration.ts — iterateBlocksInSpan

**Files:**
- Modify: `packages/core/src/state/span-iteration.ts`
- Modify: `packages/core/src/state/span-iteration.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `span-iteration.test.ts`:

```typescript
import { iterateBlocksInSpan } from "./span-iteration";

describe("iterateBlocksInSpan", () => {
  // doc > [section1 > [p1, p2], section2 > [p3]]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s1", lastChildId: "s2" }),
        buildBlock({ id: "s1", type: "section", parentId: "doc", nextSiblingId: "s2", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s1", nextSiblingId: "p2", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s1", prevSiblingId: "p1", inlineContent: createInlineContent([text("b")]) }),
        buildBlock({ id: "s2", type: "section", parentId: "doc", prevSiblingId: "s1", firstChildId: "p3", lastChildId: "p3" }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "s2", inlineContent: createInlineContent([text("c")]) }),
      ],
    });

  it("yields just the block when span is within a single block", () => {
    const state = fixture();
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p1" as BlockId, 1));
    const blocks = [...iterateBlocksInSpan(state, span)];
    expect(blocks.map((b) => b.id)).toEqual(["p1"]);
  });

  it("yields all blocks (leaves AND containers) overlapped by the span", () => {
    const state = fixture();
    // Span from p1 into p3 — passes through p2, s2 (container), p3.
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p3" as BlockId, 1));
    const blocks = [...iterateBlocksInSpan(state, span)];
    // Expected sequence in doc order: p1, p2, s2, p3.
    expect(blocks.map((b) => b.id)).toEqual(["p1", "p2", "s2", "p3"]);
  });

  it("normalizes the span before iterating", () => {
    const state = fixture();
    const span = createSpan(createPosition("p3" as BlockId, 1), createPosition("p1" as BlockId, 0));
    const blocks = [...iterateBlocksInSpan(state, span)];
    expect(blocks.map((b) => b.id)).toEqual(["p1", "p2", "s2", "p3"]);
  });

  it("yields just the single block for a collapsed span", () => {
    const state = fixture();
    const pos = createPosition("p1" as BlockId, 0);
    const span = createSpan(pos, pos);
    const blocks = [...iterateBlocksInSpan(state, span)];
    expect(blocks.map((b) => b.id)).toEqual(["p1"]);
  });

  it("supports container-block endpoints (anchor on a section, focus on a leaf)", () => {
    const state = fixture();
    // Selecting from s1 to p3 — used by 'wrap in section' / 'set page-break' style ops.
    const span = createSpan(createPosition("s1" as BlockId, 0), createPosition("p3" as BlockId, 0));
    const blocks = [...iterateBlocksInSpan(state, span)];
    // Doc-order from s1: s1, p1, p2, s2, p3.
    expect(blocks.map((b) => b.id)).toEqual(["s1", "p1", "p2", "s2", "p3"]);
  });

  it("yields a deeply-nested cross-subtree range", () => {
    // doc > [outer1 > [s1 > [p1, p2]], outer2 > [s2 > [p3]]]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "o1", lastChildId: "o2" }),
        buildBlock({ id: "o1", type: "section", parentId: "doc", nextSiblingId: "o2", firstChildId: "s1", lastChildId: "s1" }),
        buildBlock({ id: "s1", type: "section", parentId: "o1", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s1", nextSiblingId: "p2", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s1", prevSiblingId: "p1", inlineContent: createInlineContent([text("b")]) }),
        buildBlock({ id: "o2", type: "section", parentId: "doc", prevSiblingId: "o1", firstChildId: "s2", lastChildId: "s2" }),
        buildBlock({ id: "s2", type: "section", parentId: "o2", firstChildId: "p3", lastChildId: "p3" }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "s2", inlineContent: createInlineContent([text("c")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p3" as BlockId, 1));
    const blocks = [...iterateBlocksInSpan(state, span)];
    // p1, p2, o2, s2, p3 — note o2 (container) appears before its first child s2.
    expect(blocks.map((b) => b.id)).toEqual(["p1", "p2", "o2", "s2", "p3"]);
  });

  it("throws when anchor and focus are in different selection contexts", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
        buildBlock({ id: "fn", type: "footnote-body", inlineContent: createInlineContent([text("footnote")]) }),
      ],
    });
    const cross = createSpan(createPosition("p1" as BlockId, 0), createPosition("fn" as BlockId, 1));
    expect(() => [...iterateBlocksInSpan(state, cross)]).toThrow(/different selection contexts/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- span-iteration`
Expected: FAIL — `iterateBlocksInSpan` not exported.

- [ ] **Step 3: Add the function**

Append to `span-iteration.ts`:

```typescript
/**
 * Yield each block (leaf or container) overlapped by the span, in
 * document order. Used by block-level operations that need to see
 * containers (e.g., set page-break-before, wrap in section).
 *
 * Difference from iterateSpan: yields containers, no per-block range
 * (the consumer touches whole blocks). Endpoints MAY be containers —
 * unlike iterateSpan, container-block endpoints are valid here.
 *
 * Precondition: anchor and focus must be in the same selection context.
 * Throws otherwise. (Cross-context spans would walk to end-of-document
 * without ever reaching focus, silently producing the wrong block list.)
 *
 * The span is normalized first.
 */
export function* iterateBlocksInSpan(state: State, span: Span): Iterable<Block> {
  // Pre-normalize precondition checks (must validate before normalizeSpan
  // runs cross-block compare, which itself requires same-context).
  if (!state.blocks.has(span.anchor.blockId)) {
    throw new Error(`iterateBlocksInSpan: anchor block "${span.anchor.blockId}" not found`);
  }
  if (!state.blocks.has(span.focus.blockId)) {
    throw new Error(`iterateBlocksInSpan: focus block "${span.focus.blockId}" not found`);
  }
  const anchorCtx = selectionContextOf(state, span.anchor.blockId);
  const focusCtx = selectionContextOf(state, span.focus.blockId);
  if (anchorCtx !== focusCtx) {
    throw new Error(
      `iterateBlocksInSpan: anchor and focus are in different selection contexts ` +
      `("${anchorCtx}" vs "${focusCtx}")`,
    );
  }

  const normalized = normalizeSpan(state, span);

  const anchorBlock = state.blocks.get(normalized.anchor.blockId);
  if (!anchorBlock) throw new Error(`iterateBlocksInSpan: block "${normalized.anchor.blockId}" not found`);
  yield anchorBlock;

  if (normalized.anchor.blockId === normalized.focus.blockId) return;

  let currentId = nextBlockInDocOrder(state, normalized.anchor.blockId);
  while (currentId) {
    const current = state.blocks.get(currentId);
    if (current) yield current;
    if (currentId === normalized.focus.blockId) return;
    currentId = nextBlockInDocOrder(state, currentId);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- span-iteration`
Expected: PASS (19 tests in `span-iteration.test.ts` — the previous 12 plus 7 iterateBlocksInSpan tests including container endpoint, deeply-nested, and cross-context).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/span-iteration.ts packages/core/src/state/span-iteration.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add iterateBlocksInSpan

Yields each block (leaf or container) overlapped by the span, in
document order. Used by block-level operations that need to see
containers (e.g., set page-break-before, wrap in section).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: new-extract-text.ts — extractText

**Files:**
- Create: `packages/core/src/state/new-extract-text.ts`
- Test: `packages/core/src/state/new-extract-text.test.ts`

> Note: file is temporarily named `new-extract-text.ts` to avoid colliding with the existing `state/extract-text.ts` (the StateNode-based version still in use). Phase 14 cleanup renames it to `extract-text.ts` after the old file is deleted.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/new-extract-text.test.ts
import { describe, it, expect } from "vitest";
import { extractText } from "./new-extract-text";
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";

describe("extractText", () => {
  it("extracts text from a single text item, full range", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    expect(extractText(state, span)).toBe("hello");
  });

  it("extracts a partial range within a single text item", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 4));
    expect(extractText(state, span)).toBe("ell");
  });

  it("concatenates multiple text items in the same block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p", type: "paragraph", parentId: "doc",
          inlineContent: createInlineContent([text("hello"), text(" "), text("world")]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 11));
    expect(extractText(state, span)).toBe("hello world");
  });

  it("represents embed items as a single Object Replacement Character (U+FFFC)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p", type: "paragraph", parentId: "doc",
          inlineContent: createInlineContent([text("a"), embed("image"), text("b")]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
    expect(extractText(state, span)).toBe("a￼b");
  });

  it("joins multi-block spans with newlines", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 5));
    expect(extractText(state, span)).toBe("hello\nworld");
  });

  it("returns empty string for a collapsed span", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 2);
    const span = createSpan(pos, pos);
    expect(extractText(state, span)).toBe("");
  });

  it("emits a trailing newline when a multi-block span ends at offset 0 of the focus block", () => {
    // This locks in the Word/Google Docs convention for "select to start
    // of next paragraph" — the trailing \n represents the paragraph break.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 0));
    expect(extractText(state, span)).toBe("hello\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- new-extract-text`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/new-extract-text.ts
import type { State } from "./state";
import type { Span } from "./block-position";
import { iterateSpan } from "./span-iteration";

/** Object Replacement Character — represents an embed in extracted text. */
const EMBED_CHAR = "￼";

/**
 * Extract plain text from a span.
 *
 * Each leaf block contributes a substring of its inline-content items
 * over the per-block range. Embed items become a single OBJECT
 * REPLACEMENT CHARACTER (U+FFFC) — same convention as Apple TextKit.
 * Multi-block spans are joined with `\n` between blocks.
 *
 * Used by clipboard, find/replace, accessibility.
 */
export function extractText(state: State, span: Span): string {
  const parts: string[] = [];
  let isFirst = true;
  for (const { block, rangeStart, rangeEnd } of iterateSpan(state, span)) {
    if (!isFirst) parts.push("\n");
    isFirst = false;
    if (!block.inlineContent) continue;
    parts.push(extractTextFromBlock(block.inlineContent.items, rangeStart, rangeEnd));
  }
  return parts.join("");
}

function extractTextFromBlock(
  items: ReadonlyArray<import("./inline-content").InlineItem>,
  rangeStart: number,
  rangeEnd: number,
): string {
  if (rangeStart >= rangeEnd) return "";
  const out: string[] = [];
  let cursor = 0;
  for (const item of items) {
    if (cursor >= rangeEnd) break;
    const itemLen = item.kind === "text" ? item.text.length : 1;
    const itemStart = cursor;
    const itemEnd = cursor + itemLen;
    cursor = itemEnd;
    if (itemEnd <= rangeStart) continue;
    // Overlap: [max(itemStart, rangeStart), min(itemEnd, rangeEnd)] within this item.
    const subStart = Math.max(itemStart, rangeStart) - itemStart;
    const subEnd = Math.min(itemEnd, rangeEnd) - itemStart;
    if (item.kind === "text") {
      out.push(item.text.slice(subStart, subEnd));
    } else {
      // Embed item is one position; if any of [0,1) overlaps the range, include it.
      if (subStart < 1 && subEnd > 0) out.push(EMBED_CHAR);
    }
  }
  return out.join("");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- new-extract-text`
Expected: PASS (7 tests, including the trailing-newline lock-in).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/new-extract-text.ts packages/core/src/state/new-extract-text.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add extractText (new-extract-text.ts) for new state shape

Walks iterateSpan; per leaf block, extracts the substring of
inline-content items over the per-block range. Embed items become
U+FFFC OBJECT REPLACEMENT CHARACTER. Multi-block spans joined with
newlines. Temporary filename to avoid colliding with the existing
StateNode-based extract-text.ts; will be renamed in Phase 14 cleanup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Verify the whole package still builds and all tests pass

Green-build checkpoint for Phase 2. Phase 2 added 4 new files (plus their tests); changed nothing existing. Build and full test suite should remain green.

- [ ] **Step 1: Run the full type checker**

Run: `npm run build --workspace=packages/core`
Expected: PASS (no TypeScript errors).

If it fails, fix errors before continuing. Common issues:
- Import paths wrong (use `./block-traversal`, `./block-compare`, etc.)
- Missing exports from intermediate files

- [ ] **Step 2: Run the full test suite**

Run: `npm test --workspace=packages/core`
Expected: PASS — all existing tests still green AND all new tests added by this phase pass. Phase 2 adds approximately 56 new tests (19 block-traversal + 17 block-compare + 19 span-iteration + 7 new-extract-text). Total should be ~958 tests passing + 4 skipped, up from Phase 1's 902.

If existing tests fail, that means we accidentally modified something. Phase 2 is purely additive; nothing existing should break.

- [ ] **Step 3: Verify the new exports are not yet wired into the public API**

Run: `grep -E "(block-traversal|block-compare|span-iteration|new-extract-text)" packages/core/src/index.ts`
Expected: empty output. New utilities are not exported from the public API yet — that wiring lands in Phase 14 (cleanup) once the old types are removed.

---

## Task 13: Phase 2 retrospective + Phase 3 prep

This is a checkpoint task — no code changes, no commits unless something needs documenting. Verify Phase 2 landed correctly and capture anything for Phase 3.

- [ ] **Step 1: Verify the file inventory matches the plan**

Run: `ls packages/core/src/state/*.ts | sort | grep -E "(block-traversal|block-compare|span-iteration|new-extract-text)"`
Expected to see (4 source + 4 test):
- `block-compare.test.ts`, `block-compare.ts`
- `block-traversal.test.ts`, `block-traversal.ts`
- `new-extract-text.test.ts`, `new-extract-text.ts`
- `span-iteration.test.ts`, `span-iteration.ts`

- [ ] **Step 2: Verify the existing state files are untouched**

Run: `git log --since="$(git log -1 --format=%cd 4230343)" -- packages/core/src/state/state-node.ts packages/core/src/state/extract-text.ts packages/core/src/state/position.ts`
Expected: no commits since Phase 1 completion (commit `4230343` was the last Phase 1 commit). Phase 2 did not modify any existing state file.

- [ ] **Step 3: Verify the spec's "Definition of done" file inventory is on track**

Open `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md` and read the "Definition of done > File inventory" section. The Phase 1 + 2 deliverables are now:
- ✅ Layer 1: persistent-map, block-id, attrs, inline-content, block-position (temp), block, state, new-initial-state (temp)
- ✅ Layer 2: block-traversal, block-compare, span-iteration, new-extract-text (temp)

Phase 3 (next plan, written after this lands) will add: cascade attribute-interpreter pipeline. Phase 4 will add: Layer 3 operations (insert-text, delete-range, split-block, merge-blocks, apply-attrs). After that we begin breaking-change cutover (delete old state files, migrate consumers).

- [ ] **Step 4: Surface anything Phase 3 should account for**

Add notes to the spec's "Decisions log" or a new "Phase 1-2 implementation notes" section if the implementation uncovered anything that should inform Phase 3+ design. Examples to look for:
- Did any test fixture pattern emerge that should be added to `state-builders.ts` before Phase 3?
- Did TypeScript strict-mode flag any type-safety issues that suggest tightening the types?
- Are there any helpers you wrote inline that should be promoted to a shared utility (e.g., a "block-id assertion helper" if many tests cast strings)?
- Did the LCA-walk perform as expected on the test fixtures, or did anything feel awkward?

If yes, edit the spec to capture them; commit the edit:

```bash
git add docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md
git commit -m "$(cat <<'EOF'
docs(spec): notes from Phase 2 implementation for Phase 3+

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If no notes, skip the commit. Phase 2 is complete.

---

## Self-review

Quick checklist run after writing this plan:

**Spec coverage** (Phase 2 scope: Layer 2 utilities):
- ✅ `block-traversal.ts` (next/prev BlockInDocOrder, ancestorChain, first/last LeafBlock) — Tasks 1-4
- ✅ `block-compare.ts` (compareBlocksInDocOrder via LCA, comparePositions, selectionContextOf) — Tasks 5-7
- ✅ `span-iteration.ts` (normalizeSpan, iterateSpan, iterateBlocksInSpan) — Tasks 8-10
- ✅ `new-extract-text.ts` (extractText with newline joining + U+FFFC for embeds) — Task 11
- ✅ Green-build checkpoint — Task 12
- ✅ Retrospective — Task 13

**Placeholder scan:** No "TBD"/"TODO"/"add appropriate error handling" patterns. Each step has actual code or commands.

**Type consistency:** `BlockId`, `Block`, `State`, `Position`, `Span`, `BlockRange`, `InlineContent`, `InlineItem` are referenced consistently across tasks. Function signatures (`compareBlocksInDocOrder(state, idA, idB)`, `iterateSpan(state, span)`, etc.) are stable across the plan and match the spec's "Layered API surface > Layer 2" section.

**Out of scope for this plan (deferred):**
- Cascade attribute-interpreter pipeline (`cascade/attr-registry.ts`, register built-ins, update `cascade/cascade-pass.ts`). → Phase 3.
- Layer 3 state-mutating operations: `insert-text.ts`, `delete-range.ts`, `split-block.ts`, `merge-blocks.ts`, `apply-attrs.ts`, plus the operation barrel `operations.ts`. → Phase 4 (probably split into multiple sub-phases).
- Render module rewrite, components rewrite, editor migration, cursor adaptation, layout/styles cleanup, integration tests, perf benchmarks, cleanup commit (rename temp files), architecture doc updates. → Phases 5-N.

The Phase 2 plan above produces 4 new source files + tests, ~13 commits, and leaves the build green. Estimated execution time: 1 day for a developer following the plan (Layer 2 utilities are mostly mechanical translations of the spec's algorithms).

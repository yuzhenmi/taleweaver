# State module redesign — Phase 4c-3: mergeAdjacentBlocks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Layer 3 `mergeAdjacentBlocks` operation — the inverse of `splitBlockAtPosition`. Given two adjacent leaf siblings under the same parent, merge them by appending right's inline content to left's, deleting right from `state.blocks`, and rewiring the parent/sibling linked list. The left block keeps its `id`, `type`, `attrs`, `parentId`, and `prevSiblingId`. After merging, run-merge any newly-adjacent same-attrs text items at the seam. This is the core operation behind "press Backspace at start of paragraph 2 to merge into paragraph 1."

**Architecture:** Per `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`, "Layered API surface > Layer 3" line 344. Mirrors `splitBlockAtPosition` (Phase 4c-2) but inverted: instead of allocating a new block id, removes one. Mirrors the linked-list discipline from `insert-block.ts` and `split-block.ts`.

**Tech Stack:** TypeScript 5.7, vitest 3.0, npm workspaces.

**Spec reference:** `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`. Implements `mergeAdjacentBlocks` from "Layered API surface > Layer 3."

**Phase 1 - 4c-2 status (assumed complete):**
- Phase 1 — Layer 1 types. Last commit `4230343`.
- Phase 2 — Layer 2 utilities. Last commit `b27bffa`.
- Phase 3 — Cascade attribute interpreters. Last commit `413728a`.
- Phase 4a — Simple block-level operations + barrel. Last commit `cc2b249`.
- Phase 4b — `insertText`. Last commit `597bad1`.
- Phase 4c-1 — `applyAttrsToRange`. Last commit `107f39a`.
- Phase 4c-2 — `splitBlockAtPosition`. Last commit `e0dbb65`.
- Build green; 1089 tests passing + 4 skipped.

**Per-phase scope notes:**

- New files: `state/merge-blocks.ts` and `state/merge-blocks.test.ts`. Confirmed at plan-write time that NEITHER file exists.
- Modify: `state/operations.ts` (one new export line) and `state/operations.test.ts` (one new assertion). Authorized.
- **Critical implementer guard (per memory `feedback_implementer_create_collision.md`):** if any file the plan asks to CREATE already exists, the implementer must STOP and report `BLOCKED`; never silently refactor, rename, or consolidate. Verified by the controller before dispatch.
- Per CLAUDE.md: TDD throughout. Verify with both `npm test` AND `npm run build`.
- Type safety: no non-null assertions (`!`); use proper narrowing.
- **Test-builder dependencies (verified at plan-write time):** `text`, `embed`, `buildBlock`, `buildState` are exported from `packages/core/src/test-utils/state-builders.ts`. `createInlineContent` from `state/inline-content.ts`. No new builders required.
- **Shared helpers (use these — do NOT inline):** Phase 4c-2.5 cleanup extracted `mergeAdjacentTextItems` to `state/inline-content.ts` (commit `b61d901`) and the `updateBlock` block-mutator helper to `state/block.ts` (commit `2c2a95a`). This plan uses both as imports — no helper duplication.

**Why left wins (keeps id, type, attrs):** matches Word and Google Docs paragraph-identity semantics. Pressing Backspace at start of paragraph 2 merges into paragraph 1; paragraph 1 retains its formatting, comment anchors, and tracked-change anchors. Paragraph 2 is absorbed and ceases to exist as a distinct entity. Type/attrs differences (e.g., merging a heading into a paragraph) yield the LEFT block's type/attrs — the action handler is responsible for converting types ahead of the merge if a different policy is desired.

**Operation signature:**

```typescript
function mergeAdjacentBlocks(
  state: State,
  leftId: BlockId,
  rightId: BlockId,
): OperationResult;
```

Notes:
- No `IdAllocator` parameter — merging removes a block, never allocates one.
- Both blocks must reference existing leaf blocks (non-null `inlineContent` AND null `firstChildId`).
- Both blocks must share the same parent, AND must be adjacent in document order: `left.nextSiblingId === rightId` AND `right.prevSiblingId === leftId`. Both arms checked defensively.
- `leftId !== rightId` enforced.
- Same-selection-context is implicit in same-parent (siblings under one parent are trivially in the same context).
- After the merge:
  - The `left` block keeps its `id`, `type`, `attrs`, `parentId`, `prevSiblingId`. Its `nextSiblingId` is rewired from `rightId` to `right.nextSiblingId` (whatever was after the right block). Its `inlineContent` becomes `[...left.items, ...right.items]` followed by the run-merging post-pass.
  - The `right` block is REMOVED from `state.blocks` via `.delete(rightId)`.
  - If `right` had a `nextSibling` (i.e., right was not the last child of the parent), that next sibling's `prevSiblingId` is rewired from `rightId` to `leftId`.
  - If `right` was the parent's `lastChildId`, the parent's `lastChildId` is rewired to `leftId`.
- `firstChildId` of the parent never changes here — the original left was already in the chain, and the parent's first slot still points to the same block (or to whatever was first; left was either it or a later block).
- Throws on:
  - missing left or right block,
  - left and right being the same block,
  - left or right being a container (non-leaf — has `firstChildId !== null` OR `inlineContent === null`),
  - blocks having different parents,
  - blocks not being adjacent siblings (either arm of `left.nextSiblingId === rightId && right.prevSiblingId === leftId` failing).

**Run-merging post-pass:**

After concatenating `[...left.items, ...right.items]`, the same `mergeAdjacentTextItems` algorithm used in `insertText` and `applyAttrsToRange` runs as a post-pass. The seam between left and right may produce two adjacent text items with equal attrs (e.g., left ended with `text("hel", { bold: true })` and right started with `text("lo", { bold: true })` → merge to `text("hello", { bold: true })`). Embeds at the seam never merge with their neighbors regardless of attrs.

**dirtyIds contract:**

The returned `dirtyIds` set contains:
- The left block's id (its `inlineContent` and `nextSiblingId` changed).
- The right block's id (it was removed from `state.blocks`; per spec line 287, "every block id whose entry differs from the previous state").
- The right block's `nextSiblingId`, IF non-null (its `prevSiblingId` was rewired to `leftId`).
- The parent block's id, IF the right block was the parent's `lastChildId` (parent's `lastChildId` was rewired to `leftId`).

The parent is **not** dirtied when right was a middle child (parent's child pointers didn't change). Same write-time discipline as `splitBlockAtPosition` and stricter than `insertBlock`'s "always dirty parent" pattern.

---

## File structure (this phase)

**Created:**

| Path | Responsibility |
|---|---|
| `packages/core/src/state/merge-blocks.ts` | `mergeAdjacentBlocks(state, leftId, rightId) → OperationResult`. Imports `mergeAdjacentTextItems` from `inline-content.ts` and `updateBlock` from `block.ts`; does not inline either. |
| `packages/core/src/state/merge-blocks.test.ts` | Unit tests covering item-shapes/run-merging, linked-list correctness, block-level invariants, empty-block cases, and error cases. |

**Modified:**

| Path | Change |
|---|---|
| `packages/core/src/state/operations.ts` | Append `export { mergeAdjacentBlocks } from "./merge-blocks";` to the Phase 4c section. |
| `packages/core/src/state/operations.test.ts` | Add `expect(typeof ops.mergeAdjacentBlocks).toBe("function");` assertion (a new `it()` block). |

**Deleted:** none.

---

## Task 1: mergeAdjacentBlocks — create file with full implementation + sanity test

**Files:**
- Create: `packages/core/src/state/merge-blocks.ts`
- Create: `packages/core/src/state/merge-blocks.test.ts`

- [ ] **Step 1: Write the failing test (merge-blocks.test.ts)**

```typescript
import { describe, it, expect } from "vitest";
import { mergeAdjacentBlocks } from "./merge-blocks";
import { buildBlock, buildState, text } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("mergeAdjacentBlocks — basic merge of two adjacent leaf siblings", () => {
  // doc > [p1("hello"), p2(" world")]
  // After merge: doc > [p1("hello world")] (run-merged into one item since both have empty attrs)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });

  it("merges right into left, removes right, rewires the parent's lastChildId", () => {
    const state = fixture();
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);

    // Left (p1) keeps its id; inlineContent is the concatenation, run-merged into one item.
    const left = result.state.blocks.get("p1" as BlockId);
    expect(left).toBeDefined();
    expect(left?.id).toBe("p1");
    expect(left?.type).toBe("paragraph");
    expect(left?.parentId).toBe("doc");
    expect(left?.prevSiblingId).toBeNull();
    expect(left?.nextSiblingId).toBeNull(); // was "p2"; p2 had no nextSibling, so left.nextSiblingId is now null
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello world", attrs: {} });

    // Right (p2) is removed from state.blocks.
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    // Parent's lastChildId is rewired to p1 (was p2). firstChildId still p1.
    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1");
    expect(parent?.lastChildId).toBe("p1");

    // dirtyIds: { p1 (modified), p2 (removed), doc (lastChildId changed) }.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "doc"]));
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npm test --workspace=packages/core -- merge-blocks --run`
Expected: FAIL with module-not-found / `mergeAdjacentBlocks is not defined`.

- [ ] **Step 3: Write the production code (merge-blocks.ts)**

```typescript
import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import { createInlineContent, mergeAdjacentTextItems } from "./inline-content";
import { updateBlock } from "./block";

/**
 * Merge two adjacent leaf siblings into one block.
 *
 * Left wins: keeps id, type, attrs, parentId, prevSiblingId. Its
 * nextSiblingId is rewired to right.nextSiblingId. Its inlineContent
 * becomes [...left.items, ...right.items] with a run-merging post-pass
 * across the seam.
 *
 * Right is removed from state.blocks. If right had a nextSibling, that
 * sibling's prevSiblingId is rewired to leftId. If right was the parent's
 * lastChildId, the parent's lastChildId is rewired to leftId.
 *
 * Returns OperationResult with dirtyIds containing:
 *   - left's id (content + nextSiblingId changed)
 *   - right's id (removed from state.blocks)
 *   - right's old nextSibling, if non-null (its prevSiblingId was rewired)
 *   - parent's id, if right was the last child (parent's lastChildId rewired)
 *
 * Throws if:
 *   - either block does not exist,
 *   - leftId === rightId,
 *   - either block is a container (firstChildId !== null OR inlineContent === null),
 *   - blocks have different parents,
 *   - blocks are not adjacent siblings (left.nextSiblingId !== rightId
 *     OR right.prevSiblingId !== leftId).
 */
export function mergeAdjacentBlocks(
  state: State,
  leftId: BlockId,
  rightId: BlockId,
): OperationResult {
  if (leftId === rightId) {
    throw new Error(`mergeAdjacentBlocks: left and right are the same block "${leftId}"`);
  }

  const left = state.blocks.get(leftId);
  if (!left) {
    throw new Error(`mergeAdjacentBlocks: left block "${leftId}" not found`);
  }
  const right = state.blocks.get(rightId);
  if (!right) {
    throw new Error(`mergeAdjacentBlocks: right block "${rightId}" not found`);
  }

  if (!left.inlineContent || left.firstChildId !== null) {
    throw new Error(
      `mergeAdjacentBlocks: left block "${leftId}" is a container, not a leaf`,
    );
  }
  if (!right.inlineContent || right.firstChildId !== null) {
    throw new Error(
      `mergeAdjacentBlocks: right block "${rightId}" is a container, not a leaf`,
    );
  }

  if (left.parentId !== right.parentId) {
    throw new Error(
      `mergeAdjacentBlocks: blocks "${leftId}" and "${rightId}" have different parents ` +
      `("${left.parentId}" vs "${right.parentId}")`,
    );
  }

  if (left.nextSiblingId !== rightId || right.prevSiblingId !== leftId) {
    throw new Error(
      `mergeAdjacentBlocks: blocks "${leftId}" and "${rightId}" are not adjacent siblings ` +
      `(left.nextSiblingId="${left.nextSiblingId}", right.prevSiblingId="${right.prevSiblingId}")`,
    );
  }

  // Defensive — same-parent + adjacency implies non-null parent (siblings can't
  // both be the root, since the root is unique and has no siblings).
  if (left.parentId === null) {
    throw new Error(
      `mergeAdjacentBlocks: blocks "${leftId}" and "${rightId}" have null parent (state corruption)`,
    );
  }

  const mergedItems = mergeAdjacentTextItems([
    ...left.inlineContent.items,
    ...right.inlineContent.items,
  ]);

  const updatedLeft = updateBlock(left, {
    nextSiblingId: right.nextSiblingId,
    inlineContent: createInlineContent(mergedItems),
  });

  let blocks = state.blocks.set(leftId, updatedLeft).delete(rightId);
  const dirtyIds = new Set<BlockId>([leftId, rightId]);

  if (right.nextSiblingId) {
    const oldRightNext = state.blocks.get(right.nextSiblingId);
    if (!oldRightNext) {
      throw new Error(
        `mergeAdjacentBlocks: right's next sibling "${right.nextSiblingId}" not found`,
      );
    }
    blocks = blocks.set(right.nextSiblingId, updateBlock(oldRightNext, { prevSiblingId: leftId }));
    dirtyIds.add(right.nextSiblingId);
  } else {
    const parent = state.blocks.get(left.parentId);
    if (!parent) {
      throw new Error(
        `mergeAdjacentBlocks: parent "${left.parentId}" of merged blocks not found`,
      );
    }
    blocks = blocks.set(left.parentId, updateBlock(parent, { lastChildId: leftId }));
    dirtyIds.add(left.parentId);
  }

  return {
    state: { ...state, blocks },
    dirtyIds,
  };
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npm test --workspace=packages/core -- merge-blocks --run`
Expected: PASS (1 test).

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/merge-blocks.ts packages/core/src/state/merge-blocks.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add mergeAdjacentBlocks Layer 3 operation — basic case

Inverse of splitBlockAtPosition. Given two adjacent leaf siblings,
merges right into left: left keeps its id/type/attrs/parent/prev,
its inlineContent becomes [...left.items, ...right.items] with a
run-merging post-pass, and its nextSiblingId is rewired to
right.nextSiblingId. Right is removed from state.blocks. Linked-list
spliced; parent's lastChildId rewired when right was the last child.

First test covers the basic only-pair merge with run-merging across
the seam. Subsequent tasks add coverage for item shapes, linked-list
variants across positional cases, block-level invariants, empty-block
edge cases, and error cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Context

**Working directory:** `/Users/hansyu/code/taleweaver/`
**Branch:** `feature/dom-architecture-redesign` (commit directly here, no branch switching).

**Where this fits:** Phase 4c-3 task 1 of 7. Phase 4c-2 just shipped `splitBlockAtPosition`. This task starts the inverse Layer 3 operation: `mergeAdjacentBlocks`. The implementation handles all leaf-pair merge cases in one go (the merge logic is unified — concat + run-merge + relink); this task's test covers only the simplest case. Tasks 2-6 add coverage; Task 7 wires the barrel.

**Critical implementer guard:** if `state/merge-blocks.ts` OR `state/merge-blocks.test.ts` already exists, STOP and report `BLOCKED`. The plan asserts neither file exists.

**Important — verify with both `npm test` AND `npm run build`:** vitest is more permissive than tsc.

**Conventions:** TDD; HEREDOC commit message verbatim; auto-commit on user's behalf; vitest 3.0; no non-null assertions.

## Your Job

Execute steps 1-5 in order. After writing the production code, self-review for: (a) unused helpers / unused imports, (b) `!` non-null assertions (none allowed), (c) any drift from the spec or plan. Then commit and run final verification.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Test output AND build output
- Files changed (with commit SHA)
- Self-review findings

---

## Task 2: mergeAdjacentBlocks — item shapes + run-merging across the seam

**Files:**
- Modify: `packages/core/src/state/merge-blocks.test.ts` (append tests only)

- [ ] **Step 1: Append the item-shape tests**

```typescript
describe("mergeAdjacentBlocks — item shapes and run-merging across the seam", () => {
  it("merges left's last text item with right's first text item when they share attrs (run-merging)", () => {
    // doc > [p1[text("hel", {bold})], p2[text("lo", {bold})]]
    // After merge: p1.items = [text("hello", {bold})] (one item, run-merged across seam).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hel", { bold: true })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("lo", { bold: true })]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello", attrs: { bold: true } });
  });

  it("preserves both items at the seam when their attrs differ", () => {
    // doc > [p1[text("hel", {bold})], p2[text("lo", {italic})]]
    // After merge: p1.items = [text("hel", {bold}), text("lo", {italic})] (two items; no run-merge).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hel", { bold: true })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("lo", { italic: true })]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hel", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "lo", attrs: { italic: true } });
  });

  it("does NOT merge across an embed at the seam, even when text neighbors share attrs", () => {
    // doc > [p1[text("a", {bold}), embed("img")], p2[text("b", {bold})]]
    // The embed is a barrier — the text("a") on left and text("b") on right both have
    // {bold:true} attrs but they are separated by the embed, so no run-merge across.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("a", { bold: true }), embed("img")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("b", { bold: true })]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
  });

  it("concatenates multi-item left + multi-item right with seam-merging only between the touching items", () => {
    // doc > [p1[text("a"), text("b", {bold})], p2[text("c", {bold}), text("d")]]
    // Concat: [text("a"), text("b", {bold}), text("c", {bold}), text("d")]
    // Run-merge: items[1] and items[2] both {bold} → merge to text("bc", {bold}).
    // Final: [text("a"), text("bc", {bold}), text("d")]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("a"), text("b", { bold: true })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("c", { bold: true }), text("d")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "bc", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "d", attrs: {} });
  });
});
```

- [ ] **Step 2: Update import to include `embed`**

The test file's first import line (from Task 1) is:
```typescript
import { buildBlock, buildState, text } from "../test-utils/state-builders";
```
Update it to:
```typescript
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
```

- [ ] **Step 3-5: Run / build / commit**

Run: `npm test --workspace=packages/core -- merge-blocks --run` → PASS (5 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/merge-blocks.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover mergeAdjacentBlocks item shapes + seam run-merging

Four new tests:
- text items with same attrs at the seam → run-merge into one item.
- text items with different attrs at the seam → preserved as two items.
- embed at the seam acts as a barrier even when text neighbors share attrs.
- multi-item left + multi-item right with seam-merging only between
  the two touching items.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: mergeAdjacentBlocks — linked-list correctness across positional cases

**Files:**
- Modify: `packages/core/src/state/merge-blocks.test.ts` (append tests only)

- [ ] **Step 1: Append the linked-list tests**

```typescript
describe("mergeAdjacentBlocks — linked-list correctness across positional cases", () => {
  // doc > [p1, p2, p3, p4]
  const fourChildFixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p4" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("two")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", nextSiblingId: "p4", inlineContent: createInlineContent([text("three")]) }),
        buildBlock({ id: "p4", type: "paragraph", parentId: "doc", prevSiblingId: "p3", inlineContent: createInlineContent([text("four")]) }),
      ],
    });

  it("middle pair (p2 + p3): p2 keeps id; p4.prevSiblingId rewires to p2; parent unchanged", () => {
    const state = fourChildFixture();
    const result = mergeAdjacentBlocks(state, "p2" as BlockId, "p3" as BlockId);

    expect(result.state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p2"); // unchanged
    expect(result.state.blocks.get("p2" as BlockId)?.prevSiblingId).toBe("p1");
    expect(result.state.blocks.get("p2" as BlockId)?.nextSiblingId).toBe("p4"); // was "p3"; now skips
    expect(result.state.blocks.get("p4" as BlockId)?.prevSiblingId).toBe("p2"); // was "p3"; rewired
    expect(result.state.blocks.has("p3" as BlockId)).toBe(false); // removed

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1"); // unchanged
    expect(parent?.lastChildId).toBe("p4"); // unchanged

    // dirtyIds: p2 (modified), p3 (removed), p4 (prevSiblingId rewired). Parent NOT dirty.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p2", "p3", "p4"]));
  });

  it("first pair (p1 + p2): p1 keeps id; firstChildId stays p1; p3.prevSiblingId rewires to p1", () => {
    const state = fourChildFixture();
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);

    expect(result.state.blocks.get("p1" as BlockId)?.prevSiblingId).toBeNull(); // unchanged
    expect(result.state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p3"); // was p2
    expect(result.state.blocks.get("p3" as BlockId)?.prevSiblingId).toBe("p1"); // was p2
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1"); // unchanged (left wins, kept id)
    expect(parent?.lastChildId).toBe("p4"); // unchanged

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3"]));
  });

  it("last pair (p3 + p4): p3 keeps id; parent's lastChildId rewires from p4 to p3", () => {
    const state = fourChildFixture();
    const result = mergeAdjacentBlocks(state, "p3" as BlockId, "p4" as BlockId);

    expect(result.state.blocks.get("p3" as BlockId)?.prevSiblingId).toBe("p2");
    expect(result.state.blocks.get("p3" as BlockId)?.nextSiblingId).toBeNull(); // was p4; now last child
    expect(result.state.blocks.has("p4" as BlockId)).toBe(false);

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1");
    expect(parent?.lastChildId).toBe("p3"); // rewired from p4

    // dirtyIds: p3 (modified), p4 (removed), doc (lastChildId rewired).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p3", "p4", "doc"]));
  });

  it("nested-block pair: doc > section > [p1, p2] → merging uses the immediate container as parent", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);

    // Section's lastChildId rewires; doc untouched.
    const section = result.state.blocks.get("section" as BlockId);
    expect(section?.firstChildId).toBe("p1");
    expect(section?.lastChildId).toBe("p1");

    const doc = result.state.blocks.get("doc" as BlockId);
    expect(doc?.firstChildId).toBe("section");
    expect(doc?.lastChildId).toBe("section");

    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    // dirtyIds: p1, p2, section. doc NOT dirty.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "section"]));
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- merge-blocks --run` → PASS (9 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/merge-blocks.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover mergeAdjacentBlocks linked-list variants

Four new tests verifying sibling-pointer + parent-childpointer updates
across positional cases:
- middle pair (parent unchanged, only siblings rewired).
- first pair (firstChildId still points to surviving left).
- last pair (parent's lastChildId rewires to surviving left).
- nested-block pair (uses immediate container as parent, not document
  root; doc untouched).

dirtyIds asserted in each case: parent appears in dirtyIds only when
its lastChildId actually changed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: mergeAdjacentBlocks — block-level invariants (left wins; structural sharing; immutability)

**Files:**
- Modify: `packages/core/src/state/merge-blocks.test.ts` (append tests only)

- [ ] **Step 1: Append the invariant tests**

```typescript
describe("mergeAdjacentBlocks — block-level invariants", () => {
  it("left wins type when blocks have different types", () => {
    // doc > [p (paragraph), h (heading)] → merge p + h → result keeps p's type "paragraph".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "h" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "h", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "h", type: "heading", parentId: "doc", prevSiblingId: "p", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p" as BlockId, "h" as BlockId);
    expect(result.state.blocks.get("p" as BlockId)?.type).toBe("paragraph");
  });

  it("left wins attrs when blocks have different attrs", () => {
    // doc > [li1 { level: 2 }, li2 { level: 3 }] → result keeps { level: 2 }.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li1", lastChildId: "li2" }),
        buildBlock({ id: "li1", type: "list-item", attrs: { level: 2 }, parentId: "doc", nextSiblingId: "li2", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "li2", type: "list-item", attrs: { level: 3 }, parentId: "doc", prevSiblingId: "li1", inlineContent: createInlineContent([text("b")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "li1" as BlockId, "li2" as BlockId);
    expect(result.state.blocks.get("li1" as BlockId)?.attrs).toEqual({ level: 2 });
  });

  it("preserves embed-referenced contents in right's inline content (no cascade-delete)", () => {
    // doc > [p1[], p2[embed("footnote", { contentBlockId: "fn-body" })]] + standalone fn-body block.
    // Merging p1 + p2 must NOT delete fn-body — the embed reference is still alive in the merged content.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("see")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([embed("footnote-anchor", { contentBlockId: "fn-body" })]) }),
        buildBlock({ id: "fn-body", type: "footnote-body", inlineContent: createInlineContent([text("footnote text")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    // fn-body must still exist.
    expect(result.state.blocks.has("fn-body" as BlockId)).toBe(true);
    // The merged inline content carries the embed reference.
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "see" });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "footnote-anchor", properties: { contentBlockId: "fn-body" } });
  });

  it("preserves structural sharing: blocks NOT touched by the merge retain object identity", () => {
    // doc > [p0, p1, p2, p3] — merge p1 + p2; p0 and p3 untouched (p3 is touched: prev rewired).
    // Actually p3 IS touched (prevSiblingId rewires). So only p0 has untouched identity.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p3" }),
        buildBlock({ id: "p0", type: "paragraph", parentId: "doc", nextSiblingId: "p1", inlineContent: createInlineContent([text("zero")]) }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", prevSiblingId: "p0", nextSiblingId: "p2", inlineContent: createInlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("two")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("three")]) }),
      ],
    });
    const beforeP0 = state.blocks.get("p0" as BlockId);
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    expect(result.state.blocks.get("p0" as BlockId)).toBe(beforeP0);
  });

  it("does not mutate the original state", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);

    expect(result.state).not.toBe(state);
    // Original state still has p2 and p1's nextSibling pointing to p2.
    expect(state.blocks.has("p2" as BlockId)).toBe(true);
    expect(state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p2");
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- merge-blocks --run` → PASS (14 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/merge-blocks.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover mergeAdjacentBlocks block-level invariants

Five new tests:
- left wins type when blocks have different types.
- left wins attrs when blocks have different attrs.
- embed-referenced content blocks (footnote bodies) survive the merge —
  no cascade-delete; the embed reference is preserved in the merged
  inline content.
- structural sharing: blocks NOT touched by the merge retain object
  identity in the result state.
- the original state is not mutated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: mergeAdjacentBlocks — empty-block edge cases

**Files:**
- Modify: `packages/core/src/state/merge-blocks.test.ts` (append tests only)

- [ ] **Step 1: Append the empty-block tests**

```typescript
describe("mergeAdjacentBlocks — empty-block edge cases", () => {
  it("left empty + right with content: result has right's content under left's id", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello" });
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
  });

  it("left with content + right empty: result has left's content unchanged", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello" });
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
  });

  it("both empty: result is one empty block under left's id", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toEqual([]);
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- merge-blocks --run` → PASS (17 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/merge-blocks.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover mergeAdjacentBlocks empty-block edges

Three new tests:
- left empty + right with content (Backspace at end-of-empty-line scenario).
- left with content + right empty (forward-delete-at-end scenario).
- both empty (collapses to one empty block).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: mergeAdjacentBlocks — error cases

**Files:**
- Modify: `packages/core/src/state/merge-blocks.test.ts` (append tests only)

- [ ] **Step 1: Append the error-case tests**

```typescript
describe("mergeAdjacentBlocks — error cases", () => {
  // Common fixture: two adjacent leaves under doc.
  const adjacentFixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("b")]) }),
      ],
    });

  it("throws when leftId === rightId (cannot merge a block with itself)", () => {
    const state = adjacentFixture();
    expect(() =>
      mergeAdjacentBlocks(state, "p1" as BlockId, "p1" as BlockId),
    ).toThrow(/same block/);
  });

  it("throws when the left block does not exist", () => {
    const state = adjacentFixture();
    expect(() =>
      mergeAdjacentBlocks(state, "missing" as BlockId, "p2" as BlockId),
    ).toThrow(/left block ".+" not found/);
  });

  it("throws when the right block does not exist", () => {
    const state = adjacentFixture();
    expect(() =>
      mergeAdjacentBlocks(state, "p1" as BlockId, "missing" as BlockId),
    ).toThrow(/right block ".+" not found/);
  });

  it("throws when the left block is a container (firstChildId set)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "p" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", nextSiblingId: "p", firstChildId: "inner", lastChildId: "inner" }),
        buildBlock({ id: "inner", type: "paragraph", parentId: "s", inlineContent: createInlineContent([text("inside")]) }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "s", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "s" as BlockId, "p" as BlockId),
    ).toThrow(/left block ".+" is a container/);
  });

  it("throws when the left block has null inlineContent (independent of firstChildId)", () => {
    // Pin the inlineContent === null arm of the left container guard so a future
    // regression that drops it (|| → &&) is caught.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "p" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", nextSiblingId: "p" }), // null inlineContent AND null firstChildId
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "s", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "s" as BlockId, "p" as BlockId),
    ).toThrow(/left block ".+" is a container/);
  });

  it("throws when the right block is a container (firstChildId set)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "s" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "s", inlineContent: createInlineContent([text("hi")]) }),
        buildBlock({ id: "s", type: "section", parentId: "doc", prevSiblingId: "p", firstChildId: "inner", lastChildId: "inner" }),
        buildBlock({ id: "inner", type: "paragraph", parentId: "s", inlineContent: createInlineContent([text("inside")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "p" as BlockId, "s" as BlockId),
    ).toThrow(/right block ".+" is a container/);
  });

  it("throws when the right block has null inlineContent (independent of firstChildId)", () => {
    // Pin the inlineContent === null arm of the right container guard.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "s" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "s", inlineContent: createInlineContent([text("hi")]) }),
        buildBlock({ id: "s", type: "section", parentId: "doc", prevSiblingId: "p" }), // null inlineContent AND null firstChildId
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "p" as BlockId, "s" as BlockId),
    ).toThrow(/right block ".+" is a container/);
  });

  it("throws when blocks have different parents", () => {
    // doc > [section1[p_a], section2[p_b]] — p_a and p_b are leaves but parented under different sections.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section1", lastChildId: "section2" }),
        buildBlock({ id: "section1", type: "section", parentId: "doc", nextSiblingId: "section2", firstChildId: "p_a", lastChildId: "p_a" }),
        buildBlock({ id: "p_a", type: "paragraph", parentId: "section1", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "section2", type: "section", parentId: "doc", prevSiblingId: "section1", firstChildId: "p_b", lastChildId: "p_b" }),
        buildBlock({ id: "p_b", type: "paragraph", parentId: "section2", inlineContent: createInlineContent([text("b")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "p_a" as BlockId, "p_b" as BlockId),
    ).toThrow(/different parents/);
  });

  it("throws when left.nextSiblingId !== rightId (non-adjacent — adjacency arm A)", () => {
    // doc > [p1, p2, p3] — try to merge p1 and p3 (skipping p2).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("b")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("c")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "p1" as BlockId, "p3" as BlockId),
    ).toThrow(/not adjacent siblings/);
  });

  it("throws when right.prevSiblingId !== leftId (malformed adjacency — adjacency arm B)", () => {
    // doc > [p1, p2] — left.nextSiblingId === "p2" (correct) but right.prevSiblingId is fabricated as null
    // to simulate a malformed-state case where the bidirectional invariant is broken.
    // The guard's second arm catches this; pinning it prevents a future regression that drops the AND.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: null, inlineContent: createInlineContent([text("b")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId),
    ).toThrow(/not adjacent siblings/);
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- merge-blocks --run` → PASS (27 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/merge-blocks.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover mergeAdjacentBlocks error cases

Ten new tests verifying the implementation throws on:
- leftId === rightId.
- missing left block.
- missing right block.
- left container via firstChildId set.
- left container via null inlineContent (pins the inlineContent === null
  arm of the OR so a future || → && regression is caught).
- right container via firstChildId set.
- right container via null inlineContent (same arm-pinning rationale).
- different parents.
- non-adjacent — left.nextSiblingId !== rightId (adjacency arm A).
- malformed adjacency — right.prevSiblingId !== leftId (adjacency arm B,
  pins the AND of the bidirectional check).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update operations barrel + verification

**Files:**
- Modify: `packages/core/src/state/operations.ts`
- Modify: `packages/core/src/state/operations.test.ts`

- [ ] **Step 1: Append export to operations.ts**

After the existing Phase 4c-2 export line `export { splitBlockAtPosition } from "./split-block";`, add a new "Phase 4c-3 operations" section:

```typescript
// Phase 4c-2 operations (block split)
export { splitBlockAtPosition } from "./split-block";

// Phase 4c-3 operations (block merge)
export { mergeAdjacentBlocks } from "./merge-blocks";
```

- [ ] **Step 2: Append assertion to operations.test.ts**

Inside the existing `describe("operations barrel", ...)` block, add a new `it()`:

```typescript
  it("re-exports Phase 4c-3 operations", () => {
    expect(typeof ops.mergeAdjacentBlocks).toBe("function");
  });
```

- [ ] **Step 3: Run tests + build**

Run: `npm test --workspace=packages/core -- "src/state/operations.test" --run` → PASS (5 tests in `operations.test.ts`).
Run: `npm test --workspace=packages/core --run` → all green; total **1117 + 4 skipped** (was 1089 + 4 after Phase 4c-2; this phase adds 27 new tests in `merge-blocks.test.ts` + 1 new assertion in `operations.test.ts` = 28).
Run: `npm run build --workspace=packages/core` → clean.

- [ ] **Step 4: Verify public API not yet wired**

Run: `grep -E "(merge-blocks)" packages/core/src/index.ts`
Expected: empty output. Phase 14 cleanup wires the public API.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/operations.ts packages/core/src/state/operations.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add mergeAdjacentBlocks to operations barrel

Phase 4c-3 operation mergeAdjacentBlocks is now accessible via the
operations barrel alongside Phase 4a's block-level operations,
Phase 4b's insertText, Phase 4c-1's applyAttrsToRange, and Phase 4c-2's
splitBlockAtPosition.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Phase 4c-4 prep**

If anything came up during Phase 4c-3 that should inform Phase 4c-4 (`deleteRange`), add notes to the spec or memory. Otherwise skip.

---

## Self-review

**Spec coverage** (Phase 4c-3 scope: mergeAdjacentBlocks):
- ✅ Core operation: merge two adjacent leaf siblings — Task 1
- ✅ Item shapes + run-merging across the seam (same-attrs, different-attrs, embed barrier, multi-item) — Task 2
- ✅ Linked-list correctness (middle pair, first pair, last pair, nested) — Task 3
- ✅ Block-level invariants (left wins type/attrs, embed-content survival, structural sharing, immutability) — Task 4
- ✅ Empty-block edge cases (left empty, right empty, both empty) — Task 5
- ✅ Error cases (10 tests pinning all guard arms including container `||` arms and adjacency `&&` arms) — Task 6
- ✅ Operations barrel update — Task 7

**Placeholder scan:** No "TBD"/"TODO" patterns. The `mergeAdjacentTextItems` helper duplicated from `insert-text.ts` and `apply-attrs.ts` is acknowledged as a known DRY concern in the per-phase scope notes, with the cleanup explicitly deferred to Phase 14.

**Type consistency:** `OperationResult`, `BlockId`, `Block`, `InlineItem`, `TextItem`, `ReadonlyAttrs` referenced consistently. `attrsEqual` from `attrs.ts`. `createTextItem`/`createInlineContent` from `inline-content.ts`.

**Out of scope (deferred):**
- `deleteRange` → Phase 4c-4
- `replaceRange` → Phase 4c-5
- `clonePastedSubtree` → Phase 4d
- "Merge across containers" semantics (e.g., merging the last paragraph of one section into the first of the next) → editor-level concern; not a state primitive
- Public API wiring → Phase 14

The Phase 4c-3 plan above produces 1 new source file + tests, ~7 commits, leaves the build green throughout. Estimated execution time: half a day.

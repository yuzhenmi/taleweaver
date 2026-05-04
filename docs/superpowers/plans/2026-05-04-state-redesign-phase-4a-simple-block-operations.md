# State module redesign — Phase 4a: simple block-level operations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four simplest Layer 3 state-mutating operations: `setBlockAttrs`, `setBlockType`, `insertBlock`, `removeBlock`. These operate at the block level — they change one block's attrs/type, or splice a block into/out of the linked-list children of its parent. They do NOT modify inline content (Phase 4b) or perform cross-block structural surgery (Phase 4c). Phase 4a establishes the `OperationResult` contract end-to-end and the `state/operations.ts` barrel that subsequent phases extend.

**Architecture:** Per `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`, "Layered API surface > Layer 3" + "Dirty-set contract" sections. Every operation returns `OperationResult = { state: State, dirtyIds: ReadonlySet<BlockId> }`. `dirtyIds` is produced at write-time, recording every block whose entry in `state.blocks` changed. The rendering pipeline consumes `dirtyIds` directly to know what to re-render.

**Tech Stack:** TypeScript 5.7, vitest 3.0, npm workspaces. Test runner: `npm test --workspace=packages/core`. Type checker: `npm run build --workspace=packages/core`.

**Spec reference:** `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`. This plan implements four of the operations listed in "Layered API surface > Layer 3."

**Phase 1 + 2 + 3 status (assumed complete):**
- Phase 1 — Layer 1 types in `packages/core/src/state/`. Last commit `4230343`.
- Phase 2 — Layer 2 utilities + hardening. Last commit `b27bffa`.
- Phase 3 — Cascade attribute interpreters in `packages/core/src/cascade/`. Last commit `413728a`.
- Build green; 990 tests passing + 4 skipped.

**Per-phase scope notes:**

- New files at top-level paths in `packages/core/src/state/`. No name collisions: `set-block-attrs.ts`, `set-block-type.ts`, `insert-block.ts`, `remove-block.ts`, `operations.ts` (barrel). None of these names collide with existing files in `state/`.
- Per CLAUDE.md: TDD throughout. Write tests first, see them fail, implement, see them pass, commit. Verify with both `npm test` AND `npm run build` (vitest is more permissive than tsc).
- Per memory `feedback_no_auto_commit.md`: commit on user's behalf at the end of each task.
- Type safety: no non-null assertions (`!`); use proper narrowing.
- Phase 4a does NOT implement embed cascade-delete in `removeBlock` (deferred to a later phase when `state.embedContents` lands). A TODO comment is added in the implementation pointing forward. Today, no code creates embed-referenced blocks, so no orphaning happens in practice.

**Operation signatures (all return `OperationResult`):**

```typescript
function setBlockAttrs(state: State, blockId: BlockId, attrs: ReadonlyAttrs): OperationResult;
function setBlockType(state: State, blockId: BlockId, type: string): OperationResult;
function insertBlock(
  state: State,
  parentId: BlockId,
  beforeSiblingId: BlockId | null,   // null = append as last child
  args: { type: string; attrs?: ReadonlyAttrs; inlineContent?: InlineContent | null },
  allocator: IdAllocator,
): OperationResult;
function removeBlock(state: State, blockId: BlockId): OperationResult;
```

Notes:
- `insertBlock`'s `beforeSiblingId` follows DOM `insertBefore(node, ref)` semantics: insert immediately before `beforeSiblingId`; if null, append at end. The new block's id comes from the allocator.
- `setBlockAttrs` replaces the attrs bag entirely. To merge with existing attrs, the caller composes `{ ...block.attrs, ...newPartial }` first.
- `removeBlock` rejects an attempt to remove the document root.

---

## File structure (this phase)

**Created:**

| Path | Responsibility |
|---|---|
| `packages/core/src/state/set-block-attrs.ts` | `setBlockAttrs(state, blockId, attrs) → OperationResult` |
| `packages/core/src/state/set-block-attrs.test.ts` | Unit tests for setBlockAttrs. |
| `packages/core/src/state/set-block-type.ts` | `setBlockType(state, blockId, type) → OperationResult` |
| `packages/core/src/state/set-block-type.test.ts` | Unit tests for setBlockType. |
| `packages/core/src/state/insert-block.ts` | `insertBlock(state, parentId, beforeSiblingId, args, allocator) → OperationResult` |
| `packages/core/src/state/insert-block.test.ts` | Unit tests for insertBlock with all 4 sibling-position cases + error cases. |
| `packages/core/src/state/remove-block.ts` | `removeBlock(state, blockId) → OperationResult` |
| `packages/core/src/state/remove-block.test.ts` | Unit tests for removeBlock with all sibling-position cases + error cases. |
| `packages/core/src/state/operations.ts` | Barrel re-exporting all Layer 3 operations. Phase 4a populates with the four block-level ops; subsequent phases append. |

**Modified:** none (Phase 4a is purely additive).

**Deleted:** none.

---

## Task 1: setBlockAttrs

**Files:**
- Create: `packages/core/src/state/set-block-attrs.ts`
- Test: `packages/core/src/state/set-block-attrs.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/set-block-attrs.test.ts
import { describe, it, expect } from "vitest";
import { setBlockAttrs } from "./set-block-attrs";
import { buildBlock, buildState } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("setBlockAttrs", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", attrs: { textAlign: "left" }, inlineContent: createInlineContent([]) }),
      ],
    });

  it("replaces the block's attrs and returns the updated block", () => {
    const state = fixture();
    const result = setBlockAttrs(state, "p" as BlockId, { textAlign: "right", marginTop: "1em" });
    const updated = result.state.blocks.get("p" as BlockId);
    expect(updated?.attrs).toEqual({ textAlign: "right", marginTop: "1em" });
    // Block-shape invariants preserved:
    expect(updated?.id).toBe("p");
    expect(updated?.type).toBe("paragraph");
    expect(updated?.parentId).toBe("doc");
  });

  it("returns dirtyIds containing only the modified block", () => {
    const state = fixture();
    const result = setBlockAttrs(state, "p" as BlockId, { textAlign: "right" });
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  it("does not modify the original state (immutability)", () => {
    const state = fixture();
    setBlockAttrs(state, "p" as BlockId, { textAlign: "right" });
    expect(state.blocks.get("p" as BlockId)?.attrs).toEqual({ textAlign: "left" });
  });

  it("throws when the block does not exist", () => {
    const state = fixture();
    expect(() => setBlockAttrs(state, "missing" as BlockId, {})).toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- set-block-attrs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/set-block-attrs.ts
import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import { createBlock } from "./block";

/**
 * Replace a block's attrs with the given bag. Returns the new state and
 * a dirtyIds set containing the modified block id.
 *
 * `attrs` replaces wholesale — to merge with existing attrs, compose
 * `{ ...block.attrs, ...newPartial }` at the call site.
 *
 * Throws if the block does not exist.
 */
export function setBlockAttrs(
  state: State,
  blockId: BlockId,
  attrs: ReadonlyAttrs,
): OperationResult {
  const block = state.blocks.get(blockId);
  if (!block) {
    throw new Error(`setBlockAttrs: block "${blockId}" not found`);
  }
  const updated = createBlock({
    id: block.id,
    type: block.type,
    attrs,
    parentId: block.parentId,
    prevSiblingId: block.prevSiblingId,
    nextSiblingId: block.nextSiblingId,
    firstChildId: block.firstChildId,
    lastChildId: block.lastChildId,
    inlineContent: block.inlineContent,
  });
  return {
    state: { ...state, blocks: state.blocks.set(blockId, updated) },
    dirtyIds: new Set([blockId]),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- set-block-attrs`
Expected: PASS (4 tests).

- [ ] **Step 4b: Run the full type checker (REQUIRED)**

Run: `npm run build --workspace=packages/core`
Expected: clean (no TypeScript errors).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/set-block-attrs.ts packages/core/src/state/set-block-attrs.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add setBlockAttrs Layer 3 operation

Replaces a block's attrs bag wholesale. Returns OperationResult with
dirtyIds = { blockId }. Phase 4a of state-model redesign — the first
of four simple block-level Layer 3 operations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: setBlockType

**Files:**
- Create: `packages/core/src/state/set-block-type.ts`
- Test: `packages/core/src/state/set-block-type.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/set-block-type.test.ts
import { describe, it, expect } from "vitest";
import { setBlockType } from "./set-block-type";
import { buildBlock, buildState } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("setBlockType", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([]) }),
      ],
    });

  it("replaces the block's type and preserves all other fields", () => {
    const state = fixture();
    const result = setBlockType(state, "p" as BlockId, "heading");
    const updated = result.state.blocks.get("p" as BlockId);
    expect(updated?.type).toBe("heading");
    expect(updated?.id).toBe("p");
    expect(updated?.parentId).toBe("doc");
    expect(updated?.inlineContent).toEqual({ items: [] });
  });

  it("returns dirtyIds containing only the modified block", () => {
    const state = fixture();
    const result = setBlockType(state, "p" as BlockId, "heading");
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  it("throws when the block does not exist", () => {
    const state = fixture();
    expect(() => setBlockType(state, "missing" as BlockId, "heading")).toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- set-block-type`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/set-block-type.ts
import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import { createBlock } from "./block";

/**
 * Change a block's type. Returns the new state and a dirtyIds set
 * containing the modified block id. All other fields preserved.
 *
 * Throws if the block does not exist.
 *
 * Note: changing type from container to leaf (or vice versa) is allowed
 * but the caller is responsible for ensuring the block's children
 * (firstChildId/lastChildId) and inlineContent fields make sense for
 * the new type. This operation just updates the type tag.
 */
export function setBlockType(
  state: State,
  blockId: BlockId,
  type: string,
): OperationResult {
  const block = state.blocks.get(blockId);
  if (!block) {
    throw new Error(`setBlockType: block "${blockId}" not found`);
  }
  const updated = createBlock({
    id: block.id,
    type,
    attrs: block.attrs,
    parentId: block.parentId,
    prevSiblingId: block.prevSiblingId,
    nextSiblingId: block.nextSiblingId,
    firstChildId: block.firstChildId,
    lastChildId: block.lastChildId,
    inlineContent: block.inlineContent,
  });
  return {
    state: { ...state, blocks: state.blocks.set(blockId, updated) },
    dirtyIds: new Set([blockId]),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- set-block-type`
Expected: PASS (3 tests).

- [ ] **Step 4b: Type check**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/set-block-type.ts packages/core/src/state/set-block-type.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add setBlockType Layer 3 operation

Replaces a block's type tag; preserves all other fields. Returns
OperationResult with dirtyIds = { blockId }. Caller is responsible
for ensuring children/inlineContent fields make sense for the new
type if the operation crosses container/leaf boundary.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: insertBlock — basic case (between siblings)

**Files:**
- Create: `packages/core/src/state/insert-block.ts`
- Test: `packages/core/src/state/insert-block.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/insert-block.test.ts
import { describe, it, expect } from "vitest";
import { insertBlock } from "./insert-block";
import { buildBlock, buildState } from "../test-utils/state-builders";
import { createTestAllocator } from "./block-id";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("insertBlock — between siblings", () => {
  // doc > [p1, p2]  →  doc > [p1, NEW, p2]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });

  it("inserts a new block between two siblings, splicing the linked list", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlock(
      state,
      "doc" as BlockId,
      "p2" as BlockId,
      { type: "paragraph", inlineContent: createInlineContent([]) },
      allocator,
    );
    const newId = "new-0" as BlockId;

    // New block exists with correct linkage:
    const newBlock = result.state.blocks.get(newId);
    expect(newBlock).toBeDefined();
    expect(newBlock?.type).toBe("paragraph");
    expect(newBlock?.parentId).toBe("doc");
    expect(newBlock?.prevSiblingId).toBe("p1");
    expect(newBlock?.nextSiblingId).toBe("p2");

    // p1's nextSiblingId now points to the new block:
    expect(result.state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe(newId);

    // p2's prevSiblingId now points to the new block:
    expect(result.state.blocks.get("p2" as BlockId)?.prevSiblingId).toBe(newId);

    // doc's firstChildId / lastChildId unchanged (still p1 / p2):
    expect(result.state.blocks.get("doc" as BlockId)?.firstChildId).toBe("p1");
    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p2");
  });

  it("returns dirtyIds for new block + parent + both adjacent siblings", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlock(
      state,
      "doc" as BlockId,
      "p2" as BlockId,
      { type: "paragraph" },
      allocator,
    );
    // Expected dirty: new block, doc (parent — its firstChild/lastChild may or may not have changed but parent was inspected/updated), p1 (nextSibling rewired), p2 (prevSibling rewired).
    // Note: when inserting between siblings, doc's first/lastChildId stay the same so dirtying it is conservative but correct.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["new-0", "doc", "p1", "p2"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- insert-block`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/insert-block.ts
import type { State, OperationResult } from "./state";
import type { BlockId, IdAllocator } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import type { InlineContent } from "./inline-content";
import { createBlock, type Block } from "./block";

export interface InsertBlockArgs {
  type: string;
  attrs?: ReadonlyAttrs;
  inlineContent?: InlineContent | null;
}

/**
 * Insert a new block as a child of `parentId`, immediately before
 * `beforeSiblingId`. If `beforeSiblingId` is null, the new block is
 * appended as the new last child.
 *
 * Returns OperationResult with the new state and dirtyIds containing:
 *   - the new block's id
 *   - the parent's id (firstChild/lastChild may have changed)
 *   - the previous sibling's id (its nextSiblingId is rewired)
 *   - the next sibling's id (its prevSiblingId is rewired)
 *
 * Throws if `parentId` does not exist, or if `beforeSiblingId` is
 * non-null and is not actually a child of `parentId`.
 */
export function insertBlock(
  state: State,
  parentId: BlockId,
  beforeSiblingId: BlockId | null,
  args: InsertBlockArgs,
  allocator: IdAllocator,
): OperationResult {
  const parent = state.blocks.get(parentId);
  if (!parent) {
    throw new Error(`insertBlock: parent "${parentId}" not found`);
  }

  // Determine prev / next siblings.
  let prevSiblingId: BlockId | null;
  let nextSiblingId: BlockId | null;

  if (beforeSiblingId === null) {
    // Append: new block becomes lastChild; prev = current lastChild; next = null.
    prevSiblingId = parent.lastChildId;
    nextSiblingId = null;
  } else {
    const beforeSibling = state.blocks.get(beforeSiblingId);
    if (!beforeSibling) {
      throw new Error(`insertBlock: beforeSibling "${beforeSiblingId}" not found`);
    }
    if (beforeSibling.parentId !== parentId) {
      throw new Error(
        `insertBlock: beforeSibling "${beforeSiblingId}" is not a child of parent "${parentId}"`,
      );
    }
    nextSiblingId = beforeSiblingId;
    prevSiblingId = beforeSibling.prevSiblingId;
  }

  // Create the new block with proper linkage.
  const newId = allocator.allocate();
  const newBlock = createBlock({
    id: newId,
    type: args.type,
    attrs: args.attrs,
    parentId,
    prevSiblingId,
    nextSiblingId,
    inlineContent: args.inlineContent,
  });

  // Build the updated blocks map.
  let blocks = state.blocks.set(newId, newBlock);
  const dirtyIds = new Set<BlockId>([newId, parentId]);

  // Update prev sibling's nextSiblingId, OR parent's firstChildId if there's no prev sibling.
  if (prevSiblingId) {
    const prev = state.blocks.get(prevSiblingId);
    if (!prev) throw new Error(`insertBlock: prev sibling "${prevSiblingId}" not found`);
    blocks = blocks.set(prevSiblingId, withNextSibling(prev, newId));
    dirtyIds.add(prevSiblingId);
  }

  // Update next sibling's prevSiblingId, OR parent's lastChildId if there's no next sibling.
  if (nextSiblingId) {
    const next = state.blocks.get(nextSiblingId);
    if (!next) throw new Error(`insertBlock: next sibling "${nextSiblingId}" not found`);
    blocks = blocks.set(nextSiblingId, withPrevSibling(next, newId));
    dirtyIds.add(nextSiblingId);
  }

  // Update parent's firstChildId / lastChildId if the new block sits at a boundary.
  const newFirstChildId = prevSiblingId === null ? newId : parent.firstChildId;
  const newLastChildId = nextSiblingId === null ? newId : parent.lastChildId;
  blocks = blocks.set(parentId, withChildPointers(parent, newFirstChildId, newLastChildId));

  return {
    state: { ...state, blocks },
    dirtyIds,
  };
}

function withNextSibling(b: Block, nextSiblingId: BlockId | null): Block {
  return createBlock({
    id: b.id, type: b.type, attrs: b.attrs,
    parentId: b.parentId, prevSiblingId: b.prevSiblingId,
    nextSiblingId,
    firstChildId: b.firstChildId, lastChildId: b.lastChildId,
    inlineContent: b.inlineContent,
  });
}

function withPrevSibling(b: Block, prevSiblingId: BlockId | null): Block {
  return createBlock({
    id: b.id, type: b.type, attrs: b.attrs,
    parentId: b.parentId,
    prevSiblingId,
    nextSiblingId: b.nextSiblingId,
    firstChildId: b.firstChildId, lastChildId: b.lastChildId,
    inlineContent: b.inlineContent,
  });
}

function withChildPointers(b: Block, firstChildId: BlockId | null, lastChildId: BlockId | null): Block {
  return createBlock({
    id: b.id, type: b.type, attrs: b.attrs,
    parentId: b.parentId, prevSiblingId: b.prevSiblingId, nextSiblingId: b.nextSiblingId,
    firstChildId, lastChildId,
    inlineContent: b.inlineContent,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- insert-block`
Expected: PASS (2 tests).

- [ ] **Step 4b: Type check**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/insert-block.ts packages/core/src/state/insert-block.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add insertBlock Layer 3 operation — between-siblings case

Splices a new block into a parent's linked-list children. This commit
covers the basic between-siblings case; subsequent tasks add boundary
tests (prepend, append, first-child-of-empty) and error tests, all
exercising the same implementation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: insertBlock — boundary cases (prepend, append, first-child-of-empty)

**Files:**
- Modify: `packages/core/src/state/insert-block.test.ts`

These tests exercise the same implementation from Task 3; no implementation changes needed. Three boundary scenarios:

- [ ] **Step 1: Append the boundary tests**

Append to `insert-block.test.ts`:

```typescript
describe("insertBlock — prepend (no prev sibling)", () => {
  // doc > [p1, p2]  →  doc > [NEW, p1, p2]  via beforeSiblingId = "p1"
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });

  it("inserts before the first child and updates parent's firstChildId", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlock(state, "doc" as BlockId, "p1" as BlockId, { type: "paragraph" }, allocator);
    const newId = "new-0" as BlockId;
    const newBlock = result.state.blocks.get(newId);
    expect(newBlock?.prevSiblingId).toBeNull();
    expect(newBlock?.nextSiblingId).toBe("p1");
    expect(result.state.blocks.get("p1" as BlockId)?.prevSiblingId).toBe(newId);
    expect(result.state.blocks.get("doc" as BlockId)?.firstChildId).toBe(newId);
    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p2");
    expect(new Set(result.dirtyIds)).toEqual(new Set([newId, "doc", "p1"]));
  });
});

describe("insertBlock — append (beforeSiblingId === null)", () => {
  // doc > [p1, p2]  →  doc > [p1, p2, NEW]  via beforeSiblingId = null
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });

  it("appends after the last child and updates parent's lastChildId", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlock(state, "doc" as BlockId, null, { type: "paragraph" }, allocator);
    const newId = "new-0" as BlockId;
    const newBlock = result.state.blocks.get(newId);
    expect(newBlock?.prevSiblingId).toBe("p2");
    expect(newBlock?.nextSiblingId).toBeNull();
    expect(result.state.blocks.get("p2" as BlockId)?.nextSiblingId).toBe(newId);
    expect(result.state.blocks.get("doc" as BlockId)?.firstChildId).toBe("p1");
    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe(newId);
    expect(new Set(result.dirtyIds)).toEqual(new Set([newId, "doc", "p2"]));
  });
});

describe("insertBlock — first child of empty container", () => {
  // doc > [section] (empty)  →  doc > [section > [NEW]]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc" }), // no children
      ],
    });

  it("inserts as the only child of an empty container (with beforeSiblingId === null)", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlock(state, "s" as BlockId, null, { type: "paragraph", inlineContent: createInlineContent([]) }, allocator);
    const newId = "new-0" as BlockId;
    const newBlock = result.state.blocks.get(newId);
    expect(newBlock?.parentId).toBe("s");
    expect(newBlock?.prevSiblingId).toBeNull();
    expect(newBlock?.nextSiblingId).toBeNull();
    expect(result.state.blocks.get("s" as BlockId)?.firstChildId).toBe(newId);
    expect(result.state.blocks.get("s" as BlockId)?.lastChildId).toBe(newId);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- insert-block`
Expected: PASS (5 tests in `insert-block.test.ts` — 2 from Task 3 + 3 new). Should pass without implementation changes; the algorithm in Task 3 covers all sibling positions.

- [ ] **Step 3: Type check**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/state/insert-block.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover insertBlock boundary cases (prepend, append, empty container)

Three new tests verifying the implementation handles:
- prepend (beforeSiblingId is the current first child)
- append (beforeSiblingId === null)
- first child of an empty container (parent has no current children)

No implementation changes; the Task 3 algorithm covers all three cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: insertBlock — error cases

**Files:**
- Modify: `packages/core/src/state/insert-block.test.ts`

The implementation already throws on missing parent and non-child beforeSibling. This task adds the tests for those cases.

- [ ] **Step 1: Append the error tests**

Append to `insert-block.test.ts`:

```typescript
describe("insertBlock — error cases", () => {
  it("throws when the parent does not exist", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    const allocator = createTestAllocator("new");
    expect(() =>
      insertBlock(state, "missing" as BlockId, null, { type: "paragraph" }, allocator),
    ).toThrow(/parent "missing" not found/);
  });

  it("throws when beforeSiblingId is not a child of parent", () => {
    // doc > [p1]; section > [p2]  — p2 is NOT a child of doc, but we pass it as beforeSiblingId on doc.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "section", type: "section" }), // orphan; for test purposes
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", inlineContent: createInlineContent([]) }),
      ],
    });
    const allocator = createTestAllocator("new");
    expect(() =>
      insertBlock(state, "doc" as BlockId, "p2" as BlockId, { type: "paragraph" }, allocator),
    ).toThrow(/not a child of parent/);
  });

  it("throws when beforeSiblingId references a missing block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
    });
    const allocator = createTestAllocator("new");
    expect(() =>
      insertBlock(state, "doc" as BlockId, "missing-sibling" as BlockId, { type: "paragraph" }, allocator),
    ).toThrow(/beforeSibling.*not found/);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- insert-block`
Expected: PASS (8 tests in `insert-block.test.ts`).

- [ ] **Step 3: Type check**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/state/insert-block.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover insertBlock error cases

Three new tests verifying the implementation throws on:
- missing parent
- beforeSibling that is not a child of the parent
- beforeSibling that references a missing block

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: removeBlock — basic case (middle child)

**Files:**
- Create: `packages/core/src/state/remove-block.ts`
- Test: `packages/core/src/state/remove-block.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/remove-block.test.ts
import { describe, it, expect } from "vitest";
import { removeBlock } from "./remove-block";
import { buildBlock, buildState } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("removeBlock — middle child", () => {
  // doc > [p1, p2, p3]  →  doc > [p1, p3] (p2 removed)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([]) }),
      ],
    });

  it("removes the block from state.blocks", () => {
    const state = fixture();
    const result = removeBlock(state, "p2" as BlockId);
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
  });

  it("relinks adjacent siblings (p1.nextSiblingId, p3.prevSiblingId)", () => {
    const state = fixture();
    const result = removeBlock(state, "p2" as BlockId);
    expect(result.state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p3");
    expect(result.state.blocks.get("p3" as BlockId)?.prevSiblingId).toBe("p1");
  });

  it("does not change parent's firstChildId / lastChildId for a middle removal", () => {
    const state = fixture();
    const result = removeBlock(state, "p2" as BlockId);
    expect(result.state.blocks.get("doc" as BlockId)?.firstChildId).toBe("p1");
    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p3");
  });

  it("returns dirtyIds for removed block + parent + adjacent siblings", () => {
    const state = fixture();
    const result = removeBlock(state, "p2" as BlockId);
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p2", "doc", "p1", "p3"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- remove-block`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/remove-block.ts
import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import { createBlock, type Block } from "./block";

/**
 * Remove a block from the document tree. Updates the linked-list
 * pointers of the prev/next siblings, and the parent's firstChildId /
 * lastChildId if the removed block was at a boundary.
 *
 * Returns OperationResult with dirtyIds containing:
 *   - the removed block's id
 *   - the parent's id (firstChildId / lastChildId may have changed)
 *   - the previous sibling's id (its nextSiblingId is rewired) — if exists
 *   - the next sibling's id (its prevSiblingId is rewired) — if exists
 *
 * Throws if the block does not exist OR is the document root.
 *
 * TODO (Phase 4d / future): cascade-delete embed-referenced content blocks
 * from `state.embedContents` for any embeds in the removed subtree's
 * inlineContent. The `state.embedContents` map doesn't yet exist; today
 * no code creates embed-referenced blocks so no orphaning happens. When
 * embedContents lands, this function will walk the removed subtree
 * collecting `EmbedItem.properties.contentBlockId` references and remove
 * each from embedContents.
 */
export function removeBlock(state: State, blockId: BlockId): OperationResult {
  const block = state.blocks.get(blockId);
  if (!block) {
    throw new Error(`removeBlock: block "${blockId}" not found`);
  }
  if (blockId === state.rootId) {
    throw new Error(`removeBlock: cannot remove the document root "${blockId}"`);
  }
  if (!block.parentId) {
    // Defensive: a non-root block with no parent is malformed state.
    throw new Error(`removeBlock: block "${blockId}" has no parentId (orphan)`);
  }

  const parentId = block.parentId;
  const parent = state.blocks.get(parentId);
  if (!parent) {
    throw new Error(`removeBlock: parent "${parentId}" of "${blockId}" not found`);
  }

  let blocks = state.blocks.delete(blockId);
  const dirtyIds = new Set<BlockId>([blockId, parentId]);

  // Relink prev sibling's nextSiblingId → block's nextSiblingId.
  if (block.prevSiblingId) {
    const prev = state.blocks.get(block.prevSiblingId);
    if (!prev) throw new Error(`removeBlock: prev sibling "${block.prevSiblingId}" not found`);
    blocks = blocks.set(block.prevSiblingId, withNextSibling(prev, block.nextSiblingId));
    dirtyIds.add(block.prevSiblingId);
  }

  // Relink next sibling's prevSiblingId → block's prevSiblingId.
  if (block.nextSiblingId) {
    const next = state.blocks.get(block.nextSiblingId);
    if (!next) throw new Error(`removeBlock: next sibling "${block.nextSiblingId}" not found`);
    blocks = blocks.set(block.nextSiblingId, withPrevSibling(next, block.prevSiblingId));
    dirtyIds.add(block.nextSiblingId);
  }

  // Update parent's firstChildId / lastChildId if the removed block was at a boundary.
  const newFirstChildId =
    parent.firstChildId === blockId ? block.nextSiblingId : parent.firstChildId;
  const newLastChildId =
    parent.lastChildId === blockId ? block.prevSiblingId : parent.lastChildId;
  blocks = blocks.set(parentId, withChildPointers(parent, newFirstChildId, newLastChildId));

  return {
    state: { ...state, blocks },
    dirtyIds,
  };
}

function withNextSibling(b: Block, nextSiblingId: BlockId | null): Block {
  return createBlock({
    id: b.id, type: b.type, attrs: b.attrs,
    parentId: b.parentId, prevSiblingId: b.prevSiblingId,
    nextSiblingId,
    firstChildId: b.firstChildId, lastChildId: b.lastChildId,
    inlineContent: b.inlineContent,
  });
}

function withPrevSibling(b: Block, prevSiblingId: BlockId | null): Block {
  return createBlock({
    id: b.id, type: b.type, attrs: b.attrs,
    parentId: b.parentId,
    prevSiblingId,
    nextSiblingId: b.nextSiblingId,
    firstChildId: b.firstChildId, lastChildId: b.lastChildId,
    inlineContent: b.inlineContent,
  });
}

function withChildPointers(b: Block, firstChildId: BlockId | null, lastChildId: BlockId | null): Block {
  return createBlock({
    id: b.id, type: b.type, attrs: b.attrs,
    parentId: b.parentId, prevSiblingId: b.prevSiblingId, nextSiblingId: b.nextSiblingId,
    firstChildId, lastChildId,
    inlineContent: b.inlineContent,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- remove-block`
Expected: PASS (4 tests).

- [ ] **Step 4b: Type check**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/remove-block.ts packages/core/src/state/remove-block.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add removeBlock Layer 3 operation — middle-child case

Removes a block from the linked-list children of its parent and relinks
adjacent siblings. Updates parent's firstChildId / lastChildId if the
removed block was at a boundary. Returns OperationResult with dirtyIds
covering the removed block + parent + adjacent siblings.

Embed cascade-delete (for footnote-body blocks etc.) is documented as
TODO; deferred to Phase 4d / future when state.embedContents lands.
Today no code creates embed-referenced blocks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: removeBlock — first / last child boundary cases

**Files:**
- Modify: `packages/core/src/state/remove-block.test.ts`

These tests exercise the same implementation from Task 6.

- [ ] **Step 1: Append the boundary tests**

Append to `remove-block.test.ts`:

```typescript
describe("removeBlock — first child", () => {
  // doc > [p1, p2, p3]  →  doc > [p2, p3] (p1 removed)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([]) }),
      ],
    });

  it("updates parent.firstChildId when removing the first child", () => {
    const state = fixture();
    const result = removeBlock(state, "p1" as BlockId);
    expect(result.state.blocks.get("doc" as BlockId)?.firstChildId).toBe("p2");
    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p3");
    expect(result.state.blocks.get("p2" as BlockId)?.prevSiblingId).toBeNull();
  });
});

describe("removeBlock — last child", () => {
  // doc > [p1, p2, p3]  →  doc > [p1, p2] (p3 removed)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([]) }),
      ],
    });

  it("updates parent.lastChildId when removing the last child", () => {
    const state = fixture();
    const result = removeBlock(state, "p3" as BlockId);
    expect(result.state.blocks.get("doc" as BlockId)?.firstChildId).toBe("p1");
    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p2");
    expect(result.state.blocks.get("p2" as BlockId)?.nextSiblingId).toBeNull();
  });
});

describe("removeBlock — only child", () => {
  // doc > [p1]  →  doc > [] (p1 removed; doc becomes empty)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([]) }),
      ],
    });

  it("clears both firstChildId and lastChildId when removing the only child", () => {
    const state = fixture();
    const result = removeBlock(state, "p1" as BlockId);
    expect(result.state.blocks.get("doc" as BlockId)?.firstChildId).toBeNull();
    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBeNull();
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "doc"]));
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- remove-block`
Expected: PASS (7 tests in `remove-block.test.ts` — 4 from Task 6 + 3 new).

- [ ] **Step 3: Type check**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/state/remove-block.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover removeBlock first/last/only-child boundary cases

Three new tests verifying the implementation correctly updates parent's
firstChildId / lastChildId when the removed block is at a boundary, and
clears both pointers when removing an only child.

No implementation changes; the Task 6 algorithm covers all cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: removeBlock — error cases

**Files:**
- Modify: `packages/core/src/state/remove-block.test.ts`

- [ ] **Step 1: Append the error tests**

Append to `remove-block.test.ts`:

```typescript
describe("removeBlock — error cases", () => {
  it("throws when the block does not exist", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(() => removeBlock(state, "missing" as BlockId)).toThrow(/not found/);
  });

  it("throws when attempting to remove the document root", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(() => removeBlock(state, "doc" as BlockId)).toThrow(/cannot remove the document root/);
  });

  it("throws when removing a non-root block with no parent (malformed state)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document" }),
        buildBlock({ id: "orphan", type: "paragraph", inlineContent: createInlineContent([]) }), // no parentId
      ],
    });
    expect(() => removeBlock(state, "orphan" as BlockId)).toThrow(/no parentId/);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- remove-block`
Expected: PASS (10 tests in `remove-block.test.ts`).

- [ ] **Step 3: Type check**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/state/remove-block.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover removeBlock error cases

Three new tests verifying the implementation throws on:
- missing block
- attempt to remove the document root
- non-root block with no parentId (malformed state)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: operations.ts barrel

**Files:**
- Create: `packages/core/src/state/operations.ts`
- Test: `packages/core/src/state/operations.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/operations.test.ts
import { describe, it, expect } from "vitest";
import * as ops from "./operations";

describe("operations barrel", () => {
  it("re-exports all Phase 4a Layer 3 operations", () => {
    expect(typeof ops.setBlockAttrs).toBe("function");
    expect(typeof ops.setBlockType).toBe("function");
    expect(typeof ops.insertBlock).toBe("function");
    expect(typeof ops.removeBlock).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- "src/state/operations.test"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/operations.ts

/**
 * Layer 3 state-mutating operations barrel.
 *
 * Each operation takes a State and arguments, returns OperationResult
 * (new state + dirtyIds of changed blocks). All operations are pure
 * functions over the immutable state.
 *
 * Phase 4a operations (this commit): block-level operations that
 * change one block's attrs/type or splice a block into/out of a
 * parent's linked-list children.
 *
 * Subsequent phases will append:
 *   - Phase 4b: insert-text, apply-attrs (inline-content edits)
 *   - Phase 4c: split-block, merge-blocks, delete-range, replace-range
 *               (cross-block structural surgery)
 *   - Phase 4d: clone-pasted-subtree (paste mechanics)
 */

export { setBlockAttrs } from "./set-block-attrs";
export { setBlockType } from "./set-block-type";
export { insertBlock, type InsertBlockArgs } from "./insert-block";
export { removeBlock } from "./remove-block";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- "src/state/operations.test"`
Expected: PASS (1 test).

- [ ] **Step 4b: Type check**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/operations.ts packages/core/src/state/operations.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add operations.ts barrel for Layer 3 operations

Re-exports the four Phase 4a operations: setBlockAttrs, setBlockType,
insertBlock, removeBlock. Subsequent phases (4b, 4c, 4d) append more
operations to this barrel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Verification + retrospective

Phase 4a added 5 new files (4 operations + barrel) plus their tests.

- [ ] **Step 1: Run the full type checker**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 2: Run the full test suite**

Run: `npm test --workspace=packages/core`
Expected: PASS — all existing tests still green AND all new tests added by this phase pass. Phase 4a adds approximately 28 new tests:
- setBlockAttrs: 4
- setBlockType: 3
- insertBlock: 8 (2 + 3 + 3)
- removeBlock: 10 (4 + 3 + 3)
- operations barrel: 1
Total ~28; total suite should be ~1018 tests passing + 4 skipped, up from Phase 3's 990 + 4 skipped.

- [ ] **Step 3: Verify the new exports are not yet wired into the public API**

Run: `grep -E "(set-block-attrs|set-block-type|insert-block|remove-block|operations)" packages/core/src/index.ts`
Expected: empty output. New operations are not exported from the public API yet — Phase 14 cleanup.

- [ ] **Step 4: Verify the existing state files are untouched**

Run: `git log --since="$(git log -1 --format=%cd 413728a)" -- packages/core/src/state/state-node.ts packages/core/src/state/transformations.ts packages/core/src/state/formatting.ts`
Expected: no commits since Phase 3 completion.

- [ ] **Step 5: Surface anything Phase 4b should account for**

If anything came up during Phase 4a implementation that should inform Phase 4b design (insert-text, apply-attrs), add notes to the spec. Examples:
- Did the OperationResult shape feel ergonomic, or did any operation want to return additional information?
- Was the "every block in parent + adjacent siblings" dirty-id pattern complete, or did some test reveal a missing dirty?
- Did the embed-cascade TODO in removeBlock cause any test to feel uncovered?

If yes, edit the spec; commit. Otherwise skip.

---

## Self-review

**Spec coverage** (Phase 4a scope: simple block-level operations):
- ✅ `setBlockAttrs` — Task 1
- ✅ `setBlockType` — Task 2
- ✅ `insertBlock` (between, prepend, append, empty container, error cases) — Tasks 3-5
- ✅ `removeBlock` (middle, first, last, only, error cases) — Tasks 6-8
- ✅ `operations.ts` barrel — Task 9
- ✅ Verification + retrospective — Task 10

**Placeholder scan:** No "TBD"/"TODO"/"add appropriate error handling" patterns in tasks. The single TODO is in removeBlock's documentation, intentionally documenting deferred embed-cascade behavior.

**Type consistency:** `OperationResult`, `BlockId`, `IdAllocator`, `ReadonlyAttrs`, `InlineContent`, `Block` referenced consistently. Function signatures stable.

**Out of scope (deferred):**
- Inline-content operations: `insertText`, `applyAttrsToRange`. → Phase 4b.
- Cross-block structural operations: `splitBlockAtPosition`, `mergeAdjacentBlocks`, `deleteRange`, `replaceRange`. → Phase 4c.
- Paste mechanics: `clonePastedSubtree`. → Phase 4d.
- Embed cascade-delete in removeBlock. → Future phase when `state.embedContents` is added.
- Public API export wiring. → Phase 14 cleanup.

The Phase 4a plan above produces 5 new source files + tests, ~10 commits, leaves the build green throughout. Estimated execution time: half a day.

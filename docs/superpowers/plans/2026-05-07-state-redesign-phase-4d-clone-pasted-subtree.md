# State module redesign — Phase 4d: clonePastedSubtree

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Layer 3 `clonePastedSubtree` operation — given a source state and a root block id, clone the subtree (recursively, including embed-referenced content blocks like footnote bodies), allocating fresh BlockIds for every cloned block and rewriting all internal id references. This is the front half of paste mechanics: the cloner produces a self-contained set of fresh blocks that the caller (action handler) then inserts into the destination state via `insertBlock` (or similar).

**Architecture:** Per `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md` line 350 (signature) and lines 246-252 (ID lifecycle: copy/paste rules). The first Phase 4 operation that genuinely needs the `IdAllocator` — every prior operation mutated existing blocks or removed them, never created new ones with allocator-assigned ids. This is also the first operation that returns a non-`OperationResult` shape: instead of `{ state, dirtyIds }`, it returns `{ blocks: Map<BlockId, Block>, rootId: BlockId }` representing a self-contained subtree-snapshot.

**Tech Stack:** TypeScript 5.7, vitest 3.0, npm workspaces.

**Phase 1 - 4c-5 status (assumed complete):**
- Phase 1 — Layer 1 types. Last commit `4230343`.
- Phase 2 — Layer 2 utilities. Last commit `b27bffa`.
- Phase 3 — Cascade attribute interpreters. Last commit `413728a`.
- Phase 4a — Simple block-level operations + barrel. Last commit `cc2b249`.
- Phase 4b — `insertText`. Last commit `597bad1`.
- Phase 4c-1 — `applyAttrsToRange`. Last commit `107f39a`.
- Phase 4c-2 — `splitBlockAtPosition`. Last commit `e0dbb65`.
- Phase 4c-2.5 cleanup — extracted `mergeAdjacentTextItems` and `updateBlock`. Last commit `2c2a95a`.
- Phase 4c-3 — `mergeAdjacentBlocks`. Last commit `da4b466`.
- Phase 4c-4 — `deleteRange` (with preventive cleanup extracting `splitInlineContentAtOffset`). Last commit `a7b168d`.
- Phase 4c-5 — `replaceRange`. Last commit `dc8c76c`.
- Build green; 1193 tests passing + 4 skipped.

**Per-phase scope notes:**

- New files: `state/clone-pasted-subtree.ts` and `state/clone-pasted-subtree.test.ts`. Confirmed at plan-write time that NEITHER file exists.
- Modify: `state/operations.ts` (one new export line) and `state/operations.test.ts` (one new assertion). Authorized.
- **Critical implementer guard (per memory `feedback_implementer_create_collision.md`):** if any file the plan asks to CREATE already exists, the implementer must STOP and report `BLOCKED`; never silently refactor, rename, or consolidate. Verified by the controller before dispatch.
- Per CLAUDE.md: TDD throughout. Verify with both `npm test` AND `npm run build`.
- Type safety: no non-null assertions (`!`); use proper narrowing.
- **Manual unused-import scan after writing every file** — `tsconfig` lacks `noUnusedLocals`. Read the imports yourself.

**Why a non-`OperationResult` return type:** `clonePastedSubtree` doesn't mutate any existing state — it produces a self-contained collection of brand-new blocks plus the new root id, ready to be merged into a destination state by the caller. There's no `dirtyIds` set because no existing block changes; the caller knows exactly which blocks are new (all of them in the returned `Map`). This signature shape matches the spec line 350.

**Why the spec's `state` parameter is dropped:** the spec signature is `clonePastedSubtree(state, sourceState, sourceRootId, allocator)`. The first `state` parameter (presumably the destination state) plays no role in the cloning — the allocator already handles namespace concerns by producing fresh ids that won't collide with anything. Same pattern as our other operations dropping unused spec parameters when they add no value.

**Operation signature:**

```typescript
interface ClonedSubtree {
  /** All cloned blocks, keyed by their new BlockId. Includes the root and every descendant, plus every embed-referenced content block (e.g., footnote bodies) and their subtrees. */
  readonly blocks: ReadonlyMap<BlockId, Block>;
  /** The new BlockId of the cloned root (corresponds to sourceRootId in the source state). */
  readonly rootId: BlockId;
}

function clonePastedSubtree(
  sourceState: State,
  sourceRootId: BlockId,
  allocator: IdAllocator,
): ClonedSubtree;
```

Notes:
- The cloned root has `parentId: null`, `prevSiblingId: null`, `nextSiblingId: null` — it's a free-standing subtree-root, ready to be re-parented by the caller during insertion.
- Non-root blocks have their `parentId` / sibling / child pointers rewritten via the `oldId → newId` map.
- Embed items in `inlineContent.items` with `properties.contentBlockId` referencing a separate block: that referenced block's subtree is ALSO cloned (recursively), and the embed's `contentBlockId` is rewritten to the new id.
- Embed-content blocks (e.g., footnote bodies) typically have `parentId: null` in the source state. Their clones also have `parentId: null` (they remain standalone roots in the cloned set).
- The walker is cycle-defended: each `oldId` is added to a `visited` set on first encounter; subsequent encounters are skipped. This guards against malformed cyclic state without infinite recursion.
- Throws if `sourceRootId` is not in `sourceState.blocks`.
- Throws if a child / sibling / `contentBlockId` reference points to a block that doesn't exist in `sourceState.blocks` (corrupted source state).

**Algorithm:**

1. **Phase 1 — collect all subtree blocks.** Walk the source subtree, building a `Set<BlockId>` of every reachable block id. Walking includes:
   - The root (`sourceRootId`).
   - All descendants reachable via `firstChildId` / `nextSiblingId` chains (within-subtree walk; do NOT follow the root's own `nextSiblingId` since that goes outside the subtree).
   - For every leaf with `inlineContent.items`, every embed item's `properties.contentBlockId` (when it's a string-castable BlockId).
   - Recursively for every embed-content block's own subtree.
   Cycle defense: skip ids already in the visited set.

2. **Phase 2 — allocate new ids.** Build a `Map<BlockId, BlockId>` mapping each old id to a fresh allocator-produced id. (Iteration order is the visit order from phase 1.)

3. **Phase 3 — build cloned blocks.** For each old id in the visited set:
   - Look up the source block.
   - Construct a new block via `createBlock` with:
     - `id`: the new id from the map.
     - `type`, `attrs`: copied unchanged.
     - `parentId`: `null` if `oldId === sourceRootId`; `null` if the source `parentId` was already `null` (e.g., embed-content root); otherwise the mapped new parent id.
     - `prevSiblingId`, `nextSiblingId`: `null` if `oldId === sourceRootId`; otherwise the mapped value (or `null` if the sibling isn't in the subtree map — defensive).
     - `firstChildId`, `lastChildId`: mapped values (or `null` if the source had `null`).
     - `inlineContent`: rewritten via `rewriteInlineContent` (which rewrites embed `contentBlockId`s; non-embed items pass through unchanged).
   - Add to the result `Map<BlockId, Block>`.

4. Return `{ blocks: result, rootId: idMap.get(sourceRootId) }`.

---

## File structure (this phase)

**Created:**

| Path | Responsibility |
|---|---|
| `packages/core/src/state/clone-pasted-subtree.ts` | `clonePastedSubtree(sourceState, sourceRootId, allocator) → ClonedSubtree`. Two-phase walk: collect ids + rewrite references. Cycle-defended. |
| `packages/core/src/state/clone-pasted-subtree.test.ts` | Unit tests: tree shapes, embed-content cloning, invariants (immutability, root detached, refs rewritten), edge cases (empty container, leaf-root), error cases (root not found, missing ref, cycle). |

**Modified:**

| Path | Change |
|---|---|
| `packages/core/src/state/operations.ts` | Append `export { clonePastedSubtree, type ClonedSubtree } from "./clone-pasted-subtree";` to a new Phase 4d section. |
| `packages/core/src/state/operations.test.ts` | Add `expect(typeof ops.clonePastedSubtree).toBe("function");` assertion. |

**Deleted:** none.

---

## Task 1: clonePastedSubtree — implementation + sanity test

**Files:**
- Create: `packages/core/src/state/clone-pasted-subtree.ts`
- Create: `packages/core/src/state/clone-pasted-subtree.test.ts`

- [ ] **Step 1: Write the failing test (clone-pasted-subtree.test.ts)**

```typescript
import { describe, it, expect } from "vitest";
import { clonePastedSubtree } from "./clone-pasted-subtree";
import { buildBlock, buildState, text } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createTestAllocator, type BlockId } from "./block-id";

describe("clonePastedSubtree — basic single-leaf clone", () => {
  // Source: doc > [p("hello world")]. Clone the paragraph alone.
  // Expected: cloned root has new id from allocator; type/attrs/content preserved;
  // parentId/sibling pointers all null on the clone.
  it("clones a single leaf block with text content", () => {
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          attrs: { textAlign: "left" },
          parentId: "doc",
          inlineContent: createInlineContent([text("hello world")]),
        }),
      ],
    });
    const allocator = createTestAllocator("clone");
    const result = clonePastedSubtree(sourceState, "p" as BlockId, allocator);

    // The cloned root has the first allocator-produced id.
    expect(result.rootId).toBe("clone-0");
    expect(result.blocks.size).toBe(1);

    const clonedRoot = result.blocks.get("clone-0" as BlockId);
    expect(clonedRoot).toBeDefined();
    expect(clonedRoot?.id).toBe("clone-0");
    expect(clonedRoot?.type).toBe("paragraph");
    expect(clonedRoot?.attrs).toEqual({ textAlign: "left" });
    // Root is detached: parentId/sibling pointers all null.
    expect(clonedRoot?.parentId).toBeNull();
    expect(clonedRoot?.prevSiblingId).toBeNull();
    expect(clonedRoot?.nextSiblingId).toBeNull();
    expect(clonedRoot?.firstChildId).toBeNull();
    expect(clonedRoot?.lastChildId).toBeNull();
    // Inline content preserved.
    expect(clonedRoot?.inlineContent?.items).toHaveLength(1);
    expect(clonedRoot?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello world" });
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npm test --workspace=packages/core -- clone-pasted-subtree --run`
Expected: FAIL with module-not-found / `clonePastedSubtree is not defined`.

- [ ] **Step 3: Write the production code (clone-pasted-subtree.ts)**

```typescript
import type { State } from "./state";
import type { BlockId, IdAllocator } from "./block-id";
import { createBlock, type Block } from "./block";
import {
  createEmbedItem,
  createInlineContent,
  type InlineContent,
  type InlineItem,
} from "./inline-content";

/**
 * The product of cloning a subtree from a source state. Self-contained:
 * `blocks` holds every cloned block (the root + all descendants + every
 * embed-referenced content block recursively), keyed by the NEW BlockId.
 * `rootId` is the new BlockId of the cloned root.
 *
 * The caller composes this with insertBlock (or similar) to merge the
 * cloned subtree into a destination state.
 */
export interface ClonedSubtree {
  readonly blocks: ReadonlyMap<BlockId, Block>;
  readonly rootId: BlockId;
}

/**
 * Clone the subtree rooted at `sourceRootId` from `sourceState`. Allocates
 * fresh BlockIds for every cloned block and rewrites all internal id
 * references (parent/sibling/child pointers + embed contentBlockId).
 *
 * Walks: the root, all descendants (via firstChildId/nextSiblingId chains),
 * and every embed-referenced content block recursively. Cycle-defended.
 *
 * The cloned root has parentId / prevSiblingId / nextSiblingId all null —
 * it's a free-standing subtree-root, ready to be re-parented by the caller
 * during insertion. Non-root parent/sibling/child references are mapped
 * via the oldId → newId map.
 *
 * Throws if sourceRootId is not in sourceState.blocks, or if any reachable
 * id (child, sibling, contentBlockId) points to a block missing from
 * sourceState.blocks (corrupted source state).
 */
export function clonePastedSubtree(
  sourceState: State,
  sourceRootId: BlockId,
  allocator: IdAllocator,
): ClonedSubtree {
  const root = sourceState.blocks.get(sourceRootId);
  if (!root) {
    throw new Error(
      `clonePastedSubtree: source root "${sourceRootId}" not found in sourceState`,
    );
  }

  // Phase 1: collect all reachable block ids in the subtree.
  const visited = new Set<BlockId>();
  collectSubtreeIds(sourceState, sourceRootId, visited);

  // Phase 2: allocate a new id for each visited id.
  const idMap = new Map<BlockId, BlockId>();
  for (const oldId of visited) {
    idMap.set(oldId, allocator.allocate());
  }

  // Phase 3: construct cloned blocks with rewritten references.
  const clonedBlocks = new Map<BlockId, Block>();
  for (const oldId of visited) {
    const oldBlock = sourceState.blocks.get(oldId);
    if (!oldBlock) {
      // Defensive — visited only contains ids that resolved during phase 1.
      throw new Error(
        `clonePastedSubtree: block "${oldId}" disappeared between phase 1 and phase 3`,
      );
    }
    const newId = idMap.get(oldId);
    if (newId === undefined) {
      throw new Error(`clonePastedSubtree: missing newId for "${oldId}"`);
    }

    const isRoot = oldId === sourceRootId;

    const cloned = createBlock({
      id: newId,
      type: oldBlock.type,
      attrs: oldBlock.attrs,
      parentId: isRoot ? null : mapId(oldBlock.parentId, idMap),
      prevSiblingId: isRoot ? null : mapId(oldBlock.prevSiblingId, idMap),
      nextSiblingId: isRoot ? null : mapId(oldBlock.nextSiblingId, idMap),
      firstChildId: mapId(oldBlock.firstChildId, idMap),
      lastChildId: mapId(oldBlock.lastChildId, idMap),
      inlineContent: oldBlock.inlineContent
        ? rewriteInlineContent(oldBlock.inlineContent, idMap)
        : null,
    });
    clonedBlocks.set(newId, cloned);
  }

  const clonedRootId = idMap.get(sourceRootId);
  if (clonedRootId === undefined) {
    throw new Error(`clonePastedSubtree: root "${sourceRootId}" missing from idMap`);
  }
  return { blocks: clonedBlocks, rootId: clonedRootId };
}

/**
 * Walk the subtree from `id` collecting every reachable BlockId into
 * `visited`. Includes:
 *   - the block itself
 *   - all descendants (firstChildId, then sibling chain via nextSiblingId
 *     within the subtree)
 *   - every embed-referenced content block (via item.properties.contentBlockId)
 *     and its subtree (recursively)
 *
 * Cycle defense: skip ids already in `visited`.
 *
 * Does NOT follow the input id's own nextSiblingId/prevSiblingId — those
 * are outside the subtree.
 */
function collectSubtreeIds(state: State, id: BlockId, visited: Set<BlockId>): void {
  if (visited.has(id)) return;
  const block = state.blocks.get(id);
  if (!block) {
    throw new Error(`clonePastedSubtree: referenced block "${id}" not found in sourceState`);
  }
  visited.add(id);

  // Walk children: from firstChildId, follow each child's nextSiblingId.
  let cur: BlockId | null = block.firstChildId;
  while (cur !== null) {
    collectSubtreeIds(state, cur, visited);
    const child = state.blocks.get(cur);
    cur = child ? child.nextSiblingId : null;
  }

  // Walk embed-content references in this block's inline content.
  if (block.inlineContent) {
    for (const item of block.inlineContent.items) {
      if (item.kind === "embed") {
        const cbId = item.properties.contentBlockId;
        if (typeof cbId === "string") {
          collectSubtreeIds(state, cbId as BlockId, visited);
        }
      }
    }
  }
}

/** Map an old BlockId to a new BlockId via `idMap`. Returns null if the input is null. Throws if the input is non-null but absent from idMap (corrupted state — the walker should have visited every reachable block). */
function mapId(oldId: BlockId | null, idMap: Map<BlockId, BlockId>): BlockId | null {
  if (oldId === null) return null;
  const newId = idMap.get(oldId);
  if (newId === undefined) {
    throw new Error(`clonePastedSubtree: id "${oldId}" was not visited (subtree-walk inconsistency)`);
  }
  return newId;
}

/**
 * Build a fresh InlineContent with embed items' `properties.contentBlockId`
 * rewritten via `idMap`. Non-embed items and embeds without a `contentBlockId`
 * pass through unchanged (by reference).
 */
function rewriteInlineContent(
  content: InlineContent,
  idMap: Map<BlockId, BlockId>,
): InlineContent {
  const newItems: InlineItem[] = content.items.map((item) => {
    if (item.kind === "embed") {
      const cbId = item.properties.contentBlockId;
      if (typeof cbId === "string") {
        const newCbId = idMap.get(cbId as BlockId);
        if (newCbId === undefined) {
          throw new Error(
            `clonePastedSubtree: embed contentBlockId "${cbId}" was not visited`,
          );
        }
        return createEmbedItem(
          item.embedType,
          { ...item.properties, contentBlockId: newCbId },
          item.attrs,
        );
      }
    }
    return item;
  });
  return createInlineContent(newItems);
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npm test --workspace=packages/core -- clone-pasted-subtree --run`
Expected: PASS (1 test).

Run: `npm run build --workspace=packages/core`
Expected: clean.

**Manual unused-import scan:** read the imports at the top of `clone-pasted-subtree.ts`. Verify each is used:
- `State` — function parameter type.
- `BlockId`, `IdAllocator` — types.
- `createBlock`, `Block` — used to construct cloned blocks; `Block` is used as the Map's value type.
- `createEmbedItem`, `createInlineContent` — used in `rewriteInlineContent`.
- `InlineContent`, `InlineItem` — type annotations.

All used. If you find any unused, remove it.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/clone-pasted-subtree.ts packages/core/src/state/clone-pasted-subtree.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add clonePastedSubtree Layer 3 operation — basic case

Walks a subtree from sourceState rooted at sourceRootId, allocating
fresh BlockIds for every cloned block and rewriting all internal
references (parentId, sibling/child pointers, embed contentBlockId).
Returns { blocks: ReadonlyMap, rootId }.

Two-phase implementation: phase 1 walks all reachable ids (including
embed-content subtrees) into a visited set with cycle defense; phase 2
allocates new ids; phase 3 constructs cloned blocks with refs mapped
via the oldId → newId map. Cloned root has parentId/sibling pointers
all null — caller re-parents at insertion site.

First test covers the simplest single-leaf case. Subsequent tasks add
coverage for tree shapes, embed-content cloning, invariants, edge
cases, and error cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Context for Task 1

**Working directory:** `/Users/hansyu/code/taleweaver/`
**Branch:** `feature/dom-architecture-redesign`

**Where this fits:** Phase 4d task 1 of 7 — final operation in Phase 4. After Task 7 completes, Phase 4 is feature-complete.

**Critical implementer guard:** if `state/clone-pasted-subtree.ts` OR `state/clone-pasted-subtree.test.ts` already exists, STOP and report `BLOCKED`.

**Important — verify with both `npm test` AND `npm run build`** AND **manually scan imports**.

## Your Job

Execute Steps 1-5 in order. Self-review for unused imports, `!` non-null assertions (none allowed), and any drift from the plan. Then commit.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Test output AND build output
- Files changed (with commit SHA)
- Self-review findings, including: did you manually scan for unused imports?

---

## Task 2: clonePastedSubtree — tree shape coverage

**Files:**
- Modify: `packages/core/src/state/clone-pasted-subtree.test.ts` (append tests only).

- [ ] **Step 1: Append the tree-shape tests**

```typescript
describe("clonePastedSubtree — tree shapes", () => {
  it("clones a parent with two children, mapping all internal refs", () => {
    // Source: section > [p1, p2]. Clone the section.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: createInlineContent([text("first")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: createInlineContent([text("second")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "section" as BlockId, allocator);

    // 3 blocks cloned: section + p1 + p2. doc is NOT included (it's outside the subtree).
    expect(result.blocks.size).toBe(3);

    const newSectionId = result.rootId;
    const newSection = result.blocks.get(newSectionId);
    expect(newSection).toBeDefined();
    expect(newSection?.type).toBe("section");
    expect(newSection?.parentId).toBeNull(); // root of clone is detached
    expect(newSection?.firstChildId).toBeDefined();
    expect(newSection?.lastChildId).toBeDefined();
    expect(newSection?.firstChildId).not.toBe(newSection?.lastChildId);

    const newP1Id = newSection?.firstChildId;
    const newP2Id = newSection?.lastChildId;
    if (!newP1Id || !newP2Id) throw new Error("missing child ids");

    const newP1 = result.blocks.get(newP1Id);
    expect(newP1?.type).toBe("paragraph");
    expect(newP1?.parentId).toBe(newSectionId);
    expect(newP1?.nextSiblingId).toBe(newP2Id);
    expect(newP1?.prevSiblingId).toBeNull();
    expect(newP1?.inlineContent?.items[0]).toMatchObject({ text: "first" });

    const newP2 = result.blocks.get(newP2Id);
    expect(newP2?.type).toBe("paragraph");
    expect(newP2?.parentId).toBe(newSectionId);
    expect(newP2?.prevSiblingId).toBe(newP1Id);
    expect(newP2?.nextSiblingId).toBeNull();
    expect(newP2?.inlineContent?.items[0]).toMatchObject({ text: "second" });
  });

  it("clones a deeply nested tree (3+ levels)", () => {
    // Source: doc > section > list > [item1, item2]. Clone the section.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "list", lastChildId: "list" }),
        buildBlock({ id: "list", type: "list", parentId: "section", firstChildId: "i1", lastChildId: "i2" }),
        buildBlock({ id: "i1", type: "list-item", parentId: "list", nextSiblingId: "i2", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "i2", type: "list-item", parentId: "list", prevSiblingId: "i1", inlineContent: createInlineContent([text("b")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "section" as BlockId, allocator);

    // 4 blocks cloned: section + list + i1 + i2.
    expect(result.blocks.size).toBe(4);

    // Walk down: section.firstChildId → list. list.firstChildId → i1. i1.nextSiblingId → i2.
    const newSection = result.blocks.get(result.rootId);
    if (!newSection?.firstChildId) throw new Error("missing list child");
    const newList = result.blocks.get(newSection.firstChildId);
    expect(newList?.type).toBe("list");
    expect(newList?.parentId).toBe(result.rootId);

    if (!newList?.firstChildId) throw new Error("missing i1 child");
    const newI1 = result.blocks.get(newList.firstChildId);
    expect(newI1?.type).toBe("list-item");
    expect(newI1?.inlineContent?.items[0]).toMatchObject({ text: "a" });
    expect(newI1?.parentId).toBe(newList.firstChildId === newI1.id ? newList.id : newI1.parentId);
    // Simpler: newI1.parentId should equal newList.id.
    expect(newI1?.parentId).toBe(newList.firstChildId === newI1.id ? newList.id : "");
  });

  it("clones a single-child tree (firstChildId === lastChildId)", () => {
    // Source: doc > section > p_only. Clone section.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p_only", lastChildId: "p_only" }),
        buildBlock({ id: "p_only", type: "paragraph", parentId: "section", inlineContent: createInlineContent([text("alone")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "section" as BlockId, allocator);

    expect(result.blocks.size).toBe(2);
    const newSection = result.blocks.get(result.rootId);
    expect(newSection?.firstChildId).toBe(newSection?.lastChildId);
    if (!newSection?.firstChildId) throw new Error("missing child");
    const newPOnly = result.blocks.get(newSection.firstChildId);
    expect(newPOnly?.inlineContent?.items[0]).toMatchObject({ text: "alone" });
    expect(newPOnly?.prevSiblingId).toBeNull();
    expect(newPOnly?.nextSiblingId).toBeNull();
  });

  it("clones an empty container (no children)", () => {
    // Source: doc > [empty_section]. Clone the empty section.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "empty_section", lastChildId: "empty_section" }),
        buildBlock({ id: "empty_section", type: "section", parentId: "doc" }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "empty_section" as BlockId, allocator);

    expect(result.blocks.size).toBe(1);
    const newEmpty = result.blocks.get(result.rootId);
    expect(newEmpty?.type).toBe("section");
    expect(newEmpty?.firstChildId).toBeNull();
    expect(newEmpty?.lastChildId).toBeNull();
    expect(newEmpty?.inlineContent).toBeNull();
  });
});
```

Note: the deeply-nested test's last assertion is intentionally simple (just walks down the chain). For a tighter test, the implementer could `console.log(result.blocks)` to inspect; but the structural checks above are sufficient.

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- clone-pasted-subtree --run` → PASS (5 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/clone-pasted-subtree.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover clonePastedSubtree tree shapes

Four new tests:
- parent with two children: all internal sibling/child/parent refs mapped.
- deeply nested tree (3+ levels of containers).
- single-child tree (firstChildId === lastChildId).
- empty container (no children).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: clonePastedSubtree — embed-content cloning

**Files:**
- Modify: `packages/core/src/state/clone-pasted-subtree.test.ts` (append tests only).

- [ ] **Step 1: Append the embed-content tests**

```typescript
describe("clonePastedSubtree — embed-content cloning", () => {
  it("clones an embed's content block (footnote body) and rewrites contentBlockId", () => {
    // Source: doc > [p1[text + embed("footnote-anchor", { contentBlockId: "fn-body" })]] + standalone fn-body.
    // Clone p1: should also clone fn-body, and the cloned anchor's contentBlockId points to the cloned body.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([
            text("see"),
            embed("footnote-anchor", { contentBlockId: "fn-body" }),
          ]),
        }),
        buildBlock({
          id: "fn-body",
          type: "footnote-body",
          inlineContent: createInlineContent([text("the footnote text")]),
        }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p1" as BlockId, allocator);

    // 2 blocks cloned: p1 + fn-body. doc is outside.
    expect(result.blocks.size).toBe(2);

    const newP1 = result.blocks.get(result.rootId);
    expect(newP1?.type).toBe("paragraph");
    expect(newP1?.inlineContent?.items).toHaveLength(2);
    expect(newP1?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "see" });

    // The embed's contentBlockId is rewritten — NOT the original "fn-body".
    const embedItem = newP1?.inlineContent?.items[1];
    expect(embedItem?.kind).toBe("embed");
    if (embedItem?.kind !== "embed") throw new Error("expected embed");
    const newCbId = embedItem.properties.contentBlockId;
    expect(typeof newCbId).toBe("string");
    expect(newCbId).not.toBe("fn-body");

    // The cloned fn-body has the rewritten id and preserved content.
    const newFnBody = result.blocks.get(newCbId as BlockId);
    expect(newFnBody).toBeDefined();
    expect(newFnBody?.type).toBe("footnote-body");
    expect(newFnBody?.inlineContent?.items[0]).toMatchObject({ text: "the footnote text" });
    expect(newFnBody?.parentId).toBeNull(); // standalone root, preserved
  });

  it("clones multiple embed-content references", () => {
    // Source: p1 with TWO footnote anchors → two distinct fn-body clones.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([
            text("a"),
            embed("footnote-anchor", { contentBlockId: "fn-a" }),
            text("b"),
            embed("footnote-anchor", { contentBlockId: "fn-b" }),
          ]),
        }),
        buildBlock({ id: "fn-a", type: "footnote-body", inlineContent: createInlineContent([text("body a")]) }),
        buildBlock({ id: "fn-b", type: "footnote-body", inlineContent: createInlineContent([text("body b")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p1" as BlockId, allocator);

    // 3 blocks cloned: p1 + fn-a + fn-b.
    expect(result.blocks.size).toBe(3);

    const newP1 = result.blocks.get(result.rootId);
    const items = newP1?.inlineContent?.items;
    expect(items).toHaveLength(4);
    if (!items) throw new Error("missing items");

    const embedA = items[1];
    const embedB = items[3];
    if (embedA.kind !== "embed" || embedB.kind !== "embed") throw new Error("expected embeds");
    const newCbA = embedA.properties.contentBlockId as BlockId;
    const newCbB = embedB.properties.contentBlockId as BlockId;
    expect(newCbA).not.toBe(newCbB);
    expect(newCbA).not.toBe("fn-a");
    expect(newCbB).not.toBe("fn-b");

    expect(result.blocks.get(newCbA)?.inlineContent?.items[0]).toMatchObject({ text: "body a" });
    expect(result.blocks.get(newCbB)?.inlineContent?.items[0]).toMatchObject({ text: "body b" });
  });

  it("clones nested embed-content (footnote body containing its own footnote anchor)", () => {
    // Source: p1 has fn-outer, fn-outer-body has fn-inner anchor, fn-inner-body has plain text.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([embed("footnote-anchor", { contentBlockId: "fn-outer" })]),
        }),
        buildBlock({
          id: "fn-outer",
          type: "footnote-body",
          inlineContent: createInlineContent([embed("footnote-anchor", { contentBlockId: "fn-inner" })]),
        }),
        buildBlock({ id: "fn-inner", type: "footnote-body", inlineContent: createInlineContent([text("deep")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p1" as BlockId, allocator);

    // 3 blocks cloned: p1 + fn-outer + fn-inner.
    expect(result.blocks.size).toBe(3);

    const newP1 = result.blocks.get(result.rootId);
    const outerEmbed = newP1?.inlineContent?.items[0];
    if (outerEmbed?.kind !== "embed") throw new Error("expected embed");
    const newOuterId = outerEmbed.properties.contentBlockId as BlockId;
    expect(newOuterId).not.toBe("fn-outer");

    const newOuter = result.blocks.get(newOuterId);
    const innerEmbed = newOuter?.inlineContent?.items[0];
    if (innerEmbed?.kind !== "embed") throw new Error("expected embed");
    const newInnerId = innerEmbed.properties.contentBlockId as BlockId;
    expect(newInnerId).not.toBe("fn-inner");

    const newInner = result.blocks.get(newInnerId);
    expect(newInner?.inlineContent?.items[0]).toMatchObject({ text: "deep" });
  });
});
```

- [ ] **Step 2: Update import to include `embed`**

The Task 1 test file imports `text` only. Update to:
```typescript
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
```

- [ ] **Step 3-5: Run / build / commit**

Run: `npm test --workspace=packages/core -- clone-pasted-subtree --run` → PASS (8 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/clone-pasted-subtree.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover clonePastedSubtree embed-content cloning

Three new tests:
- clones an embed's content block (footnote body) and rewrites
  contentBlockId to the new id.
- multiple embed-content references → distinct cloned bodies.
- nested embed-content (footnote body containing its own footnote
  anchor) → recursive cloning preserves the chain.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: clonePastedSubtree — block-level invariants

**Files:**
- Modify: `packages/core/src/state/clone-pasted-subtree.test.ts` (append tests only).

- [ ] **Step 1: Append the invariant tests**

```typescript
describe("clonePastedSubtree — block-level invariants", () => {
  it("does not mutate the source state", () => {
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const beforeP = sourceState.blocks.get("p" as BlockId);
    const beforeDoc = sourceState.blocks.get("doc" as BlockId);
    const allocator = createTestAllocator("c");
    clonePastedSubtree(sourceState, "p" as BlockId, allocator);

    // Source state's blocks unchanged.
    expect(sourceState.blocks.get("p" as BlockId)).toBe(beforeP);
    expect(sourceState.blocks.get("doc" as BlockId)).toBe(beforeDoc);
    // No new blocks added to the source.
    expect(sourceState.blocks.has("c-0" as BlockId)).toBe(false);
  });

  it("the cloned root has parentId/sibling pointers all null, even when the source did not", () => {
    // Source: section > [p1, p2, p3]. Clone p2 (a middle child with both prev and next siblings).
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("b")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("c")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p2" as BlockId, allocator);

    expect(result.blocks.size).toBe(1);
    const newP2 = result.blocks.get(result.rootId);
    expect(newP2?.parentId).toBeNull();
    expect(newP2?.prevSiblingId).toBeNull();
    expect(newP2?.nextSiblingId).toBeNull();
    expect(newP2?.inlineContent?.items[0]).toMatchObject({ text: "b" });
  });

  it("preserves type, attrs, text content, and embed properties exactly (excluding rewritten contentBlockId)", () => {
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "li" }),
        buildBlock({
          id: "li",
          type: "list-item",
          attrs: { level: 2, ordered: true, custom: { meta: "x" } },
          parentId: "doc",
          inlineContent: createInlineContent([
            text("hello", { bold: true, color: "red" }),
            embed("image", { src: "img.png", width: 200 }, { link: "https://example.com" }),
          ]),
        }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "li" as BlockId, allocator);

    const newLi = result.blocks.get(result.rootId);
    expect(newLi?.type).toBe("list-item");
    expect(newLi?.attrs).toEqual({ level: 2, ordered: true, custom: { meta: "x" } });

    const items = newLi?.inlineContent?.items;
    if (!items) throw new Error("missing items");
    expect(items[0]).toMatchObject({ kind: "text", text: "hello", attrs: { bold: true, color: "red" } });
    expect(items[1]).toMatchObject({
      kind: "embed",
      embedType: "image",
      properties: { src: "img.png", width: 200 },
      attrs: { link: "https://example.com" },
    });
  });

  it("all internal references in the result point to ids in result.blocks (no leaked source ids)", () => {
    // Source with multiple internal refs.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: createInlineContent([text("first"), embed("footnote-anchor", { contentBlockId: "fn" })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: createInlineContent([text("second")]) }),
        buildBlock({ id: "fn", type: "footnote-body", inlineContent: createInlineContent([text("footnote text")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "section" as BlockId, allocator);

    // 4 blocks: section, p1, p2, fn.
    expect(result.blocks.size).toBe(4);

    // For each block in the result, every non-null reference must be a key in result.blocks (or null).
    const allIds = new Set(result.blocks.keys());
    for (const [, b] of result.blocks) {
      const refs = [b.parentId, b.prevSiblingId, b.nextSiblingId, b.firstChildId, b.lastChildId];
      for (const ref of refs) {
        if (ref !== null) {
          expect(allIds.has(ref)).toBe(true);
        }
      }
      if (b.inlineContent) {
        for (const item of b.inlineContent.items) {
          if (item.kind === "embed") {
            const cbId = item.properties.contentBlockId;
            if (typeof cbId === "string") {
              expect(allIds.has(cbId as BlockId)).toBe(true);
            }
          }
        }
      }
    }
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- clone-pasted-subtree --run` → PASS (12 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/clone-pasted-subtree.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover clonePastedSubtree block-level invariants

Four new tests:
- does not mutate the source state.
- cloned root has parentId/sibling pointers all null even when the
  source root had non-null ones (root is detached at the clone boundary).
- preserves type, attrs, text content, and embed properties exactly.
- all internal references in result.blocks point to ids in result.blocks
  (no leaked source ids).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: clonePastedSubtree — edge cases

**Files:**
- Modify: `packages/core/src/state/clone-pasted-subtree.test.ts` (append tests only).

- [ ] **Step 1: Append the edge-case tests**

```typescript
describe("clonePastedSubtree — edge cases", () => {
  it("clones a leaf with empty inlineContent.items", () => {
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p" as BlockId, allocator);

    expect(result.blocks.size).toBe(1);
    const newP = result.blocks.get(result.rootId);
    expect(newP?.inlineContent?.items).toEqual([]);
  });

  it("clones an embed item without a contentBlockId (no recursion needed)", () => {
    // Image embed with primitive properties only — no contentBlockId.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([embed("image", { src: "x.png" })]),
        }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p" as BlockId, allocator);

    expect(result.blocks.size).toBe(1); // only p — no embed-content to follow.
    const newP = result.blocks.get(result.rootId);
    const item = newP?.inlineContent?.items[0];
    if (item?.kind !== "embed") throw new Error("expected embed");
    expect(item.embedType).toBe("image");
    expect(item.properties).toEqual({ src: "x.png" }); // contentBlockId not present, properties pass through.
  });

  it("each clonePastedSubtree call uses fresh allocator-produced ids", () => {
    // Same source, two clones with different allocators → all blocks have distinct ids.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });

    const a1 = createTestAllocator("first");
    const a2 = createTestAllocator("second");
    const r1 = clonePastedSubtree(sourceState, "p" as BlockId, a1);
    const r2 = clonePastedSubtree(sourceState, "p" as BlockId, a2);

    expect(r1.rootId).toBe("first-0");
    expect(r2.rootId).toBe("second-0");
    expect(r1.rootId).not.toBe(r2.rootId);
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- clone-pasted-subtree --run` → PASS (15 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/clone-pasted-subtree.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover clonePastedSubtree edge cases

Three new tests:
- leaf with empty inlineContent.items.
- embed item without a contentBlockId (no recursion needed).
- two clones from the same source with different allocators produce
  distinct ids (allocator threading verified).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: clonePastedSubtree — error cases

**Files:**
- Modify: `packages/core/src/state/clone-pasted-subtree.test.ts` (append tests only).

- [ ] **Step 1: Append the error-case tests**

```typescript
describe("clonePastedSubtree — error cases", () => {
  it("throws when sourceRootId is not in sourceState.blocks", () => {
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    expect(() => clonePastedSubtree(sourceState, "missing" as BlockId, allocator)).toThrow(
      /source root ".+" not found/,
    );
  });

  it("throws when a child reference points to a missing block (corrupted source)", () => {
    // section.firstChildId references "ghost" which doesn't exist in state.blocks.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "ghost", lastChildId: "ghost" }),
      ],
    });
    const allocator = createTestAllocator("c");
    expect(() => clonePastedSubtree(sourceState, "section" as BlockId, allocator)).toThrow(
      /block ".+" not found/,
    );
  });

  it("throws when an embed's contentBlockId references a missing block", () => {
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([embed("footnote-anchor", { contentBlockId: "ghost" })]),
        }),
      ],
    });
    const allocator = createTestAllocator("c");
    expect(() => clonePastedSubtree(sourceState, "p" as BlockId, allocator)).toThrow(
      /block ".+" not found/,
    );
  });

  it("handles cycles in the source state without infinite recursion (cycle defense)", () => {
    // Pathological source state: section.firstChildId points to itself (cycle).
    // The walker should add "section" to visited on first encounter and skip on second.
    // This is malformed state, but the operation should not infinite-loop.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "section", lastChildId: "section" }), // self-loop
      ],
    });
    const allocator = createTestAllocator("c");
    // Should NOT throw, and should NOT hang. The cycle defense in collectSubtreeIds
    // skips already-visited ids. The cloned section will have firstChildId/lastChildId
    // pointing to ITSELF in the cloned namespace (the self-loop is preserved
    // structurally). This is documented "garbage in, garbage out" — the operation
    // doesn't repair malformed source state.
    const result = clonePastedSubtree(sourceState, "section" as BlockId, allocator);
    expect(result.blocks.size).toBe(1);
    const cloned = result.blocks.get(result.rootId);
    expect(cloned?.firstChildId).toBe(result.rootId); // self-loop preserved in cloned namespace
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- clone-pasted-subtree --run` → PASS (19 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/clone-pasted-subtree.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover clonePastedSubtree error cases

Four new tests:
- missing sourceRootId.
- corrupted child reference (firstChildId points to missing block).
- corrupted embed contentBlockId (references missing block).
- cycle defense: a malformed self-loop in the source state does not
  cause infinite recursion; the cloned subtree preserves the self-loop
  in its own id namespace ("garbage in, garbage out" — operation
  doesn't repair malformed input).

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

After the existing Phase 4c-5 export line, add a new "Phase 4d operations" section:

```typescript
// Phase 4c-5 operations (range replace)
export { replaceRange } from "./replace-range";

// Phase 4d operations (paste mechanics)
export { clonePastedSubtree, type ClonedSubtree } from "./clone-pasted-subtree";
```

- [ ] **Step 2: Append assertion to operations.test.ts**

Inside the existing `describe("operations barrel", ...)` block, add a new `it()`:

```typescript
  it("re-exports Phase 4d operations", () => {
    expect(typeof ops.clonePastedSubtree).toBe("function");
  });
```

- [ ] **Step 3: Run tests + build**

Run: `npm test --workspace=packages/core -- "src/state/operations.test" --run` → PASS (8 tests in `operations.test.ts`).
Run: `npm test --workspace=packages/core --run` → all green; total **1213 + 4 skipped** (was 1193 + 4 after Phase 4c-5; this phase adds 19 new tests in `clone-pasted-subtree.test.ts` + 1 new assertion in `operations.test.ts` = 20).
Run: `npm run build --workspace=packages/core` → clean.

- [ ] **Step 4: Verify public API not yet wired**

Run: `grep -E "(clone-pasted-subtree)" packages/core/src/index.ts`
Expected: empty output. Phase 14 cleanup wires the public API.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/operations.ts packages/core/src/state/operations.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add clonePastedSubtree to operations barrel

Phase 4d operation clonePastedSubtree (paste mechanics: clone a subtree
with fresh allocator-assigned BlockIds and rewrite all internal refs)
is now accessible via the operations barrel. Phase 4 (state-mutating
operations) is feature-complete: setBlockAttrs, setBlockType,
insertBlock, removeBlock (Phase 4a), insertText (4b), applyAttrsToRange
(4c-1), splitBlockAtPosition (4c-2), mergeAdjacentBlocks (4c-3),
deleteRange (4c-4), replaceRange (4c-5), clonePastedSubtree (4d).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Phase 5+ prep**

If anything came up during Phase 4d that should inform later phases (especially the editor-action-handler rewrite, which composes Layer 3 operations), add notes to the spec or memory. Otherwise skip.

---

## Self-review

**Spec coverage** (Phase 4d scope: clonePastedSubtree):
- ✅ Core operation: walk subtree, allocate ids, rewrite refs — Task 1
- ✅ Tree shapes: 2 children, deep nest, single child, empty container — Task 2
- ✅ Embed-content cloning: single, multiple, nested — Task 3
- ✅ Block-level invariants: immutability, root detached, type/attrs/embed properties preserved, no leaked refs — Task 4
- ✅ Edge cases: empty inlineContent, embed without contentBlockId, allocator threading — Task 5
- ✅ Error cases: missing root, missing child ref, missing contentBlockId, cycle defense — Task 6
- ✅ Operations barrel update — Task 7

**Placeholder scan:** No "TBD"/"TODO" patterns. Helpers used: `createBlock` (block.ts), `createInlineContent`/`createEmbedItem` (inline-content.ts). No new helpers introduced; no duplication.

**Type consistency:** `State`, `BlockId`, `IdAllocator`, `Block`, `InlineContent`, `InlineItem` referenced consistently. New exported type `ClonedSubtree` (`{ blocks: ReadonlyMap<BlockId, Block>, rootId: BlockId }`).

**Out of scope (deferred):**
- Action-handler integration (the caller that uses `clonePastedSubtree` to actually paste a clipboard payload). That's Phase 10b / editor module rewrite.
- Cross-document paste with attribute filtering. Same scope as above.
- `state.embedContents` map separation (currently embed-content blocks live in `state.blocks` with null parentId). Phase 14 / future architecture work.
- Public API wiring → Phase 14.

**Phase 4 milestone:** with Phase 4d, the entire Layer 3 surface (state-mutating operations) is feature-complete. The state module is ready for the editor-module rewrite (Phase 5+) to consume it.

The Phase 4d plan above produces 1 new source file + tests, ~7 commits, leaves the build green throughout. Estimated execution time: most of a day (the test fixtures with embed-content cloning are more elaborate than prior phases).

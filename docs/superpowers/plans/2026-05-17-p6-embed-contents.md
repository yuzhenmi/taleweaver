# P6 — state.embedContents Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move embed-content blocks (footnote bodies, etc.) from `state.blocks` to `state.embedContents`. Implement `removeBlock`'s deferred cascade-delete. Restructure `clonePastedSubtree`'s output shape to separate cloned tree blocks from cloned embed-content blocks.

**Architecture:** P4e already plumbed the Y.Doc structure (`embedContents` is a `Y.Map<BlockId, Y.Map>` root sibling to `blocks`). `getEmbedContent(state, id)`, `getEmbedContentsMap(doc)`, `getYBlock(doc, id, op, "embedContent")`, and `SnapshotCache.embedContents` all exist. What's left: (1) writers must put embed-content blocks in the right map, (2) the cascade-delete TODO in `removeBlock` needs implementing, (3) `clonePastedSubtree` must look up contentBlockId references via the embedContents map AND segregate cloned content into the two output maps, (4) test fixtures must migrate to the new shape, (5) test-utils builder needs an `embedContents` parameter.

**Tech Stack:** Same as P4e (TypeScript, Vitest, Yjs).

## Resolved spec questions

- **History schema (spec Open Q 2): N/A.** `Change` wraps the legacy `StateNode` (in `state/change.ts`), NOT the new Y.Doc-backed `State`. Adding `embedContents` to the new State does not affect `Change` or its consumers. The new History (Y.UndoManager-backed at `state/history.ts`) tracks Yjs transactions, not State snapshots — embedContents mutations are tracked via the existing dirty-id capture (see P4e Task 2 yjs-doc tests). Don't waste cycles on this question.
- **`buildState` helper signature (spec Open Q 1): optional `embedContents` parameter.** See Task 1.

---

## File Structure

**New files:** none. All affected files exist.

**Modified files:**
- `packages/core/src/state/state.ts` — add `getBlockFromEither(state, id): Block | null` helper.
- `packages/core/src/state/state.test.ts` — tests for `getBlockFromEither`.
- `packages/core/src/state/remove-block.ts` — implement cascade-delete (resolves the TODO at lines 30-37 pointing at P6).
- `packages/core/src/state/remove-block.test.ts` — new tests for cascade-delete of embed-content blocks.
- `packages/core/src/state/clone-pasted-subtree.ts` — walker resolves contentBlockId via embedContents map; return type adds `embedContents` field.
- `packages/core/src/state/clone-pasted-subtree.test.ts` — fixture migration + return-shape update.
- `packages/core/src/state/delete-range.test.ts`, `merge-blocks.test.ts`, `replace-range.test.ts`, `yjs-doc.test.ts` — migrate fn-body fixtures to `embedContents` map.
- `packages/core/src/test-utils/state-builders.ts` — `buildState` accepts optional `embedContents: ReadonlyArray<Block>`.
- `packages/core/src/test-utils/state-builders.test.ts` — test for the new parameter.

**Deleted files:** none.

---

## Sub-phase ordering

The build stays green at every commit. Each task has its own test cycle.

1. Task 1: `buildState` learns about `embedContents` (test-util change; no production-code impact).
2. Task 2: `getBlockFromEither` helper added (small unblocking helper).
3. Task 3: Migrate 4 test files' fn-body fixtures from `state.blocks` to `embedContents` (one commit per file, all green). clone-pasted-subtree.test.ts is DEFERRED to Task 4 to keep every commit green.
4. Task 4: `clonePastedSubtree` walker + return shape updated to two-map model, AND clone-pasted-subtree.test.ts fixtures migrated (same atomic commit).
5. Task 5: `removeBlock` cascade-delete implementation (resolves the TODO).
6. Task 6: Final verification (full build + test sweep + grep cleanup audit).

---

## Task 1: Extend `buildState` to accept embed-content blocks

**Files:**
- Modify: `packages/core/src/test-utils/state-builders.ts`
- Modify: `packages/core/src/test-utils/state-builders.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/test-utils/state-builders.test.ts` (also ensure `getBlock` is imported — needed for the second test below):

```typescript
import { getBlock, getEmbedContent } from "../state/state";

// ... existing tests ...

describe("buildState — embedContents", () => {
  it("creates an empty embedContents map when not provided", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
    });
    expect(getEmbedContent(state, "missing" as BlockId)).toBeNull();
  });

  it("populates embedContents from the optional parameter", () => {
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "root",
          inlineContent: inlineContent([
            embed("fn-anchor", { contentBlockId: "fn-body-1" }),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "fn-body-1",
          type: "fn-body",
          inlineContent: inlineContent([text("footnote text")]),
        }),
      ],
    });
    const body = getEmbedContent(state, "fn-body-1" as BlockId);
    expect(body).not.toBeNull();
    expect(body?.type).toBe("fn-body");
    expect(body?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "footnote text" });
    // Embed-content blocks should NOT appear in the main blocks map.
    expect(getBlock(state, "fn-body-1" as BlockId)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test (expected failure: `embedContents` not yet a parameter)**

```bash
npm test --workspace=packages/core -- test-utils/state-builders.test 2>&1 | tail -10
```

- [ ] **Step 3: Extend `buildState`**

Edit `packages/core/src/test-utils/state-builders.ts`. Find the existing `buildState` and update:

```typescript
import { createState, type State } from "../state/state";
import { runTransaction, getBlocksMap, getEmbedContentsMap } from "../state/yjs-doc";
import { buildYBlock } from "../state/y-block";

/**
 * Build a Y.Doc-backed State from a list of Block-shape fixtures.
 * Each block is materialized into the Y.Doc's blocks map.
 *
 * Optional `embedContents` parameter materializes embed-content blocks
 * (footnote bodies, etc.) into the Y.Doc's embedContents map instead.
 * Per Decision A, embed-content blocks live in a separate map from
 * main-tree blocks so the "only root has null parentId" invariant
 * holds for state.blocks. Embed-content blocks typically have parentId
 * === null (no parent — they're referenced via EmbedItem.properties.contentBlockId).
 */
export function buildState(args: {
  rootId: string;
  blocks: ReadonlyArray<Block>;
  embedContents?: ReadonlyArray<Block>;
}): State {
  const state = createState({ rootId: args.rootId as BlockId });
  runTransaction(state.doc, () => {
    const yBlocks = getBlocksMap(state.doc);
    for (const block of args.blocks) {
      yBlocks.set(block.id, buildYBlock({
        type: block.type,
        attrs: block.attrs,
        parentId: block.parentId,
        prevSiblingId: block.prevSiblingId,
        nextSiblingId: block.nextSiblingId,
        firstChildId: block.firstChildId,
        lastChildId: block.lastChildId,
        inlineContent: block.inlineContent,
      }));
    }
    if (args.embedContents !== undefined) {
      const yEmbeds = getEmbedContentsMap(state.doc);
      for (const block of args.embedContents) {
        yEmbeds.set(block.id, buildYBlock({
          type: block.type,
          attrs: block.attrs,
          parentId: block.parentId,
          prevSiblingId: block.prevSiblingId,
          nextSiblingId: block.nextSiblingId,
          firstChildId: block.firstChildId,
          lastChildId: block.lastChildId,
          inlineContent: block.inlineContent,
        }));
      }
    }
  });
  return state;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test --workspace=packages/core -- test-utils/state-builders.test 2>&1 | tail -10
```

Expected: all pass (including the new 2 tests).

- [ ] **Step 5: Run full suite to verify no regression**

```bash
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: 1256 + 2 new = 1258 passing.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/test-utils/state-builders.ts packages/core/src/test-utils/state-builders.test.ts
git commit -m "feat(p6): buildState accepts optional embedContents parameter"
```

---

## Task 2: Add `getBlockFromEither` helper to `state.ts`

**Files:**
- Modify: `packages/core/src/state/state.ts`
- Modify: `packages/core/src/state/state.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/state/state.test.ts`:

```typescript
import { getBlockFromEither } from "./state";
import { buildBlock, buildState, inlineContent, text, embed } from "../test-utils/state-builders";

describe("getBlockFromEither", () => {
  it("returns blocks from the main tree", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
    });
    const block = getBlockFromEither(state, "root" as BlockId);
    expect(block?.type).toBe("document");
  });

  it("returns blocks from the embedContents map", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      embedContents: [
        buildBlock({
          id: "fn-body-1",
          type: "fn-body",
          inlineContent: inlineContent([text("note")]),
        }),
      ],
    });
    const body = getBlockFromEither(state, "fn-body-1" as BlockId);
    expect(body?.type).toBe("fn-body");
  });

  it("returns null when the id is in neither map", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
    });
    expect(getBlockFromEither(state, "missing" as BlockId)).toBeNull();
  });

  it("prefers the main tree if an id collision somehow exists (defensive)", () => {
    // Allocator should prevent this, but if it ever happens we return the main-tree block.
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "document" }),
        buildBlock({ id: "dup-id", type: "paragraph", parentId: "root" }),
      ],
      embedContents: [
        buildBlock({ id: "dup-id", type: "fn-body" }),
      ],
    });
    const block = getBlockFromEither(state, "dup-id" as BlockId);
    expect(block?.type).toBe("paragraph");
  });
});
```

- [ ] **Step 2: Run the test (expected failure: not exported)**

```bash
npm test --workspace=packages/core -- "src/state/state.test.ts" 2>&1 | tail -10
```

- [ ] **Step 3: Add `getBlockFromEither` to `state.ts`**

Append below `getEmbedContent` in `packages/core/src/state/state.ts`:

```typescript
/**
 * Read a frozen Block snapshot from either the main tree or the
 * embedContents tree. Used by Layer 3 ops that don't know in advance
 * which tree an id belongs to (paste walker, future cross-tree
 * references). Main tree takes precedence in the unlikely event of
 * an id collision.
 *
 * Most ops should call `getBlock` or `getEmbedContent` directly — they
 * know which tree they operate on.
 */
export function getBlockFromEither(state: State, id: BlockId): Block | null {
  return getBlock(state, id) ?? getEmbedContent(state, id);
}
```

- [ ] **Step 4: Run tests**

```bash
npm test --workspace=packages/core -- "src/state/state.test.ts" 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 5: Verify build clean + full suite**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
npm test --workspace=packages/core 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/state/state.ts packages/core/src/state/state.test.ts
git commit -m "feat(p6): add getBlockFromEither helper for cross-map lookups"
```

---

## Task 3: Migrate fn-body fixtures across 4 test files (one commit per file)

**Files (this task — 4 files, all green after each commit):**
- Modify: `packages/core/src/state/yjs-doc.test.ts`
- Modify: `packages/core/src/state/delete-range.test.ts`
- Modify: `packages/core/src/state/merge-blocks.test.ts`
- Modify: `packages/core/src/state/replace-range.test.ts`

**Deferred to Task 4:** `clone-pasted-subtree.test.ts` fixture migration. That file's tests can't go green until the walker is updated (Task 4); to preserve the "build green every commit" invariant, that migration lands in the same commit as the walker change.

These four files currently put `fn-body` blocks in `state.blocks` with `parentId: null` — violating the "only root has null parentId" invariant. Migrate them to `embedContents`.

- [ ] **Step 1: Audit each file**

```bash
for f in /Users/hansyu/code/taleweaver/packages/core/src/state/yjs-doc.test.ts /Users/hansyu/code/taleweaver/packages/core/src/state/delete-range.test.ts /Users/hansyu/code/taleweaver/packages/core/src/state/merge-blocks.test.ts /Users/hansyu/code/taleweaver/packages/core/src/state/replace-range.test.ts; do
  echo "=== $f ==="
  grep -n "fn-body\|fn-anchor\|footnote-body\|contentBlockId\|\"fn\"" "$f"
done
```

For each match, categorize:
- **Category A**: fn-body is genuinely an embed-content block (referenced via `EmbedItem.properties.contentBlockId` from a main-tree block). MIGRATE to `embedContents`; assertion `state.blocks.get("fn-body")` becomes `getEmbedContent(state, "fn-body" as BlockId)`.
- **Category B (special — orphan-position error test)**: `delete-range.test.ts:557` puts a `fn` block at top-level with no parent and no contentBlockId reference, deliberately, to trigger `comparePositions`'s "no common ancestor → different selection contexts" error. **Migrate this fn block to `embedContents` too** — the error path still works (`comparePositions` walks up the parent chain from `p` and never reaches a common ancestor with `fn`, which lives in a separate tree). The test assertion (the thrown error pattern) is unchanged. DO NOT delete this test.
- **Category C ("no-cascade-delete" tests)**: `delete-range.test.ts:313`, `merge-blocks.test.ts` (similar pattern), `replace-range.test.ts:285` — these test that an embed-content block SURVIVES the operation because the embed reference is TRANSFERRED to the new merged block (not orphaned). Post-P6: migrate the fn-body fixture to `embedContents`, swap the assertion from `getBlock` to `getEmbedContent`. The test logic still holds — `deleteRange`/`mergeAdjacentBlocks`/`replaceRange` move the focus block's inline content (including embed anchors) into the anchor block, so the embed reference survives. **These ops do NOT call `removeBlock`; they call `yBlocks.delete(focusId)` directly, bypassing Task 5's cascade-delete.** The fn-body in `embedContents` is therefore NOT cascade-deleted; the test name "(no cascade-delete)" remains accurate.

- [ ] **Step 2: Migrate Category A & B & C fixtures**

For each fixture:
- Move the fn-body `buildBlock(...)` from `blocks: [...]` to `embedContents: [...]`.
- Ensure the fn-body block has `parentId: null`.
- Update any assertions: `result.state.blocks.get("fn-body")` → `getEmbedContent(result.state, "fn-body" as BlockId)`; `state.blocks.has("fn-body")` → `getEmbedContent(state, "fn-body" as BlockId) !== null`.

For Category C tests, also verify the assertion text matches the new shape (e.g., the assertion name says "fn-body still in state.blocks" → rename to "fn-body still in embedContents").

- [ ] **Step 3: Per-file commit (4 commits)**

After each file:

```bash
npm test --workspace=packages/core -- "src/state/<file>.test.ts" 2>&1 | tail -10
```

Confirm green, then:

```bash
git add packages/core/src/state/<file>.test.ts
git commit -m "test(p6): migrate fn-body fixtures from blocks to embedContents in <file>"
```

After all 4 files, run full suite — expect green:

```bash
npm test --workspace=packages/core 2>&1 | tail -5
```

(clone-pasted-subtree.test.ts is unchanged at this point; its tests still pass against the pre-Task-4 walker because the source fixtures still use `state.blocks` for fn-body. Task 4 migrates that file's fixtures AND the walker in one atomic commit.)

---

## Task 4: Update `clonePastedSubtree` walker + return shape + migrate its tests

**Files (all in one atomic commit to preserve build-green invariant):**
- Modify: `packages/core/src/state/clone-pasted-subtree.ts`
- Modify: `packages/core/src/state/clone-pasted-subtree.test.ts` (fixture migration AND assertion updates AND new tests)

Three changes:
1. Walker resolves `EmbedItem.properties.contentBlockId` via `getEmbedContent` (not `getBlock`).
2. Return type adds `embedContents: ReadonlyMap<BlockId, Block>` field — cloned embed-content blocks go there, cloned tree blocks stay in `blocks`.
3. Test fixtures: move fn-body blocks from `blocks: [...]` to `embedContents: [...]`. Existing `result.blocks.has("cloned-fn-body-id")` assertions → `result.embedContents.has("cloned-fn-body-id")`.

- [ ] **Step 1: Read the legacy implementation**

```bash
cat /Users/hansyu/code/taleweaver/packages/core/src/state/clone-pasted-subtree.ts
```

Note the `collectSubtreeIds` walker (lines ~108-150) — it recurses on children via `getBlock` and on `contentBlockId` references via `getBlock` too. After P6: the contentBlockId recursion must use `getEmbedContent`.

Note `ClonedSubtree { blocks, rootId }` interface. After P6: add `embedContents: ReadonlyMap<BlockId, Block>`.

- [ ] **Step 2: Update the test contract**

Add new tests to `clone-pasted-subtree.test.ts` asserting:
- An embed-content block (in source's `embedContents`) gets cloned into the result's `embedContents` (NOT `blocks`).
- Nested embed-content references (fn-body containing a fn-anchor pointing to another fn-body) are recursively cloned with both bodies in `result.embedContents`.

Existing tests that already exercise contentBlockId rewriting will need their assertions updated from `result.blocks.has("cloned-fn-body-id")` to `result.embedContents.has("cloned-fn-body-id")`.

- [ ] **Step 3: Rewrite `clone-pasted-subtree.ts`**

Update the interface:

```typescript
export interface ClonedSubtree {
  readonly blocks: ReadonlyMap<BlockId, Block>;
  readonly embedContents: ReadonlyMap<BlockId, Block>;
  readonly rootId: BlockId;
}
```

Update `collectSubtreeIds` to recurse via `getEmbedContent` for contentBlockId references (and track which ids are embed-content vs tree). Concretely, change the walker signature to also accumulate an `embedContentIds: Set<BlockId>` so the output-building phase knows which map to put each cloned block in:

```typescript
function collectSubtreeIds(
  state: State,
  rootId: BlockId,
  idMap: Map<BlockId, BlockId>,
  embedContentIds: Set<BlockId>, // ids in idMap that came via contentBlockId
  allocator: IdAllocator,
): void {
  if (idMap.has(rootId)) return;
  const block = getBlock(state, rootId);
  if (block === null) return;
  idMap.set(rootId, allocator.allocate());

  // Walk children (main tree).
  let childId = block.firstChildId;
  while (childId !== null) {
    if (idMap.has(childId)) break;
    collectSubtreeIds(state, childId, idMap, embedContentIds, allocator);
    const child = getBlock(state, childId);
    childId = child?.nextSiblingId ?? null;
  }

  // Walk embed-content references — resolved via embedContents map.
  if (block.inlineContent !== null) {
    for (const item of block.inlineContent.items) {
      if (item.kind !== "embed") continue;
      const cbId = item.properties.contentBlockId;
      if (typeof cbId !== "string") continue;
      const embedBlock = getEmbedContent(state, cbId as BlockId);
      if (embedBlock === null) continue; // dangling reference; skip
      if (idMap.has(cbId as BlockId)) continue;
      idMap.set(cbId as BlockId, allocator.allocate());
      embedContentIds.add(idMap.get(cbId as BlockId)!); // track that the CLONED id is embed-content
      // Recurse on the embed-content block itself (it may contain its own embeds AND children).
      collectEmbedContentSubtreeIds(state, cbId as BlockId, idMap, embedContentIds, allocator);
    }
  }
}

// Parallel walker for embed-content subtrees: looks up via getEmbedContent.
function collectEmbedContentSubtreeIds(
  state: State,
  rootId: BlockId,
  idMap: Map<BlockId, BlockId>,
  embedContentIds: Set<BlockId>,
  allocator: IdAllocator,
): void {
  const block = getEmbedContent(state, rootId);
  if (block === null) return;
  // Note: rootId already in idMap and embedContentIds (set by caller).

  // Children of an embed-content block (if any) are themselves embed-content.
  let childId = block.firstChildId;
  while (childId !== null) {
    if (idMap.has(childId)) break;
    idMap.set(childId, allocator.allocate());
    embedContentIds.add(idMap.get(childId)!);
    collectEmbedContentSubtreeIds(state, childId, idMap, embedContentIds, allocator);
    const child = getEmbedContent(state, childId);
    childId = child?.nextSiblingId ?? null;
  }

  // Nested embed-content references within this embed-content's inlineContent.
  if (block.inlineContent !== null) {
    for (const item of block.inlineContent.items) {
      if (item.kind !== "embed") continue;
      const cbId = item.properties.contentBlockId;
      if (typeof cbId !== "string") continue;
      if (idMap.has(cbId as BlockId)) continue;
      const nested = getEmbedContent(state, cbId as BlockId);
      if (nested === null) continue;
      idMap.set(cbId as BlockId, allocator.allocate());
      embedContentIds.add(idMap.get(cbId as BlockId)!);
      collectEmbedContentSubtreeIds(state, cbId as BlockId, idMap, embedContentIds, allocator);
    }
  }
}
```

Update the output-building loop to partition by `embedContentIds`:

```typescript
const outBlocks = new Map<BlockId, Block>();
const outEmbedContents = new Map<BlockId, Block>();
for (const [sourceId, newId] of idMap.entries()) {
  const isEmbedContent = embedContentIds.has(newId);
  const source = isEmbedContent ? getEmbedContent(state, sourceId) : getBlock(state, sourceId);
  if (source === null) continue;
  const cloned: Block = Object.freeze({
    id: newId,
    type: source.type,
    attrs: Object.freeze({ ...source.attrs }),
    // Embed-content blocks have parentId === null by invariant; tree blocks
    // get their parentId remapped (root's parent is null).
    parentId: isEmbedContent
      ? null
      : sourceId === sourceRootId
        ? null
        : (source.parentId === null ? null : (idMap.get(source.parentId) ?? null)),
    prevSiblingId: source.prevSiblingId === null ? null : (idMap.get(source.prevSiblingId) ?? null),
    nextSiblingId: source.nextSiblingId === null ? null : (idMap.get(source.nextSiblingId) ?? null),
    firstChildId: source.firstChildId === null ? null : (idMap.get(source.firstChildId) ?? null),
    lastChildId: source.lastChildId === null ? null : (idMap.get(source.lastChildId) ?? null),
    inlineContent: source.inlineContent === null
      ? null
      : rewriteInlineContent(source.inlineContent, idMap),
  });
  (isEmbedContent ? outEmbedContents : outBlocks).set(newId, cloned);
}

return Object.freeze({
  blocks: outBlocks,
  embedContents: outEmbedContents,
  rootId: idMap.get(sourceRootId)!,
});
```

Update the existing tests' assertions accordingly.

- [ ] **Step 4: Run tests**

```bash
npm test --workspace=packages/core -- clone-pasted-subtree.test 2>&1 | tail -10
```

Expected: all pass (including Task 3's migrated fixtures + any new tests).

- [ ] **Step 5: Verify full suite**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
npm test --workspace=packages/core 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/state/clone-pasted-subtree.ts packages/core/src/state/clone-pasted-subtree.test.ts
git commit -m "feat(p6): clonePastedSubtree walks embedContents + segregates output by tree"
```

---

## Task 5: Implement `removeBlock` cascade-delete

**Files:**
- Modify: `packages/core/src/state/remove-block.ts`
- Modify: `packages/core/src/state/remove-block.test.ts`

Resolve the TODO at lines 30-37: when removing a block, walk its removed subtree's inlineContent for `EmbedItem.properties.contentBlockId` references; recursively delete each from `state.embedContents` (including the embed-content's own children + nested embed-content references).

**Scope clarification.** Cascade-delete fires ONLY when callers invoke `removeBlock` directly. Other ops that delete blocks (`deleteRange`, `replaceRange`) call `yBlocks.delete(id)` directly inside their transactions to bypass `removeBlock`'s overhead — and in those ops, the focus block's inline content (including any embed anchors) is TRANSFERRED into the anchor block before the delete. So embed references are preserved across `deleteRange`/`replaceRange`, not orphaned. Task 3's Category C tests pin this behavior. Future ops that add new block-deletion paths must either invoke `removeBlock` (free cascade) or replicate the cascade-collect manually.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/state/remove-block.test.ts`:

```typescript
import { getEmbedContent } from "./state";

describe("removeBlock — cascade-delete embed-content references", () => {
  it("removes a referenced fn-body when its anchor block is removed", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("hello"),
            embed("fn-anchor", { contentBlockId: "fn-body-1" }),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "fn-body-1",
          type: "fn-body",
          inlineContent: inlineContent([text("note")]),
        }),
      ],
    });
    expect(getEmbedContent(state, "fn-body-1" as BlockId)).not.toBeNull();

    const result = removeBlock(state, "p1" as BlockId);
    expect(getEmbedContent(result.state, "fn-body-1" as BlockId)).toBeNull();
    expect(result.dirtyIds.has("fn-body-1" as BlockId)).toBe(true);
  });

  it("recursively removes nested embed-content references (footnote in footnote)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([embed("fn-anchor", { contentBlockId: "outer" })]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "outer",
          type: "fn-body",
          inlineContent: inlineContent([embed("fn-anchor", { contentBlockId: "inner" })]),
        }),
        buildBlock({
          id: "inner",
          type: "fn-body",
          inlineContent: inlineContent([text("deep")]),
        }),
      ],
    });

    const result = removeBlock(state, "p1" as BlockId);
    expect(getEmbedContent(result.state, "outer" as BlockId)).toBeNull();
    expect(getEmbedContent(result.state, "inner" as BlockId)).toBeNull();
    expect(result.dirtyIds.has("outer" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("inner" as BlockId)).toBe(true);
  });

  it("does not double-delete when multiple anchors reference the same body (cycle defense)", () => {
    // Two paragraphs both reference the same fn-body. Removing one paragraph
    // should remove the fn-body. Removing the OTHER paragraph would normally
    // also try — but since the body is already gone, the walker must handle
    // the absence gracefully (defensive, but worth testing).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([embed("fn-anchor", { contentBlockId: "shared" })]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          inlineContent: inlineContent([embed("fn-anchor", { contentBlockId: "shared" })]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "shared",
          type: "fn-body",
          inlineContent: inlineContent([text("body")]),
        }),
      ],
    });
    const r1 = removeBlock(state, "p1" as BlockId);
    expect(getEmbedContent(r1.state, "shared" as BlockId)).toBeNull();
    // Now remove p2 — its anchor's contentBlockId still points at "shared" but the body is gone.
    expect(() => removeBlock(r1.state, "p2" as BlockId)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
npm test --workspace=packages/core -- "remove-block.test" 2>&1 | tail -15
```

Expected: 3 new tests fail (cascade-delete not yet implemented).

- [ ] **Step 3: Implement cascade-delete in `remove-block.ts`**

Read the current implementation. The cascade-delete pass should run INSIDE the existing `applyOperation` transaction. After the subtree ids are collected via `collectSubtreeIds`, walk those blocks' inlineContent collecting all `EmbedItem.properties.contentBlockId` references; then for each, recursively walk the embed-content subtree (children + further contentBlockId references) and delete from `embedContents`.

Sketch:

```typescript
// ... inside applyOperation, after subtreeIds is collected ...

const embedContentIdsToDelete = new Set<BlockId>();
for (const id of subtreeIds) {
  const block = getBlock(state, id);
  if (block === null || block.inlineContent === null) continue;
  for (const item of block.inlineContent.items) {
    if (item.kind !== "embed") continue;
    const cbId = item.properties.contentBlockId;
    if (typeof cbId !== "string") continue;
    collectEmbedContentSubtree(state, cbId as BlockId, embedContentIdsToDelete);
  }
}

const yEmbeds = getEmbedContentsMap(state.doc);
for (const id of embedContentIdsToDelete) {
  yEmbeds.delete(id);
}

// ... existing sibling rewire + main-tree subtree delete ...
```

Add helper `collectEmbedContentSubtree`:

```typescript
function collectEmbedContentSubtree(
  state: State,
  rootId: BlockId,
  out: Set<BlockId>,
): void {
  if (out.has(rootId)) return;
  const block = getEmbedContent(state, rootId);
  if (block === null) return;
  out.add(rootId);
  // Children (if any).
  let childId = block.firstChildId;
  while (childId !== null) {
    if (out.has(childId)) break;
    collectEmbedContentSubtree(state, childId, out);
    const child = getEmbedContent(state, childId);
    childId = child?.nextSiblingId ?? null;
  }
  // Nested embed-content references.
  if (block.inlineContent !== null) {
    for (const item of block.inlineContent.items) {
      if (item.kind !== "embed") continue;
      const cbId = item.properties.contentBlockId;
      if (typeof cbId !== "string") continue;
      collectEmbedContentSubtree(state, cbId as BlockId, out);
    }
  }
}
```

Remove the TODO comment in remove-block.ts (lines 30-37) — replace with a brief doc paragraph describing the cascade behavior.

- [ ] **Step 4: Run tests**

```bash
npm test --workspace=packages/core -- "remove-block.test" 2>&1 | tail -10
```

Expected: all pass (13 original + 3 new = 16).

- [ ] **Step 5: Run full suite**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
npm test --workspace=packages/core 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/state/remove-block.ts packages/core/src/state/remove-block.test.ts
git commit -m "feat(p6): removeBlock cascade-deletes embed-content references"
```

---

## Task 6: Final verification + cleanup audit

- [ ] **Step 1: Confirm no fn-body fixtures remain in state.blocks**

```bash
grep -rn "fn-body" /Users/hansyu/code/taleweaver/packages/core/src/state/*.test.ts | head -20
```

Inspect each match. Every fn-body should appear in `embedContents: [...]` array context OR be in a clearly-named contentBlockId reference within inline content. None should appear as a `buildBlock({ id: "fn-body...", parentId: null, ...})` directly inside `blocks: [...]`.

- [ ] **Step 2: Confirm the TODO is resolved**

```bash
grep -n "TODO" /Users/hansyu/code/taleweaver/packages/core/src/state/remove-block.ts
```

Should return nothing (the P6 TODO is gone).

- [ ] **Step 3: Full build + test**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: clean. Test count: ~1256 + ~14 new = ~1270 passing.

- [ ] **Step 4: If everything's green, no commit needed**

If anything fails, identify the cause and fix in a follow-up commit (don't squash — keep the per-task commits for review traceability).

- [ ] **Step 5: Browser smoke — deferred**

P6 doesn't touch render / paint / editor wiring. The new `embedContents` map and cascade-delete behavior will affect what downstream phases see, but no UI consumer of the new Y.Doc-backed state exists yet (legacy editor still drives the example apps via `StateNode`). Browser smoke is therefore deferred to the first downstream phase that wires the new state into a UI consumer (P7 render rewrite or P11.x editor cutover). Note in the final commit message that this is intentional.

## End of P6

After all 6 tasks: `state.embedContents` is fully populated, `removeBlock` cascade-deletes correctly, `clonePastedSubtree` segregates cloned output into the two maps, and test fixtures match the new shape. The "only root has null parentId" invariant holds for `state.blocks`. The TODO at `remove-block.ts:30-37` is resolved.

Downstream phases (P7 render rewrite, P8 components, P11.x editor migration) can build on top of `state.embedContents` without invariant gymnastics.

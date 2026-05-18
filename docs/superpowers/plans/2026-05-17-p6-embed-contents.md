# P6 — state.embedContents Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move embed-content blocks (footnote bodies, etc.) from `state.blocks` to `state.embedContents`. Implement `removeBlock`'s deferred cascade-delete. Restructure `clonePastedSubtree`'s output shape to separate cloned tree blocks from cloned embed-content blocks.

**Architecture:** P4e already plumbed the Y.Doc structure (`embedContents` is a `Y.Map<BlockId, Y.Map>` root sibling to `blocks`). `getEmbedContent(state, id)`, `getEmbedContentsMap(doc)`, `getYBlock(doc, id, op, "embedContent")`, and `SnapshotCache.embedContents` all exist. What's left: (1) writers must put embed-content blocks in the right map, (2) the cascade-delete TODO in `removeBlock` needs implementing, (3) `clonePastedSubtree` must look up contentBlockId references via the embedContents map AND segregate cloned content into the two output maps, (4) test fixtures must migrate to the new shape, (5) test-utils builder needs an `embedContents` parameter.

**Tech Stack:** Same as P4e (TypeScript, Vitest, Yjs).

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

The build stays green throughout. Each task has its own test cycle.

1. Task 1: `buildState` learns about `embedContents` (test-util change; no production-code impact).
2. Task 2: `getBlockFromEither` helper added (small unblocking helper).
3. Task 3: Migrate the four test files' fn-body fixtures from `state.blocks` to `embedContents`.
4. Task 4: `clonePastedSubtree` walker + return shape updated to two-map model.
5. Task 5: `removeBlock` cascade-delete implementation (resolves the TODO).
6. Task 6: Final verification (full build + test sweep + grep cleanup audit).

---

## Task 1: Extend `buildState` to accept embed-content blocks

**Files:**
- Modify: `packages/core/src/test-utils/state-builders.ts`
- Modify: `packages/core/src/test-utils/state-builders.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/test-utils/state-builders.test.ts`:

```typescript
import { getEmbedContent } from "../state/state";

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

## Task 3: Migrate fn-body fixtures across test files

**Files:**
- Modify: `packages/core/src/state/yjs-doc.test.ts`
- Modify: `packages/core/src/state/clone-pasted-subtree.test.ts`
- Modify: `packages/core/src/state/delete-range.test.ts`
- Modify: `packages/core/src/state/merge-blocks.test.ts`
- Modify: `packages/core/src/state/replace-range.test.ts`

These test files currently put `fn-body` blocks in `state.blocks` with `parentId: null` — violating the "only root has null parentId" invariant. Migrate them to `embedContents`.

**Important**: don't migrate test fixtures BLINDLY. Some `clone-pasted-subtree.test.ts` tests specifically verify that `clonePastedSubtree` walks contentBlockId references. Those tests need the fn-body in `embedContents` (where clonePastedSubtree looks for it after Task 4). Other tests may use fn-body merely as "another block id" — those can stay in `state.blocks` IF they aren't asserting embed-content-specific behavior (rename to a non-fn-body id, or keep in main tree with a real parent).

- [ ] **Step 1: Audit each test file**

For each of the 5 files, list every fn-body usage and categorize:
- **Category A**: fn-body is genuinely an embed-content block (referenced via `EmbedItem.properties.contentBlockId` from a main-tree block). MIGRATE to `embedContents`.
- **Category B**: fn-body is used as "just another block" with no contentBlockId pointer. Either rename to a generic id (e.g., `"side-x"`) or restructure as a real child block with a parent. Most likely the fixture INTENDED Category A but the spec didn't have a place to put it yet.

```bash
for f in /Users/hansyu/code/taleweaver/packages/core/src/state/yjs-doc.test.ts /Users/hansyu/code/taleweaver/packages/core/src/state/clone-pasted-subtree.test.ts /Users/hansyu/code/taleweaver/packages/core/src/state/delete-range.test.ts /Users/hansyu/code/taleweaver/packages/core/src/state/merge-blocks.test.ts /Users/hansyu/code/taleweaver/packages/core/src/state/replace-range.test.ts; do
  echo "=== $f ==="
  grep -n "fn-body\|fn-anchor\|contentBlockId" "$f"
done
```

Categorize each match. The most likely outcome: ALL are Category A (the spec lists them as preventive-cleanup targets).

- [ ] **Step 2: Migrate Category A fixtures**

For each fixture that's Category A:
- Move the fn-body `buildBlock(...)` from the `blocks: [...]` array to a NEW `embedContents: [...]` array.
- Ensure the fn-body block has `parentId: null` (embed-content blocks have no parent — they're referenced by id).
- Ensure the main-tree block that references it has the correct `EmbedItem.properties.contentBlockId` (this should already be the case).
- Update any assertions like `result.state.blocks.get("fn-body")` → `getEmbedContent(result.state, "fn-body" as BlockId)`.

- [ ] **Step 3: Per-file commit**

After migrating each file:

```bash
npm test --workspace=packages/core -- <file>.test 2>&1 | tail -10
```

Confirm green, then:

```bash
git add packages/core/src/state/<file>.test.ts
git commit -m "test(p6): migrate fn-body fixtures from blocks to embedContents in <file>"
```

Repeat for all 5 files. Five commits, one per file.

NOTE: clone-pasted-subtree.test.ts will likely fail until Task 4 lands (clonePastedSubtree doesn't yet look up contentBlockId in embedContents). If a test fails BECAUSE clonePastedSubtree can't find the fn-body, leave the test file in its migrated state and proceed to Task 4 — Task 4's success criterion is "these tests pass."

If clone-pasted-subtree.test.ts has tests that don't depend on the walker following contentBlockId, those should pass after migration alone.

- [ ] **Step 4: Run full suite**

```bash
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: most tests pass; some clone-pasted-subtree tests may fail pending Task 4. Document the failures in the Task 4 commit message.

---

## Task 4: Update `clonePastedSubtree` walker + return shape

**Files:**
- Modify: `packages/core/src/state/clone-pasted-subtree.ts`
- Modify: `packages/core/src/state/clone-pasted-subtree.test.ts`

Two changes:
1. Walker resolves `EmbedItem.properties.contentBlockId` via `getEmbedContent` (not `getBlock`).
2. Return type adds `embedContents: ReadonlyMap<BlockId, Block>` field — cloned embed-content blocks go there, cloned tree blocks stay in `blocks`.

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

## End of P6

After all 6 tasks: `state.embedContents` is fully populated, `removeBlock` cascade-deletes correctly, `clonePastedSubtree` segregates cloned output into the two maps, and test fixtures match the new shape. The "only root has null parentId" invariant holds for `state.blocks`. The TODO at `remove-block.ts:30-37` is resolved.

Downstream phases (P7 render rewrite, P8 components, P11.x editor migration) can build on top of `state.embedContents` without invariant gymnastics.

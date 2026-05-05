# State module redesign — Phase 4c-2: splitBlockAtPosition

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Layer 3 `splitBlockAtPosition` operation — split a leaf block at a given `Position` into two adjacent leaf siblings under the same parent. The new block carries the original's `type`, `attrs`, and `parentId`; gets a fresh `BlockId` from the injected `IdAllocator`; and is wired into the linked-list of children at the original block's `nextSibling` slot. This is the core operation behind "press Enter to break a paragraph in two."

**Architecture:** Per `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`, "Layered API surface > Layer 3" + "Data structures" + "ID generation" sections. Slicing of inline content uses Phase 1's `findItemAtOffset` helper (see `inline-content.ts`). Linked-list splice mirrors Phase 4a's `insertBlock` pattern (sibling-pointer + parent-childpointer updates). No run-merging post-pass is needed: a clean prefix slice + suffix slice cannot introduce new same-attrs adjacencies that didn't already exist within their respective halves (the original input was already normalized).

**Tech Stack:** TypeScript 5.7, vitest 3.0, npm workspaces.

**Spec reference:** `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`. Implements `splitBlockAtPosition` from "Layered API surface > Layer 3."

**Phase 1 - 4c-1 status (assumed complete):**
- Phase 1 — Layer 1 types. Last commit `4230343`.
- Phase 2 — Layer 2 utilities. Last commit `b27bffa`.
- Phase 3 — Cascade attribute interpreters. Last commit `413728a`.
- Phase 4a — Simple block-level operations + barrel. Last commit `cc2b249`.
- Phase 4b — `insertText`. Last commit `597bad1`.
- Phase 4c-1 — `applyAttrsToRange`. Last commit `107f39a`.
- Build green; 1065 tests passing + 4 skipped.

**Per-phase scope notes:**

- New files: `state/split-block.ts` and `state/split-block.test.ts`. Confirmed at plan-write time that NEITHER file exists.
- Modify: `state/operations.ts` (one new export line) and `state/operations.test.ts` (one new assertion). Authorized.
- **Critical implementer guard (per memory `feedback_implementer_create_collision.md`):** if any file the plan asks to CREATE already exists, the implementer must STOP and report `BLOCKED`; never silently refactor, rename, or consolidate. Verified by the controller before dispatch.
- Per CLAUDE.md: TDD throughout. Verify with both `npm test` AND `npm run build`.
- Type safety: no non-null assertions (`!`); use proper narrowing.
- **Test-builder dependencies (verified at plan-write time):** `text` and `embed` are both exported from `packages/core/src/test-utils/state-builders.ts` (around lines 8-22). `buildBlock` and `buildState` likewise. `createTestAllocator` is exported from `state/block-id.ts`. `createInlineContent` is exported from `state/inline-content.ts`. `createPosition` is exported from `state/block-position.ts`. No new builder helpers are required.

**Why the original block keeps its id and the new block gets a fresh id:** this matches Word and Google Docs paragraph-identity semantics — the paragraph BEFORE the cursor retains its formatting, comment anchors, tracked-change anchors, etc.; a new paragraph is born AFTER it. Pressing Enter mid-paragraph "creates a paragraph after," not "splits both halves into siblings of a parent." The "original keeps id" discipline matches that mental model and matches what every collaborative-editing system anchors to.

**Operation signature:**

```typescript
function splitBlockAtPosition(
  state: State,
  position: Position,
  allocator: IdAllocator,
): OperationResult;
```

Notes:
- `position.blockId` must reference an existing leaf block (one with non-null `inlineContent` and no `firstChildId`).
- `position.offset` must satisfy `0 <= offset <= inlineContentLength(block.inlineContent)`.
- The block must NOT be the root (root has `parentId === null`; we cannot create a sibling for the root in the same parent's linked list).
- After the split:
  - The original block keeps its `id`, `type`, `attrs`, `parentId`, `prevSiblingId`, `firstChildId`, `lastChildId` (null), and gets `inlineContent` containing items from `[0, offset)`. Its `nextSiblingId` is updated to the new block's id.
  - A new block is created with a fresh id from `allocator.allocate()`, the original block's `type`, `attrs`, `parentId`. Its `prevSiblingId` is the original block's id; its `nextSiblingId` is what the original block's `nextSiblingId` was. Its `firstChildId`/`lastChildId` are null. Its `inlineContent` contains items from `[offset, length)`.
- If the original block had a `nextSibling`, that sibling's `prevSiblingId` is rewired to the new block's id.
- If the original block was the last child of its parent (no `nextSibling`), the parent's `lastChildId` is updated to the new block's id.
- `firstChildId` of the parent never changes (the original block keeps its position; it's still the first slot if it was before).
- Throws on:
  - missing block,
  - container block (firstChildId !== null OR inlineContent === null),
  - root block (parentId === null),
  - offset < 0 or offset > inlineContentLength.

**Inline-item slicing semantics:**

Given `position.offset`, the original `inlineContent.items` are partitioned into `leftItems` and `rightItems`:

- Boundary case (`findItemAtOffset` returns `withinItem === 0`): clean array slice. `leftItems = items[0..itemIndex)`, `rightItems = items[itemIndex..)`.
- Mid-text-item case (`withinItem > 0` on a `TextItem`): the item at `itemIndex` is split into a left half (chars `[0..withinItem)`) and a right half (chars `[withinItem..)`). Both halves preserve the original item's `attrs`. Items with empty text are not emitted (defensive — should not occur for `withinItem > 0`).
- Mid-embed case (`withinItem > 0` on an `EmbedItem`): unreachable per `findItemAtOffset`'s contract (embeds count as 1 cursor position; offsets land at `withinItem === 0` of the next item). Defensive throw if it ever happens.

**Empty halves:** are valid and intentional. `offset === 0` produces an empty-content original block (`inlineContent.items = []`) and a new block holding everything; `offset === inlineContentLength` produces a new empty-content block. This matches Word/Google Docs "Enter at start/end of paragraph" semantics.

**Why no run-merging post-pass:** the input items array is already normalized (no adjacent same-attrs text items). Splitting at any point produces two arrays, each a contiguous sub-sequence of the input — possibly with one boundary item replaced by a head/tail slice (mid-text-item case). Within each half:

- The interior items are unchanged from the input, so they retain their existing non-same-attrs adjacencies.
- The boundary item, if it was split mid-text, has the same `attrs` as the original whole item — so the slice's neighbor on each side has different attrs (otherwise normalization would have merged them with the original whole item before the split). No new same-attrs adjacency is introduced.

Across the two halves there is also no merging concern: they go into different `Block` objects.

So skipping the post-pass is correct, not a shortcut.

**dirtyIds contract:**

The returned `dirtyIds` set contains:
- The original block's id (its `inlineContent` and `nextSiblingId` changed).
- The new block's id (it's a new entry in `state.blocks`).
- The original block's previous `nextSiblingId`, IF non-null (its `prevSiblingId` was rewired to the new block's id).
- The parent block's id, IF the original block was the last child (parent's `lastChildId` was updated).

The parent is **not** dirtied when the original block was a middle/first child — neither `firstChildId` nor `lastChildId` changes in those cases, and per the spec ("`dirtyIds` is produced at write-time," line 291) we only dirty blocks whose entry in `state.blocks` actually differs. (Note: this is stricter than Phase 4a `insertBlock`'s pattern, which always rewrites and dirties the parent because its child-pointer update logic is unconditional. `splitBlockAtPosition` only writes the parent when `lastChildId` actually changes.)

---

## File structure (this phase)

**Created:**

| Path | Responsibility |
|---|---|
| `packages/core/src/state/split-block.ts` | `splitBlockAtPosition(state, position, allocator) → OperationResult` |
| `packages/core/src/state/split-block.test.ts` | Unit tests covering item-shapes, edge offsets, linked-list correctness, invariants, and error cases. |

**Modified:**

| Path | Change |
|---|---|
| `packages/core/src/state/operations.ts` | Append `export { splitBlockAtPosition } from "./split-block";` to the Phase 4c-1 section (or a new "Phase 4c-2 operations" section). |
| `packages/core/src/state/operations.test.ts` | Add `expect(typeof ops.splitBlockAtPosition).toBe("function");` assertion (a new `it()` block, OR appended to the existing Phase 4c-1 assertion as a Phase 4c-2 line — see Task 7 for exact form). |

**Deleted:** none.

---

## Task 1: splitBlockAtPosition — create file with full implementation + sanity test

**Files:**
- Create: `packages/core/src/state/split-block.ts`
- Create: `packages/core/src/state/split-block.test.ts`

- [ ] **Step 1: Write the failing test (split-block.test.ts)**

```typescript
import { describe, it, expect } from "vitest";
import { splitBlockAtPosition } from "./split-block";
import { buildBlock, buildState, text } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createPosition } from "./block-position";
import { createTestAllocator, type BlockId } from "./block-id";

describe("splitBlockAtPosition — single-block, mid-text-item split", () => {
  // doc > [p("hello world")]
  // Split at offset 5: p_left = "hello", new block = " world"
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world")]) }),
      ],
    });

  it("splits the leaf block into two adjacent siblings", () => {
    const state = fixture();
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 5), allocator);

    // Original block: same id, content "hello", nextSibling rewired to new block.
    const left = result.state.blocks.get("p" as BlockId);
    expect(left).toBeDefined();
    expect(left?.id).toBe("p");
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello" });
    expect(left?.nextSiblingId).toBe("p2-0");

    // New block: id from allocator, content " world", parentId same as original.
    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right).toBeDefined();
    expect(right?.type).toBe("paragraph");
    expect(right?.parentId).toBe("doc");
    expect(right?.prevSiblingId).toBe("p");
    expect(right?.nextSiblingId).toBeNull();
    expect(right?.firstChildId).toBeNull();
    expect(right?.lastChildId).toBeNull();
    expect(right?.inlineContent?.items).toHaveLength(1);
    expect(right?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: " world" });

    // Parent: lastChildId updated to new block (original was the only/last child).
    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p");
    expect(parent?.lastChildId).toBe("p2-0");

    // dirtyIds: { p, p2-0, doc }. (No nextSibling existed to rewire; parent.lastChildId changed → parent dirty.)
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p", "p2-0", "doc"]));
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npm test --workspace=packages/core -- split-block --run`
Expected: FAIL with module-not-found / `splitBlockAtPosition is not defined`.

- [ ] **Step 3: Write the production code (split-block.ts)**

```typescript
import type { State, OperationResult } from "./state";
import type { BlockId, IdAllocator } from "./block-id";
import type { Position } from "./block-position";
import {
  createInlineContent,
  createTextItem,
  inlineContentLength,
  findItemAtOffset,
  type InlineContent,
  type InlineItem,
} from "./inline-content";
import { createBlock, type Block } from "./block";

/**
 * Split a leaf block at `position` into two adjacent siblings under the
 * same parent.
 *
 * The original block keeps its id, type, attrs, parentId, prevSiblingId.
 * Its inlineContent becomes items in [0, offset). Its nextSiblingId is
 * rewired to the new block.
 *
 * A new block is created with a fresh id from `allocator`, carrying the
 * original block's type, attrs, parentId. Its prevSiblingId is the
 * original block's id; its nextSiblingId is the original block's
 * previous nextSiblingId. Its inlineContent is items in
 * [offset, length).
 *
 * Returns OperationResult with dirtyIds containing:
 *   - the original block's id (content + nextSiblingId changed)
 *   - the new block's id (new entry)
 *   - the original's previous nextSibling, if non-null (its prevSiblingId
 *     was rewired)
 *   - the parent's id, if the original was the last child (parent's
 *     lastChildId updated)
 *
 * Throws if:
 *   - the block does not exist,
 *   - the block is a container (has firstChildId or null inlineContent),
 *   - the block is the root (parentId === null),
 *   - the offset is out of range [0, inlineContentLength].
 */
export function splitBlockAtPosition(
  state: State,
  position: Position,
  allocator: IdAllocator,
): OperationResult {
  const block = state.blocks.get(position.blockId);
  if (!block) {
    throw new Error(`splitBlockAtPosition: block "${position.blockId}" not found`);
  }
  if (!block.inlineContent || block.firstChildId !== null) {
    throw new Error(
      `splitBlockAtPosition: block "${position.blockId}" is a container, not a leaf`,
    );
  }
  if (block.parentId === null) {
    throw new Error(
      `splitBlockAtPosition: block "${position.blockId}" is the root and has no parent to host a sibling`,
    );
  }
  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `splitBlockAtPosition: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }

  const [leftItems, rightItems] = splitInlineContentAtOffset(
    block.inlineContent,
    position.offset,
  );

  const newId = allocator.allocate();

  // New block: same type/attrs/parent; sits between original and original's old next sibling.
  const newBlock = createBlock({
    id: newId,
    type: block.type,
    attrs: block.attrs,
    parentId: block.parentId,
    prevSiblingId: block.id,
    nextSiblingId: block.nextSiblingId,
    inlineContent: createInlineContent(rightItems),
  });

  // Updated original block: keeps id/type/attrs/parent/prev; nextSiblingId rewired to newId; new inline content.
  const updatedOriginal = createBlock({
    id: block.id,
    type: block.type,
    attrs: block.attrs,
    parentId: block.parentId,
    prevSiblingId: block.prevSiblingId,
    nextSiblingId: newId,
    inlineContent: createInlineContent(leftItems),
  });

  let blocks = state.blocks.set(block.id, updatedOriginal).set(newId, newBlock);
  const dirtyIds = new Set<BlockId>([block.id, newId]);

  // Rewire the original block's old next sibling, if any.
  if (block.nextSiblingId) {
    const oldNext = state.blocks.get(block.nextSiblingId);
    if (!oldNext) {
      throw new Error(
        `splitBlockAtPosition: original block's next sibling "${block.nextSiblingId}" not found`,
      );
    }
    blocks = blocks.set(block.nextSiblingId, withPrevSibling(oldNext, newId));
    dirtyIds.add(block.nextSiblingId);
  } else {
    // Original was the last child of its parent — parent's lastChildId now points to the new block.
    const parent = state.blocks.get(block.parentId);
    if (!parent) {
      throw new Error(
        `splitBlockAtPosition: parent "${block.parentId}" of block "${block.id}" not found`,
      );
    }
    blocks = blocks.set(block.parentId, withLastChild(parent, newId));
    dirtyIds.add(block.parentId);
  }

  return {
    state: { ...state, blocks },
    dirtyIds,
  };
}

/**
 * Partition `content.items` at `offset` into [leftItems, rightItems].
 *
 * - Clean boundary (offset falls between items, or at start/end of content):
 *   pure array slice, no item splitting.
 * - Mid-text (offset falls inside a text item): split that item into its
 *   left and right halves; both halves preserve the original item's attrs.
 * - Mid-embed: unreachable per findItemAtOffset's contract (embeds count
 *   as one cursor position; offsets at embed boundaries return withinItem=0).
 *   Throws defensively.
 */
function splitInlineContentAtOffset(
  content: InlineContent,
  offset: number,
): [InlineItem[], InlineItem[]] {
  const items = content.items;
  const { itemIndex, withinItem } = findItemAtOffset(content, offset);

  if (withinItem === 0) {
    return [items.slice(0, itemIndex), items.slice(itemIndex)];
  }

  // withinItem > 0: must be a text item per findItemAtOffset's contract.
  const straddle = items[itemIndex];
  if (straddle.kind !== "text") {
    throw new Error(
      `splitBlockAtPosition: offset falls inside non-text item at index ${itemIndex} (kind="${straddle.kind}")`,
    );
  }
  const leftHead = createTextItem(straddle.text.slice(0, withinItem), straddle.attrs);
  const rightHead = createTextItem(straddle.text.slice(withinItem), straddle.attrs);
  return [
    [...items.slice(0, itemIndex), leftHead],
    [rightHead, ...items.slice(itemIndex + 1)],
  ];
}

function withPrevSibling(b: Block, prevSiblingId: BlockId | null): Block {
  return createBlock({
    id: b.id,
    type: b.type,
    attrs: b.attrs,
    parentId: b.parentId,
    prevSiblingId,
    nextSiblingId: b.nextSiblingId,
    firstChildId: b.firstChildId,
    lastChildId: b.lastChildId,
    inlineContent: b.inlineContent,
  });
}

function withLastChild(b: Block, lastChildId: BlockId | null): Block {
  return createBlock({
    id: b.id,
    type: b.type,
    attrs: b.attrs,
    parentId: b.parentId,
    prevSiblingId: b.prevSiblingId,
    nextSiblingId: b.nextSiblingId,
    firstChildId: b.firstChildId,
    lastChildId,
    inlineContent: b.inlineContent,
  });
}
```

(Note: `splitBlockAtPosition` only ever updates the parent's `lastChildId`, never `firstChildId` — the original block keeps its position, so the parent's first slot is unchanged regardless of the split. Hence only `withPrevSibling` and `withLastChild` are needed. Don't add a `withFirstChild` helper unless a future operation needs it.)

- [ ] **Step 4: Run tests — verify pass**

Run: `npm test --workspace=packages/core -- split-block --run`
Expected: PASS (1 test).

Run: `npm run build --workspace=packages/core`
Expected: clean (will catch the dead-code helper if it's still there — TypeScript reports unused symbols only on `noUnusedLocals: true`; vitest is permissive. Verify by reading the diff.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/split-block.ts packages/core/src/state/split-block.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add splitBlockAtPosition Layer 3 operation — basic case

Splits a leaf block at a Position into two adjacent leaf siblings under
the same parent. Original keeps its id/type/attrs/parent and gets the
left half of inline content; new block (fresh id from IdAllocator) gets
the right half. Linked-list spliced; parent's lastChildId updated when
the original was the last child.

First test covers the simplest mid-text-item case with a single-paragraph
document. Subsequent tasks add coverage for boundary splits, multi-item
content, embed boundaries, edge offsets, linked-list variants,
invariants, and error cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Context

**Working directory:** `/Users/hansyu/code/taleweaver/`
**Branch:** `feature/dom-architecture-redesign` (commit directly here, no branch switching).

**Where this fits:** Phase 4c-2 task 1 of 7. Phase 4c-1 just shipped `applyAttrsToRange`. This task starts the next Layer 3 operation: `splitBlockAtPosition`. The implementation handles all item-shape and offset cases in one go (the slicing logic is unified); this task's test covers only the simplest case. Tasks 2-6 add coverage; Task 7 wires the barrel.

**Critical implementer guard:** if `state/split-block.ts` OR `state/split-block.test.ts` already exists, STOP and report `BLOCKED`. The plan asserts neither file exists.

**Important — verify with both `npm test` AND `npm run build`:** vitest is more permissive than tsc.

**Conventions:** TDD; HEREDOC commit message verbatim; auto-commit on user's behalf; vitest 3.0; no non-null assertions.

## Your Job

Execute steps 1-5 in order. After writing the production code, self-review for: (a) unused helpers (the spec says only `withPrevSibling` and `withLastChild` are needed — do not add others), (b) `!` non-null assertions, (c) any drift from the spec. Then commit and run final verification.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Test output AND build output
- Files changed (with commit SHA)
- Self-review findings

---

## Task 2: splitBlockAtPosition — item-shape coverage (boundary, multi-item, embed)

**Files:**
- Modify: `packages/core/src/state/split-block.test.ts` (append tests only)

- [ ] **Step 1: Append the item-shape tests**

```typescript
describe("splitBlockAtPosition — split at text-item boundary", () => {
  it("splits cleanly between two text items without splitting either", () => {
    // Block: [text("hello") {}, text(" world") { italic: true }] — total length 11.
    // Split at offset 5 — exactly between the two items.
    // Expected: left [text("hello")], right [text(" world", italic)]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("hello"), text(" world", { italic: true })]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 5), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello", attrs: {} });

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toHaveLength(1);
    expect(right?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: " world", attrs: { italic: true } });
  });
});

describe("splitBlockAtPosition — split inside a multi-item block (preserves attrs on both halves)", () => {
  it("splits inside the styled middle of three text items, preserving attrs on both halves of the split item", () => {
    // Block: [text("ab", {}), text("cd", { bold: true }), text("ef", {})] — normalized
    // (no two adjacent items share attrs). Total length 6.
    // Split at offset 3 — falls inside the bold "cd" at within=1.
    // Expected:
    //   left  = [text("ab", {}), text("c", { bold: true })]
    //   right = [text("d", { bold: true }), text("ef", {})]
    // Both halves of the split bold item must carry { bold: true } — this is the
    // most likely place an attrs-preservation bug would silently strip formatting
    // (e.g., createTextItem(slice) without the attrs arg). Pin it explicitly.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([
            text("ab"),
            text("cd", { bold: true }),
            text("ef"),
          ]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 3), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(2);
    expect(left?.inlineContent?.items[0]).toMatchObject({ text: "ab", attrs: {} });
    expect(left?.inlineContent?.items[1]).toMatchObject({ text: "c", attrs: { bold: true } });

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toHaveLength(2);
    expect(right?.inlineContent?.items[0]).toMatchObject({ text: "d", attrs: { bold: true } });
    expect(right?.inlineContent?.items[1]).toMatchObject({ text: "ef", attrs: {} });
  });
});

describe("splitBlockAtPosition — split at embed-item boundaries", () => {
  it("splits at the leading edge of an embed item (offset = pre-embed length)", () => {
    // Block: [text("a"), embed("img"), text("b")] — total length 3.
    // Split at offset 1 — exactly at the leading edge of the embed.
    // Expected: left [text("a")], right [embed("img"), text("b")]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("a"), embed("img"), text("b")]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 1), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "a" });

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toHaveLength(2);
    expect(right?.inlineContent?.items[0]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(right?.inlineContent?.items[1]).toMatchObject({ kind: "text", text: "b" });
  });

  it("splits at the trailing edge of an embed item (offset = pre-embed length + 1)", () => {
    // Same fixture as above. Split at offset 2 — just after the embed.
    // Expected: left [text("a"), embed("img")], right [text("b")]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("a"), embed("img"), text("b")]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 2), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(2);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "a" });
    expect(left?.inlineContent?.items[1]).toMatchObject({ kind: "embed", embedType: "img" });

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toHaveLength(1);
    expect(right?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "b" });
  });

  it("splits at offset 0 in a block whose first item is an embed", () => {
    // Block: [embed("img"), text("a")] — total length 2.
    // Split at offset 0 — leading edge of the embed.
    // Expected: left [], right [embed("img"), text("a")]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([embed("img"), text("a")]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 0), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toEqual([]);

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toHaveLength(2);
    expect(right?.inlineContent?.items[0]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(right?.inlineContent?.items[1]).toMatchObject({ kind: "text", text: "a" });
  });
});
```

- [ ] **Step 2: Append the import for `embed` test-builder**

The Task 1 test file imports `text` only. Update the line:

```typescript
import { buildBlock, buildState, text } from "../test-utils/state-builders";
```

to:

```typescript
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
```

- [ ] **Step 3-5: Run / build / commit**

Run: `npm test --workspace=packages/core -- split-block --run` → PASS (6 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/split-block.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover splitBlockAtPosition item-shape variants

Five new tests:
- split exactly at the boundary between two text items (no item splitting).
- split inside the styled middle of three text items, preserving attrs
  on both halves of the split item (pins attrs-preservation contract).
- split at the leading edge of an embed item.
- split at the trailing edge of an embed item.
- split at offset 0 of a block whose first item is an embed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: splitBlockAtPosition — edge offsets (offset=0, offset=total length, empty block)

**Files:**
- Modify: `packages/core/src/state/split-block.test.ts` (append tests only)

- [ ] **Step 1: Append the edge-offset tests**

```typescript
describe("splitBlockAtPosition — edge offsets", () => {
  it("offset=0 produces an empty original block + new block holding all original content", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 0), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toEqual([]);

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toHaveLength(1);
    expect(right?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello" });

    // Parent's lastChildId rewired (original was the last child).
    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p2-0");

    // dirtyIds: original block, new block, parent (lastChildId changed).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p", "p2-0", "doc"]));
  });

  it("offset=total length produces a full original block + empty new block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 5), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello" });

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toEqual([]);

    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p2-0");
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p", "p2-0", "doc"]));
  });

  it("splits an empty leaf block at offset 0 into two empty siblings", () => {
    // Empty paragraph — pressing Enter on an empty line should produce two empty paragraphs.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([]) }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 0), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toEqual([]);

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toEqual([]);
    expect(right?.type).toBe("paragraph");
    expect(right?.parentId).toBe("doc");
    expect(right?.prevSiblingId).toBe("p");

    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p2-0");
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p", "p2-0", "doc"]));
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- split-block --run` → PASS (9 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/split-block.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover splitBlockAtPosition edge offsets

Three new tests:
- offset=0: empty original block + new block holding all content.
- offset=total length: full original block + empty new block.
- splitting an empty leaf produces two empty siblings (Enter-on-empty-line).

Each asserts parent's lastChildId is rewired to the new block and
dirtyIds = { original, new, parent }.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: splitBlockAtPosition — linked-list correctness across sibling configurations

**Files:**
- Modify: `packages/core/src/state/split-block.test.ts` (append tests only)

- [ ] **Step 1: Append the linked-list tests**

```typescript
describe("splitBlockAtPosition — linked-list correctness", () => {
  // doc > [p1, p2, p3] — split p2.
  const threeChildFixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("two")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("three")]) }),
      ],
    });

  it("middle child split: prev sibling's nextSiblingId unchanged; next sibling's prevSiblingId rewired; parent unchanged", () => {
    const state = threeChildFixture();
    const allocator = createTestAllocator("p2b");
    const result = splitBlockAtPosition(state, createPosition("p2" as BlockId, 1), allocator);

    expect(result.state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p2"); // unchanged
    expect(result.state.blocks.get("p2" as BlockId)?.nextSiblingId).toBe("p2b-0"); // rewired
    expect(result.state.blocks.get("p2b-0" as BlockId)?.prevSiblingId).toBe("p2");
    expect(result.state.blocks.get("p2b-0" as BlockId)?.nextSiblingId).toBe("p3");
    expect(result.state.blocks.get("p3" as BlockId)?.prevSiblingId).toBe("p2b-0"); // rewired

    // Parent's first/last unchanged (split was a middle child).
    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1");
    expect(parent?.lastChildId).toBe("p3");

    // dirtyIds: { p2, p2b-0, p3 }. Parent NOT dirty (no first/last change).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p2", "p2b-0", "p3"]));
  });

  it("first-child split: parent's firstChildId unchanged (still original); next sibling's prevSiblingId rewired", () => {
    const state = threeChildFixture();
    const allocator = createTestAllocator("p1b");
    const result = splitBlockAtPosition(state, createPosition("p1" as BlockId, 1), allocator);

    expect(result.state.blocks.get("p1" as BlockId)?.prevSiblingId).toBeNull(); // unchanged
    expect(result.state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p1b-0");
    expect(result.state.blocks.get("p1b-0" as BlockId)?.prevSiblingId).toBe("p1");
    expect(result.state.blocks.get("p1b-0" as BlockId)?.nextSiblingId).toBe("p2");
    expect(result.state.blocks.get("p2" as BlockId)?.prevSiblingId).toBe("p1b-0"); // rewired

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1"); // unchanged
    expect(parent?.lastChildId).toBe("p3"); // unchanged

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p1b-0", "p2"]));
  });

  it("last-child split: parent's lastChildId rewired to new block; no next sibling existed", () => {
    const state = threeChildFixture();
    const allocator = createTestAllocator("p3b");
    const result = splitBlockAtPosition(state, createPosition("p3" as BlockId, 2), allocator);

    expect(result.state.blocks.get("p3" as BlockId)?.nextSiblingId).toBe("p3b-0");
    expect(result.state.blocks.get("p3b-0" as BlockId)?.prevSiblingId).toBe("p3");
    expect(result.state.blocks.get("p3b-0" as BlockId)?.nextSiblingId).toBeNull();

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1"); // unchanged
    expect(parent?.lastChildId).toBe("p3b-0"); // rewired

    // dirtyIds: { p3, p3b-0, doc }. Parent dirty because lastChildId changed.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p3", "p3b-0", "doc"]));
  });

  it("nested-block split: leaf nested inside a section uses the section as the parent for sibling linkage", () => {
    // doc > section > [p_only] — split p_only.
    // The section is the parent of p_only; the section's lastChildId should be rewired to the new block.
    // doc's child pointers (firstChildId/lastChildId = "section") are unchanged.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p_only", lastChildId: "p_only" }),
        buildBlock({ id: "p_only", type: "paragraph", parentId: "section", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const allocator = createTestAllocator("pNew");
    const result = splitBlockAtPosition(state, createPosition("p_only" as BlockId, 3), allocator);

    // New block's parent is the section, NOT the doc.
    const right = result.state.blocks.get("pNew-0" as BlockId);
    expect(right?.parentId).toBe("section");

    // Section's child pointers: firstChildId unchanged (still p_only), lastChildId rewired to new block.
    const section = result.state.blocks.get("section" as BlockId);
    expect(section?.firstChildId).toBe("p_only");
    expect(section?.lastChildId).toBe("pNew-0");

    // doc's child pointers untouched.
    const doc = result.state.blocks.get("doc" as BlockId);
    expect(doc?.firstChildId).toBe("section");
    expect(doc?.lastChildId).toBe("section");

    // dirtyIds: section dirtied (lastChildId changed); doc NOT dirtied.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p_only", "pNew-0", "section"]));
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- split-block --run` → PASS (13 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/split-block.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover splitBlockAtPosition linked-list variants

Four new tests verifying sibling-pointer + parent-childpointer updates
across the structural cases:
- middle child split (prev unchanged, next rewired, parent unchanged).
- first child split (firstChildId unchanged — still original).
- last child split (parent's lastChildId rewired to new block).
- nested-block split (parent of nested leaf is its container, not the
  document root; only the immediate parent is dirtied).

dirtyIds asserted in each case: parent appears in dirtyIds only when
its firstChildId or lastChildId actually changed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: splitBlockAtPosition — block-level invariants (type, attrs, allocator, structural sharing)

**Files:**
- Modify: `packages/core/src/state/split-block.test.ts` (append tests only)

- [ ] **Step 1: Append the invariant tests**

```typescript
describe("splitBlockAtPosition — block-level invariants", () => {
  it("new block inherits type, attrs, and parentId from the original", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "li" }),
        buildBlock({
          id: "li",
          type: "list-item",
          attrs: { level: 2, ordered: true },
          parentId: "doc",
          inlineContent: createInlineContent([text("hello")]),
        }),
      ],
    });
    const allocator = createTestAllocator("li2");
    const result = splitBlockAtPosition(state, createPosition("li" as BlockId, 3), allocator);

    const right = result.state.blocks.get("li2-0" as BlockId);
    expect(right?.type).toBe("list-item");
    expect(right?.attrs).toEqual({ level: 2, ordered: true });
    expect(right?.parentId).toBe("doc");
  });

  it("new block id comes from allocator.allocate()", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator("custom");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 1), allocator);

    expect(result.state.blocks.has("custom-0" as BlockId)).toBe(true);
    expect(result.state.blocks.get("p" as BlockId)?.nextSiblingId).toBe("custom-0");
  });

  it("preserves structural sharing: untouched blocks retain object identity", () => {
    // doc > [p1, p2, p3] — split p2; p1 should keep identity. (p3 is rewired, so its identity changes.)
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("two")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("three")]) }),
      ],
    });
    const beforeP1 = state.blocks.get("p1" as BlockId);
    const allocator = createTestAllocator("p2b");
    const result = splitBlockAtPosition(state, createPosition("p2" as BlockId, 1), allocator);
    expect(result.state.blocks.get("p1" as BlockId)).toBe(beforeP1);
  });

  it("does not mutate the original state", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 2), allocator);

    expect(result.state).not.toBe(state);
    // Original state's "p" block still has its original content + nextSibling.
    expect(state.blocks.get("p" as BlockId)?.inlineContent?.items[0]).toMatchObject({ text: "hello" });
    expect(state.blocks.get("p" as BlockId)?.nextSiblingId).toBeNull();
    expect(state.blocks.has("p2-0" as BlockId)).toBe(false);
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- split-block --run` → PASS (17 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/split-block.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover splitBlockAtPosition block-level invariants

Four new tests:
- new block inherits type/attrs/parentId from the original.
- new block id is sourced from the injected IdAllocator.
- structural sharing: blocks not touched by the split retain object identity.
- the original state is not mutated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: splitBlockAtPosition — error cases

**Files:**
- Modify: `packages/core/src/state/split-block.test.ts` (append tests only)

- [ ] **Step 1: Append the error-case tests**

```typescript
describe("splitBlockAtPosition — error cases", () => {
  it("throws when the block does not exist", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(state, createPosition("missing" as BlockId, 0), allocator),
    ).toThrow(/not found/);
  });

  it("throws when the block is a container (firstChildId is set)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "s", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(state, createPosition("s" as BlockId, 0), allocator),
    ).toThrow(/container/);
  });

  it("throws when the block has null inlineContent (independent of firstChildId)", () => {
    // A block with inlineContent === null is container-shaped even if firstChildId
    // is also null. The container guard rejects on EITHER condition; this test pins
    // the inlineContent === null arm so a future regression that changes || to &&
    // (or removes the inlineContent check) is caught.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc" }), // null inlineContent AND null firstChildId
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(state, createPosition("s" as BlockId, 0), allocator),
    ).toThrow(/container/);
  });

  it("throws when the block is the root (parentId is null)", () => {
    // Root block, leaf-shaped (atypical but legal — a single-paragraph "document" root).
    const state = buildState({
      rootId: "p",
      blocks: [
        buildBlock({ id: "p", type: "paragraph", parentId: null, inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(state, createPosition("p" as BlockId, 1), allocator),
    ).toThrow(/root/);
  });

  it("throws when offset is negative", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(state, createPosition("p" as BlockId, -1), allocator),
    ).toThrow(/out of range/);
  });

  it("throws when offset exceeds inlineContentLength", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(state, createPosition("p" as BlockId, 999), allocator),
    ).toThrow(/out of range/);
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- split-block --run` → PASS (23 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/split-block.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover splitBlockAtPosition error cases

Six new tests verifying the implementation throws on:
- missing block.
- container block via firstChildId set (the typical container shape).
- container block via null inlineContent (independent guard arm — pins
  the inlineContent === null branch of the OR so a future regression
  that drops it is caught).
- root block (parentId null — no parent linked-list to host a sibling).
- negative offset.
- offset exceeding inlineContentLength.

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

After the existing Phase 4c-1 export line `export { applyAttrsToRange } from "./apply-attrs";` (which lives in the "Phase 4c-1 operations" section), add a new "Phase 4c-2 operations" section. The result around the Phase 4c block should be:

```typescript
// Phase 4c-1 operations (range attribute application)
export { applyAttrsToRange } from "./apply-attrs";

// Phase 4c-2 operations (block split)
export { splitBlockAtPosition } from "./split-block";
```

- [ ] **Step 2: Append assertion to operations.test.ts**

Inside the existing `describe("operations barrel", ...)` block, add a new `it()`:

```typescript
  it("re-exports Phase 4c-2 operations", () => {
    expect(typeof ops.splitBlockAtPosition).toBe("function");
  });
```

- [ ] **Step 3: Run tests + build**

Run: `npm test --workspace=packages/core -- "src/state/operations.test" --run` → PASS (4 tests in `operations.test.ts`).
Run: `npm test --workspace=packages/core --run` → all green; total 1089 + 4 skipped (was 1065 + 4 after Phase 4c-1; this phase adds 23 new tests in `split-block.test.ts` + 1 new assertion in `operations.test.ts` = 24).
Run: `npm run build --workspace=packages/core` → clean.

- [ ] **Step 4: Verify public API not yet wired**

Run: `grep -E "(split-block)" packages/core/src/index.ts`
Expected: empty output. Phase 14 cleanup wires the public API.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/operations.ts packages/core/src/state/operations.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add splitBlockAtPosition to operations barrel

Phase 4c-2 operation splitBlockAtPosition is now accessible via the
operations barrel alongside Phase 4a's block-level operations,
Phase 4b's insertText, and Phase 4c-1's applyAttrsToRange.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Phase 4c-3 prep**

If anything came up during Phase 4c-2 that should inform Phase 4c-3 (`mergeAdjacentBlocks` — the inverse operation), add notes to the spec or memory. Otherwise skip.

---

## Self-review

**Spec coverage** (Phase 4c-2 scope: splitBlockAtPosition):
- ✅ Core operation: split a leaf at a position into two siblings — Task 1
- ✅ Item-shape coverage (boundary, multi-item, embed leading/trailing edge, embed-first block) — Task 2
- ✅ Edge offsets (0, total, empty block) with parent-update + dirtyIds assertions — Task 3
- ✅ Linked-list correctness (middle / first / last child + nested-block) — Task 4
- ✅ Block-level invariants (type, attrs, parentId, allocator, structural sharing, immutability) — Task 5
- ✅ Error cases (missing, container-via-firstChildId, container-via-null-inlineContent, root, negative offset, oversized offset) — Task 6
- ✅ Operations barrel update — Task 7

**Placeholder scan:** No "TBD"/"TODO" patterns. Task 1's production code emits exactly two helpers (`withPrevSibling`, `withLastChild`); no dead helpers.

**Type consistency:** `OperationResult`, `BlockId`, `IdAllocator`, `Position`, `Block`, `InlineItem`, `TextItem` referenced consistently. `findItemAtOffset` and `inlineContentLength` from `inline-content.ts`. `createTestAllocator` from `block-id.ts`.

**Out of scope (deferred):**
- `mergeAdjacentBlocks` (the inverse) → Phase 4c-3
- `deleteRange` → Phase 4c-4
- `replaceRange` → Phase 4c-5
- `clonePastedSubtree` → Phase 4d
- "Split at depth N" semantics (split a list-item containing the leaf, etc.) → editor-level concern; not a state primitive
- Public API wiring → Phase 14

The Phase 4c-2 plan above produces 1 new source file + tests, ~7 commits, leaves the build green throughout. Estimated execution time: half a day.

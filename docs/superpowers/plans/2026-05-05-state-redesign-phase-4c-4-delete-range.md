# State module redesign — Phase 4c-4: deleteRange

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Layer 3 `deleteRange` operation — given a `Span`, delete the inline content in the range, possibly absorbing content across block boundaries when the span crosses blocks. The anchor block keeps its identity (id, type, attrs, parentId, prevSiblingId); the focus block (when different from anchor) is deleted along with any leaf blocks in between. This is the core operation behind selection-based delete (e.g., select a range and press Delete or Backspace).

**Architecture:** Per `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md` line 276 ("`deleteRange(state, span, allocator)` = walk `iterateSpan` collecting blocks; produce a new state where: anchor block's content is `items[0..rangeStart)` ⊕ focus block's content `items[rangeEnd..)` (merged into the anchor block); intervening blocks are removed via `state.blocks.delete(id)`; cascade-delete any embed-referenced content blocks; reconnect parents' child linked lists.").

**Tech Stack:** TypeScript 5.7, vitest 3.0, npm workspaces.

**Phase 1 - 4c-3 status (assumed complete):**
- Phase 1 — Layer 1 types. Last commit `4230343`.
- Phase 2 — Layer 2 utilities. Last commit `b27bffa`.
- Phase 3 — Cascade attribute interpreters. Last commit `413728a`.
- Phase 4a — Simple block-level operations + barrel. Last commit `cc2b249`.
- Phase 4b — `insertText`. Last commit `597bad1`.
- Phase 4c-1 — `applyAttrsToRange`. Last commit `107f39a`.
- Phase 4c-2 — `splitBlockAtPosition`. Last commit `e0dbb65`.
- Phase 4c-2.5 cleanup — extracted `mergeAdjacentTextItems` and `updateBlock`. Last commit `2c2a95a`.
- Phase 4c-3 — `mergeAdjacentBlocks`. Last commit `da4b466`.
- Build green; 1128 tests passing + 4 skipped.

**Per-phase scope notes:**

- New files: `state/delete-range.ts` and `state/delete-range.test.ts`. Confirmed at plan-write time that NEITHER file exists.
- Modify: `state/operations.ts` (one new export line) and `state/operations.test.ts` (one new assertion). Authorized.
- Modify (Task 1 preventive cleanup): `state/inline-content.ts` (export `splitInlineContentAtOffset`), `state/inline-content.test.ts` (add tests for the newly-exported helper), `state/split-block.ts` (use shared version, drop local copy). Authorized.
- **Critical implementer guard (per memory `feedback_implementer_create_collision.md`):** if any file the plan asks to CREATE already exists, the implementer must STOP and report `BLOCKED`; never silently refactor, rename, or consolidate. Verified by the controller before dispatch.
- Per CLAUDE.md: TDD throughout. Verify with both `npm test` AND `npm run build`.
- Type safety: no non-null assertions (`!`); use proper narrowing.
- **Manual unused-import scan after writing every file** — `tsconfig` does NOT have `noUnusedLocals`, so `tsc` won't catch unused imports. Lesson from Phase 4c-2.5: a previous implementer's self-review missed an unused import; the IDE caught it post-commit and a fix-up commit was needed. Don't repeat.
- **Shared helpers (use these — do NOT inline):** `mergeAdjacentTextItems` and `splitInlineContentAtOffset` (after Task 1) live in `state/inline-content.ts`. `updateBlock` lives in `state/block.ts`. Phase 4c-4 imports all three from those locations.

**Why "anchor wins" and not "focus wins" for cross-block cases:** matches Word and Google Docs paragraph-identity semantics. Selecting from mid-paragraph 1 to mid-paragraph 2 and pressing Delete: paragraph 1 retains its formatting, comment anchors, tracked-change anchors, and absorbs paragraph 2's tail. Paragraph 2 ceases to exist as a distinct entity. Same identity convention as `splitBlockAtPosition` (the original keeps id) and `mergeAdjacentBlocks` (left wins). The action handler is responsible for any pre-merge type/attrs conversion if a different policy is desired.

**Why same-parent only for cross-block cases:** the operation requires reconnecting one parent's child linked list. Cross-parent spans (e.g., span from a paragraph in section1 to a paragraph in section2) involve multiple parents whose linked lists would need independent reconnection AND raise design questions about empty-container disposal that are editor-level concerns. This phase rejects cross-parent spans with a clear error message; the action handler can compose multiple `deleteRange` + `removeBlock` + `mergeAdjacentBlocks` calls to achieve cross-parent semantics if needed. (Cross-context is already rejected by the inherited `comparePositions` precondition via `normalizeSpan`.)

**Why no `IdAllocator` parameter (despite spec mentioning one):** `deleteRange` only deletes blocks; it never creates new ones. Threading an allocator through serves no purpose. The spec's signature `deleteRange(state, span, allocator)` is aspirational; our existing operations have already diverged from the spec on this point (`insertText` and `applyAttrsToRange` both omit the allocator parameter when not needed). Consistent with that pattern.

**Operation signature:**

```typescript
function deleteRange(
  state: State,
  span: Span,
): OperationResult;
```

Notes:
- Empty-span no-op: if `anchor.blockId === focus.blockId && anchor.offset === focus.offset` (collapsed-ness is normalization-invariant), return `{ state, dirtyIds: new Set() }` immediately without any further validation.
- Span is normalized internally (via `normalizeSpan` from `span-iteration.ts`).
- `normalizeSpan` itself throws via `comparePositions` → `compareBlocksInDocOrder` if the endpoints are in different selection contexts.
- Both endpoints must reference existing leaf blocks (non-null `inlineContent` AND null `firstChildId`).
- For cross-block spans, both endpoints must share the same `parentId`. Cross-parent rejected.
- Offsets must satisfy `0 <= offset <= inlineContentLength`.
- After the operation:
  - **Same-block case:** the block's `inlineContent` becomes `items[0..anchor.offset) ⊕ items[focus.offset..)` with run-merging post-pass. No structural changes.
  - **Cross-block case:** the anchor block's `inlineContent` becomes `anchor.items[0..anchor.offset) ⊕ focus.items[focus.offset..)` with run-merging post-pass; its `nextSiblingId` rewires to `focus.nextSiblingId`. The focus block is deleted from `state.blocks`. Any leaf blocks between anchor and focus in the parent's child linked list are also deleted. If focus had a `nextSibling`, that sibling's `prevSiblingId` rewires to anchor's id. If focus was the parent's `lastChildId`, the parent's `lastChildId` rewires to anchor's id.
- Throws on:
  - missing anchor or focus block,
  - either endpoint being a container (firstChildId !== null OR inlineContent === null),
  - cross-block span where blocks have different parents,
  - any offset out of `[0, inlineContentLength]`.

**Run-merging at the seam:**

After concatenating `[...anchorPrefix, ...focusSuffix]` (cross-block) or `[...prefix, ...suffix]` (same-block), the same `mergeAdjacentTextItems` algorithm used in `insertText`, `applyAttrsToRange`, and `mergeAdjacentBlocks` runs as a post-pass. The seam between the two halves may produce two adjacent text items with equal attrs (e.g., prefix ends with `text("hel", { bold: true })` and suffix starts with `text("lo", { bold: true })` → merge to `text("hello", { bold: true })`). Embeds at the seam never merge with their neighbors regardless of attrs.

**dirtyIds contract:**

The returned `dirtyIds` set contains:

- For same-block delete:
  - The block's id.

- For cross-block delete:
  - The anchor block's id (its `inlineContent` and `nextSiblingId` changed).
  - The focus block's id (it was removed from `state.blocks`).
  - Each intervening leaf's id (each removed from `state.blocks`).
  - The focus block's old `nextSiblingId`, IF non-null (its `prevSiblingId` was rewired to anchor's id).
  - The parent block's id, IF the focus block was the parent's `lastChildId` (parent's `lastChildId` was rewired to anchor's id).

The parent is **not** dirtied when focus had a `nextSibling` (parent's child pointers didn't change). Same write-time discipline as `splitBlockAtPosition` and `mergeAdjacentBlocks`.

---

## File structure (this phase)

**Created:**

| Path | Responsibility |
|---|---|
| `packages/core/src/state/delete-range.ts` | `deleteRange(state, span) → OperationResult`. Imports `mergeAdjacentTextItems` and `splitInlineContentAtOffset` from `inline-content.ts`; `updateBlock` from `block.ts`; `normalizeSpan` from `span-iteration.ts`. |
| `packages/core/src/state/delete-range.test.ts` | Unit tests covering same-block delete, cross-block delete, linked-list correctness, block-level invariants, edge offsets, and error cases. |

**Modified:**

| Path | Change |
|---|---|
| `packages/core/src/state/inline-content.ts` | Export `splitInlineContentAtOffset` (currently a private helper in `split-block.ts`; moved here as a shared utility — Task 1 preventive cleanup). |
| `packages/core/src/state/inline-content.test.ts` | Add tests for the newly-exported `splitInlineContentAtOffset` (Task 1). |
| `packages/core/src/state/split-block.ts` | Drop local copy of `splitInlineContentAtOffset`; import from `inline-content.ts` (Task 1). |
| `packages/core/src/state/operations.ts` | Append `export { deleteRange } from "./delete-range";` to the Phase 4c section (Task 8). |
| `packages/core/src/state/operations.test.ts` | Add `expect(typeof ops.deleteRange).toBe("function");` assertion (Task 8). |

**Deleted:** none.

---

## Task 1: Preventive cleanup — extract splitInlineContentAtOffset to inline-content.ts

**Files:**
- Modify: `packages/core/src/state/inline-content.ts` (add new exported function).
- Modify: `packages/core/src/state/inline-content.test.ts` (add tests).
- Modify: `packages/core/src/state/split-block.ts` (drop local copy, import from inline-content).

- [ ] **Step 1: Add `splitInlineContentAtOffset` to `inline-content.ts`**

Append to `packages/core/src/state/inline-content.ts` (after the existing `mergeAdjacentTextItems` function — keep the `attrsEqual` import which already exists for that function, no new import needed):

```typescript
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
 *
 * Used by Layer 3 operations that slice inline content at a position
 * (splitBlockAtPosition, deleteRange, etc.).
 */
export function splitInlineContentAtOffset(
  content: InlineContent,
  offset: number,
): [InlineItem[], InlineItem[]] {
  const items = content.items;
  const { itemIndex, withinItem } = findItemAtOffset(content, offset);

  if (withinItem === 0) {
    return [items.slice(0, itemIndex), items.slice(itemIndex)];
  }

  const straddle = items[itemIndex];
  if (straddle.kind !== "text") {
    throw new Error(
      `splitInlineContentAtOffset: offset falls inside non-text item at index ${itemIndex} (kind="${straddle.kind}")`,
    );
  }
  const leftHead = createTextItem(straddle.text.slice(0, withinItem), straddle.attrs);
  const rightHead = createTextItem(straddle.text.slice(withinItem), straddle.attrs);
  return [
    [...items.slice(0, itemIndex), leftHead],
    [rightHead, ...items.slice(itemIndex + 1)],
  ];
}
```

- [ ] **Step 2: Add tests to `inline-content.test.ts`**

Append to `packages/core/src/state/inline-content.test.ts`:

```typescript
describe("splitInlineContentAtOffset", () => {
  it("returns [[], []] for an empty inline content at offset 0", () => {
    const content = createInlineContent([]);
    const [left, right] = splitInlineContentAtOffset(content, 0);
    expect(left).toEqual([]);
    expect(right).toEqual([]);
  });

  it("returns [[], allItems] for offset 0 of non-empty content", () => {
    const content = createInlineContent([createTextItem("hello"), createTextItem(" world", { italic: true })]);
    const [left, right] = splitInlineContentAtOffset(content, 0);
    expect(left).toEqual([]);
    expect(right).toHaveLength(2);
    expect(right[0]).toMatchObject({ text: "hello" });
    expect(right[1]).toMatchObject({ text: " world", attrs: { italic: true } });
  });

  it("returns [allItems, []] for offset === total length", () => {
    const content = createInlineContent([createTextItem("hello")]);
    const [left, right] = splitInlineContentAtOffset(content, 5);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ text: "hello" });
    expect(right).toEqual([]);
  });

  it("clean-cuts at a text-item boundary", () => {
    // [text("hello"), text(" world")] — offset 5 = exactly between items.
    const content = createInlineContent([createTextItem("hello"), createTextItem(" world")]);
    const [left, right] = splitInlineContentAtOffset(content, 5);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ text: "hello" });
    expect(right).toHaveLength(1);
    expect(right[0]).toMatchObject({ text: " world" });
  });

  it("splits a text item mid-text, preserving attrs on both halves", () => {
    // [text("hello", { bold: true })] — offset 3 = mid-text.
    const content = createInlineContent([createTextItem("hello", { bold: true })]);
    const [left, right] = splitInlineContentAtOffset(content, 3);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ text: "hel", attrs: { bold: true } });
    expect(right).toHaveLength(1);
    expect(right[0]).toMatchObject({ text: "lo", attrs: { bold: true } });
  });

  it("clean-cuts at an embed leading edge", () => {
    // [text("a"), embed("img"), text("b")] — offset 1 = leading edge of embed.
    const content = createInlineContent([
      createTextItem("a"),
      createEmbedItem("img"),
      createTextItem("b"),
    ]);
    const [left, right] = splitInlineContentAtOffset(content, 1);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ kind: "text", text: "a" });
    expect(right).toHaveLength(2);
    expect(right[0]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(right[1]).toMatchObject({ kind: "text", text: "b" });
  });

  it("clean-cuts at an embed trailing edge", () => {
    // Same fixture; offset 2 = trailing edge of embed.
    const content = createInlineContent([
      createTextItem("a"),
      createEmbedItem("img"),
      createTextItem("b"),
    ]);
    const [left, right] = splitInlineContentAtOffset(content, 2);
    expect(left).toHaveLength(2);
    expect(left[0]).toMatchObject({ kind: "text", text: "a" });
    expect(left[1]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(right).toHaveLength(1);
    expect(right[0]).toMatchObject({ kind: "text", text: "b" });
  });
});
```

The `inline-content.test.ts` already imports `createTextItem` and `createEmbedItem`. Add `splitInlineContentAtOffset` to the existing import line from `./inline-content`.

- [ ] **Step 3: Run tests — verify pass**

Run: `npm test --workspace=packages/core -- "src/state/inline-content.test" --run`
Expected: existing tests pass + 7 new tests for `splitInlineContentAtOffset`.

- [ ] **Step 4: Refactor `split-block.ts` to use the shared helper**

Edit `packages/core/src/state/split-block.ts`:

1. Update the existing import from `./inline-content` to add `splitInlineContentAtOffset` to the imports.
2. Delete the local `splitInlineContentAtOffset` function (around lines 139-160; verify by reading).
3. Manual unused-import scan: read the imports at the top of the file. After deleting the local helper, are any of the imports still needed? Specifically:
   - `findItemAtOffset` was used inside the local helper. After deletion, is it still used? Probably NOT. If unused, remove it.
   - `createTextItem` was used inside the local helper. After deletion, is it still used? Probably NOT. If unused, remove it.
   - `InlineContent` type was used as the helper's parameter type. After deletion, is it still used? Probably NOT. If unused, remove it.
   - Verify each by grepping the file.

- [ ] **Step 5: Verify**

Run: `npm test --workspace=packages/core --run` → all green; total **1135 + 4 skipped** (was 1128 + 4; +7 new tests for the extracted helper).
Run: `npm run build --workspace=packages/core` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/state/inline-content.ts packages/core/src/state/inline-content.test.ts packages/core/src/state/split-block.ts
git commit -m "$(cat <<'EOF'
refactor(state): extract splitInlineContentAtOffset to inline-content.ts

Preventive cleanup before Phase 4c-4 (deleteRange) — moves the helper
from a private location in split-block.ts to a shared exported function
in inline-content.ts. Phase 4c-4 needs the same slicing logic for both
the same-block case (slice anchor's items at start/end of range) and
the cross-block case (slice anchor prefix + focus suffix); extracting
now prevents duplication.

split-block.ts is updated to import from the shared location. Adds
direct unit tests for splitInlineContentAtOffset (previously only
exercised transitively via splitBlockAtPosition).

No behavior change. All existing tests still pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Context

**Working directory:** `/Users/hansyu/code/taleweaver/`
**Branch:** `feature/dom-architecture-redesign`

**Where this fits:** Phase 4c-4 task 1 of 8. Preventive cleanup — extracts a single-caller helper to a shared module so Phase 4c-4's deleteRange can use it without duplicating.

**Important:** verify with both `npm test` AND `npm run build`. AND manually scan the imports of every modified file for unused ones (`tsconfig` lacks `noUnusedLocals`).

## Your Job

Execute Steps 1-6 in order. Self-review for unused imports before committing.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Test output AND build output
- Files changed (with commit SHA)
- Self-review findings, especially: did you remove all unused imports from `split-block.ts`?

---

## Task 2: deleteRange — implementation + sanity test (same-block case)

**Files:**
- Create: `packages/core/src/state/delete-range.ts`
- Create: `packages/core/src/state/delete-range.test.ts`

- [ ] **Step 1: Write the failing test (delete-range.test.ts)**

```typescript
import { describe, it, expect } from "vitest";
import { deleteRange } from "./delete-range";
import { buildBlock, buildState, text } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";

describe("deleteRange — basic same-block range delete", () => {
  // doc > [p("hello world")]
  // Delete range [3, 7) — covers "lo w".
  // Expected: p("helorld")
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world")]) }),
      ],
    });

  it("deletes the range from a single text item, keeping prefix and suffix", () => {
    const state = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = deleteRange(state, span);

    const block = result.state.blocks.get("p" as BlockId);
    expect(block?.inlineContent?.items).toHaveLength(1);
    expect(block?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "helorld" });

    // dirtyIds: only the modified block.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p"]));
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npm test --workspace=packages/core -- delete-range --run`
Expected: FAIL with module-not-found / `deleteRange is not defined`.

- [ ] **Step 3: Write the production code (delete-range.ts)**

```typescript
import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import type { Span } from "./block-position";
import {
  createInlineContent,
  inlineContentLength,
  mergeAdjacentTextItems,
  splitInlineContentAtOffset,
} from "./inline-content";
import { updateBlock } from "./block";
import { normalizeSpan } from "./span-iteration";

/**
 * Delete the inline content within a Span.
 *
 * Same-block case: the block's inlineContent becomes
 *   items[0..anchor.offset) ⊕ items[focus.offset..)
 * with a run-merging post-pass.
 *
 * Cross-block case (same parent only): the anchor block keeps its identity
 * (id, type, attrs, parentId, prevSiblingId) and absorbs:
 *   anchor.items[0..anchor.offset) ⊕ focus.items[focus.offset..)
 * with a run-merging post-pass. The focus block and any leaf blocks
 * between anchor and focus in the parent's child list are removed.
 * Anchor's nextSiblingId rewires to focus's old nextSiblingId.
 *
 * Empty-span (collapsed) is a no-op.
 *
 * Returns OperationResult with dirtyIds containing every block id whose
 * entry in state.blocks differs from the previous state.
 *
 * Throws if:
 *   - either endpoint references a missing block,
 *   - either endpoint is a container (firstChildId !== null OR
 *     inlineContent === null),
 *   - the span crosses parents (cross-parent deleteRange not supported
 *     in this phase — action handlers compose primitives for that),
 *   - cross-context (inherited via normalizeSpan's comparePositions
 *     call which throws on no-common-ancestor),
 *   - any offset is outside [0, inlineContentLength].
 */
export function deleteRange(state: State, span: Span): OperationResult {
  // Empty-span no-op (collapsed-ness is normalization-invariant).
  if (
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset
  ) {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  // Normalize. Throws via comparePositions if cross-context.
  const normalized = normalizeSpan(state, span);

  // SAME-BLOCK case
  if (normalized.anchor.blockId === normalized.focus.blockId) {
    const block = state.blocks.get(normalized.anchor.blockId);
    if (!block) {
      throw new Error(`deleteRange: block "${normalized.anchor.blockId}" not found`);
    }
    if (!block.inlineContent || block.firstChildId !== null) {
      throw new Error(
        `deleteRange: block "${normalized.anchor.blockId}" is a container, not a leaf`,
      );
    }

    const totalLen = inlineContentLength(block.inlineContent);
    if (normalized.anchor.offset < 0 || normalized.anchor.offset > totalLen) {
      throw new Error(
        `deleteRange: anchor offset ${normalized.anchor.offset} out of range [0, ${totalLen}] for block "${normalized.anchor.blockId}"`,
      );
    }
    if (normalized.focus.offset < 0 || normalized.focus.offset > totalLen) {
      throw new Error(
        `deleteRange: focus offset ${normalized.focus.offset} out of range [0, ${totalLen}] for block "${normalized.anchor.blockId}"`,
      );
    }

    // After collapsed-span no-op above, normalized may still be collapsed
    // if the input had reverse-order positions in the same block at the
    // same offset. The normalized form would be identical to either input.
    // Re-check here for completeness.
    if (normalized.anchor.offset === normalized.focus.offset) {
      return { state, dirtyIds: new Set<BlockId>() };
    }

    const [prefix] = splitInlineContentAtOffset(block.inlineContent, normalized.anchor.offset);
    const [, suffix] = splitInlineContentAtOffset(block.inlineContent, normalized.focus.offset);
    const merged = mergeAdjacentTextItems([...prefix, ...suffix]);

    const updated = updateBlock(block, {
      inlineContent: createInlineContent(merged),
    });

    return {
      state: { ...state, blocks: state.blocks.set(block.id, updated) },
      dirtyIds: new Set<BlockId>([block.id]),
    };
  }

  // CROSS-BLOCK case
  const anchorBlock = state.blocks.get(normalized.anchor.blockId);
  if (!anchorBlock) {
    throw new Error(`deleteRange: anchor block "${normalized.anchor.blockId}" not found`);
  }
  const focusBlock = state.blocks.get(normalized.focus.blockId);
  if (!focusBlock) {
    throw new Error(`deleteRange: focus block "${normalized.focus.blockId}" not found`);
  }

  if (!anchorBlock.inlineContent || anchorBlock.firstChildId !== null) {
    throw new Error(
      `deleteRange: anchor block "${normalized.anchor.blockId}" is a container, not a leaf`,
    );
  }
  if (!focusBlock.inlineContent || focusBlock.firstChildId !== null) {
    throw new Error(
      `deleteRange: focus block "${normalized.focus.blockId}" is a container, not a leaf`,
    );
  }

  if (anchorBlock.parentId !== focusBlock.parentId) {
    throw new Error(
      `deleteRange: cross-parent spans are not supported in this phase ` +
      `(anchor parent="${anchorBlock.parentId}", focus parent="${focusBlock.parentId}"). ` +
      `Action handlers should decompose into per-parent operations.`,
    );
  }

  // Defensive: same-parent + cross-block implies non-null parent (siblings
  // can't span the root since the root has no siblings).
  if (anchorBlock.parentId === null) {
    throw new Error(
      `deleteRange: blocks "${normalized.anchor.blockId}" and "${normalized.focus.blockId}" have null parent (state corruption)`,
    );
  }

  const anchorLen = inlineContentLength(anchorBlock.inlineContent);
  if (normalized.anchor.offset < 0 || normalized.anchor.offset > anchorLen) {
    throw new Error(
      `deleteRange: anchor offset ${normalized.anchor.offset} out of range [0, ${anchorLen}] for block "${normalized.anchor.blockId}"`,
    );
  }
  const focusLen = inlineContentLength(focusBlock.inlineContent);
  if (normalized.focus.offset < 0 || normalized.focus.offset > focusLen) {
    throw new Error(
      `deleteRange: focus offset ${normalized.focus.offset} out of range [0, ${focusLen}] for block "${normalized.focus.blockId}"`,
    );
  }

  // Walk the parent's child sibling chain from anchor to focus, collecting
  // intervening leaves. Throws if focus is not reachable (which would mean
  // anchor doesn't precede focus in the chain — impossible after normalization
  // unless state is corrupt).
  const interveningIds: BlockId[] = [];
  let cur: BlockId | null = anchorBlock.nextSiblingId;
  while (cur !== null && cur !== focusBlock.id) {
    interveningIds.push(cur);
    const node = state.blocks.get(cur);
    if (!node) {
      throw new Error(`deleteRange: intervening sibling "${cur}" not found`);
    }
    cur = node.nextSiblingId;
  }
  if (cur !== focusBlock.id) {
    throw new Error(
      `deleteRange: focus block "${focusBlock.id}" is not reachable from anchor "${anchorBlock.id}" in the parent's sibling chain`,
    );
  }

  // Build merged anchor inline content.
  const [anchorPrefix] = splitInlineContentAtOffset(anchorBlock.inlineContent, normalized.anchor.offset);
  const [, focusSuffix] = splitInlineContentAtOffset(focusBlock.inlineContent, normalized.focus.offset);
  const mergedItems = mergeAdjacentTextItems([...anchorPrefix, ...focusSuffix]);

  // Update anchor: new content + nextSiblingId rewired to focus's old next.
  let blocks = state.blocks.set(anchorBlock.id, updateBlock(anchorBlock, {
    inlineContent: createInlineContent(mergedItems),
    nextSiblingId: focusBlock.nextSiblingId,
  }));
  const dirtyIds = new Set<BlockId>([anchorBlock.id, focusBlock.id]);

  // Delete focus.
  blocks = blocks.delete(focusBlock.id);

  // Delete intervening leaves.
  for (const id of interveningIds) {
    blocks = blocks.delete(id);
    dirtyIds.add(id);
  }

  // Rewire focus's old nextSibling, if any.
  if (focusBlock.nextSiblingId) {
    const oldFocusNext = state.blocks.get(focusBlock.nextSiblingId);
    if (!oldFocusNext) {
      throw new Error(
        `deleteRange: focus block's next sibling "${focusBlock.nextSiblingId}" not found`,
      );
    }
    blocks = blocks.set(focusBlock.nextSiblingId, updateBlock(oldFocusNext, { prevSiblingId: anchorBlock.id }));
    dirtyIds.add(focusBlock.nextSiblingId);
  } else {
    // Focus was the parent's last child — parent's lastChildId rewires to anchor.
    const parent = state.blocks.get(anchorBlock.parentId);
    if (!parent) {
      throw new Error(
        `deleteRange: parent "${anchorBlock.parentId}" of anchor block not found`,
      );
    }
    blocks = blocks.set(anchorBlock.parentId, updateBlock(parent, { lastChildId: anchorBlock.id }));
    dirtyIds.add(anchorBlock.parentId);
  }

  return {
    state: { ...state, blocks },
    dirtyIds,
  };
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npm test --workspace=packages/core -- delete-range --run`
Expected: PASS (1 test).

Run: `npm run build --workspace=packages/core`
Expected: clean.

**Manual unused-import scan:** read the imports at the top of `delete-range.ts`. Verify each is used in the body. Specifically: `State`, `OperationResult`, `BlockId`, `Span`, `createInlineContent`, `inlineContentLength`, `mergeAdjacentTextItems`, `splitInlineContentAtOffset`, `updateBlock`, `normalizeSpan` — all used. If you find anything unused, remove it.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/delete-range.ts packages/core/src/state/delete-range.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add deleteRange Layer 3 operation — basic same-block case

Deletes the inline content within a Span. Handles same-block ranges
(items[0..anchor.offset) ⊕ items[focus.offset..) with run-merging
post-pass) and cross-block-same-parent ranges (anchor block keeps
identity and absorbs anchor.prefix + focus.suffix; focus and any
intervening leaves are removed; linked list spliced).

Cross-parent spans are rejected with a clear error — action handlers
should decompose into per-parent operations. Cross-context spans are
rejected by the inherited normalizeSpan precondition.

First test covers the simplest same-block mid-text delete.
Subsequent tasks add coverage for same-block edge cases, cross-block
variants, linked-list correctness, block-level invariants, edge
offsets, and error cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Context for Task 2

**Critical implementer guard:** if `state/delete-range.ts` OR `state/delete-range.test.ts` already exists, STOP and report `BLOCKED`. The plan asserts neither file exists.

**Manual unused-import scan after writing the production code** — `tsconfig` lacks `noUnusedLocals`; `tsc` won't catch dead imports. Read the imports yourself.

## Your Job (Task 2)

Execute Steps 1-5 in order. Self-review: confirm only the two files are in the commit; confirm no `!` non-null assertions; confirm imports are minimal and complete.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Test output AND build output
- Files changed (with commit SHA)
- Self-review findings

---

## Task 3: deleteRange — same-block coverage (item shapes, edge offsets, run-merging)

**Files:**
- Modify: `packages/core/src/state/delete-range.test.ts` (append tests only).

- [ ] **Step 1: Append the same-block coverage tests**

```typescript
describe("deleteRange — same-block: item shapes and edges", () => {
  it("deletes a range that exactly covers a text item (clean removal at boundary)", () => {
    // [text("hello"), text(" world")] — delete [0, 5) — drops "hello", keeps " world".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello"), text(" world")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    const result = deleteRange(state, span);
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: " world" });
  });

  it("deletes a range that spans multiple text items, splitting both endpoints", () => {
    // [text("ab"), text("cd"), text("ef")] — delete [1, 5) — keeps "a" + "f".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("ab"), text("cd"), text("ef")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 5));
    const result = deleteRange(state, span);
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    // After run-merging: text("a") and text("f") have same attrs ({}), so they merge.
    expect(items?.[0]).toMatchObject({ text: "af", attrs: {} });
  });

  it("deletes an embed item in the range", () => {
    // [text("a"), embed("img"), text("b")] — delete [1, 2) — drops the embed.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("a"), embed("img"), text("b")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 2));
    const result = deleteRange(state, span);
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "ab" }); // run-merged at the seam
  });

  it("preserves attrs on both halves when splitting a styled item mid-text", () => {
    // [text("hello world", { bold: true })] — delete [3, 7) — should leave
    // text("hel", {bold:true}) + text("rld", {bold:true}) → run-merged to text("helrld", {bold:true}).
    // Pins the attrs-preservation contract on both prefix and suffix sides.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world", { bold: true })]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = deleteRange(state, span);
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "helrld", attrs: { bold: true } });
  });

  it("does NOT merge text across an embed at the seam", () => {
    // [text("a", {bold}), embed, text("b", {bold}), text("c", {italic})]
    // Delete [3, 4) — drops the "c" range from text("c").
    // Wait this fixture doesn't actually exercise the embed-barrier-at-seam
    // path. Better: have the seam land between an embed and a text item.
    // Try: [text("a", {bold}), embed("img"), text("X"), text("b", {bold})]
    // (length: 1+1+1+1 = 4; delete [2, 3) — drops text("X").
    // Result: [text("a", {bold}), embed, text("b", {bold})] — embed at seam,
    // text("a") and text("b") have same attrs but separated by embed → no merge.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([
            text("a", { bold: true }),
            embed("img"),
            text("X"),
            text("b", { bold: true }),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 2), createPosition("p" as BlockId, 3));
    const result = deleteRange(state, span);
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
  });
});
```

- [ ] **Step 2: Update import to include `embed`**

The Task 2 test file imports `text` only. Update to:
```typescript
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
```

- [ ] **Step 3-5: Run / build / commit**

Run: `npm test --workspace=packages/core -- delete-range --run` → PASS (6 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/delete-range.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover deleteRange same-block item shapes + run-merging

Five new tests:
- range exactly covers a text item (clean boundary removal).
- range spans multiple text items (both endpoints split, then run-merge).
- range covers an embed item (embed dropped, neighbors run-merge if eligible).
- attrs preserved on both halves when splitting a styled item mid-text.
- embed at the seam acts as a barrier (no merge across embed even with
  same-attrs text neighbors).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: deleteRange — cross-block coverage (no intervening, with intervening, linked-list)

**Files:**
- Modify: `packages/core/src/state/delete-range.test.ts` (append tests only).

- [ ] **Step 1: Append the cross-block tests**

```typescript
describe("deleteRange — cross-block (same-parent)", () => {
  it("merges anchor prefix with focus suffix when blocks are adjacent siblings (no intervening)", () => {
    // doc > [p1("hello"), p2(" world")]
    // Delete from p1@2 to p2@3 — keep "he" of p1 + "rld" of p2.
    // Expected: doc > [p1("herld")] — p2 deleted.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    const result = deleteRange(state, span);

    const p1 = result.state.blocks.get("p1" as BlockId);
    expect(p1?.inlineContent?.items).toHaveLength(1);
    expect(p1?.inlineContent?.items[0]).toMatchObject({ text: "herld" });
    expect(p1?.nextSiblingId).toBeNull(); // p2 deleted; p2 had no nextSibling
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.lastChildId).toBe("p1"); // rewired from p2

    // dirtyIds: { p1, p2, doc } — p2 was last child so doc.lastChildId changed.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "doc"]));
  });

  it("deletes intervening leaves between anchor and focus", () => {
    // doc > [p1("hello"), p2("middle"), p3("world")]
    // Delete from p1@2 to p3@2 — anchor=p1, focus=p3, intervening=[p2].
    // Result: p1 keeps "he" + p3's "rld" = "herld"; p2 and p3 deleted.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("middle")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p3" as BlockId, 2));
    const result = deleteRange(state, span);

    const p1 = result.state.blocks.get("p1" as BlockId);
    expect(p1?.inlineContent?.items).toHaveLength(1);
    expect(p1?.inlineContent?.items[0]).toMatchObject({ text: "herld" });
    expect(p1?.nextSiblingId).toBeNull();

    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
    expect(result.state.blocks.has("p3" as BlockId)).toBe(false);

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1");
    expect(parent?.lastChildId).toBe("p1");

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3", "doc"]));
  });

  it("middle pair (anchor not first, focus not last): parent unchanged", () => {
    // doc > [p0, p1, p2, p3] — delete from p1@2 to p2@2.
    // Expected: p0 unchanged, p1 absorbs p2 tail, p2 deleted, p3.prevSibling rewires.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p3" }),
        buildBlock({ id: "p0", type: "paragraph", parentId: "doc", nextSiblingId: "p1", inlineContent: createInlineContent([text("zero")]) }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", prevSiblingId: "p0", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("world")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("end")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 2));
    const result = deleteRange(state, span);

    expect(result.state.blocks.get("p0" as BlockId)?.nextSiblingId).toBe("p1"); // unchanged
    expect(result.state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p3"); // rewired
    expect(result.state.blocks.get("p3" as BlockId)?.prevSiblingId).toBe("p1"); // rewired
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p0"); // unchanged
    expect(parent?.lastChildId).toBe("p3"); // unchanged

    // dirtyIds: { p1, p2, p3 } — parent NOT dirty.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3"]));
  });

  it("anchor is first child, focus is last child (full-children-coverage)", () => {
    // doc > [p1, p2] — delete from p1@0 to p2@end (full content of both blocks deleted).
    // Result: p1 has empty inlineContent (anchor.prefix=[] + focus.suffix=[] = []),
    //   p2 deleted, parent.lastChildId rewires to p1.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("b")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 1));
    const result = deleteRange(state, span);

    const p1 = result.state.blocks.get("p1" as BlockId);
    expect(p1?.inlineContent?.items).toEqual([]);
    expect(p1?.nextSiblingId).toBeNull();

    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1");
    expect(parent?.lastChildId).toBe("p1");

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "doc"]));
  });

  it("nested: anchor and focus inside a section container; section's lastChildId rewires", () => {
    // doc > section > [p1, p2] — delete from p1@2 to p2@2.
    // After: section has [p1] with merged content; doc untouched.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: createInlineContent([text("world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 2));
    const result = deleteRange(state, span);

    const section = result.state.blocks.get("section" as BlockId);
    expect(section?.firstChildId).toBe("p1");
    expect(section?.lastChildId).toBe("p1"); // rewired from p2

    const doc = result.state.blocks.get("doc" as BlockId);
    expect(doc?.firstChildId).toBe("section");
    expect(doc?.lastChildId).toBe("section");

    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "section"]));
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- delete-range --run` → PASS (11 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/delete-range.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover deleteRange cross-block (same-parent) cases

Five new tests:
- adjacent pair (no intervening leaves): anchor + focus merge, focus
  removed, parent's lastChildId rewires.
- with intervening leaves: anchor + focus merge, intervening leaves
  also removed, all dirtied appropriately.
- middle pair (anchor not first, focus not last): parent unchanged,
  only siblings/blocks dirtied.
- full-children-coverage (delete from p1@0 to p2@end): anchor block
  ends up empty but survives; focus deleted.
- nested (doc > section > [p1, p2]): section's lastChildId rewires;
  doc untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: deleteRange — block-level invariants

**Files:**
- Modify: `packages/core/src/state/delete-range.test.ts` (append tests only).

- [ ] **Step 1: Append the invariant tests**

```typescript
describe("deleteRange — block-level invariants", () => {
  it("anchor wins type when blocks have different types (cross-block)", () => {
    // doc > [p (paragraph), h (heading)] — delete from p@2 to h@2.
    // Result: anchor block keeps its "paragraph" type.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "h" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "h", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "h", type: "heading", parentId: "doc", prevSiblingId: "p", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 2), createPosition("h" as BlockId, 2));
    const result = deleteRange(state, span);
    expect(result.state.blocks.get("p" as BlockId)?.type).toBe("paragraph");
  });

  it("anchor wins attrs when blocks have different attrs (cross-block)", () => {
    // doc > [li1 { level: 2 }, li2 { level: 3 }] — delete cross-block.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li1", lastChildId: "li2" }),
        buildBlock({ id: "li1", type: "list-item", attrs: { level: 2 }, parentId: "doc", nextSiblingId: "li2", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "li2", type: "list-item", attrs: { level: 3 }, parentId: "doc", prevSiblingId: "li1", inlineContent: createInlineContent([text("b")]) }),
      ],
    });
    const span = createSpan(createPosition("li1" as BlockId, 0), createPosition("li2" as BlockId, 1));
    const result = deleteRange(state, span);
    expect(result.state.blocks.get("li1" as BlockId)?.attrs).toEqual({ level: 2 });
  });

  it("preserves embed-referenced content blocks (no cascade-delete on focus's content)", () => {
    // doc > [p1[], p2[embed("footnote", { contentBlockId: "fn-body" })]] + standalone fn-body.
    // Delete from p1@0 to p2@0 — focus's items[0..) keeps the embed; merged into p1.
    // Result: fn-body must still exist.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("see")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([embed("footnote-anchor", { contentBlockId: "fn-body" })]) }),
        buildBlock({ id: "fn-body", type: "footnote-body", inlineContent: createInlineContent([text("footnote text")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 0));
    const result = deleteRange(state, span);
    expect(result.state.blocks.has("fn-body" as BlockId)).toBe(true);
    // p1 absorbed p2's content (embed) since focus.offset=0 → focus.suffix is full focus content.
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "embed", embedType: "footnote-anchor", properties: { contentBlockId: "fn-body" } });
  });

  it("preserves structural sharing: blocks NOT touched by the operation retain object identity", () => {
    // doc > [p0, p1, p2, p3] — delete cross-block from p1@2 to p2@2.
    // p0 is untouched; p3 is touched (prevSiblingId rewires from p2 to p1).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p3" }),
        buildBlock({ id: "p0", type: "paragraph", parentId: "doc", nextSiblingId: "p1", inlineContent: createInlineContent([text("zero")]) }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", prevSiblingId: "p0", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("world")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("end")]) }),
      ],
    });
    const beforeP0 = state.blocks.get("p0" as BlockId);
    const result = deleteRange(state, createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 2)));
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
    const result = deleteRange(state, createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3)));

    expect(result.state).not.toBe(state);
    // Original state still has p2.
    expect(state.blocks.has("p2" as BlockId)).toBe(true);
    expect(state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p2");
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- delete-range --run` → PASS (16 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/delete-range.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover deleteRange block-level invariants

Five new tests:
- anchor wins type when blocks have different types (cross-block).
- anchor wins attrs when blocks have different attrs (cross-block).
- embed-referenced content blocks survive (no cascade-delete; the embed
  reference travels with the merged content).
- structural sharing: blocks NOT touched by the operation retain object
  identity in the result state.
- the original state is not mutated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: deleteRange — edge offsets and special cases

**Files:**
- Modify: `packages/core/src/state/delete-range.test.ts` (append tests only).

- [ ] **Step 1: Append the edge-offset tests**

```typescript
describe("deleteRange — edge offsets and special cases", () => {
  it("collapsed span (anchor === focus) is a no-op (returns same state, empty dirtyIds)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 2);
    const result = deleteRange(state, createSpan(pos, pos));
    expect(result.state).toBe(state);
    expect([...result.dirtyIds]).toEqual([]);
  });

  it("same-block delete with anchor.offset === 0 (delete from start)", () => {
    // [text("hello")] — delete [0, 3) — keeps "lo".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const result = deleteRange(state, createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3)));
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "lo" });
  });

  it("same-block delete with focus.offset === inlineContentLength (delete to end)", () => {
    // [text("hello")] — delete [2, 5) — keeps "he".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const result = deleteRange(state, createSpan(createPosition("p" as BlockId, 2), createPosition("p" as BlockId, 5)));
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "he" });
  });

  it("same-block delete spanning [0, inlineContentLength] (delete entire block content)", () => {
    // [text("hello")] — delete [0, 5) — keeps nothing.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const result = deleteRange(state, createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5)));
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toEqual([]);
  });

  it("reverse-order span normalizes correctly (focus before anchor in doc order)", () => {
    // Delete from p@7 to p@3 — same as [3, 7) after normalization.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 7), createPosition("p" as BlockId, 3));
    const result = deleteRange(state, span);
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "helorld" });
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- delete-range --run` → PASS (21 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/delete-range.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover deleteRange edge offsets and special cases

Five new tests:
- collapsed span (anchor === focus) is a no-op.
- same-block delete from start (anchor.offset === 0).
- same-block delete to end (focus.offset === inlineContentLength).
- same-block delete spanning entire block content.
- reverse-order span normalizes correctly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: deleteRange — error cases

**Files:**
- Modify: `packages/core/src/state/delete-range.test.ts` (append tests only).

- [ ] **Step 1: Append the error-case tests**

```typescript
describe("deleteRange — error cases", () => {
  it("throws when the anchor block does not exist (cross-block)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("missing" as BlockId, 0), createPosition("p" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/anchor block ".+" not found/);
  });

  it("throws when the focus block does not exist (cross-block)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("missing" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/focus block ".+" not found/);
  });

  it("throws when the same-block target does not exist", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("missing" as BlockId, 0), createPosition("missing" as BlockId, 1));
    // Same blockId on both endpoints → same-block branch → throws "block not found"
    expect(() => deleteRange(state, span)).toThrow(/block ".+" not found/);
  });

  it("throws when an endpoint references a container block (firstChildId set)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "p" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", nextSiblingId: "p", firstChildId: "inner", lastChildId: "inner" }),
        buildBlock({ id: "inner", type: "paragraph", parentId: "s", inlineContent: createInlineContent([text("inside")]) }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "s", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("s" as BlockId, 0), createPosition("p" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/anchor block ".+" is a container/);
  });

  it("throws when an endpoint has null inlineContent (independent of firstChildId)", () => {
    // Pin the inlineContent === null arm of the container guard.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "p" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", nextSiblingId: "p" }), // null inlineContent AND null firstChildId
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "s", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("s" as BlockId, 0), createPosition("p" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/anchor block ".+" is a container/);
  });

  it("throws when the focus block is a container (firstChildId set)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "s" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "s", inlineContent: createInlineContent([text("hi")]) }),
        buildBlock({ id: "s", type: "section", parentId: "doc", prevSiblingId: "p", firstChildId: "inner", lastChildId: "inner" }),
        buildBlock({ id: "inner", type: "paragraph", parentId: "s", inlineContent: createInlineContent([text("inside")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("s" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/focus block ".+" is a container/);
  });

  it("throws when the focus block has null inlineContent (independent of firstChildId)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "s" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "s", inlineContent: createInlineContent([text("hi")]) }),
        buildBlock({ id: "s", type: "section", parentId: "doc", prevSiblingId: "p" }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("s" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/focus block ".+" is a container/);
  });

  it("throws when the cross-block span has different parents (cross-parent not supported)", () => {
    // doc > [section1[p_a], section2[p_b]] — span across sections.
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
    const span = createSpan(createPosition("p_a" as BlockId, 0), createPosition("p_b" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/cross-parent spans are not supported/);
  });

  it("throws when the cross-block span endpoints are in different selection contexts", () => {
    // p in doc; fn-body has no parentId → different root → comparePositions throws via no-common-ancestor.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
        buildBlock({ id: "fn", type: "footnote-body", inlineContent: createInlineContent([text("footnote")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("fn" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/no common ancestor/);
  });

  it("throws when anchor offset is negative (same-block)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, -1), createPosition("p" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/out of range/);
  });

  it("throws when focus offset exceeds inlineContentLength (same-block)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 999));
    expect(() => deleteRange(state, span)).toThrow(/out of range/);
  });

  it("throws when anchor offset exceeds inlineContentLength (cross-block)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hi")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 999), createPosition("p2" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/out of range/);
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- delete-range --run` → PASS (33 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/delete-range.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover deleteRange error cases

Twelve new tests verifying the implementation throws on:
- missing anchor (cross-block).
- missing focus (cross-block).
- missing block (same-block).
- anchor container via firstChildId.
- anchor container via null inlineContent (pins the OR's null arm).
- focus container via firstChildId.
- focus container via null inlineContent (same).
- cross-parent span (rejected explicitly per phase scope).
- cross-context span (rejected via inherited comparePositions guard
  with "no common ancestor" message).
- negative anchor offset.
- focus offset > inlineContentLength (same-block).
- anchor offset > inlineContentLength (cross-block).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Update operations barrel + verification

**Files:**
- Modify: `packages/core/src/state/operations.ts`
- Modify: `packages/core/src/state/operations.test.ts`

- [ ] **Step 1: Append export to operations.ts**

After the existing Phase 4c-3 export line, add a new "Phase 4c-4 operations" section:

```typescript
// Phase 4c-3 operations (block merge)
export { mergeAdjacentBlocks } from "./merge-blocks";

// Phase 4c-4 operations (range delete)
export { deleteRange } from "./delete-range";
```

- [ ] **Step 2: Append assertion to operations.test.ts**

Inside the existing `describe("operations barrel", ...)` block, add a new `it()`:

```typescript
  it("re-exports Phase 4c-4 operations", () => {
    expect(typeof ops.deleteRange).toBe("function");
  });
```

- [ ] **Step 3: Run tests + build**

Run: `npm test --workspace=packages/core -- "src/state/operations.test" --run` → PASS (6 tests in `operations.test.ts`).
Run: `npm test --workspace=packages/core --run` → all green; total **1169 + 4 skipped** (was 1135 + 4 after Task 1; Tasks 2-7 added 33 tests in `delete-range.test.ts` + 1 in `operations.test.ts` = 34 → 1135 + 34 = 1169).
Run: `npm run build --workspace=packages/core` → clean.

- [ ] **Step 4: Verify public API not yet wired**

Run: `grep -E "(delete-range)" packages/core/src/index.ts`
Expected: empty output. Phase 14 cleanup wires the public API.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/operations.ts packages/core/src/state/operations.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add deleteRange to operations barrel

Phase 4c-4 operation deleteRange is now accessible via the operations
barrel alongside Phase 4a's block-level operations, Phase 4b's
insertText, Phase 4c-1's applyAttrsToRange, Phase 4c-2's
splitBlockAtPosition, and Phase 4c-3's mergeAdjacentBlocks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Phase 4c-5 prep**

If anything came up during Phase 4c-4 that should inform Phase 4c-5 (`replaceRange`), add notes. Otherwise skip.

---

## Self-review

**Spec coverage** (Phase 4c-4 scope: deleteRange):
- ✅ Preventive cleanup: extract `splitInlineContentAtOffset` to `inline-content.ts` — Task 1
- ✅ Core operation: same-block + cross-block-same-parent — Task 2
- ✅ Same-block coverage: item shapes, run-merging, attrs preservation — Task 3
- ✅ Cross-block coverage: adjacent / with intervening / linked-list positional / nested — Task 4
- ✅ Block-level invariants: anchor wins type/attrs, embed-content survival, structural sharing, immutability — Task 5
- ✅ Edge offsets: collapsed, anchor=0, focus=length, full coverage, reverse-order — Task 6
- ✅ Error cases: 12 tests pinning all guard arms (existence, container OR arms for both endpoints, cross-parent, cross-context, offset bounds) — Task 7
- ✅ Operations barrel update — Task 8

**Placeholder scan:** No "TBD"/"TODO" patterns. Shared helpers (`mergeAdjacentTextItems`, `splitInlineContentAtOffset`, `updateBlock`) used throughout via imports — no duplication.

**Type consistency:** `State`, `OperationResult`, `BlockId`, `Span` referenced consistently. `mergeAdjacentTextItems`, `splitInlineContentAtOffset`, `createInlineContent`, `inlineContentLength` from `inline-content.ts`. `updateBlock` from `block.ts`. `normalizeSpan` from `span-iteration.ts`.

**Out of scope (deferred):**
- `replaceRange` → Phase 4c-5 (likely composes `deleteRange` + `insertText`)
- `clonePastedSubtree` → Phase 4d
- Cross-parent `deleteRange` semantics (action handler decomposes)
- Empty-container disposal after all leaves are deleted (action handler concern)
- Public API wiring → Phase 14
- `state.embedContents` and embed-content cascade-delete → Phase 14 / future architectural work

The Phase 4c-4 plan above produces 1 new source file + tests (plus the small inline-content.ts cleanup), ~8 commits, leaves the build green throughout. Estimated execution time: most of a day.

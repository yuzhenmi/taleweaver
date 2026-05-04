# State module redesign — Phase 4b: insertText

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Layer 3 `insertText` operation — insert a string into a leaf block's `inlineContent` at a given position with given attrs. This is the most-called editing operation (every keystroke). It's the simpler of Phase 4b's two inline-content operations; Phase 4c plan will cover `applyAttrsToRange` separately.

**Architecture:** Per `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`, "Layered API surface > Layer 3" + "Run merging and equality" sections. `insertText(state, position, text, attrs)` finds the inline item at `position.offset`, splices the new text in, and runs run-merging on adjacent same-attrs text items so the final inlineContent is normalized. Operates on a single block; multi-block edits are not insertText's job (that's deleteRange + insertText composed).

**Tech Stack:** TypeScript 5.7, vitest 3.0, npm workspaces. Test runner: `npm test --workspace=packages/core`. Type checker: `npm run build --workspace=packages/core`.

**Spec reference:** `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`. This plan implements one of the operations listed in "Layered API surface > Layer 3."

**Phase 1 + 2 + 3 + 4a status (assumed complete):**
- Phase 1 — Layer 1 types. Last commit `4230343`.
- Phase 2 — Layer 2 utilities + hardening. Last commit `b27bffa`.
- Phase 3 — Cascade attribute interpreters. Last commit `413728a`.
- Phase 4a — Simple block-level operations + `operations.ts` barrel. Last commit `e0bda90` (or `cc2b249` for the barrel).
- Build green; 1019 tests passing + 4 skipped.

**Per-phase scope notes:**

- New file at top-level path: `state/insert-text.ts` (no name collision; this filename does NOT exist yet — confirmed). Test: `state/insert-text.test.ts`.
- Modify: `state/operations.ts` (the Phase 4a barrel) — add a single export line for `insertText`. This is intentional and authorized.
- **Critical implementer guard (per memory `feedback_implementer_create_collision.md`):** if any file the plan asks to CREATE already exists, the implementer must STOP and report `BLOCKED`; never silently refactor, rename, or consolidate the existing file. This rule was added after Phase 4a Task 9's unauthorized scope creep. Follow the plan's file targets exactly.
- Per CLAUDE.md: TDD throughout. Write tests first, see them fail, implement, see them pass, commit. Verify with both `npm test` AND `npm run build`.
- Per memory `feedback_no_auto_commit.md`: commit on user's behalf at the end of each task.
- Type safety: no non-null assertions (`!`); use proper narrowing.

**Operation signature:**

```typescript
function insertText(
  state: State,
  position: Position,
  text: string,
  attrs: ReadonlyAttrs,
): OperationResult;
```

Notes:
- `attrs` is REQUIRED. The caller is responsible for computing the surrounding-context attrs (cursor module's job). insertText doesn't infer.
- No allocator parameter — insertText doesn't create new blocks, only modifies one block's inlineContent.
- Empty `text` is a no-op: returns the original state with empty `dirtyIds`.
- Throws if the block doesn't exist, isn't a leaf (no inlineContent), or `offset` is out of `[0, inlineContentLength]`.

**Key behavior — run merging:**

After splicing in the new text, the implementation must walk the resulting `items` array and merge adjacent text items with equal attrs (using Phase 1's `attrsEqual`). This keeps inlineContent normalized: no two adjacent text items with the same attrs.

---

## File structure (this phase)

**Created:**

| Path | Responsibility |
|---|---|
| `packages/core/src/state/insert-text.ts` | `insertText(state, position, text, attrs) → OperationResult` |
| `packages/core/src/state/insert-text.test.ts` | Unit tests covering all positional cases (mid-item, boundary, empty block, embed-adjacent) and run-merging. |

**Modified:**

| Path | Change |
|---|---|
| `packages/core/src/state/operations.ts` | Append `export { insertText } from "./insert-text";` |
| `packages/core/src/state/operations.test.ts` | Add one assertion that `ops.insertText` is a function. |

**Deleted:** none.

---

## Task 1: insertText — basic case (insert in middle of single text item, same attrs)

**Files:**
- Create: `packages/core/src/state/insert-text.ts`
- Test: `packages/core/src/state/insert-text.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/insert-text.test.ts
import { describe, it, expect } from "vitest";
import { insertText } from "./insert-text";
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createPosition } from "./block-position";
import type { BlockId } from "./block-id";

describe("insertText — middle of single text item", () => {
  // doc > [p("hello world")]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("hello world")]),
        }),
      ],
    });

  it("inserts the text into the middle of the existing item, preserving attrs", () => {
    const state = fixture();
    const result = insertText(state, createPosition("p" as BlockId, 5), " beautiful", {});
    const updated = result.state.blocks.get("p" as BlockId);
    expect(updated?.inlineContent?.items).toHaveLength(1);
    const item = updated?.inlineContent?.items[0];
    expect(item?.kind).toBe("text");
    if (item?.kind === "text") {
      expect(item.text).toBe("hello beautiful world");
      expect(item.attrs).toEqual({});
    }
  });

  it("returns dirtyIds containing only the modified block", () => {
    const state = fixture();
    const result = insertText(state, createPosition("p" as BlockId, 5), " beautiful", {});
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  it("preserves immutability + structural sharing (does not mutate original; unmodified blocks share identity)", () => {
    const state = fixture();
    const beforeP = state.blocks.get("p" as BlockId);
    const beforeDoc = state.blocks.get("doc" as BlockId);
    const result = insertText(state, createPosition("p" as BlockId, 5), " x", {});
    // Original state and its blocks are not mutated.
    expect(result.state).not.toBe(state);
    expect(result.state.blocks.get("p" as BlockId)).not.toBe(beforeP);
    expect(beforeP?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello world" });
    // Unmodified blocks (doc) share identity — structural sharing.
    expect(result.state.blocks.get("doc" as BlockId)).toBe(beforeDoc);
  });

  it("normalizes already-unnormalized inline content (merges adjacent same-attrs text items in input)", () => {
    // Input is unnormalized: three adjacent same-attrs text items. The
    // post-pass should merge them all (along with any new insertion).
    // createInlineContent does NOT normalize, so this is a real input shape.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("a"), text("b"), text("c")]),
        }),
      ],
    });
    // Insert at offset 1 (between "a" and "b"): all attrs equal, so the result should be one merged item.
    const result = insertText(state, createPosition("p" as BlockId, 1), "X", {});
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "aXbc", attrs: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- insert-text`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/insert-text.ts
import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import type { Position } from "./block-position";
import type { ReadonlyAttrs } from "./attrs";
import { attrsEqual } from "./attrs";
import {
  createInlineContent,
  createTextItem,
  inlineContentLength,
  type InlineItem,
  type TextItem,
} from "./inline-content";
import { createBlock } from "./block";

/**
 * Insert text into a leaf block's inlineContent at `position`.
 *
 * `attrs` is the attribute bag for the inserted text. Caller computes
 * surrounding-context attrs (e.g., from the cursor's containing run).
 *
 * Returns OperationResult with dirtyIds = { position.blockId }.
 *
 * Behavior:
 *   - Empty `text`: no-op (returns original state with empty dirtyIds).
 *   - Insert in middle of a same-attrs text item: splice text in.
 *   - Insert in middle of a different-attrs text item: split the item
 *     into prefix + new + suffix.
 *   - Insert at a boundary: create new text item or merge with adjacent
 *     same-attrs item.
 *   - Adjacent text items with equal attrs are merged in a normalize pass.
 *
 * Throws if:
 *   - The block does not exist.
 *   - The block is not a leaf (has no inlineContent).
 *   - `position.offset` is outside `[0, inlineContentLength(content)]`.
 */
export function insertText(
  state: State,
  position: Position,
  text: string,
  attrs: ReadonlyAttrs,
): OperationResult {
  if (text === "") {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  const block = state.blocks.get(position.blockId);
  if (!block) {
    throw new Error(`insertText: block "${position.blockId}" not found`);
  }
  if (!block.inlineContent) {
    throw new Error(`insertText: block "${position.blockId}" is not a leaf (no inlineContent)`);
  }

  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `insertText: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }

  const items = block.inlineContent.items;
  const newItems = spliceTextIntoItems(items, position.offset, text, attrs);
  const merged = mergeAdjacentTextItems(newItems);

  const updated = createBlock({
    id: block.id,
    type: block.type,
    attrs: block.attrs,
    parentId: block.parentId,
    prevSiblingId: block.prevSiblingId,
    nextSiblingId: block.nextSiblingId,
    firstChildId: block.firstChildId,
    lastChildId: block.lastChildId,
    inlineContent: createInlineContent(merged),
  });

  return {
    state: { ...state, blocks: state.blocks.set(position.blockId, updated) },
    dirtyIds: new Set([position.blockId]),
  };
}

/**
 * Walk items, find the position, and splice in a new TextItem with
 * the given attrs. Splits the affected item if needed; preserves all
 * other items. Run-merging is done in a separate normalize pass.
 */
function spliceTextIntoItems(
  items: ReadonlyArray<InlineItem>,
  offset: number,
  text: string,
  attrs: ReadonlyAttrs,
): InlineItem[] {
  const out: InlineItem[] = [];
  let cursor = 0;
  let inserted = false;

  for (const item of items) {
    const itemLen = item.kind === "text" ? item.text.length : 1;
    const itemEnd = cursor + itemLen;

    if (inserted) {
      out.push(item);
      cursor = itemEnd;
      continue;
    }

    if (offset < cursor + itemLen || (offset === cursor + itemLen && item.kind === "text")) {
      // The insertion point falls inside this item, OR exactly at its
      // trailing edge for a text item (we prefer to land at the trailing
      // edge of a text item rather than the leading edge of the next item,
      // so we can merge if attrs match).
      // Asymmetry: at an embed→text boundary, the OR clause is FALSE for
      // the embed (because item.kind === "embed"), so the embed is pushed
      // and the loop continues; the next iteration enters the text item
      // at within=0 and creates [embed, new, text]. The merge pass then
      // joins new+text if attrs match. This is the correct behavior:
      // we cannot "merge" with a non-text item.
      if (item.kind === "text") {
        const within = offset - cursor;
        const prefix = item.text.slice(0, within);
        const suffix = item.text.slice(within);
        if (prefix.length > 0) out.push(createTextItem(prefix, item.attrs));
        out.push(createTextItem(text, attrs));
        if (suffix.length > 0) out.push(createTextItem(suffix, item.attrs));
      } else {
        // Embed item with offset inside it: offset===cursor means before, offset===cursor+1 means after.
        if (offset === cursor) {
          out.push(createTextItem(text, attrs));
          out.push(item);
        } else {
          out.push(item);
          out.push(createTextItem(text, attrs));
        }
      }
      inserted = true;
      cursor = itemEnd;
      continue;
    }

    out.push(item);
    cursor = itemEnd;
  }

  if (!inserted) {
    // Offset was at end-of-content (or content was empty).
    out.push(createTextItem(text, attrs));
  }

  return out;
}

/**
 * Merge adjacent text items with equal attrs into a single item.
 * Embed items are not merged. Returns a fresh array.
 */
function mergeAdjacentTextItems(items: ReadonlyArray<InlineItem>): InlineItem[] {
  if (items.length <= 1) return [...items];
  const out: InlineItem[] = [];
  let pending: TextItem | null = null;

  for (const item of items) {
    if (item.kind === "text") {
      if (pending && attrsEqual(pending.attrs, item.attrs)) {
        // pending.attrs and item.attrs are equal-by-value (attrsEqual
        // returned true); using either side yields the same result.
        // We pick pending.attrs for stability.
        pending = createTextItem(pending.text + item.text, pending.attrs);
      } else {
        if (pending) out.push(pending);
        pending = item;
      }
    } else {
      if (pending) {
        out.push(pending);
        pending = null;
      }
      out.push(item);
    }
  }
  if (pending) out.push(pending);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- insert-text`
Expected: PASS (4 tests — basic, dirtyIds, immutability/identity, multi-item normalization).

- [ ] **Step 4b: Run the full type checker (REQUIRED)**

Run: `npm run build --workspace=packages/core`
Expected: clean (no TypeScript errors).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/insert-text.ts packages/core/src/state/insert-text.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add insertText Layer 3 operation — basic mid-item case

Splices text into a leaf block's inlineContent at the given position,
with caller-supplied attrs. Returns OperationResult with dirtyIds =
{ blockId }. This commit covers the basic case (insert in middle of a
single text item); subsequent tasks add boundary cases and error tests,
all exercising the same algorithm.

The implementation includes a normalize pass that merges adjacent
text items with equal attrs (per the spec's "Run merging and equality"
section). Empty `text` is a no-op (returns original state with empty
dirtyIds).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Context

**Working directory:** `/Users/hansyu/code/taleweaver/`
**Branch:** `feature/dom-architecture-redesign` (commit directly here, no branch switching).

**Where this fits:** Phase 4b task 1 of 8. Phase 4a shipped the four block-level operations + barrel. This task starts the most-used Layer 3 operation: `insertText`. Tasks 2-7 add the boundary and error cases (no implementation changes — same algorithm covers all positions). Task 8 updates the operations barrel and verifies.

**Critical implementer guard:** if `state/insert-text.ts` already exists, STOP and report `BLOCKED`. The plan asserts the file does NOT exist. (Verified by the controller before dispatch.)

**Important — verify with both `npm test` AND `npm run build`:** vitest is more permissive than tsc.

**Conventions:** TDD; HEREDOC commit message verbatim; auto-commit on user's behalf; vitest 3.0; no non-null assertions.

## Your Job

Execute steps 1-5 in order, including step 4b. Then self-review.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Test output AND build output
- Files changed (with commit SHA)
- Self-review findings

---

## Task 2: insertText — boundary cases (offset 0, end-of-block, empty block)

**Files:**
- Modify: `packages/core/src/state/insert-text.test.ts` (append tests only)

These tests exercise the same algorithm from Task 1; no implementation changes needed.

- [ ] **Step 1: Append the boundary tests**

Append to `insert-text.test.ts`:

```typescript
describe("insertText — offset 0 (beginning of block)", () => {
  it("prepends text in front of the existing first item (different attrs → new run)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("world")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 0), "hello ", { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello ", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "world", attrs: {} });
  });

  it("merges with the first item when attrs are equal", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("world")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 0), "hello ", {});
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello world", attrs: {} });
  });
});

describe("insertText — end of block (offset === inlineContentLength)", () => {
  it("appends text after the last item (different attrs → new run)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), "!", { italic: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "!", attrs: { italic: true } });
  });

  it("merges with the last item when attrs are equal", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), "!", {});
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello!", attrs: {} });
  });
});

describe("insertText — empty block", () => {
  it("creates the first text item in an empty block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 0), "hi", { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hi", attrs: { bold: true } });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- insert-text`
Expected: PASS (9 tests in `insert-text.test.ts` — 4 from Task 1 + 5 new).

- [ ] **Step 3: Type check**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/state/insert-text.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover insertText boundary cases (offset 0, end, empty block)

Five new tests:
- offset 0 with different attrs (new run prepended)
- offset 0 with same attrs (merged with first item)
- end-of-block with different attrs (new run appended)
- end-of-block with same attrs (merged with last item)
- empty block (creates first item)

No implementation changes; the Task 1 algorithm covers all cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: insertText — splits a different-attrs text item

**Files:**
- Modify: `packages/core/src/state/insert-text.test.ts` (append tests only)

- [ ] **Step 1: Append the split tests**

Append to `insert-text.test.ts`:

```typescript
describe("insertText — split a different-attrs text item", () => {
  // Block: [text("helloworld") with attrs {}]
  // Insert "BOLD" with { bold: true } at offset 5
  // Expected: [text("hello") {}, text("BOLD") {bold:true}, text("world") {}]
  it("splits the affected text item into prefix + new + suffix when attrs differ", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("helloworld")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), "BOLD", { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "BOLD", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "world", attrs: {} });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- insert-text`
Expected: PASS (10 tests).

- [ ] **Step 3: Type check**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/state/insert-text.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover insertText splitting a different-attrs text item

Verifies the implementation correctly splits a text item into prefix +
new run + suffix when the inserted text has different attrs from the
surrounding text.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: insertText — at boundary between two text items

**Files:**
- Modify: `packages/core/src/state/insert-text.test.ts` (append tests only)

- [ ] **Step 1: Append the boundary tests**

Append to `insert-text.test.ts`:

```typescript
describe("insertText — at boundary between two text items", () => {
  // Block: [text("hello") {}, text("world") {bold:true}]  (length 10)
  // Insert " " {} at offset 5 (the boundary between the two items)
  // Expected: text(" ") merges with the prev item (same attrs), giving:
  //   [text("hello ") {}, text("world") {bold:true}]
  it("merges with the previous item when boundary attrs match the prev item", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("hello"), text("world", { bold: true })]),
        }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), " ", {});
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello ", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "world", attrs: { bold: true } });
  });

  it("creates a new run when boundary attrs match neither side", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("hello"), text("world", { bold: true })]),
        }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), "X", { italic: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "X", attrs: { italic: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "world", attrs: { bold: true } });
  });

  it("does NOT merge two same-attrs runs across a different-attrs insert (contract pin)", () => {
    // [text("a") {bold}, text("b") {bold}] insert "X" {italic} at offset 1
    // Expected: [text("a") {bold}, text("X") {italic}, text("b") {bold}]
    // — the two {bold} runs do NOT collapse across the {italic} run.
    // This pins the contract: the merge pass walks linearly and only
    // merges immediately adjacent same-attrs items; it never collapses
    // across an intervening different-attrs item.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("a", { bold: true }), text("b", { bold: true })]),
        }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 1), "X", { italic: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "X", attrs: { italic: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- insert-text`
Expected: PASS (13 tests — 10 from prior tasks + 3 new boundary cases including the "no merge across different-attrs insert" contract pin).

- [ ] **Step 3: Type check**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/state/insert-text.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover insertText at text-item boundaries

Two new tests:
- inserting at the boundary with attrs matching the prev item:
  merges with prev (algorithm prefers the trailing edge of a
  text item over the leading edge of the next).
- inserting at the boundary with attrs matching neither side:
  creates a new run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: insertText — adjacent to embed items

**Files:**
- Modify: `packages/core/src/state/insert-text.test.ts` (append tests only)

- [ ] **Step 1: Append the embed-adjacency tests**

Append to `insert-text.test.ts`:

```typescript
describe("insertText — adjacent to embed items", () => {
  // Block: [text("a") {}, embed("image"), text("b") {}]  (length 3)

  it("inserts immediately before an embed when offset === embed start", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("a"), embed("image"), text("b")]),
        }),
      ],
    });
    // offset 1 = end of "a" / start of embed. Algorithm prefers trailing-edge of text item, so "X" merges with "a".
    const result = insertText(state, createPosition("p" as BlockId, 1), "X", {});
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "aX" });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "image" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b" });
  });

  it("inserts immediately after an embed when offset === embed end", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("a"), embed("image"), text("b")]),
        }),
      ],
    });
    // offset 2 = end of embed / start of "b". Algorithm puts text BEFORE the next text item; merges with "b" if attrs match.
    const result = insertText(state, createPosition("p" as BlockId, 2), "Y", {});
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a" });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "image" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "Yb" });
  });

  it("inserts at the start of a block whose first item is an embed", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([embed("image"), text("b")]),
        }),
      ],
    });
    // offset 0 = before embed.
    const result = insertText(state, createPosition("p" as BlockId, 0), "X", {});
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "X" });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "image" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b" });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- insert-text`
Expected: PASS (16 tests — 13 from prior tasks + 3 new embed-adjacency tests).

- [ ] **Step 3: Type check**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/state/insert-text.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover insertText adjacent to embed items

Three new tests verifying behavior at embed boundaries:
- offset = embed start: prefers trailing edge of prev text item (merges with prev if attrs match).
- offset = embed end: puts text before the next text item (merges with next if attrs match).
- offset 0 with embed as first item: prepends a new text item before the embed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: insertText — empty text is a no-op

**Files:**
- Modify: `packages/core/src/state/insert-text.test.ts` (append tests only)

- [ ] **Step 1: Append the no-op test**

Append to `insert-text.test.ts`:

```typescript
describe("insertText — empty text", () => {
  it("returns the original state with empty dirtyIds", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 2), "", {});
    expect(result.state).toBe(state);
    expect([...result.dirtyIds]).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- insert-text`
Expected: PASS (17 tests — 16 from prior tasks + 1 new no-op test).

- [ ] **Step 3: Type check**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/state/insert-text.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover insertText empty-text no-op

Empty text returns the original state reference + empty dirtyIds.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: insertText — error cases

**Files:**
- Modify: `packages/core/src/state/insert-text.test.ts` (append tests only)

- [ ] **Step 1: Append the error tests**

Append to `insert-text.test.ts`:

```typescript
describe("insertText — error cases", () => {
  it("throws when the block does not exist", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(() => insertText(state, createPosition("missing" as BlockId, 0), "x", {})).toThrow(/not found/);
  });

  it("throws when the block is a container (no inlineContent)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc" }), // container, no inlineContent
      ],
    });
    expect(() => insertText(state, createPosition("s" as BlockId, 0), "x", {})).toThrow(/not a leaf/);
  });

  it("throws when offset is negative", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    expect(() => insertText(state, createPosition("p" as BlockId, -1), "x", {})).toThrow(/out of range/);
  });

  it("throws when offset exceeds inline-content length", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    // Inline-content length is 2; valid offsets are [0, 2]. Offset 3 is out of range.
    expect(() => insertText(state, createPosition("p" as BlockId, 3), "x", {})).toThrow(/out of range/);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- insert-text`
Expected: PASS (21 tests — 17 from prior tasks + 4 new error tests).

- [ ] **Step 3: Type check**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/state/insert-text.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover insertText error cases

Four new tests verifying the implementation throws on:
- missing block
- container block (no inlineContent)
- negative offset
- offset exceeding inlineContentLength

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Update operations barrel + verification

**Files:**
- Modify: `packages/core/src/state/operations.ts` (append one export line)
- Modify: `packages/core/src/state/operations.test.ts` (append one assertion)

- [ ] **Step 1: Read the existing files**

Read `packages/core/src/state/operations.ts` and `packages/core/src/state/operations.test.ts` to confirm the Phase 4a barrel structure.

- [ ] **Step 2: Append the export to operations.ts**

In `packages/core/src/state/operations.ts`, append the new export line in the "Phase 4a operations" section (or in a new "Phase 4b operations" section). Specifically, after the existing `export { removeBlock } from "./remove-block";` line, add:

```typescript

// Phase 4b operations (inline-content edits)
export { insertText } from "./insert-text";
```

- [ ] **Step 3: Add the assertion to operations.test.ts**

In `packages/core/src/state/operations.test.ts`, in the existing "re-exports all Phase 4a Layer 3 operations" test, add one more assertion (or add a new `it()` block):

```typescript
  it("re-exports Phase 4b operations", () => {
    expect(typeof ops.insertText).toBe("function");
  });
```

(Add this as a new `it` inside the existing `describe("operations barrel")`.)

- [ ] **Step 4: Run tests to verify**

Run: `npm test --workspace=packages/core -- "src/state/operations.test"`
Expected: PASS (2 tests in `operations.test.ts` — 1 from Phase 4a + 1 new).

- [ ] **Step 5: Run the full test suite + type check**

Run: `npm test --workspace=packages/core`
Expected: PASS (all existing tests still green AND insertText's 21 new tests + 1 new operations-barrel assertion pass; total ~1041 tests + 4 skipped, up from ~1019 + 4 at end of Phase 4a).

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 6: Verify the new export is not yet wired into the public API**

Run: `grep -E "(insert-text)" packages/core/src/index.ts`
Expected: empty output. Phase 14 cleanup wires the public API.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/state/operations.ts packages/core/src/state/operations.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add insertText to operations barrel

Phase 4b operation insertText is now accessible via the operations
barrel alongside the four Phase 4a block-level operations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Surface anything Phase 4c should account for**

If anything came up during Phase 4b implementation that should inform Phase 4c (split-block, merge-blocks, delete-range, replace-range), add notes to the spec or the project memory. Examples:
- Did the run-merging algorithm feel correct, or did any test reveal a missing case (e.g., merging across a deleted embed)?
- Did the "trailing-edge preference" at item boundaries cause any surprise?
- Was the no-op behavior for empty text the right choice, or should it throw?
- Are there test fixtures that should be promoted to test-utils for reuse?

If yes, edit the spec; commit. Otherwise skip.

---

## Self-review

**Spec coverage** (Phase 4b scope: insertText):
- ✅ Mid-text-item insert (basic case) — Task 1
- ✅ Boundary cases: offset 0, end-of-block, empty block — Task 2
- ✅ Splits a different-attrs item — Task 3
- ✅ At boundary between text items (merge prev / no merge) — Task 4
- ✅ Adjacent to embeds — Task 5
- ✅ Empty-text no-op — Task 6
- ✅ Error cases — Task 7
- ✅ Operations barrel update + verification — Task 8

**Placeholder scan:** No "TBD"/"TODO"/"add appropriate error handling" patterns.

**Type consistency:** `OperationResult`, `BlockId`, `Position`, `ReadonlyAttrs`, `InlineItem`, `TextItem`, `EmbedItem` referenced consistently. Function signature stable.

**Out of scope (deferred):**
- `applyAttrsToRange` (range-based attribute changes). → Phase 4c (or a sibling sub-phase).
- Cross-block structural operations: `splitBlockAtPosition`, `mergeAdjacentBlocks`, `deleteRange`, `replaceRange`. → Phase 4c.
- Paste mechanics: `clonePastedSubtree`. → Phase 4d.
- Embed cascade-delete in removeBlock. → Future when `state.embedContents` lands.
- Public API export wiring. → Phase 14 cleanup.

The Phase 4b plan above produces 1 new source file + tests, ~8 commits, leaves the build green throughout. Estimated execution time: half a day (algorithm is contained; test enumeration is the main work).

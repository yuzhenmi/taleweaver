# State module redesign — Phase 4c-1: applyAttrsToRange

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Layer 3 `applyAttrsToRange` operation — apply an attrs bag to all text items (and the wrap-attrs of any embed items) within a Span. The Span may span multiple blocks. After applying, run-merge adjacent same-attrs items per block. This is the core operation behind "make this selection bold," "remove all italics in this range," etc.

**Architecture:** Per `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`, "Layered API surface > Layer 3" + "Multi-block selection" sections. Cross-block iteration uses Phase 2's `iterateSpan`. Per-block attribute application splits items at the range boundaries, merges new attrs into existing attrs (with `undefined` values removing keys), and runs the same `mergeAdjacentTextItems` post-pass that `insertText` uses.

**Tech Stack:** TypeScript 5.7, vitest 3.0, npm workspaces.

**Spec reference:** `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`. Implements one of the operations listed in "Layered API surface > Layer 3."

**Phase 1-4b status (assumed complete):**
- Phase 1 — Layer 1 types. Last commit `4230343`.
- Phase 2 — Layer 2 utilities + hardening. Last commit `b27bffa`.
- Phase 3 — Cascade attribute interpreters. Last commit `413728a`.
- Phase 4a — Simple block-level operations + barrel. Last commit `cc2b249`.
- Phase 4b — `insertText`. Last commit `597bad1`.
- Build green; 1041 tests passing + 4 skipped.

**Per-phase scope notes:**

- New file at top-level path: `state/apply-attrs.ts` (no name collision; this filename does NOT exist yet — confirmed). Test: `state/apply-attrs.test.ts`.
- Modify: `state/operations.ts` (add export line) and `state/operations.test.ts` (add one assertion). Authorized.
- **Critical implementer guard (per memory `feedback_implementer_create_collision.md`):** if any file the plan asks to CREATE already exists, the implementer must STOP and report `BLOCKED`; never silently refactor, rename, or consolidate. Verified by the controller before dispatch.
- Per CLAUDE.md: TDD throughout. Verify with both `npm test` AND `npm run build`.
- Type safety: no non-null assertions (`!`); use proper narrowing.

**Operation signature:**

```typescript
function applyAttrsToRange(
  state: State,
  span: Span,
  attrs: ReadonlyAttrs,
): OperationResult;
```

Notes:
- `attrs` is the bag to MERGE into existing attrs. To remove an attr, pass it with value `undefined` (e.g., `{ bold: undefined }`).
- No allocator parameter — applyAttrsToRange doesn't create new blocks.
- Empty span (anchor === focus): no-op (returns original state with empty `dirtyIds`).
- Span is normalized first (anchor before focus in document order).
- Per-block range is computed by `iterateSpan` (Phase 2 utility).
- For embed items intersecting the range: apply the merge to the embed's `attrs` field (NOT `properties` — properties are intrinsic embed data; attrs are wrap attributes like links/comments).
- Throws if the span is malformed (preconditions of `iterateSpan` apply: existing leaf-block endpoints, same selection context).

**Merge semantics:**

```
mergeAttrs(existing, incoming):
  result = { ...existing }
  for each key in incoming:
    if incoming[key] === undefined: delete result[key]
    else: result[key] = incoming[key]
  return result
```

**Run-merging:**

After attrs are applied within a block, the block's items may have new same-attrs neighbors. The same `mergeAdjacentTextItems` algorithm used in `insertText` runs as a post-pass per block.

---

## File structure (this phase)

**Created:**

| Path | Responsibility |
|---|---|
| `packages/core/src/state/apply-attrs.ts` | `applyAttrsToRange(state, span, attrs) → OperationResult` |
| `packages/core/src/state/apply-attrs.test.ts` | Unit tests covering single-block, multi-block, embed, attr-removal, empty-span, run-merging, and error cases. |

**Modified:**

| Path | Change |
|---|---|
| `packages/core/src/state/operations.ts` | Append `export { applyAttrsToRange } from "./apply-attrs";` to the Phase 4c section. |
| `packages/core/src/state/operations.test.ts` | Add `expect(typeof ops.applyAttrsToRange).toBe("function");` assertion. |

**Deleted:** none.

---

## Task 1: applyAttrsToRange — single-block basic case (sub-range split + immutability)

**Files:**
- Create: `packages/core/src/state/apply-attrs.ts`
- Test: `packages/core/src/state/apply-attrs.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/apply-attrs.test.ts
import { describe, it, expect } from "vitest";
import { applyAttrsToRange } from "./apply-attrs";
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";

describe("applyAttrsToRange — single-block sub-range (splits one item into prefix + middle + suffix)", () => {
  // Block: [text("helloworld") {}]
  // Apply { bold: true } to range [3, 7) — chars "lowo".
  // Expected: [text("hel") {}, text("lowo") {bold:true}, text("rld") {}]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("helloworld")]),
        }),
      ],
    });

  it("splits the affected text item into prefix + attrs-applied middle + suffix", () => {
    const state = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hel", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "lowo", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "rld", attrs: {} });
  });

  it("returns dirtyIds containing only the modified block", () => {
    const state = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = applyAttrsToRange(state, span, { bold: true });
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  it("preserves immutability + structural sharing (does not mutate original; unmodified blocks share identity)", () => {
    const state = fixture();
    const beforeP = state.blocks.get("p" as BlockId);
    const beforeDoc = state.blocks.get("doc" as BlockId);
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = applyAttrsToRange(state, span, { bold: true });
    expect(result.state).not.toBe(state);
    expect(result.state.blocks.get("p" as BlockId)).not.toBe(beforeP);
    // Original block's content unchanged:
    expect(beforeP?.inlineContent?.items).toHaveLength(1);
    expect(beforeP?.inlineContent?.items[0]).toMatchObject({ text: "helloworld", attrs: {} });
    // Unmodified blocks (doc) share identity.
    expect(result.state.blocks.get("doc" as BlockId)).toBe(beforeDoc);
  });

  it("merges incoming attrs with existing attrs (does not replace)", () => {
    // Pre-existing item has { italic: true }; applying { bold: true } should yield { italic: true, bold: true } in the affected range.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("helloworld", { italic: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ text: "hel", attrs: { italic: true } });
    expect(items?.[1]).toMatchObject({ text: "lowo", attrs: { italic: true, bold: true } });
    expect(items?.[2]).toMatchObject({ text: "rld", attrs: { italic: true } });
  });

  it("re-collapses prefix+middle+suffix when applying value-equal attrs (split-then-merge contract pin)", () => {
    // text("helloworld", { bold: true }) and apply { bold: true } over [3,7).
    // The algorithm splits into prefix/middle/suffix (all with value-equal attrs);
    // the post-pass mergeAdjacentTextItems must re-collapse them into one item.
    // Pins the contract that attrsEqual is value-based (not reference-based) so
    // that future changes to attrsEqual cannot silently break this case.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("helloworld", { bold: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "helloworld", attrs: { bold: true } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- apply-attrs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/apply-attrs.ts
import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import type { Span } from "./block-position";
import type { ReadonlyAttrs } from "./attrs";
import { attrsEqual } from "./attrs";
import {
  createInlineContent,
  createTextItem,
  createEmbedItem,
  type InlineItem,
  type TextItem,
} from "./inline-content";
import { createBlock } from "./block";
import { iterateSpan, normalizeSpan } from "./span-iteration";
import { comparePositions } from "./block-compare";

/**
 * Apply attrs to all inline content within a span.
 *
 * `attrs` is MERGED into each affected item's existing attrs. To remove
 * an attr, pass it with value `undefined` (e.g., `{ bold: undefined }`).
 *
 * For embed items intersecting the range, the merge applies to the embed's
 * `attrs` field (wrap attrs like link/comment-range — NOT `properties`,
 * which holds intrinsic embed data).
 *
 * After applying, each touched block's items go through a run-merging
 * post-pass so adjacent same-attrs text items collapse.
 *
 * Returns OperationResult with dirtyIds = every block id whose items
 * changed.
 *
 * Behavior:
 *   - Empty span (anchor === focus, in same block at same offset): no-op.
 *   - Span is normalized first (anchor before focus in document order).
 *   - Single-block span: one block touched.
 *   - Multi-block span: each leaf block in the span is touched; the
 *     anchor block from anchor.offset to its end, intervening leaves
 *     fully, focus block from 0 to focus.offset.
 *
 * Throws via `iterateSpan`'s preconditions if endpoints are non-leaf
 * containers or different selection contexts.
 */
export function applyAttrsToRange(
  state: State,
  span: Span,
  attrs: ReadonlyAttrs,
): OperationResult {
  // Empty incoming attrs = no-op (mirrors insertText's empty-text guard;
  // avoids needlessly re-allocating items + dirtying blocks).
  if (Object.keys(attrs).length === 0) {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  // Empty span = no-op.
  const normalized = normalizeSpan(state, span);
  if (
    normalized.anchor.blockId === normalized.focus.blockId &&
    normalized.anchor.offset === normalized.focus.offset
  ) {
    return { state, dirtyIds: new Set<BlockId>() };
  }
  // (Same-context + leaf-block-endpoint preconditions enforced by iterateSpan.)

  let blocks = state.blocks;
  const dirtyIds = new Set<BlockId>();

  for (const { block, rangeStart, rangeEnd } of iterateSpan(state, normalized)) {
    if (!block.inlineContent) continue; // defensive — iterateSpan only yields leaves
    if (rangeStart >= rangeEnd) continue; // zero-width range in this block (e.g., focus at offset 0 of last block)

    const newItems = applyAttrsToBlockRange(
      block.inlineContent.items,
      rangeStart,
      rangeEnd,
      attrs,
    );
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
    blocks = blocks.set(block.id, updated);
    dirtyIds.add(block.id);
  }

  return { state: { ...state, blocks }, dirtyIds };
}

/**
 * Walk one block's items and apply attrs to the portion overlapping
 * [rangeStart, rangeEnd). Splits items at boundaries; merges incoming
 * attrs into each affected item's existing attrs.
 */
function applyAttrsToBlockRange(
  items: ReadonlyArray<InlineItem>,
  rangeStart: number,
  rangeEnd: number,
  attrs: ReadonlyAttrs,
): InlineItem[] {
  const out: InlineItem[] = [];
  let cursor = 0;

  for (const item of items) {
    const itemLen = item.kind === "text" ? item.text.length : 1;
    const itemStart = cursor;
    const itemEnd = cursor + itemLen;
    cursor = itemEnd;

    // Item entirely outside the range: keep as-is.
    if (itemEnd <= rangeStart || itemStart >= rangeEnd) {
      out.push(item);
      continue;
    }

    if (item.kind === "text") {
      // Compute the overlap [overlapStart, overlapEnd) within this item's coordinate frame.
      const overlapStart = Math.max(0, rangeStart - itemStart);
      const overlapEnd = Math.min(itemLen, rangeEnd - itemStart);
      const prefix = item.text.slice(0, overlapStart);
      const middle = item.text.slice(overlapStart, overlapEnd);
      const suffix = item.text.slice(overlapEnd);
      if (prefix.length > 0) out.push(createTextItem(prefix, item.attrs));
      if (middle.length > 0) out.push(createTextItem(middle, mergeAttrs(item.attrs, attrs)));
      if (suffix.length > 0) out.push(createTextItem(suffix, item.attrs));
    } else {
      // Embed: 1 unit; apply merge to its wrap-attrs.
      out.push(createEmbedItem(item.embedType, item.properties, mergeAttrs(item.attrs, attrs)));
    }
  }

  return out;
}

/**
 * Merge incoming attrs into existing attrs.
 * - Keys with value `undefined` in `incoming` are REMOVED from the result.
 * - Other keys in `incoming` overwrite or add to `existing`.
 * - Keys only in `existing` are preserved.
 */
function mergeAttrs(existing: ReadonlyAttrs, incoming: ReadonlyAttrs): ReadonlyAttrs {
  const result: Record<string, unknown> = { ...existing };
  for (const key of Object.keys(incoming)) {
    if (incoming[key] === undefined) {
      delete result[key];
    } else {
      result[key] = incoming[key];
    }
  }
  return result;
}

/**
 * Merge adjacent text items with equal attrs into a single item.
 * Embed items are not merged.
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

Run: `npm test --workspace=packages/core -- apply-attrs`
Expected: PASS (5 tests — basic split, dirtyIds, immutability/identity, attrs merge, re-collapse contract pin).

- [ ] **Step 4b: Run the full type checker (REQUIRED)**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/apply-attrs.ts packages/core/src/state/apply-attrs.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add applyAttrsToRange Layer 3 operation — basic single-block case

Applies an attrs bag to all inline content within a Span. Splits text
items at the range boundaries; merges incoming attrs into existing attrs
(undefined values remove keys). Run-merges adjacent same-attrs items
in a post-pass per touched block. This commit covers the basic case
(single block, sub-range, immutability + merge); subsequent tasks add
multi-item, embed, multi-block, attr-removal, empty-span, run-merging,
and error tests — all exercising the same algorithm.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Context

**Working directory:** `/Users/hansyu/code/taleweaver/`
**Branch:** `feature/dom-architecture-redesign` (commit directly here, no branch switching).

**Where this fits:** Phase 4c-1 task 1 of 8. Phase 4b just shipped insertText. This task starts the next Layer 3 operation: applyAttrsToRange. The implementation handles single-block AND multi-block via iterateSpan; this task's tests cover only the single-block case. Tasks 2-7 add coverage; Task 8 wires the barrel.

**Critical implementer guard:** if `state/apply-attrs.ts` already exists, STOP and report `BLOCKED`. The plan asserts the file does NOT exist.

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

## Task 2: applyAttrsToRange — single block, multi-item span

**Files:**
- Modify: `packages/core/src/state/apply-attrs.test.ts` (append tests only)

- [ ] **Step 1: Append the multi-item tests**

Append to `apply-attrs.test.ts`:

```typescript
describe("applyAttrsToRange — single block, multi-item span", () => {
  it("applies attrs across two text items, merging with each item's existing attrs", () => {
    // Block: [text("hello") {}, text("world") { italic: true }]  (length 10)
    // Apply { bold: true } over [3, 8) — covers "lo" (in first item) + "wor" (in second item).
    // Expected: [text("hel") {}, text("lo") {bold:true}, text("wor") {italic:true, bold:true}, text("ld") {italic:true}]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("hello"), text("world", { italic: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 8));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(4);
    expect(items?.[0]).toMatchObject({ text: "hel", attrs: {} });
    expect(items?.[1]).toMatchObject({ text: "lo", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ text: "wor", attrs: { italic: true, bold: true } });
    expect(items?.[3]).toMatchObject({ text: "ld", attrs: { italic: true } });
  });

  it("applies attrs to a fully-covered text item without splitting", () => {
    // Block: [text("hello") {}, text("world") {}]
    // Apply { bold: true } over [0, 5) — covers exactly the first item.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("hello"), text("world")]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ text: "hello", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ text: "world", attrs: {} });
  });

  it("leaves items entirely outside the range untouched (3-item block, range covers only the middle)", () => {
    // Block: [text("aaa"), text("bbb"), text("ccc")] — lengths 3+3+3=9
    // Apply { bold: true } over [3, 6) — covers exactly the middle item.
    // First item ends at 3 (itemEnd <= rangeStart) → keep.
    // Last item starts at 6 (itemStart >= rangeEnd) → keep.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("aaa"), text("bbb"), text("ccc")]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 6));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ text: "aaa", attrs: {} });
    expect(items?.[1]).toMatchObject({ text: "bbb", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ text: "ccc", attrs: {} });
  });
});
```

- [ ] **Step 2-4: Run tests / build / commit**

Run: `npm test --workspace=packages/core -- apply-attrs` → PASS (6 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/apply-attrs.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover applyAttrsToRange single-block multi-item span

Two new tests:
- applying attrs across two items (each gets attrs merged with its existing attrs).
- applying attrs over an exactly-covering range (no item split needed).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: applyAttrsToRange — embed item in range

**Files:**
- Modify: `packages/core/src/state/apply-attrs.test.ts` (append tests only)

- [ ] **Step 1: Append the embed tests**

Append:

```typescript
describe("applyAttrsToRange — embed items in range", () => {
  it("applies attrs to an embed's wrap-attrs (NOT its properties)", () => {
    // Block: [text("a"), embed("image", { src: "u" }), text("b")]  (length 3)
    // Apply { link: "http://x" } over [0, 3) — covers everything.
    // Expected:
    //   - text("a") gets { link: "http://x" }
    //   - embed gets attrs = { link: "http://x" }; properties unchanged
    //   - text("b") gets { link: "http://x" }
    // After run-merge: text items have same attrs but are separated by the embed,
    // so they don't merge across it.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([
            text("a"),
            embed("image", { src: "u" }),
            text("b"),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
    const result = applyAttrsToRange(state, span, { link: "http://x" });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: { link: "http://x" } });
    expect(items?.[1]).toMatchObject({
      kind: "embed",
      embedType: "image",
      properties: { src: "u" },
      attrs: { link: "http://x" },
    });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b", attrs: { link: "http://x" } });
  });

  it("preserves an embed's pre-existing wrap-attrs and merges with incoming", () => {
    // Embed pre-attrs: { comment: "c1" }; apply { link: "http://x" }
    // Expected merged: { comment: "c1", link: "http://x" }
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([
            embed("image", { src: "u" }, { comment: "c1" }),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 1));
    const result = applyAttrsToRange(state, span, { link: "http://x" });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({
      kind: "embed",
      embedType: "image",
      properties: { src: "u" },
      attrs: { comment: "c1", link: "http://x" },
    });
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- apply-attrs` → PASS (8 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/apply-attrs.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover applyAttrsToRange with embed items in range

Two new tests verifying that:
- embed wrap-attrs receive the merged attrs while properties stay
  intact.
- embed pre-existing wrap-attrs merge correctly with incoming attrs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: applyAttrsToRange — multi-block span

**Files:**
- Modify: `packages/core/src/state/apply-attrs.test.ts` (append tests only)

- [ ] **Step 1: Append the multi-block tests**

Append:

```typescript
describe("applyAttrsToRange — multi-block span", () => {
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

  it("applies attrs across two blocks: anchor block partial + focus block partial", () => {
    const state = fixture();
    // Span p1@2 → p2@3: covers p1 [2, 5) + p2 [0, 3).
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    const result = applyAttrsToRange(state, span, { bold: true });

    // p1 split: [text("he") {}, text("llo") {bold}]
    const p1Items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(p1Items).toHaveLength(2);
    expect(p1Items?.[0]).toMatchObject({ text: "he", attrs: {} });
    expect(p1Items?.[1]).toMatchObject({ text: "llo", attrs: { bold: true } });

    // p2 split: [text("wor") {bold}, text("ld") {}]
    const p2Items = result.state.blocks.get("p2" as BlockId)?.inlineContent?.items;
    expect(p2Items).toHaveLength(2);
    expect(p2Items?.[0]).toMatchObject({ text: "wor", attrs: { bold: true } });
    expect(p2Items?.[1]).toMatchObject({ text: "ld", attrs: {} });

    // p3 untouched.
    const p3Items = result.state.blocks.get("p3" as BlockId)?.inlineContent?.items;
    expect(p3Items).toHaveLength(1);
    expect(p3Items?.[0]).toMatchObject({ text: "!", attrs: {} });

    // dirtyIds: only p1 and p2 changed.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2"]));
  });

  it("applies attrs across three blocks: anchor partial, intervening leaf full, focus partial", () => {
    const state = fixture();
    // Span p1@1 → p3@1: covers p1 [1, 5) + p2 [0, 5) + p3 [0, 1).
    const span = createSpan(createPosition("p1" as BlockId, 1), createPosition("p3" as BlockId, 1));
    const result = applyAttrsToRange(state, span, { bold: true });

    // p1: [text("h") {}, text("ello") {bold}]
    const p1Items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(p1Items).toHaveLength(2);
    expect(p1Items?.[0]).toMatchObject({ text: "h", attrs: {} });
    expect(p1Items?.[1]).toMatchObject({ text: "ello", attrs: { bold: true } });

    // p2 fully covered → [text("world") {bold}]
    const p2Items = result.state.blocks.get("p2" as BlockId)?.inlineContent?.items;
    expect(p2Items).toHaveLength(1);
    expect(p2Items?.[0]).toMatchObject({ text: "world", attrs: { bold: true } });

    // p3: [text("!") {bold}]
    const p3Items = result.state.blocks.get("p3" as BlockId)?.inlineContent?.items;
    expect(p3Items).toHaveLength(1);
    expect(p3Items?.[0]).toMatchObject({ text: "!", attrs: { bold: true } });

    // dirtyIds: p1, p2, p3 all changed.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3"]));
  });

  it("preserves structural sharing: untouched blocks share identity across the operation", () => {
    const state = fixture();
    const beforeP3 = state.blocks.get("p3" as BlockId);
    const beforeDoc = state.blocks.get("doc" as BlockId);
    // Span only over p1 and p2.
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 5));
    const result = applyAttrsToRange(state, span, { bold: true });
    expect(result.state.blocks.get("p3" as BlockId)).toBe(beforeP3);
    expect(result.state.blocks.get("doc" as BlockId)).toBe(beforeDoc);
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- apply-attrs` → PASS (11 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/apply-attrs.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover applyAttrsToRange multi-block span

Three new tests:
- two-block span (anchor partial + focus partial), verifying per-block
  splits and dirtyIds = { anchorBlock, focusBlock }.
- three-block span (anchor partial + intervening leaf fully covered +
  focus partial), verifying middle block gets attrs across its full
  content.
- structural sharing: blocks NOT touched by the span retain object
  identity in the result state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: applyAttrsToRange — removing attrs (undefined values)

**Files:**
- Modify: `packages/core/src/state/apply-attrs.test.ts` (append tests only)

- [ ] **Step 1: Append the removal tests**

Append:

```typescript
describe("applyAttrsToRange — removing attrs (undefined values)", () => {
  it("removes a key from text items in range when value is undefined", () => {
    // Block: [text("hello world", { bold: true, italic: true })]
    // Apply { bold: undefined } over [3, 8) — should remove `bold` from "lo wo".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("hello world", { bold: true, italic: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 8));
    const result = applyAttrsToRange(state, span, { bold: undefined });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ text: "hel", attrs: { bold: true, italic: true } });
    expect(items?.[1]).toMatchObject({ text: "lo wo", attrs: { italic: true } });
    expect(items?.[2]).toMatchObject({ text: "rld", attrs: { bold: true, italic: true } });
  });

  it("removing a key that doesn't exist on an item is a no-op for that item", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("hello", { italic: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    // Attempting to remove `bold` when only `italic` exists.
    const result = applyAttrsToRange(state, span, { bold: undefined });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    // After merge attrs: still { italic: true } (bold key never existed).
    expect(items?.[0]).toMatchObject({ text: "hello", attrs: { italic: true } });
  });

  it("can add and remove attrs in the same call", () => {
    // Block: [text("hello", { bold: true })]
    // Apply { bold: undefined, italic: true }: should remove bold AND add italic.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("hello", { bold: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    const result = applyAttrsToRange(state, span, { bold: undefined, italic: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "hello", attrs: { italic: true } });
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- apply-attrs` → PASS (14 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/apply-attrs.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover applyAttrsToRange undefined-value attr removal

Three new tests:
- removing a key from items in range (undefined value).
- removing a key that doesn't exist on an item (no-op for that item).
- adding and removing attrs in the same call.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: applyAttrsToRange — empty span no-op + run-merging contract

**Files:**
- Modify: `packages/core/src/state/apply-attrs.test.ts` (append tests only)

- [ ] **Step 1: Append the no-op + run-merging tests**

Append:

```typescript
describe("applyAttrsToRange — empty span no-op", () => {
  it("returns the original state with empty dirtyIds for a collapsed span", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 2);
    const span = createSpan(pos, pos);
    const result = applyAttrsToRange(state, span, { bold: true });
    expect(result.state).toBe(state);
    expect([...result.dirtyIds]).toEqual([]);
  });

  it("returns the original state with empty dirtyIds when incoming attrs is empty {}", () => {
    // No-op for empty attrs — avoids re-allocating items unnecessarily.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello", { bold: true })]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    const result = applyAttrsToRange(state, span, {});
    expect(result.state).toBe(state);
    expect([...result.dirtyIds]).toEqual([]);
  });
});

describe("applyAttrsToRange — run merging post-pass", () => {
  it("merges adjacent text items that become same-attrs after the operation", () => {
    // Block: [text("a", { bold: true }), text("b") {}, text("c", { bold: true })]
    // Apply { bold: true } over the whole range — every item gets bold.
    // After merge: should collapse to one item.
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
            text("b"),
            text("c", { bold: true }),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "abc", attrs: { bold: true } });
  });

  it("does NOT merge across an embed even when text neighbors share attrs", () => {
    // Block: [text("a"), embed("image"), text("b")]
    // Apply { bold: true } over the whole range — both text items get bold; embed gets bold wrap.
    // Even though text("a") and text("b") have identical attrs after, they don't merge across the embed.
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
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "embed", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- apply-attrs` → PASS (17 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/apply-attrs.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover applyAttrsToRange empty-span no-op + run-merging

Three new tests:
- collapsed span (anchor === focus) returns original state with empty
  dirtyIds.
- post-pass run merging: items that become same-attrs after the
  operation collapse into one item.
- contract pin: text items separated by an embed do NOT merge across
  the embed even when they end up with identical attrs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: applyAttrsToRange — error cases

**Files:**
- Modify: `packages/core/src/state/apply-attrs.test.ts` (append tests only)

- [ ] **Step 1: Append the error tests**

Append:

```typescript
describe("applyAttrsToRange — error cases", () => {
  it("throws when an endpoint references a missing block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("missing" as BlockId, 1),
    );
    expect(() => applyAttrsToRange(state, span, { bold: true })).toThrow(/not found/);
  });

  it("throws when an endpoint references a container block (not a leaf)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "s", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(
      createPosition("s" as BlockId, 0),
      createPosition("p" as BlockId, 1),
    );
    expect(() => applyAttrsToRange(state, span, { bold: true })).toThrow(/container/);
  });

  it("throws when endpoints are in different selection contexts", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
        buildBlock({ id: "fn", type: "footnote-body", inlineContent: createInlineContent([text("footnote")]) }),
      ],
    });
    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("fn" as BlockId, 1),
    );
    expect(() => applyAttrsToRange(state, span, { bold: true })).toThrow(/different selection contexts/);
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- apply-attrs` → PASS (20 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/apply-attrs.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover applyAttrsToRange error cases

Three new tests verifying the implementation throws (via iterateSpan's
preconditions) on:
- missing block in span.
- container-block endpoint.
- cross-selection-context span.

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

Add a new export line in the Phase 4b section (or a new "Phase 4c operations" section), after `export { insertText } from "./insert-text";`:

```typescript
export { applyAttrsToRange } from "./apply-attrs";
```

- [ ] **Step 2: Append assertion to operations.test.ts**

Add one new `it()` block in the existing `describe("operations barrel", ...)`:

```typescript
  it("re-exports Phase 4c-1 operations", () => {
    expect(typeof ops.applyAttrsToRange).toBe("function");
  });
```

- [ ] **Step 3: Run tests + build**

Run: `npm test --workspace=packages/core -- "src/state/operations.test"` → PASS (3 tests).
Run: `npm test --workspace=packages/core` → all green; total ~1061 + 4 skipped.
Run: `npm run build --workspace=packages/core` → clean.

- [ ] **Step 4: Verify public API not yet wired**

Run: `grep -E "(apply-attrs)" packages/core/src/index.ts`
Expected: empty output. Phase 14 cleanup wires the public API.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/operations.ts packages/core/src/state/operations.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add applyAttrsToRange to operations barrel

Phase 4c-1 operation applyAttrsToRange is now accessible via the
operations barrel alongside Phase 4a's block-level operations and
Phase 4b's insertText.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Phase 4c-2 prep**

If anything came up during Phase 4c-1 that should inform Phase 4c-2 (`splitBlockAtPosition`), add notes to the spec or memory. Otherwise skip.

---

## Self-review

**Spec coverage** (Phase 4c-1 scope: applyAttrsToRange):
- ✅ Single-block sub-range with split + immutability + merge — Task 1
- ✅ Single-block multi-item span — Task 2
- ✅ Embed items in range — Task 3
- ✅ Multi-block span (2-block, 3-block, structural sharing) — Task 4
- ✅ Removing attrs (undefined values) — Task 5
- ✅ Empty span + run-merging — Task 6
- ✅ Error cases — Task 7
- ✅ Operations barrel update — Task 8

**Placeholder scan:** No "TBD"/"TODO" patterns.

**Type consistency:** `OperationResult`, `BlockId`, `Span`, `ReadonlyAttrs`, `InlineItem`, `TextItem`, `EmbedItem` referenced consistently.

**Out of scope (deferred):**
- `splitBlockAtPosition` → Phase 4c-2
- `mergeAdjacentBlocks` → Phase 4c-3
- `deleteRange` → Phase 4c-4
- `replaceRange` → Phase 4c-5
- `clonePastedSubtree` → Phase 4d
- Public API wiring → Phase 14

The Phase 4c-1 plan above produces 1 new source file + tests, ~8 commits, leaves the build green throughout. Estimated execution time: half a day.

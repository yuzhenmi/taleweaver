# State module redesign — Phase 4c-5: replaceRange

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Layer 3 `replaceRange` operation — given a `Span` and a `text` payload with `attrs`, delete the range's content and insert the text at the resulting cursor position. This is the operation behind "select a range, type a character" (and the engine-level building block for paste-replace, find-and-replace, etc.).

**Architecture:** Per `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md` line 342 (signature). `replaceRange` is a composition operation — it delegates to `deleteRange` (Phase 4c-4) and then `insertText` (Phase 4b). No new structural logic is introduced; the operation's value is providing a single audited surface for "replace selection with text" with correctly-merged `dirtyIds` and a clean error contract. The `attrs` parameter is the formatting for the inserted text — the caller (action handler) decides what attrs to apply, matching `insertText`'s discipline.

**Tech Stack:** TypeScript 5.7, vitest 3.0, npm workspaces.

**Phase 1 - 4c-4 status (assumed complete):**
- Phase 1 — Layer 1 types. Last commit `4230343`.
- Phase 2 — Layer 2 utilities. Last commit `b27bffa`.
- Phase 3 — Cascade attribute interpreters. Last commit `413728a`.
- Phase 4a — Simple block-level operations + barrel. Last commit `cc2b249`.
- Phase 4b — `insertText`. Last commit `597bad1`.
- Phase 4c-1 — `applyAttrsToRange`. Last commit `107f39a`.
- Phase 4c-2 — `splitBlockAtPosition`. Last commit `e0dbb65`.
- Phase 4c-2.5 cleanup — extracted `mergeAdjacentTextItems` and `updateBlock`. Last commit `2c2a95a`.
- Phase 4c-3 — `mergeAdjacentBlocks`. Last commit `da4b466`.
- Phase 4c-4 — `deleteRange` (with preventive cleanup extracting `splitInlineContentAtOffset` to `inline-content.ts`, and architectural fix moving existence/leaf guards before `normalizeSpan`). Last commit `a7b168d`.
- Build green; 1169 tests passing + 4 skipped.

**Per-phase scope notes:**

- New files: `state/replace-range.ts` and `state/replace-range.test.ts`. Confirmed at plan-write time that NEITHER file exists.
- Modify: `state/operations.ts` (one new export line) and `state/operations.test.ts` (one new assertion). Authorized.
- **Critical implementer guard (per memory `feedback_implementer_create_collision.md`):** if any file the plan asks to CREATE already exists, the implementer must STOP and report `BLOCKED`; never silently refactor, rename, or consolidate. Verified by the controller before dispatch.
- Per CLAUDE.md: TDD throughout. Verify with both `npm test` AND `npm run build`.
- Type safety: no non-null assertions (`!`); use proper narrowing.
- **Manual unused-import scan after writing every file** — `tsconfig` does NOT have `noUnusedLocals`. Lessons from prior phases: implementer self-reviews have missed unused imports twice; the IDE caught them post-commit. Don't repeat — read the imports yourself.
- **Composition discipline:** `replaceRange` does NOT re-implement deleteRange's or insertText's logic. It calls them. Do not duplicate validation, slicing, normalization, or run-merging.

**Why no `IdAllocator` parameter (despite spec mentioning one):** the spec signature is `replaceRange(state, span, text, attrs, allocator)`. But the composition `deleteRange` + `insertText` doesn't allocate any new BlockIds — neither operation creates blocks. Threading an allocator serves no purpose. Consistent with our pattern of dropping the spec's allocator when it's unused (insertText, applyAttrsToRange, deleteRange all dropped it).

**Why not auto-detect attrs from surrounding text:** Word/Google Docs auto-pick the format from the left edge of the selection when typing-to-replace. That heuristic belongs in the action handler, not the state primitive. The Layer 3 operation takes explicit `attrs` so the caller controls the policy. Same discipline as `insertText`.

**Operation signature:**

```typescript
function replaceRange(
  state: State,
  span: Span,
  text: string,
  attrs: ReadonlyAttrs,
): OperationResult;
```

Notes:
- Empty-span (collapsed) + empty text: no-op (returns `{ state, dirtyIds: new Set() }`).
- Empty-span (collapsed) + non-empty text: equivalent to `insertText(state, span.anchor, text, attrs)`. No deletion happens.
- Non-empty span + empty text: equivalent to `deleteRange(state, span)`. No insertion happens.
- Non-empty span + non-empty text: full replacement — delete the range, then insert at the resulting cursor position.
- Cursor position after delete is `{ blockId: normalized.anchor.blockId, offset: normalized.anchor.offset }`. Validity: same-block deletes the range [anchor.offset, focus.offset), leaving anchor.offset within the new (shorter) content. Cross-block deletes everything from anchor.offset onward in the anchor block (and replaces with focus's items[focus.offset..)), leaving anchor.offset at the seam in the new merged content.
- Span is normalized once at the top of `replaceRange`; the normalized form is passed to `deleteRange`. (deleteRange itself runs `normalizeSpan` again, which is idempotent for an already-normalized span.) The normalized anchor's blockId+offset is the cursor position.
- All error cases delegate to `deleteRange` (existence, leaf, cross-parent, cross-context, offset bounds). Test coverage spot-checks delegation rather than re-exhausts the matrix.

**dirtyIds contract:**

The returned `dirtyIds` set is the union of the dirtyIds from the underlying `deleteRange` and `insertText` calls. Specifically:

- For empty-span + empty-text (full no-op): empty set.
- For empty-span + non-empty text (insert-only): the dirtyIds returned by `insertText` (typically just the anchor block's id).
- For non-empty span + empty text (delete-only): the dirtyIds returned by `deleteRange` (anchor + focus + intervening + maybe parent).
- For full replace: union of both, where anchor block's id appears in both inputs and is deduped by Set semantics.

This matches the spec's "every block id whose entry in state.blocks differs from the previous state" contract — the union covers every such block.

---

## File structure (this phase)

**Created:**

| Path | Responsibility |
|---|---|
| `packages/core/src/state/replace-range.ts` | `replaceRange(state, span, text, attrs) → OperationResult`. Composes `deleteRange` + `insertText`; imports `normalizeSpan` from `span-iteration.ts` and `createPosition` from `block-position.ts`. |
| `packages/core/src/state/replace-range.test.ts` | Unit tests covering same-block / cross-block replacement, edge cases (empty text, collapsed span), block-level invariants (composition correctness, dirtyIds union), and error propagation from the underlying operations. |

**Modified:**

| Path | Change |
|---|---|
| `packages/core/src/state/operations.ts` | Append `export { replaceRange } from "./replace-range";` to the Phase 4c section. |
| `packages/core/src/state/operations.test.ts` | Add `expect(typeof ops.replaceRange).toBe("function");` assertion. |

**Deleted:** none.

---

## Task 1: replaceRange — implementation + sanity test

**Files:**
- Create: `packages/core/src/state/replace-range.ts`
- Create: `packages/core/src/state/replace-range.test.ts`

- [ ] **Step 1: Write the failing test (replace-range.test.ts)**

```typescript
import { describe, it, expect } from "vitest";
import { replaceRange } from "./replace-range";
import { buildBlock, buildState, text } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";

describe("replaceRange — basic single-block replacement", () => {
  // doc > [p("hello world")]
  // Replace range [3, 7) with "FOO" — drops "lo w", inserts "FOO" at position 3.
  // Expected: p("helFOOorld")
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world")]) }),
      ],
    });

  it("deletes the range and inserts the replacement text at the seam", () => {
    const state = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = replaceRange(state, span, "FOO", {});

    const block = result.state.blocks.get("p" as BlockId);
    expect(block?.inlineContent?.items).toHaveLength(1);
    expect(block?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "helFOOorld", attrs: {} });

    // dirtyIds: just the modified block (deleteRange dirties "p"; insertText dirties "p"; union = {"p"}).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p"]));
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npm test --workspace=packages/core -- replace-range --run`
Expected: FAIL with module-not-found / `replaceRange is not defined`.

- [ ] **Step 3: Write the production code (replace-range.ts)**

```typescript
import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import type { Span } from "./block-position";
import { createPosition } from "./block-position";
import type { ReadonlyAttrs } from "./attrs";
import { normalizeSpan } from "./span-iteration";
import { deleteRange } from "./delete-range";
import { insertText } from "./insert-text";

/**
 * Replace the inline content within a Span with the given text + attrs.
 *
 * Composes deleteRange (Phase 4c-4) and insertText (Phase 4b):
 *   1. If the span is non-collapsed, delete its content via deleteRange.
 *   2. If the text is non-empty, insert it at the cursor position via
 *      insertText.
 *
 * The cursor position lands at the seam between the surviving anchor
 * prefix and the focus suffix — i.e., `{ normalized.anchor.blockId,
 * normalized.anchor.offset }` post-delete.
 *
 * `attrs` is the formatting for the inserted text. Caller computes the
 * intended formatting (e.g., from the cursor's containing run, or a
 * paste payload's attrs).
 *
 * Returns OperationResult with dirtyIds = union of the two underlying
 * operations' dirtyIds.
 *
 * Error contract delegates entirely to deleteRange (existence, leaf,
 * cross-parent, cross-context, offset bounds) for the non-collapsed
 * paths, and to insertText (offset bounds) for the collapsed-insert
 * path. After deleteRange succeeds, the cursor position is always
 * valid in the post-delete anchor block, so insertText's defensive
 * existence/offset throws are unreachable from the full-replace path.
 *
 * Behavior:
 *   - Collapsed span + empty text: pure no-op.
 *   - Collapsed span + non-empty text: insertText only.
 *   - Non-collapsed span + empty text: deleteRange only.
 *   - Non-collapsed span + non-empty text: deleteRange then insertText.
 *
 * Why deleteRange runs BEFORE normalizeSpan (architectural note): a top-
 * level normalizeSpan would invoke compareBlocksInDocOrder, which throws
 * a generic "compareBlocksInDocOrder: block ... not found" message when
 * either endpoint references a missing block. That message would shadow
 * deleteRange's prefixed contract ("anchor block ... not found", "focus
 * block ... not found"). By calling deleteRange first (which has its own
 * pre-normalize existence/leaf guards from Phase 4c-4), the operation's
 * stated error contract wins. Same architectural pattern as Phase 4c-1's
 * applyAttrsToRange fix and Phase 4c-4's deleteRange fix.
 */
export function replaceRange(
  state: State,
  span: Span,
  text: string,
  attrs: ReadonlyAttrs,
): OperationResult {
  const isCollapsed =
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset;

  // Collapsed span (no range to delete).
  if (isCollapsed) {
    // Pure no-op when there's also no text to insert.
    if (text === "") {
      return { state, dirtyIds: new Set<BlockId>() };
    }
    // Insert-only path. The cursor is just span.anchor — no normalization
    // needed for a collapsed span. insertText's own validation handles
    // missing block / container / offset bounds.
    return insertText(state, span.anchor, text, attrs);
  }

  // Non-collapsed span. Delete first; deleteRange owns existence + leaf +
  // cross-parent + cross-context + offset validation and emits the
  // prefixed error contract directly.
  const deleteResult = deleteRange(state, span);

  // Delete-only path.
  if (text === "") {
    return deleteResult;
  }

  // Full replace: compute the cursor position and insert. Since deleteRange
  // succeeded, both endpoints exist, are leaves, and are in the same
  // selection context — so normalizeSpan(state, span) on the ORIGINAL
  // pre-delete state cannot throw here. The normalized anchor's blockId
  // is the surviving anchor block; its offset is the seam in the post-
  // delete merged content.
  const normalized = normalizeSpan(state, span);
  const cursorPos = createPosition(normalized.anchor.blockId, normalized.anchor.offset);
  const insertResult = insertText(deleteResult.state, cursorPos, text, attrs);

  const combinedDirty = new Set<BlockId>(deleteResult.dirtyIds);
  for (const id of insertResult.dirtyIds) combinedDirty.add(id);
  return { state: insertResult.state, dirtyIds: combinedDirty };
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npm test --workspace=packages/core -- replace-range --run`
Expected: PASS (1 test).

Run: `npm run build --workspace=packages/core`
Expected: clean.

**Manual unused-import scan:** read the imports at the top of `replace-range.ts`. Verify each is used:
- `State`, `OperationResult` — used in the function signature/return type.
- `BlockId` — used in `Set<BlockId>`.
- `Span`, `ReadonlyAttrs` — used in parameters.
- `createPosition` — used to build the cursor position.
- `normalizeSpan` — used to normalize the span.
- `deleteRange`, `insertText` — used in the composition.

All used. If you find any unused, remove it.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/replace-range.ts packages/core/src/state/replace-range.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add replaceRange Layer 3 operation — basic case

Composes deleteRange (Phase 4c-4) + insertText (Phase 4b): if the span
is non-collapsed, deletes its content; if the text is non-empty,
inserts at the (normalized) anchor position. dirtyIds is the union of
the two underlying calls; error contract delegates entirely.

First test covers the simplest single-block replace ("hello world"
range [3, 7) replaced with "FOO" → "helFOOorld"). Subsequent tasks add
coverage for same-block variants, cross-block, edge cases (empty text,
collapsed span), block-level invariants, and error propagation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Context

**Working directory:** `/Users/hansyu/code/taleweaver/`
**Branch:** `feature/dom-architecture-redesign`

**Where this fits:** Phase 4c-5 task 1 of 7 — final operation in the Phase 4c family before clonePastedSubtree (Phase 4d).

**Critical implementer guard:** if `state/replace-range.ts` OR `state/replace-range.test.ts` already exists, STOP and report `BLOCKED`.

**Important — verify with both `npm test` AND `npm run build`** AND **manually scan imports** for unused ones.

**Conventions:** TDD; HEREDOC commit message verbatim; auto-commit on user's behalf; vitest 3.0; no non-null assertions.

## Your Job

Execute Steps 1-5 in order. After writing the production code, self-review for unused imports, `!` non-null assertions (none allowed), and any drift from the plan. Then commit.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Test output AND build output
- Files changed (with commit SHA)
- Self-review findings, including: did you manually scan for unused imports?

---

## Task 2: replaceRange — same-block replacement coverage

**Files:**
- Modify: `packages/core/src/state/replace-range.test.ts` (append tests only).

- [ ] **Step 1: Append the same-block coverage tests**

```typescript
describe("replaceRange — same-block coverage", () => {
  it("replaces a range mid-text-item, inheriting the caller's attrs (NOT the deleted range's attrs)", () => {
    // [text("hello world", { bold: true })] — replace [3, 7) with "FOO" + {italic: true}.
    // Expected items: text("hel", {bold:true}), text("FOO", {italic:true}), text("orld", {bold:true})
    // The inserted text takes the caller's attrs ({italic:true}); the surviving
    // halves keep the block's original attrs ({bold:true}). No run-merging at the
    // seams because attrs differ.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world", { bold: true })]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = replaceRange(state, span, "FOO", { italic: true });

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ text: "hel", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ text: "FOO", attrs: { italic: true } });
    expect(items?.[2]).toMatchObject({ text: "orld", attrs: { bold: true } });
  });

  it("replaces a range and run-merges with neighbors when attrs match", () => {
    // [text("hello world", { bold: true })] — replace [3, 7) with "FOO" + {bold: true}.
    // After: prefix text("hel", {bold}) + insert text("FOO", {bold}) + suffix text("orld", {bold}).
    // All three have same attrs → run-merged into one item: text("helFOOorld", {bold:true}).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world", { bold: true })]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = replaceRange(state, span, "FOO", { bold: true });

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "helFOOorld", attrs: { bold: true } });
  });

  it("replaces a range covering an embed item with text", () => {
    // [text("a"), embed("img"), text("b")] — replace [1, 2) (the embed) with "X" + {}.
    // After: anchor [text("a"), text("X"), text("b")] — all same attrs → run-merged.
    // Final: [text("aXb", {})]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("a"), embed("img"), text("b")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 2));
    const result = replaceRange(state, span, "X", {});

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "aXb", attrs: {} });
  });

  it("replaces a range that spans multiple text items", () => {
    // [text("ab"), text("cd"), text("ef")] — replace [1, 5) with "Z" + {}.
    // After delete: [text("a"), text("f")] (run-merged from "a" + "f" = "af").
    // After insert at offset 1 (which is now end-of-"a"): [text("aZf", {})] (run-merged).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("ab"), text("cd"), text("ef")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 5));
    const result = replaceRange(state, span, "Z", {});

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "aZf", attrs: {} });
  });
});
```

- [ ] **Step 2: Update import to include `embed`**

The Task 1 test file imports `text` only. Update to:
```typescript
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
```

- [ ] **Step 3-5: Run / build / commit**

Run: `npm test --workspace=packages/core -- replace-range --run` → PASS (5 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/replace-range.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover replaceRange same-block variants

Four new tests:
- inserted text inherits caller's attrs, NOT the deleted range's
  surrounding attrs; surviving halves keep the original attrs.
- replacement run-merges into surrounding text when attrs match.
- replace covering an embed item with text (embed dropped, text neighbors
  run-merge with insertion).
- replace spanning multiple text items.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: replaceRange — cross-block replacement coverage

**Files:**
- Modify: `packages/core/src/state/replace-range.test.ts` (append tests only).

- [ ] **Step 1: Append the cross-block tests**

```typescript
describe("replaceRange — cross-block coverage", () => {
  it("replaces a cross-block (adjacent-pair) range with text", () => {
    // doc > [p1("hello"), p2(" world")]
    // Replace from p1@2 to p2@3 with "FOO" + {}.
    // After delete: anchor block has "he" + "rld" = "herld" (p2 deleted).
    // After insert at p1@2: "he" + "FOO" + "rld" = "heFOOrld".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    const result = replaceRange(state, span, "FOO", {});

    const p1 = result.state.blocks.get("p1" as BlockId);
    expect(p1?.inlineContent?.items).toHaveLength(1);
    expect(p1?.inlineContent?.items[0]).toMatchObject({ text: "heFOOrld", attrs: {} });
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    // dirtyIds: union of deleteRange's dirtyIds ({p1, p2, doc}) + insertText's ({p1}) = {p1, p2, doc}.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "doc"]));
  });

  it("replaces a cross-block range with intervening leaves", () => {
    // doc > [p1("hello"), p2("middle"), p3("world")]
    // Replace from p1@2 to p3@2 with "Z" + {}.
    // After delete: p1 has "he" + "rld" = "herld"; p2 and p3 deleted.
    // After insert at p1@2: "he" + "Z" + "rld" = "heZrld".
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
    const result = replaceRange(state, span, "Z", {});

    const p1 = result.state.blocks.get("p1" as BlockId);
    expect(p1?.inlineContent?.items).toHaveLength(1);
    expect(p1?.inlineContent?.items[0]).toMatchObject({ text: "heZrld", attrs: {} });
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
    expect(result.state.blocks.has("p3" as BlockId)).toBe(false);

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3", "doc"]));
  });

  it("inserted text uses the caller's attrs (independent of the surviving anchor block's attrs)", () => {
    // doc > [p1("hello", {bold}), p2(" world", {italic})] — replace p1@2 → p2@3 with "FOO" + {underline: true}.
    // After delete: p1 absorbs "he" {bold} + "rld" {italic} = [text("he", {bold}), text("rld", {italic})].
    // After insert at p1@2: [text("he", {bold}), text("FOO", {underline: true}), text("rld", {italic})].
    // No run-merging since all three have different attrs.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello", { bold: true })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world", { italic: true })]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    const result = replaceRange(state, span, "FOO", { underline: true });

    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ text: "he", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ text: "FOO", attrs: { underline: true } });
    expect(items?.[2]).toMatchObject({ text: "rld", attrs: { italic: true } });
  });

  it("nested: cross-block replacement inside a section container", () => {
    // doc > section > [p1("hello"), p2(" world")] — replace cross-block inside the section.
    // section's lastChildId rewires; doc untouched.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    const result = replaceRange(state, span, "X", {});

    expect(result.state.blocks.get("p1" as BlockId)?.inlineContent?.items[0]).toMatchObject({ text: "heXrld" });
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
    expect(result.state.blocks.get("section" as BlockId)?.lastChildId).toBe("p1");
    expect(result.state.blocks.get("doc" as BlockId)?.firstChildId).toBe("section"); // unchanged
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- replace-range --run` → PASS (9 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/replace-range.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover replaceRange cross-block replacement

Four new tests:
- adjacent-pair cross-block replace (anchor + focus merge with insert text).
- cross-block with intervening leaves.
- inserted text uses caller's attrs (not the surviving anchor's nor the
  deleted range's attrs).
- nested cross-block replacement inside a section container.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: replaceRange — edge cases (empty text, collapsed span, no-op short-circuits)

**Files:**
- Modify: `packages/core/src/state/replace-range.test.ts` (append tests only).

- [ ] **Step 1: Append the edge-case tests**

```typescript
describe("replaceRange — edge cases", () => {
  it("collapsed span + empty text is a pure no-op (returns same state, empty dirtyIds)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 2);
    const result = replaceRange(state, createSpan(pos, pos), "", {});
    expect(result.state).toBe(state);
    expect([...result.dirtyIds]).toEqual([]);
  });

  it("collapsed span + non-empty text equals insertText at that position", () => {
    // [text("hello")] — collapsed at offset 2 + insert "XY".
    // Expected: [text("heXYllo")] (insert in middle, run-merged).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 2);
    const result = replaceRange(state, createSpan(pos, pos), "XY", {});

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "heXYllo", attrs: {} });
    // dirtyIds: just the modified block.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p"]));
  });

  it("non-collapsed span + empty text equals deleteRange (delete only, no insert)", () => {
    // [text("hello world")] — delete [3, 7) with empty text → "helorld".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = replaceRange(state, span, "", {});

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "helorld" });
  });

  it("reverse-order span normalizes correctly", () => {
    // Replace from p@7 to p@3 with "FOO" + {} — same as [3, 7) after normalization.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 7), createPosition("p" as BlockId, 3));
    const result = replaceRange(state, span, "FOO", {});

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "helFOOorld" });
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- replace-range --run` → PASS (13 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/replace-range.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover replaceRange edge cases

Four new tests:
- collapsed span + empty text: pure no-op (returns same state, empty dirtyIds).
- collapsed span + non-empty text: equivalent to insertText.
- non-collapsed span + empty text: equivalent to deleteRange.
- reverse-order span normalizes correctly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: replaceRange — block-level invariants (composition correctness)

**Files:**
- Modify: `packages/core/src/state/replace-range.test.ts` (append tests only).

- [ ] **Step 1: Append the invariant tests**

```typescript
describe("replaceRange — block-level invariants", () => {
  it("preserves embed-referenced content blocks (no cascade-delete)", () => {
    // doc > [p1[], p2[embed("footnote", { contentBlockId: "fn-body" })]] + standalone fn-body.
    // Replace p1@0 → p2@0 with "X" + {} — focus's items[0..) keeps the embed; merged into p1; then "X" inserted at p1@0.
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
    const result = replaceRange(state, span, "X", {});

    expect(result.state.blocks.has("fn-body" as BlockId)).toBe(true);
    // p1's content: prefix=[] + "X" inserted at offset 0 + focus.suffix=[embed] → [text("X"), embed].
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "X" });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "footnote-anchor" });
  });

  it("preserves structural sharing for blocks NOT touched", () => {
    // doc > [p0, p1, p2, p3] — replace cross-block from p1@2 to p2@2 with "Z".
    // p0 is untouched.
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
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 2));
    const result = replaceRange(state, span, "Z", {});
    expect(result.state.blocks.get("p0" as BlockId)).toBe(beforeP0);
  });

  it("does not mutate the original state", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 4));
    const result = replaceRange(state, span, "FOO", {});
    expect(result.state).not.toBe(state);
    // Original state still has the original block content.
    expect(state.blocks.get("p" as BlockId)?.inlineContent?.items[0]).toMatchObject({ text: "hello" });
  });

  it("dirtyIds is the union of underlying deleteRange + insertText dirtyIds (full replace)", () => {
    // Cross-block replace where deleteRange dirties {p1, p2, p3, doc} and insertText dirties {p1}.
    // Union (deduped) = {p1, p2, p3, doc}.
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
    const result = replaceRange(state, span, "X", {});
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3", "doc"]));
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- replace-range --run` → PASS (17 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/replace-range.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover replaceRange block-level invariants

Four new tests:
- preserves embed-referenced content blocks (no cascade-delete on focus's content).
- preserves structural sharing for blocks NOT touched.
- does not mutate the original state.
- dirtyIds is the union of underlying deleteRange + insertText dirtyIds.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: replaceRange — error propagation (delegated to deleteRange / insertText)

**Files:**
- Modify: `packages/core/src/state/replace-range.test.ts` (append tests only).

- [ ] **Step 1: Append the error-case tests**

These tests spot-check that errors from the underlying operations propagate correctly. They do NOT re-exhaust deleteRange's full error matrix (which has its own dedicated 12-test suite); instead they confirm each delegation path (existence, leaf, cross-parent, cross-context, offset bounds) reaches the caller.

```typescript
describe("replaceRange — error propagation", () => {
  it("propagates deleteRange's missing-anchor error (cross-block)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("missing" as BlockId, 0), createPosition("p" as BlockId, 1));
    expect(() => replaceRange(state, span, "X", {})).toThrow(/anchor block ".+" not found/);
  });

  it("propagates deleteRange's container-endpoint error", () => {
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
    expect(() => replaceRange(state, span, "X", {})).toThrow(/anchor block ".+" is a container/);
  });

  it("propagates deleteRange's cross-parent error", () => {
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
    expect(() => replaceRange(state, span, "X", {})).toThrow(/cross-parent spans are not supported/);
  });

  it("propagates cross-context error (no common ancestor)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
        buildBlock({ id: "fn", type: "footnote-body", inlineContent: createInlineContent([text("footnote")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("fn" as BlockId, 1));
    expect(() => replaceRange(state, span, "X", {})).toThrow(/no common ancestor/);
  });

  it("propagates offset-out-of-range error", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 999));
    expect(() => replaceRange(state, span, "X", {})).toThrow(/out of range/);
  });

  it("propagates insertText's offset-out-of-range error for collapsed-span insert-only path", () => {
    // Collapsed span at out-of-range offset, non-empty text → bypasses deleteRange,
    // goes straight to insertText, which throws.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 999);
    expect(() => replaceRange(state, createSpan(pos, pos), "X", {})).toThrow(/out of range/);
  });
});
```

- [ ] **Step 2-4: Run / build / commit**

Run: `npm test --workspace=packages/core -- replace-range --run` → PASS (23 tests).
Run: `npm run build --workspace=packages/core` → clean.

```bash
git add packages/core/src/state/replace-range.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover replaceRange error propagation

Six new tests verifying errors from the underlying operations propagate
correctly:
- deleteRange's missing-anchor error (cross-block).
- deleteRange's container-endpoint error.
- deleteRange's cross-parent error.
- cross-context "no common ancestor" error (via normalizeSpan).
- offset-out-of-range error from deleteRange.
- offset-out-of-range error from insertText (insert-only path with
  collapsed span at invalid offset; deleteRange is bypassed).

These spot-check delegation rather than re-exhausting deleteRange's
full error matrix (covered by Phase 4c-4 Task 7's dedicated suite).

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

After the existing Phase 4c-4 export line, add a new "Phase 4c-5 operations" section:

```typescript
// Phase 4c-4 operations (range delete)
export { deleteRange } from "./delete-range";

// Phase 4c-5 operations (range replace)
export { replaceRange } from "./replace-range";
```

- [ ] **Step 2: Append assertion to operations.test.ts**

Inside the existing `describe("operations barrel", ...)` block, add a new `it()`:

```typescript
  it("re-exports Phase 4c-5 operations", () => {
    expect(typeof ops.replaceRange).toBe("function");
  });
```

- [ ] **Step 3: Run tests + build**

Run: `npm test --workspace=packages/core -- "src/state/operations.test" --run` → PASS (7 tests in `operations.test.ts`).
Run: `npm test --workspace=packages/core --run` → all green; total **1193 + 4 skipped** (was 1169 + 4 after Phase 4c-4; this phase adds 23 new tests in `replace-range.test.ts` + 1 new assertion in `operations.test.ts` = 24).
Run: `npm run build --workspace=packages/core` → clean.

- [ ] **Step 4: Verify public API not yet wired**

Run: `grep -E "(replace-range)" packages/core/src/index.ts`
Expected: empty output. Phase 14 cleanup wires the public API.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/operations.ts packages/core/src/state/operations.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add replaceRange to operations barrel

Phase 4c-5 operation replaceRange is now accessible via the operations
barrel alongside Phase 4a's block-level operations, Phase 4b's
insertText, Phase 4c-1's applyAttrsToRange, Phase 4c-2's
splitBlockAtPosition, Phase 4c-3's mergeAdjacentBlocks, and Phase 4c-4's
deleteRange. Phase 4c (range/structural surgery) is now feature-complete.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Phase 4d prep**

If anything came up during Phase 4c-5 that should inform Phase 4d (`clonePastedSubtree`), add notes. Otherwise skip.

---

## Self-review

**Spec coverage** (Phase 4c-5 scope: replaceRange):
- ✅ Core operation: same-block + cross-block-same-parent replace via composition — Task 1
- ✅ Same-block coverage: attrs inheritance from caller, run-merging, embed/multi-item — Task 2
- ✅ Cross-block coverage: adjacent / with intervening / attrs / nested — Task 3
- ✅ Edge cases: collapsed + empty-text, collapsed + insert-only, non-collapsed + empty-text, reverse-order — Task 4
- ✅ Block-level invariants: embed-content survival, structural sharing, immutability, dirtyIds union — Task 5
- ✅ Error propagation: 6 spot-checks of delegation paths — Task 6
- ✅ Operations barrel update — Task 7

**Placeholder scan:** No "TBD"/"TODO" patterns. Composition operation; no helper duplication.

**Type consistency:** `State`, `OperationResult`, `BlockId`, `Span`, `ReadonlyAttrs` referenced consistently. `createPosition` from `block-position.ts`. `normalizeSpan` from `span-iteration.ts`. `deleteRange` and `insertText` from their respective modules.

**Out of scope (deferred):**
- `clonePastedSubtree` (multi-block paste mechanics) → Phase 4d
- Public API wiring → Phase 14
- Auto-detect formatting from surrounding text (action-handler concern, not state primitive)

**Composition disciplines (verified across the plan):**
- replaceRange does NOT re-implement deleteRange or insertText logic — only orchestrates.
- normalizeSpan is called once at the top; the result drives both the deletion span and the cursor position for insertion.
- dirtyIds is correctly unioned via Set semantics — no enumeration manually.
- Error contracts are inherited; no error-message rewriting.

The Phase 4c-5 plan above produces 1 new source file + tests, ~7 commits, leaves the build green throughout. Estimated execution time: half a day. With Phase 4c-5 complete, the entire Phase 4c (range / structural surgery) family is feature-complete: applyAttrsToRange, splitBlockAtPosition, mergeAdjacentBlocks, deleteRange, replaceRange.

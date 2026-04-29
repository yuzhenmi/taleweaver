# Plan 3.G — Line-Stable IFC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the IFC's full-paragraph re-wrap with incremental line-stable wrap. After Plan 3.G, edits to a paragraph re-wrap only the affected portion; lines outside the change range are reused (reference-equal). For long paragraphs, this is O(1) per keystroke instead of O(N).

**Architecture:** Greedy line wrap has a useful property: line K's break is determined by `(start-token, available-inline-size-at-line)`. When a re-wrap converges with a previous wrap (same start-token + same line-width at the same line), the rest of the previous wrap can be reused. Plan 3.G ships:
- Stable token IDs derived from `(state-node-key, offset-within-node)`.
- A wrap-level convergence detector.
- Reference-equality reuse of unchanged lines.

**Spec reference:** `2026-04-29-plan-3-architectural-foundation-rewrite.md` §7 (Line-stable IFC).

**Branch:** `feature/dom-architecture-redesign`.

---

## Worktree discipline

All work in `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign`. Pre-flight check on every task: `cd <worktree> && pwd && git -C <worktree> branch --show-current`. Expect `feature/dom-architecture-redesign`. STOP if mismatched. Use absolute paths and `git -C <worktree>` for all git commands.

---

## Task list overview

| Task | Subject |
|---|---|
| **1** | Stable token IDs derived from `(state-node-key, offset-within-node)` |
| **2** | `IFCState` type and per-paragraph cache infrastructure |
| **3** | `rewrapIncremental` algorithm with convergence detection |
| **4** | Wire incremental wrap into `layoutInlineContent`; full-wrap fallback path |
| **5** | Float-environment dirty-block-offset tracking; re-wrap floor when floats change |
| **6** | Reference-equality test suite for incremental wrap (assert prefix/suffix lines reference-equal) |
| **7** | Reserve `text-wrap: balance \| pretty \| stable` schema values; treat as `wrap` for v1 |
| **8** | Address inherited followups: `parentCs` unused param (F3A.4); Token schema cleanup (F3C.2) |

---

## Task 1: Stable token IDs

**Files:**
- Modify: `packages/core/src/layout/text-tokenize.ts` (or wherever `Token` is defined).
- Modify: `packages/core/src/layout/ifc.ts`.

**Why:** Tokens currently lack identity that survives state changes. To detect convergence, we need: "is this token the same one that appeared in the previous wrap?" — answered by token ID equality.

**Token ID scheme:**
- Text tokens: `{state-node-key}:{offset-within-node}`. When text content changes within a node, that node's tokens get new IDs (offsets shift). Surrounding nodes' tokens stay stable.
- Atomic tokens (inline-blocks, floats, hard-breaks): `{state-node-key}` (no offset; the node itself IS the atom).

**Steps:**
1. Add `id: string` field to `Token` interface.
2. Populate in `collectInlineTokens` from `(child.key, matchStart)` for text and `(child.key)` for atomics.
3. (Optional) tests for ID stability.
4. Commit.

---

## Task 2: `IFCState` type and per-paragraph cache

**Files:**
- Create: `packages/core/src/layout/ifc-state.ts` — `IFCState` interface; per-paragraph cache helpers.
- Re-export from `index.ts`.

**`IFCState` shape:**

```ts
export interface IFCState {
  readonly tokens: readonly Token[];
  readonly lines: readonly LineBox[];
  readonly availableInlineSize: number;
  // Float-env state at construction time (for invalidation comparison)
  readonly floatEnvDirtyOffset: number;  // 0 means "no floats affected"
}

export interface IFCStateCache {
  get(paragraphKey: string): IFCState | undefined;
  set(paragraphKey: string, state: IFCState): void;
  invalidate(paragraphKey: string): void;
}
```

**Steps:**
1. Define types + factory function `createIFCStateCache()`.
2. Tests for roundtrip + invalidation.
3. Commit.

---

## Task 3: `rewrapIncremental` algorithm with convergence detection

**Files:**
- Create: `packages/core/src/layout/wrap-incremental.ts`.
- Tests.

**Algorithm:**

```ts
export function rewrapIncremental(
  prev: IFCState | null,
  newTokens: readonly Token[],
  availableInlineSize: number,
  shaper: TextShaper,
  floatEnv: FloatEnvironment,
  startBlockOffset: number,
): readonly LineBox[] {
  if (!prev || prev.availableInlineSize !== availableInlineSize) {
    // No prior state OR width changed: full re-wrap.
    return wrapAll(newTokens, availableInlineSize, shaper, floatEnv, startBlockOffset);
  }

  // Find the first divergent token (by ID).
  const changePoint = findChangePoint(prev.tokens, newTokens);
  if (changePoint === -1) {
    // Token list identical; assume floats unchanged → reuse.
    return prev.lines;
  }

  // Find the line containing the change point.
  const startLineIdx = findLineForToken(prev.lines, changePoint);
  const reusedHead = prev.lines.slice(0, startLineIdx);
  const startToken = prev.lines[startLineIdx]?.startTokenIdx ?? changePoint;

  // Re-wrap from startToken; check for convergence.
  const newLines: LineBox[] = [];
  let cursor = startToken;
  while (cursor < newTokens.length) {
    const line = wrapOneLine(newTokens, cursor, availableInlineSize, shaper, floatEnv);
    newLines.push(line);

    // Convergence check: does the next wrap start-token align with a previous line?
    const matchingPrev = findLineByStartToken(prev.lines, line.endTokenIdx + 1);
    if (matchingPrev !== null && availableSizeMatches(matchingPrev, floatEnv)) {
      const reusedTail = prev.lines.slice(matchingPrev);
      return [...reusedHead, ...newLines, ...reusedTail];
    }

    cursor = line.endTokenIdx + 1;
  }

  return [...reusedHead, ...newLines];
}
```

**Steps:**
1. Implement `rewrapIncremental` + `findChangePoint` + `findLineForToken` + helpers.
2. Tests:
   - First-time wrap (no prev): full wrap.
   - Identical tokens: reuse all.
   - Insert mid-paragraph: lines before change reused; lines after converge.
   - Different available inline-size: full re-wrap.
3. Commit.

---

## Task 4: Wire incremental wrap into `layoutInlineContent`

**Files:**
- Modify: `packages/core/src/layout/ifc.ts`.

**Behavior:** `layoutInlineContent` now consults the IFCStateCache (passed via `LayoutContext` or as a separate parameter). For each anonymous-block / paragraph being laid out:
- Look up `prev` state by `paragraph.key`.
- Call `rewrapIncremental(prev, newTokens, ...)` to get the lines.
- Cache the new state.

**Files to update:**
- `packages/core/src/layout/layout-context.ts` — add `ifcStateCache: IFCStateCache` to context.
- `packages/core/src/layout/ifc.ts` — replace the existing wrap loop with `rewrapIncremental` + cache lookup.
- `packages/core/src/layout/dispatch.ts` — root context creates fresh cache.

**Steps:**
1. Plumb the cache through context.
2. Replace IFC's wrap call with incremental version.
3. Run all tests; verify no regressions.
4. Commit.

---

## Task 5: Float-environment dirty-block-offset tracking

**Files:**
- Modify: `packages/core/src/layout/float-context.ts` — add dirty-tracking.
- Modify: `packages/core/src/layout/wrap-incremental.ts` — use it in convergence check.

**Why:** When a float is added/removed/moved between layouts, lines whose block-offset is at-or-below the affected y need re-wrap. Previous lines (above) are still valid.

**Implementation:**
```ts
interface FloatEnvironment {
  // ...existing
  dirtyBlockOffsetSince(prev: FloatEnvironment): number;
}
```

If both environments have the same set of floats (placed comparison), result = +Infinity (no dirty).
Otherwise, result = lowest changed float's block-offset.

**Steps:**
1. Add `dirtyBlockOffsetSince` to `FloatEnvironment`.
2. Use in `rewrapIncremental` to set re-wrap floor: skip reuse for lines below dirty offset.
3. Test.
4. Commit.

---

## Task 6: Reference-equality test suite

**Files:**
- Create: `packages/core/src/integration/incremental-wrap.test.ts`.

For each scenario, perform two layouts (initial + edit), assert:
- Lines outside affected range are `===` reference-equal between layouts.
- Lines inside affected range are NOT reference-equal.

Scenarios:
1. Insert character mid-paragraph.
2. Insert character at start of paragraph (worst case — full re-wrap expected).
3. Toggle bold on a word (style change).
4. Add a float above paragraph (whole paragraph re-wraps).
5. No-op edit (token list identical) — full reuse.

**Commit:** `test(integration): line-stable IFC reference-equality assertions`.

---

## Task 7: `text-wrap` schema reservation

**Files:**
- Modify: `packages/core/src/styles/style.ts` — `textWrap: "wrap" | "nowrap" | "balance" | "pretty" | "stable"` (already added in Plan 3.C Task 0; verify).
- Modify: `packages/core/src/layout/ifc.ts` — log a one-time warning if a non-`wrap`/`nowrap` value is used; treat as `wrap`.

**Steps:**
1. Verify the schema accepts the values (Plan 3.C Task 0 should have added them).
2. Add a comment in IFC where the `textWrap` value would be consumed: "Plan 3.G: only `wrap` / `nowrap` honored; balance/pretty/stable activate in a future plan."
3. Commit.

---

## Task 8: Address inherited followups

**Files:**
- Modify: `packages/core/src/layout/ifc.ts` — remove `parentCs` unused param OR use it.

**Why:** F3A.4 / F3B.5 / F3C followups all flag the same dead parameter. Either remove or use.

**Decision:** REMOVE. The function body doesn't read it; nothing in the IFC needs it post-cascade.

**Steps:**
1. Find `parentCs` parameter and remove from the signature.
2. Update callers.
3. Test.
4. Commit (close F3A.4, F3B.5, F3C inherited followups).

Also: F3C.2 — Token schema cleanup. After Task 1 adds the `id` field, Token may be ready for a tidier shape (combining cluster info, hyphen breaks, etc. into a more cohesive structure). Leave as-is for v1; document that we re-evaluate post-3.G if Token has grown unwieldy.

---

## Phase exit criteria

- All 8 tasks committed.
- Build clean across all packages.
- Test suite green.
- Reference-equality test suite passes (lines outside change range reuse).
- `parentCs` unused parameter closed.
- Dev server boots; typing in a long paragraph feels responsive (anecdotal verification).

## Plan 3.A / 3.B / 3.C / 3.D / 3.E / 3.F followups closed by 3.G

- F3A.4 / F3B.5 / F3C followups — `parentCs` unused (Task 8).
- F3C.2 — Token schema (Task 1 reshapes; mostly resolved).

## Plan 3.G new followups likely

- The `text-wrap: pretty` value won't activate until a paragraph-optimal wrap algorithm is added (Knuth-Plass-style); document.
- The `IFCStateCache` invalidation semantics need to integrate with Plan 3.H (incremental layout) — when a paragraph render node changes, both incremental-cascade and IFCStateCache need invalidation.
- The `dirtyBlockOffsetSince` comparison may have edge cases around floats placed by `placeFloat` returning a different position than requested (push-below); verify the comparison correctly handles "same requested but different final position".

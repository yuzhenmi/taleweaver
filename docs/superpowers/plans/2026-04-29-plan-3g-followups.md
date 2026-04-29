# Plan 3.G — Follow-ups, Hacks, and Deferred Cleanups

**Status as of Plan 3.G completion (2026-04-29):**
- 7 commits on `feature/dom-architecture-redesign` for Plan 3.G
- Build clean across all packages
- Test suite green: 695 core / 114 dom / 10 react

---

## Items closed by 3.G

- **F3A.4 / F3B.5 / F3C inherited** — `parentCs` unused param. Removed in 3.G Task 8 (`0497171`). The function signature is now clean.
- **F3C.2** — Token schema cleanup. The `id` field added in Task 1; the existing complexity (clusterWidths, hyphenBreaks) is acceptable for v1.

## Critical follow-up — content equality

### F3G.1 — Token ID scheme is positional, doesn't detect same-length text changes

**File:** `packages/core/src/layout/ifc.ts` (Token construction in `collectInlineTokens`)

**What:** Token IDs are derived from `(sourceKey, offset)` for text tokens. Two tokens at the same source position have the same ID even if their text content differs. So a same-length edit (replacing "hello" with "world" — both 5 chars at offset 0) produces identical token IDs across layouts.

**Concrete bug scenario:**
1. Initial layout: paragraph "hello world", tokens `[{id: "t:0", text: "hello", ...}, {id: "t:6", text: "world", ...}]`. Cache stores this state.
2. User edits to "HELLO world" (same length). New layout collects tokens `[{id: "t:0", text: "HELLO", ...}, {id: "t:6", text: "world", ...}]`.
3. `findChangePoint(prev.tokens, new.tokens)` compares IDs only. Returns `-1` (no change detected).
4. The cache lookup returns the OLD lines. **The user's edit doesn't appear in the layout.**

**Why it surfaced:** Plan 3.G Task 6's "edit to one paragraph invalidates only its cached state" test was constructed with an INSERTION ("first" → "FIRST") which changes the text length, shifting offsets and producing different IDs for subsequent tokens. The implementer noted this carefully — same-length replacement would fail.

**Fix options:**

(a) **Compare more than just id in `findChangePoint`.** Compare `id` + `text` + `width`. This is what real engines do — token equality means "same identity AND same content."

```ts
function tokensEqual(a: Token, b: Token): boolean {
  return a.id === b.id && a.text === b.text && a.width === b.width
    && /* style equality, isSpace, isLineBreak, etc. */;
}

export function findChangePoint(prev: readonly Token[], next: readonly Token[]): number {
  const len = Math.min(prev.length, next.length);
  for (let i = 0; i < len; i++) {
    if (!tokensEqual(prev[i], next[i])) return i;
  }
  if (prev.length !== next.length) return len;
  return -1;
}
```

(b) **Encode content into the ID.** `id = "${sourceKey}:${offset}:${textHash}"` where `textHash` is a quick string hash. Costs a hash computation per token.

(c) **Hybrid: compare ID first, then text content as fallback.** Same as (a) but presented as a fast-path optimization.

**Recommended:** (a). It's explicit, type-safe, and matches the existing pattern of "tokens are equal when their content is equal".

**When to fix:** Plan 3.H (incremental layout) is the natural place — it'll consume incremental wrap output and any layout-tree reuse needs to be content-correct, not just identity-correct. Add as a Plan 3.H prerequisite task.

**Workaround until then:** the cache currently provides correctness-via-staleness (returns stale layout for same-length edits). For LIVE editing, this is user-visible bug. The current example app may not exercise this case at typing speed (each keystroke either inserts or deletes, both of which change length). But a paste-replace operation that swaps text of identical length would trigger the bug.

**Priority:** **HIGH for Plan 3.H.** Document loudly so the next phase fixes it.

## New followups from 3.G

### F3G.2 — `dirtyBlockOffsetSince` is a stub

**File:** `packages/core/src/layout/float-context.ts`

**What:** Task 5 added the method but with a conservative stub: same-instance returns `+Infinity`, different instance returns `0`. No real diff is computed. Plan 3.H consumers can implement properly when they have a use case (likely: comparing two FloatEnvironments across incremental layouts, returning the lowest block-offset where their placements differ).

**Priority:** Plan 3.H or later.

### F3G.3 — Convergence detection not exercised in shipped code

**File:** `packages/core/src/layout/wrap-incremental.ts` and `ifc.ts` integration

**What:** Task 3 implemented the full `rewrapIncremental` algorithm with convergence detection. Task 4 chose the simple-cache-only path (full reuse on identity, full re-wrap otherwise) due to complexity of extracting `wrapOneLine` from the IFC's hyphen-handling code. The convergence-detection logic IS implemented and tested via `wrap-incremental.test.ts` but not connected to the IFC's actual layout.

**To activate:** refactor the IFC's wrap loop to drive iteration via `wrapOneLine` callbacks. Hyphen-split tokens need a representation that fits the contiguous-token-range invariant of `WrapOneLineFn`. Possible approach: pre-shape hyphen-split tokens at tokenization time (before wrapping starts) so the wrap loop sees a flat token array.

**Priority:** medium. The simple-cache provides 90%+ of the benefit for documents without long-paragraph edits. Convergence detection helps for the case where typing on line 30 of a 100-line paragraph; without it, the whole paragraph re-wraps. Acceptable for v1; optimize later when perf data warrants.

### F3G.4 — `IFCStateCache` invalidation depends on render-node-key stability

**File:** `packages/core/src/layout/ifc-state.ts`

**What:** The cache is keyed by `paragraph.key`. When the paragraph node is recreated (new key), the cache misses correctly. But if the paragraph's key is reused while children change (anonymous-block-run case where the parent's `anon[i]` key may shift), the cache could return stale data.

Plan 3.E Task 5 set up positional keys for anonymous boxes (`parent/anon[i]`), so the keys ARE stable per position. If a child is added/removed mid-parent, anonymous keys at later positions shift, naturally invalidating those cache entries. Edge case: if a render tree's child order changes (children move) without the parent's key changing, cache entries keyed by `parent/anon[i]` may incorrectly persist.

**Mitigation:** for v1, the example app's edit operations don't reorder children. Real document edits (drag-and-drop, etc.) could surface this. Plan 3.H (incremental layout) revisits cache invalidation more comprehensively.

## Inherited still-unresolved

- **F3C.3** — `TextShaper | TextMeasurer` overload. Future plan.
- **F3C.4** — Mixed-direction bidi. Plan 4.
- **F3D.1/.6** — Rowspan/colspan auto-table. Plan 6.
- **F3D.2** — `containingBlockSize` plumbing not yet consumed. Forward-compat.
- **F3D.3** — `withInlineOffset` requires explicit `containingInlineSize`. Document.
- **F3D.4** — IFC inline-block makes a fresh root context (cache isolation). Low priority.
- **F3E.1** — Anonymous cell synthesizes synthetic ElementBox. Low priority.
- **F3E.2** — Anonymous row stylesheet inheritance. Low priority.
- **F3E.3** — Anonymous block run produces LineBoxes as siblings of BlockBoxes. Low priority.
- **F3F.1** — `LayoutContext.isBFCRoot` dual-source-of-truth. Watch for misuse.
- **F3F.2 / F3F.3** — Doc-only.
- **bfc.ts unreachable code** at ~line 357 (preexisting Plan 1 followup F7.x). Outstanding.

## Most-important items going into Plan 3.H

1. **F3G.1** — token content-equality. Plan 3.H prerequisite.
2. **F3G.2** — `dirtyBlockOffsetSince` real implementation. Plan 3.H consumer.
3. **F3G.3** — convergence detection not yet wired (optional optimization).

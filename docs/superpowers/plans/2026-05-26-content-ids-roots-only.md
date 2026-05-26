# `getEmbedContentIds`/`getTemplateContentIds` → roots only (#313) — Plan

> subagent-driven-development; independent code-reviewer gate before commit; TDD.

**Goal (C.2c prereq, surfaced in #285 T2 review):** the full + incremental render loops iterate
`getEmbedContentIds`/`getTemplateContentIds`, which today return `.keys()` of the flat content Y.Map =
body ROOTS **and** their CHILDREN. So every child of a multi-level body is ALSO rendered as a spurious
standalone top-level `RenderOutput.{embed,template}Contents` entry — with `parentComputed=null` (wrong
cascade context) and wastefully (the child is already rendered in-body under its root). C.2c
(headers/footers) iterates `templateContents` and would lay out those child entries as independent
header/footer regions. Fix: the accessors return only ROOT ids.

**Root criterion (confirmed):** a body root has `parentId === null`; body children carry `parentId`
pointing to their in-body parent (proven by #285's multi-level fixtures + its parentId invalidation
walk). Single-level bodies (leaf roots) also have `parentId === null` ⇒ still returned.

**Blast radius (enumerated):** the ONLY production consumer of the `*ContentIds` accessors is
`render.ts` (4 loops); no production code iterates `RenderOutput.embedContents`/`.templateContents`
(the state-side `state.embedContents` references in delete-range/remove-block/etc. are a different
thing — the state map, not the render output). C.2c isn't wired yet. So narrowing the accessors to
roots is safe; only the accessor unit tests + the #285 render tests' expectations (entry counts) may
need confirming.

## Task 1

**Files:** `packages/core/src/state/state.ts` (the two accessors + docstrings); `state.test.ts`
(accessor tests); `packages/core/src/render/render.test.ts` (confirm/adjust entry-count expectations);
`packages/core/src/state/block-traversal.ts` (~20-21 comment refinement). Render.ts call sites UNCHANGED
(they already iterate + want roots).

1. **`getEmbedContentIds` / `getTemplateContentIds`:** yield only ids whose block `parentId === null`.
   Implementation: iterate the map's keys, resolve each via the existing `getEmbedContent(state, id)` /
   `getTemplateContent(state, id)`, yield the id iff `block !== null && block.parentId === null`. No `!`;
   narrow the resolved block. Rewrite the docstrings: "Yield the ROOT BlockId of each registered
   embed/template body (blocks with `parentId === null` in the map). Body CHILDREN are reached via the
   root's child chain during render, NOT enumerated here — this prevents spurious non-root
   `RenderOutput` entries (#313)."
2. **`block-traversal.ts` ~20-21 comment:** refine "Embed-content blocks … have parentId === null" →
   embed/template body ROOTS have `parentId === null` (children carry parentId within the body since
   C.2c multi-level bodies); the unreachable-from-main-tree claim still holds. (Comment-only; the
   cycle-bound logic is unchanged.)

**TDD (write FIRST):**
- `state.test.ts`: a multi-level embed body `[root(parentId null, firstChild=c1), c1(parentId root),
  c2(parentId root)]` → `getEmbedContentIds` returns ONLY `[root]` (NOT c1/c2). Same for
  `getTemplateContentIds` with a template body. Single-level leaf body → returns `[root]`. Empty → `[]`.
  Two sibling roots → both returned. (These REPLACE the existing all-ids assertions.)
- `render.test.ts`: a multi-level template body → `RenderOutput.templateContents` has ONLY the root
  entry (`templateContents.size === 1`, no `templateContents.get(childId)`); the root entry still
  contains the children IN-BODY (regression-lock the #285 multi-tree-walk behavior). Same for embed.
  Confirm the existing #285 tests still pass (they look up the root + walk into it — should be
  unaffected; adjust ONLY if one asserted a child standalone entry).

## Verify
- `npm run build --workspace=packages/core` clean; FULL core + dom green; `examples/react` builds.
- Confirm NO production consumer broke (only render.ts uses the accessors; no RenderOutput-map
  iteration). Reviewer gate, then commit.

## Status
- [x] T1 — accessors yield roots only + docstrings + comment + tests.
  - `state.ts`: both accessors converted to generators filtering `block.parentId === null`
    (resolve via `getEmbedContent`/`getTemplateContent`, no `!`); docstrings rewritten.
  - `block-traversal.ts`: cycle-bound comment refined (roots null, children carry parentId).
  - Tests: `state.test.ts` accessor blocks replaced (multi-level → root-only, single-level leaf,
    two sibling roots, empty); `render.test.ts` #313 root-only entry-count tests added (size===1,
    children undefined as top-level, present in-body). RED confirmed before fix, GREEN after.
  - Verify: core build clean; full core (1693 pass / 4 skip) + dom (149 pass) green;
    examples/react builds. No unexpected test changes. NOT committed (reviewer gate pending).

# Plan 3.E — Anonymous Box Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate anonymous boxes inline during FC layout dispatch when the document tree's structure doesn't match what a formatting context requires. After Plan 3.E, the engine renders correctly when state-tree authors mix block + inline children at the same level, or when the table structure is missing intermediate rows / row-groups / cells.

**Architecture:** Real CSS engines never materialize anonymous boxes as a separate render-tree pass. They synthesize them at layout dispatch time, ephemerally. We do the same: a `groupChildren()` helper at the top of `layoutBlock` walks children and groups consecutive inline-display children into virtual "anonymous block runs"; each run dispatches to one IFC. Table FC has its own dispatcher inserting anonymous row / row-group / cell when missing.

**Spec reference:** `2026-04-29-plan-3-architectural-foundation-rewrite.md` §5 (anonymous box generation).

**Branch:** `feature/dom-architecture-redesign`.

---

## Worktree discipline

All work in `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign`. Pre-flight check on every task: `cd <worktree> && pwd && git -C <worktree> branch --show-current`. Expect `feature/dom-architecture-redesign`. STOP and report BLOCKED if mismatched. Use absolute paths and `git -C <worktree>` for all git commands.

---

## Task list overview

| Task | Subject |
|---|---|
| **1** | Define a child-grouping helper for BFC: walks children, groups consecutive inline-display children into "anonymous block runs" |
| **2** | BFC dispatches one IFC per anonymous block run; block children dispatch normally |
| **3** | Table FC: auto-insert anonymous row + row-group when a `display: table-cell` is a direct child |
| **4** | Table FC: auto-wrap inline content in anonymous `display: table-cell` when found in a table-row |
| **5** | Anonymous box positional keying for incremental cache (`parentKey/anon[i]`) |
| **6** | Integration test + smoke: documents with mixed block+inline children render correctly; tables with missing intermediates render correctly |

---

## Task 1: BFC child-grouping helper

**Files:**
- Create: `packages/core/src/layout/group-children.ts` — helper module.
- Create: `packages/core/src/layout/group-children.test.ts`.

**Behavior:** Walk children in document order; group consecutive inline-display children (`display: "inline"`, `"inline-block"`, or text nodes) into a single virtual run. Block-display children stand alone.

**Output type:**

```ts
export type ChildGroup =
  | { kind: "block";  child: ElementBox; positionalIndex: number }
  | { kind: "inline-run"; children: readonly RenderNode[]; positionalIndex: number };

export function groupChildren(parent: ElementBox): ChildGroup[];
```

The `positionalIndex` is the group's index in the parent (used by Task 5 for stable keying).

**Steps:**
1. Pre-flight check.
2. Implement `groupChildren` per the spec.
3. Tests:
   - All-block children → N block groups.
   - All-inline children → 1 inline-run.
   - Mixed: `block, inline, inline, block, inline` → `block, inline-run([2 children]), block, inline-run([1 child])`.
   - Empty children → empty array.
4. Build + commit: `feat(layout): groupChildren helper for anonymous block run detection`.

---

## Task 2: BFC dispatches one IFC per inline-run group

**Files:**
- Modify: `packages/core/src/layout/bfc.ts`.
- Modify: `packages/core/src/layout/bfc.test.ts` for new mixed-content test.

**Behavior:** At the top of `layoutBlock`, call `groupChildren(node)`. For each group:
- `block` group: dispatch to `layoutBlock` or `layoutTable` as today.
- `inline-run` group: synthesize a virtual "anonymous block" wrapper, then dispatch to `layoutInlineContent` with the run's children. The anonymous wrapper inherits the parent's computed style (zero margins, padding, borders); CSS spec says anonymous blocks have transparent layout properties.

**Implementation sketch:**

```ts
const groups = groupChildren(node);
for (const group of groups) {
  if (group.kind === "block") {
    // existing dispatch path: layoutBlock or layoutTable
  } else {
    // inline-run: create virtual ElementBox with the run's children;
    // dispatch to layoutInlineContent.
    const anonKey = `${node.key}/anon[${group.positionalIndex}]`;
    const anonElement: ElementBox = {
      type: "element",
      key: anonKey,
      tag: "anon-block",  // or whatever the type label is
      computedStyle: cs,  // inherits parent's
      children: group.children,
    };
    const lines = layoutInlineContent(anonElement, ...);
    // append lines to layoutChildren
  }
}
```

**Note:** the existing `layoutBlock` already has a path that detects "all inline children" and runs IFC. After Task 2, that detection is REPLACED by the explicit grouping — `groupChildren` returns one inline-run group when all children are inline, and the BFC dispatches IFC for that group as a degenerate one-group case.

**Tests:**

1. Mixed: a doc with `text, paragraph, text` — engine produces 2 anonymous IFCs and 1 paragraph block, in that order, in the doc's layout.
2. All-inline parent: a paragraph with `text, span, text` — produces ONE IFC (no anonymous wrap visible to the consumer).
3. All-block: doc with just paragraphs — no anonymous boxes generated.

**Commit:** `feat(layout): BFC anonymous block runs for mixed block+inline children`.

---

## Task 3: Anonymous table-row + row-group when cell is direct child of table

**Files:**
- Modify: `packages/core/src/layout/table-fc.ts`.

**Behavior:** When `layoutTable` walks the table's children, if it encounters a `display: "table-cell"` directly (without a `table-row` ancestor inside the table), wrap it in an anonymous row.

Similarly, `display: "table-row"` direct children of a table get wrapped in an anonymous row-group (in v1 we don't model row-groups explicitly; the wrap is logical).

**Implementation:** add a child-grouping pre-pass in `layoutTable` that synthesizes anonymous wrappers as needed.

**Tests:**
1. Table with a `table-cell` child (no row) — engine generates an anonymous row containing the cell.
2. Table with a mix of `table-row` and bare `table-cell` children — bare cells are grouped into an anonymous row at their position.

**Commit:** `feat(layout): Table FC anonymous row + row-group when missing`.

---

## Task 4: Anonymous table-cell when inline content is in a table-row

**Files:**
- Modify: `packages/core/src/layout/table-fc.ts`.

**Behavior:** When laying out a `table-row`'s children, if a non-`table-cell` element or text node appears, wrap it in an anonymous `table-cell`.

**Tests:**
1. Table-row containing a paragraph (block) — wrapped in anonymous table-cell.
2. Table-row containing inline content directly — wrapped in anonymous table-cell.

**Commit:** `feat(layout): Table FC anonymous table-cell for inline content in row`.

---

## Task 5: Positional keying for anonymous boxes

**Files:**
- Modify: `packages/core/src/layout/group-children.ts` (export key generator).
- Modify: `packages/core/src/layout/bfc.ts`, `table-fc.ts` (use the key generator).

**Behavior:** Anonymous boxes have no state-node ID, so they can't reuse a render-node `key`. Generate stable positional keys: `<parentKey>/anon[<index>]`.

**Why:** so the incremental layout cache (Plan 3.H) and intrinsic-sizing cache can index anonymous boxes by stable key.

**Steps:**
1. Confirm Tasks 2-4 use a consistent key shape (`parentKey/anon[i]`).
2. Document the key shape in `group-children.ts` (or a dedicated `anonymous-keys.ts` if preferred).
3. Tests verify stable keys across two layouts of the same input.

**Commit:** `feat(layout): stable positional keys for anonymous boxes`.

---

## Task 6: Integration test + dev-server smoke

**Files:**
- Create: `packages/core/src/integration/anonymous-boxes.test.ts`.
- Possibly: `examples/react/src/...` — add a doc with mixed block+inline content for visual verification.

**Scenarios:**
1. Doc with `text, paragraph, text` — both text runs render as separate "anonymous-block lines" before/after the paragraph.
2. Table with bare `table-cell` direct children — render with an anonymous row wrapper.
3. Table-row with paragraph inside — paragraph wrapped in anonymous cell.

**Smoke:** dev server boots; example app's existing doc still renders.

**Commit:** `test(integration): anonymous box generation scenarios`.

---

## Phase exit criteria

- All 6 tasks committed.
- Build clean across all packages.
- Test suite green.
- Anonymous boxes generated correctly for mixed block+inline content and for missing table intermediates.
- Dev server boots.

## Plan 3.A / 3.B / 3.C / 3.D followups closed by 3.E

- None directly. Plan 3.E adds new infrastructure rather than fixing prior work.

## New followups likely from 3.E

Track here as discovered:
- Anonymous-box style inheritance: per CSS spec, anonymous boxes inherit from parent. Plan 3.E uses parent's computedStyle directly. If a future test uncovers a case where this is wrong (e.g., `text-decoration` should propagate through anonymous boxes specially), document.
- Anonymous-box fragmentation: anonymous boxes split across pages like real boxes. Plan 5 (pagination) revisits.

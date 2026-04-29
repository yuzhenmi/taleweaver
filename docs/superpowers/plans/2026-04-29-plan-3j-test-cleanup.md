# Plan 3.J — Test Cleanup + Value-Resolution Pipeline Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Final phase of Plan 3. Close out lingering test gaps, add a comprehensive value-resolution-pipeline test suite, and wrap up Plan 3 with a summary doc.

**Architecture:** Plan 3.J is housekeeping. Each task targets a specific gap from prior phases' followups or the retrospective D11 (test gap on value-resolution pipeline).

**Spec reference:** `2026-04-29-plan-3-architectural-foundation-rewrite.md` §10.J. Retrospective D11.

**Branch:** `feature/dom-architecture-redesign`.

---

## Worktree discipline

All work in `/Users/hansyu/code/taleweaver/.worktrees/dom-redesign`. Pre-flight check on every task. Use absolute paths and `git -C <worktree>` for git.

---

## Task list overview

| Task | Subject |
|---|---|
| **1** | Value-resolution pipeline test suite — `em` / `%` / `auto` / intrinsic-keyword end-to-end (closes D11) |
| **2** | Restore tests for inline-block intrinsic sizing (Plan 1 F6 deletion category, now meaningful) |
| **3** | Restore tests for floats edge cases (Plan 1 F6) |
| **4** | Audit `bfc.ts` unreachable code at line ~383 (preexisting Plan 1 F7.x) — remove if dead |
| **5** | Plan 3 wrap-up summary doc — mark closed-out followups; flag remaining work for Plans 4-8 |

---

## Task 1: Value-resolution pipeline test suite

**File:** `packages/core/src/integration/value-resolution.test.ts` (new).

Cover each value form across cascade + layout:

```ts
describe("Value resolution — end-to-end (cascade + layout)", () => {
  it("em on margin resolves against inheritance-chain font-size", () => {
    // Document with fontSize: 20; child paragraph with marginBlockStart: { unit: "em", value: 0.5 }
    // → marginBlockStart resolves to 10 px
  });

  it("rem (root em) — when 'rem' unit lands; stub for now", () => {
    // Plan 3.B doesn't ship `rem`; document the gap.
  });

  it("percent margin resolves against containing-block inline-size", () => {
    // marginBlockStart: { unit: "percent", value: 10 } in 500px container → 50 px
  });

  it("percent padding resolves against containing-block inline-size", () => {
    // paddingInlineStart: { unit: "percent", value: 5 } in 800px container → 40 px
  });

  it("auto margin in a width-constrained block: still 0 (per CSS rule for auto in inline-axis)", () => {
    // Auto margins in CSS center the block when width is explicit. Plan 3.B's
    // fallbackForAutoMargin defaults to 0; this test documents that.
  });

  it("auto inline-size on inline-block resolves to shrink-to-fit", () => {
    // (Already tested in intrinsic-sizing.test.ts; reference there.)
  });

  it("min-content keyword on inlineSize uses widest cluster", () => {
    // (Already tested; reference.)
  });

  it("inheritance: child fontSize is inherited if not overridden", () => {
    // Doc with fontSize: 24 → paragraph with no fontSize → inherits 24
  });

  it("non-inheriting properties: child margin doesn't inherit from parent margin", () => {
    // Doc with marginBlockStart: 10 → paragraph with no margin → 0 (initial)
  });
});
```

(Adjust based on what feels comprehensive. Aim for 8-12 scenarios.)

## Task 2: Inline-block intrinsic sizing edge cases

Restore or add tests:
- inline-block with explicit `inlineSize` (not auto): uses the explicit value, NOT shrink-to-fit.
- inline-block with content wider than its container: shrink-to-fit clamps to available.
- inline-block inside another inline-block (nested): outer + inner both compute correctly.

## Task 3: Floats edge cases

Restore or add tests:
- Float with explicit width that doesn't fit: pushes below.
- Float and clear interaction: a cleared block lands below the floats it cleared.
- Floats on both sides where content doesn't fit between them: line pushes below.

(The float push-below test from Plan 3.F should already exist; verify and reference.)

## Task 4: Address `bfc.ts` unreachable code

**File:** `packages/core/src/layout/bfc.ts` (~line 383)

**Steps:**
1. Read the surrounding code; understand what control-flow branches make the line unreachable.
2. If the unreachable code IS dead: remove it.
3. If the unreachable code is INTENTIONAL but TS can't see why (e.g., a defensive `throw` after an exhaustive switch): annotate with a comment explaining why TS sees it as unreachable, OR refactor to surface the intent.

## Task 5: Plan 3 wrap-up summary

**File:** Create `docs/superpowers/plans/2026-04-29-plan-3-summary.md`.

Contents:
- Overview of what Plan 3 delivered (cross-phase summary).
- Test counts per phase.
- Followups closed (cumulative list).
- Followups remaining (deferred to Plan 4-8 or specific later plans).
- Architectural decisions logged for future readers.
- Pointers to each phase's plan-doc + followups-doc.

---

## Phase exit criteria

- All 5 tasks committed.
- Build clean.
- Test suite green.
- Value-resolution pipeline test suite covers em / percent / auto / intrinsic / inheritance.
- `bfc.ts` unreachable code addressed.
- Plan 3 summary doc landed.
- Plan 3 is COMPLETE.

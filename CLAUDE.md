# Taleweaver — Project Instructions for Claude

## Vision

**Taleweaver is a TypeScript word-processor engine that matches Google Docs quality.**

The engine renders rich text documents — multi-page, multi-script, faithfully typeset, edited at human speed even on hundred-page documents. It is the layout-and-rendering core; downstream consumers (collab, spell-check, embedded media, native shells) plug into it via interfaces.

## Mission

**Use CSS/DOM box-model semantics faithfully.** Decades of browser engineering have already solved how to flow rich text, blocks, floats, and tables across pages with cascading properties. Borrow that work; don't re-derive an inferior version of it. Concretely: real Style → ComputedStyle → UsedStyle pipeline; real BFC / IFC / Table FCs dispatching by `display`; real CSS 9.5 floats with clearance; real CSS Fragmentation Module pagination; Unicode-correct text (UAX bidi, grapheme clusters, line-break).

**Scope: "uncompromising word processor."** Every feature a real document engine needs, implemented to CSS spec. NOT a general-purpose web layout engine. Skip features that exist for app-layout only:
- OUT: flex, grid, sticky, scroll-snap, animations/transitions, filters/clip-path/mask
- **FUTURE (designed-for-now, built-later):** real-time collaborative editing. The state model is built on Yjs primitives from the start (Phase 4e). Collab sync transport is added when collab work begins; the state module needs no rewrite at that point. See `docs/superpowers/specs/phase-5-plus/decisions.md` decision C.
- OUT (downstream consumers / separate plans): spell-check backend, embedded media (LaTeX/charts/video), concrete HarfBuzz-WASM in-engine
- IN: vertical writing-mode (CJK), full bidi, hyphens, multi-column, real pagination with fragmentation + headers/footers/footnotes, position relative/absolute, transforms, full tables, generated content, counters, tab stops, hyperlinks, comments, change tracking

**When in doubt about scope:** would Google Docs do this? Would a typesetter need this? If yes → in scope. If it's a web/app-UI feature → out of scope.

**Quality bar:** match Google Docs in feature behavior. Performance target: O(1) per keystroke and per cursor-move regardless of document size.

**We are NOT building an MVP. We are building a Google Docs-equivalent.**
This overrides every instinct to ship a reduced first version of anything.
There is no "v1 that handles the common case" for an in-scope feature: when a
feature is built, it is built to Google Docs parity — including the hard cases
(footnote bodies that split across pages, RTL, restart-numbering, long-document
performance, etc.). A feature that handles the 95% case and degrades on the rest
is NOT done.

Phasing is allowed ONLY across whole features (build footnotes before tables),
NEVER within a feature (do not ship footnotes-that-cannot-split and call
splitting a "fast-follow"). "Foundations before features" (first principle 1) is
about LAYER and FEATURE ordering — it never licenses a deliberately-weakened
version of a feature you are actively building. If a feature's correct behavior
needs a foundation that doesn't exist yet, build that foundation first or don't
start the feature; do not ship the feature degraded.

When you catch yourself proposing "simplest MVP", "v1 handles the common case",
"assume X fits", "good enough for now", or "fast-follow for the hard part" —
STOP. That is the exact anti-pattern this rule exists to prevent. The only
acceptable scoping question is "which whole feature next," never "how much of
this feature."

## Durability rule (load-bearing)

**Roadmap-level and scope decisions must be committed to a spec or plan doc before continuing past the decision. Chat is not durable.**

Compaction summaries preserve implementation-detail-level context (commits, file changes, plan-task lists). They do NOT reliably preserve strategic choices, scope framings, or path/option decisions made in conversation. If a decision will inform work spanning more than one phase or session, write it to disk before the next tool call.

Concretely:
- New scope or path decisions → write to a spec under `docs/superpowers/specs/` before continuing.
- New plan structure or phase decomposition → write to a plan under `docs/superpowers/plans/` before dispatching implementer subagents.
- Mid-brainstorm decisions → checkpoint into the spec doc as they happen, don't batch-write at the end.

## First principles (load-bearing — apply on every iteration)

These principles drive every workflow decision in this project. They are
ABSOLUTE standing rules. The user will not restate them task-by-task.

### 1. Foundations before features

Prioritize lower-level abstractions (state, render, cascade, layout) before
higher-level features. A weak core multiplies feature debt; a strong core
makes features cheap.

When picking what to work on next, sort by **layer depth** (pipeline order
= priority order: state → render → cascade → layout → editor → host) and
prefer the deeper item. Invariants / type vocabulary beat algorithms beat
features. Cross-cutting cleanups beat localized fixes. Architectural debt
beats bug fixes when the bug is a symptom of the debt.

Not a license to refactor endlessly — once the foundation is solid enough
to support the next feature, move up. The rule says "don't skip the
foundation pass," not "stay in the foundation forever."

### 2. Fix-now-not-later, scoped to surviving code

We fix issues NOW (instead of later) because procrastination compounds
into design debt that destroys future design as scope grows. EXCEPT
issues in code already committed for destruction (per active spec / plan
/ in-flight decision) — those die with the code, so fixing them is
waste.

When triaging issues: (1) consult active specs and in-flight decisions to
identify which code survives; (2) fix surviving-code issues now; (3) note
doomed-code issues as one-liners only, don't make them action items; (4)
escalate borderline cases to the user. Discipline is **scope-before-raise**,
not raise-then-defer.

### 3. Review-until-no-more-feedback (ABSOLUTE)

**Every cycle of planning AND every cycle of implementation must terminate
with an independent code-reviewer dispatch that returns "approved / no more
feedback".** No exceptions.

The user has restated this rule five times. It is the standing default. It
overrides time pressure, "small fix" feels, and "tests pass" feels.

**"No more feedback" is a HIGH bar — do not confuse it with "no blockers."**
The loop terminates ONLY when the reviewer's verdict is, in substance, *"clean
— I have no remaining feedback at any severity."* A review that returns findings
labelled "minor", "nit", "acceptable follow-up", "non-blocking", or "no
blockers" has NOT terminated the loop — it has open feedback. The correct
response to ANY open finding is to RESOLVE it and re-review, iterating until the
reviewer comes back genuinely clean. Committing on a "no blockers" verdict with
open findings is the exact lapse this rule exists to prevent.

**Interaction with principle 4 (carve-out to a ticket).** Principle 4 lets a
concern become "a follow-up task with its own ticket" — but a carve-out does NOT
terminate the review loop by itself. A finding may be deferred to a ticket ONLY
when it is genuinely OUT OF SCOPE of the current diff (a pre-existing issue, or a
separable larger workstream), AND you re-dispatch the reviewer and it returns
clean ON THE CURRENT DIFF with that item explicitly carved out. A finding that is
IN the current diff (something this change introduced or should have done) is not
eligible for carve-out — fix it and re-review. When unsure whether a finding is
in-scope, treat it as in-scope and fix it.

**Terminating-review checklist (run before EVERY commit):** (1) Did the last
reviewer dispatch cover THIS exact diff? (2) Did it return zero open findings —
not "no blockers", actually zero? (3) If any finding was deferred, is it provably
out-of-scope AND did a re-review confirm the diff is clean with it carved out? If
any answer is "no", you are not done — resolve and re-review; do NOT commit.

**When the review fires:**
- After writing a plan → dispatch plan reviewer → iterate → only when
  approved, dispatch implementer.
- After every implementation cycle → dispatch code-reviewer → iterate →
  only when approved, commit.
- After a stalled / killed / timed-out implementer that left usable
  changes → STILL dispatch the reviewer on the working tree before
  commit.
- End of each phase → phase-level reviewer if appropriate.

**Catch-the-lapse trigger:** before writing `git commit`, ask: *was a
code-reviewer dispatched for this exact diff and did it approve?* If no,
dispatch the reviewer first.

**Common rationalizations that mean "I'm about to skip review" (don't):**
"tests pass, build clean — good enough" / "the implementer claimed
browser-verified" / "it's a small fix" / "the implementer stalled but
the work looks right" / "I want to keep momentum" / "the reviewer
infrastructure failed" (try again; if it persistently fails, escalate to
user, don't self-review silently).

**Common rationalizations that mean "I'm about to commit on an unterminated
review" (don't):** "the reviewer said no blockers" / "those are just minor
nits" / "the reviewer called it an acceptable follow-up" / "I'll ticket the
rest and move on" / "it's non-blocking so it can wait" / "the findings are
low-severity". Each of these is OPEN FEEDBACK. Resolve the findings and
re-review to a genuinely clean verdict before committing.

**Exceptions are narrow:** trivially mechanical edits — one-line typo
fixes, memory updates, pure git operations with no semantic change. Bug
fixes, refactors, new features, and tests are NOT in the exception list
regardless of size.

**When implementer is a subagent:** do NOT include the commit step in
the implementer's instructions. The implementer stops after build/test
green and reports the diff. The controller dispatches the reviewer,
iterates if needed, THEN commits.

### 4. Never downplay issues in reviews

When a reviewer (or audit) raises a concern, it becomes an action item.
There is no "observation / minor / fine as-is" bucket that quietly drops
items. If you raise it, it gets resolved — either fixed, or carved out
explicitly as a follow-up task with its own ticket.

This applies in BOTH directions: don't soften reviewer findings to ship
faster, AND don't escalate every nitpick to blocker — but every concern
SURFACES as a tracked outcome.

### 5. Document decisions and plans to disk continuously

Chat is not durable. Compaction summaries preserve implementation
details but DO NOT reliably preserve strategic choices, scope framings,
or path/option decisions made in conversation. Multi-step work without
written plans drifts.

**Concretely:**
- Goal capture: before non-trivial work, write the goal to a plan/spec
  doc.
- Decisions land immediately: when a scope choice, ordering choice, or
  principle change is made mid-stream, checkpoint it into the doc THAT
  TURN, before the next tool call.
- Status tracking: keep both a TaskCreate task list AND a status section
  in the plan doc, both updated as work proceeds.
- Findings + ranking from reviewer / explorer subagents go into the
  plan doc, not just chat.

(This generalizes the Durability rule above to ALL multi-step work, not
just roadmap-level decisions.)

### 6. Browser engine is the reference

For layout / text / cascade / fragmentation / a11y / IME questions,
default to "what does the browser do?" Don't drift toward simpler
heuristics without a spec citation. Decades of browser engineering have
already solved these problems; borrow that work rather than re-deriving
inferior versions.

### 7. Top word processors are the reference

For state-model / position-semantics / editing-model questions,
survey Word / Google Docs / Pages / Notion / ProseMirror / Lexical /
Slate / TipTap / Quill before recommending. The convergence across these
systems IS the answer most of the time.

When principles 6 and 7 conflict (e.g., empty-line selection: Chrome
shows full-line, Firefox shows narrow, Google Docs shows narrow), the
engine's mission ("match Google Docs quality") settles it: prefer the
word-processor convention for editing/document-shape questions, prefer
the browser convention for layout/text-flow questions.

### 8. Every bug fix lands a regression test — lean, not bloated (ABSOLUTE)

When a bug is found (especially a browser-found one that unit tests
missed), the fix is NOT done until its behavior is covered by a test that
would FAIL without the fix. This is how we stop regressions and grow the
suite's real coverage where it has gaps.

**Keep tests lean and effective.** Prefer FOLDING the regression assertion
into an EXISTING, closely-related test (one more `expect` on a setup that
already exists) over creating a new test/file. Add a new test only when no
existing test exercises that path. The goal is maximum behavior coverage
per line of test, not test count. A bug found in the browser usually means
a missing assertion in an existing test, not a missing test file — find
that test and add the assertion.

Browser-found bugs are the highest-signal: they reveal exactly the
integration the unit suite doesn't exercise. Every one becomes a durable
test before the fix is called done.

## In-flight architectural decisions

These are durable decisions that affect work across multiple phases.
Check this section before starting any work that touches the named
subsystems.

- **State model: block-tree-of-styled-runs (2026-05-02).** Replaced the
  earlier path-based immutable tree of `StateNode`s with a Y.Doc-backed
  `Map<BlockId, Block>` plus per-block `inlineContent: InlineItem[]`. ID-
  based positions (`{ blockId, offset }`). Substantially implemented on
  `feature/dom-architecture-redesign`. Spec at
  `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`.

- **Virtualized layout (2026-05-24).** The paginated layout pass splits into
  a cheap measure/paginate pass (runs every keystroke in the reducer; computes
  page boundaries via a pure fit-core over cached per-block fragmentation
  metadata — allocation-free) and an on-demand `getPage(i)` position pass
  (materializes a positioned `PageBox` only for viewport + cursor pages).
  `editorState.layoutTree` becomes `LayoutBox | VirtualLayoutTree`
  (discriminated by `type: "virtual-root"`). Fixes Enter-at-top being
  O(N_blocks) (175ms at 110pp): every block after a top-edit was re-positioned
  every keystroke. Floats/`clear` docs fall back to the legacy full path in v1.
  Spec (reviewer-approved): `docs/superpowers/specs/2026-05-24-virtualized-layout-design.md`;
  root-cause: `docs/superpowers/specs/2026-05-24-l-perf-f-shift-tolerant-page-reuse-design.md`.
  Phased: (1) fit-core extraction + measure pass behind current output;
  (2) VirtualLayoutTree + getPage + `materializeAll()` bridge; (3) DOM
  controller migration (perf win lands); (4) cursor/hit-test/selection/line-nav
  to per-page LineIndex + plan resolver; (5) remove bridge; (6) optional
  Fenwick incremental measure.

## Architecture documentation

**Hierarchical living docs at `docs/architecture/`.** Each file describes the **target state** of one slice of the engine — what it should be when complete. Status flags (`[implemented]`, `[partial]`, `[missing]`) annotate items where current state diverges; `state-of-branch.md` is the consolidated audit of implementation vs target.

**File hierarchy.** Hierarchical folders, with `overview.md` at every level (top-level overview has no number; per-package and per-module overviews live in their folder). Numbered files are mid-level; sub-numbered files are deeper. Add deeper files only when a parent doc would otherwise grow too dense.

```
docs/architecture/
├── overview.md             ← top-level: packages and inter-package touchpoints
├── 1-core/
│   ├── overview.md         ← core's top-level modules and the pipeline
│   ├── 1.0-styles.md       ← type vocabulary, INITIAL_COMPUTED_STYLE, logicalToPhysical
│   ├── 1.1-state.md
│   ├── 1.2-render.md
│   ├── 1.3-cascade.md
│   ├── 1.4-layout/         ← folder
│   │   ├── overview.md
│   │   ├── 1.4.1-bfc.md
│   │   ├── 1.4.2-ifc.md
│   │   └── 1.4.3-table-fc.md
│   ├── 1.5-pagination.md
│   ├── 1.6-text.md
│   ├── 1.7-editor.md
│   ├── 1.8-perf.md
│   └── 1.9-positioning.md  ← position: relative/absolute, transforms, opacity
├── 2-dom/
│   ├── overview.md
│   ├── 2.1-editor-controller.md
│   ├── 2.2-canvas-renderer.md
│   ├── 2.3-paint-cache.md
│   └── 2.4-canvas-shaper.md
├── 3-react/
│   ├── overview.md
│   ├── 3.1-use-editor.md
│   └── 3.2-editor-view.md
└── state-of-branch.md      ← consolidated audit: current code vs target architecture
```

Files cross-link rather than duplicate content. Each `overview.md` introduces the modules below it and links into them.

**Stop point for "architecture":** when a description gets to "how this function is structured internally," that's code-and-test territory, not architecture docs. Architecture covers shape, interfaces, responsibilities, data flow.

**Pure architecture content.** No roadmap framing, no plan numbers, no historical context. Architecture docs are timeless state documents — what the engine IS — separate from `docs/superpowers/plans/` (how we got here) and `docs/superpowers/specs/` (one-off design decisions).

**No unstable references.** Architecture docs describe how the software works. They MUST NOT reference numbers that change as the codebase evolves: lines of code, file sizes, test counts, commit hashes, fixture sizes, performance measurements, dependency-version specifics. These belong in plan docs, perf reports, or git history — not architecture. Stable references (type names, interface signatures, package names, file paths within a package, algorithm names like "BFC" or "UAX #9") are fine and encouraged.

**Living documents — update them as you work.** When you encounter implementation details that reveal a better architecture, **update the architecture doc FIRST, before continuing the implementation.** Don't follow an inferior plan when you know there's a better one. Treat the architecture as the source of truth; if your work disagrees with it, one of them is wrong — figure out which.

**Top-to-bottom coherence pass on every architecture update.** When updating any file, walk top-down from `00-overview.md` and verify that interfaces between layers haven't drifted. Don't update one piece in isolation and leave its neighbors stale — the value of hierarchical docs is interface coherence; update one interface and the matching consumers must be checked. If an update implies changes to multiple files, do them together in one commit.

**Read before acting.** When picking up new work in an area, read the relevant architecture doc(s) FIRST. Don't dive into code and try to reconstruct architecture from implementation — the docs are there to spare you that.

## Workflow

- **Branch:** all current development happens on `feature/dom-architecture-redesign` (checked out directly in `/Users/hansyu/code/taleweaver/`). Pre-flight check the branch on every task. (Earlier in the project a `.worktrees/dom-redesign/` worktree was used; it has been removed.)
- **Subagent dispatch:** every implementer subagent dispatch must include explicit `cwd` guards (the project path) so it doesn't drift.
- **Parallel implementer agents:** never dispatch multiple implementer (file-writing) subagents that share the main checkout. Observed failures: commit scope-leak (Agent B's untracked files get included in Agent A's `git add` / commit), commit-undone-by-reset race (Agent B does `git reset HEAD~1` for its own cleanup and accidentally undoes A's commit), and in-place file revert race (Agent B's file snapshot was taken before A's edit, B's write overwrites). **Default: serialize implementer dispatch.** Reviewer agents (read-only) can run in parallel freely.
- **NEVER use git worktrees (ABSOLUTE, user directive).** Do NOT pass
  `isolation: "worktree"` to the Agent/Workflow tools, do NOT `git worktree add`,
  and do NOT run agents in a worktree. Worktrees are difficult to work with here
  and have caused work to be discarded by accident (stale-ancestor checkouts,
  locked leftover sandboxes that confuse the tree, commit-scope races). ALL work —
  including every subagent — happens in the single main checkout at
  `/Users/hansyu/code/taleweaver/` on `feature/dom-architecture-redesign`. To
  parallelize safely, serialize file-writing implementer dispatch (see the
  parallel-agent rule above); never reach for a worktree to isolate them. If a
  stray `.claude/worktrees/*` dir appears, it is harmless leftover (gitignored) —
  ignore it; do not depend on it.
- **Auto-commit:** commit on user's behalf on the feature branch per milestone. Never commit to `main` without explicit instruction.
- **Stalled / killed implementer work still needs review.** Implementer agent dying mid-task does NOT exempt the resulting working-tree changes from the reviewer pass. Tests-pass + build-clean is NOT a substitute. Dispatch the reviewer on the working tree before commit.
- **Implementer must escalate on Create-target collision.** If a plan task says "Create: `<path>`" and that file already exists, the implementer MUST STOP and report BLOCKED. Never silently refactor or consolidate the existing file — the controller needs to disambiguate "fresh-create" vs "merge into existing" before any work proceeds.
- **TypeScript checks:** use `npm run build --workspace=<pkg>`, not bare `npx tsc`. The IDE's TypeScript server occasionally surfaces stale "Cannot find module" diagnostics after file moves; the authoritative check is `npm run build`.
- **Browser smoke test for UI work:** `npm test` does not catch geometry / paint / coordinate bugs. After any work that touches layout, paint, the editor controller, or the example apps, run `npm run dev --workspace=examples/react` and exercise the feature in a real browser before declaring it done. Tests assert structure (counts, types, references); only the browser exercises actual coordinates and pixels. P1.B shipped with multiple integration bugs that 840 unit tests passed but the browser exposed in seconds.
- **TDD:** write/update tests first, then implement. No exceptions. **Test geometry, not just structure** — assertions on `box.children.length` won't catch a line at the wrong y-position.
- **Type safety:** never write type-unsafe code. Avoid non-null assertions (`!`); use proper narrowing, defaults, or refactor to eliminate `undefined`/`null`.

## Coordination protocol for per-piece agents

The architecture has been derisked to ~95% confidence (see `docs/superpowers/specs/2026-05-02-architecture-derisk-memo.md`). Every piece in `docs/superpowers/plans/2026-04-30-decomposition.md` fits a known architectural slot. Per-piece agents should:

1. Implement within the piece's scope. The architecture docs are the spec.
2. **STOP and surface for coordination** if implementation reveals the need for a cross-cutting architectural change — adding a new field to `LayoutBox`, changing how the cascade pass dispatches, restructuring the editor reducer's action pipeline, etc. Don't unilaterally restructure across pieces.
3. Read the spec for your piece (if one exists) and CLAUDE.md before starting. For pieces without a spec yet (most non-pagination pieces), brainstorm first per superpowers:brainstorming.
4. Brand-new architectural concerns (accessibility, IME composition, multi-column) have derisking sketches in the architecture-derisk memo. Use those as a starting point; they're not full designs but they confirm the architecture supports each.

## Conventions

- File naming: kebab-case (case-insensitive filesystem).
- Node v24.14.0 via nvm (`.nvmrc`).
- Test runner: `npm test --workspace=packages/core` from project root.
- npm workspaces monorepo. State tree files in `packages/core/src/state/`.

## Reference docs (read first when picking up work)

- **Architecture (start here):** `docs/architecture/overview.md` and the per-package overviews it links to.
- **Implementation status:** `docs/architecture/state-of-branch.md` (current code vs target architecture).
- **Roadmap:** `docs/superpowers/plans/2026-04-30-decomposition.md` (the P1-P26 piece list with dependencies).
- **Architecture-readiness derisking memo:** `docs/superpowers/specs/2026-05-02-architecture-derisk-memo.md` (confirmation that accessibility, IME, multi-column fit existing slots; sketches for each).
- **Pagination specs:**
  - P1.B (within-block fragmentation, shipped): `docs/superpowers/specs/2026-05-01-p1b-pagination-within-block-fragmentation-design.md`
  - P1.C (templates, headers, footers, footnotes — designed, not implemented): `docs/superpowers/specs/2026-05-02-p1c-pagination-templates-design.md`
- **Plan 3 work history:** `docs/superpowers/plans/2026-04-29-plan-3-summary.md` (what shipped during the architectural foundation rewrite).
- **Per-phase plans + followups (historical):** `docs/superpowers/plans/2026-04-29-plan-3{a..k}-*.md`.

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

## Durability rule (load-bearing)

**Roadmap-level and scope decisions must be committed to a spec or plan doc before continuing past the decision. Chat is not durable.**

Compaction summaries preserve implementation-detail-level context (commits, file changes, plan-task lists). They do NOT reliably preserve strategic choices, scope framings, or path/option decisions made in conversation. If a decision will inform work spanning more than one phase or session, write it to disk before the next tool call.

Concretely:
- New scope or path decisions → write to a spec under `docs/superpowers/specs/` before continuing.
- New plan structure or phase decomposition → write to a plan under `docs/superpowers/plans/` before dispatching implementer subagents.
- Mid-brainstorm decisions → checkpoint into the spec doc as they happen, don't batch-write at the end.

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
- **`isolation: "worktree"` caveat:** the framework's worktree harness can give an agent a checkout from a stale ancestor commit (observed: a dependabot vite-bump from before the feature branch's state-module work), not the current `feature/dom-architecture-redesign` HEAD. When the implementer reports the worktree's files don't match the current state (e.g., they see `change.ts` / `find-path.ts` instead of the Y.Doc-based files), they MUST commit on `feature/dom-architecture-redesign` directly via the main checkout — that's where current development lives per CLAUDE.md's branch policy. After a worktree agent commits to `feature/dom-architecture-redesign` directly, no merge is needed; from the main checkout, `cd /Users/hansyu/code/taleweaver/` and the commit is already there.
- **Auto-commit:** commit on user's behalf on the feature branch per milestone. Never commit to `main` without explicit instruction.
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

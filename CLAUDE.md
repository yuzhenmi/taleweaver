# Taleweaver — Project Instructions for Claude

## Vision

**Taleweaver is a TypeScript word-processor engine that matches Google Docs quality.**

The engine renders rich text documents — multi-page, multi-script, faithfully typeset, edited at human speed even on hundred-page documents. It is the layout-and-rendering core; downstream consumers (collab, spell-check, embedded media, native shells) plug into it via interfaces.

## Mission

**Use CSS/DOM box-model semantics faithfully.** Decades of browser engineering have already solved how to flow rich text, blocks, floats, and tables across pages with cascading properties. Borrow that work; don't re-derive an inferior version of it. Concretely: real Style → ComputedStyle → UsedStyle pipeline; real BFC / IFC / Table FCs dispatching by `display`; real CSS 9.5 floats with clearance; real CSS Fragmentation Module pagination; Unicode-correct text (UAX bidi, grapheme clusters, line-break).

**Scope: "uncompromising word processor."** Every feature a real document engine needs, implemented to CSS spec. NOT a general-purpose web layout engine. Skip features that exist for app-layout only:
- OUT: flex, grid, sticky, scroll-snap, animations/transitions, filters/clip-path/mask
- OUT: real-time collab, spell-check backend, embedded media (LaTeX/charts/video), concrete HarfBuzz-WASM in-engine — these are downstream consumers / separate plans
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

- **Worktree:** all current development happens in `.worktrees/dom-redesign/` on `feature/dom-architecture-redesign`. Use absolute paths for git (`git -C <worktree>`). Pre-flight check on every task.
- **Subagent dispatch:** every implementer subagent dispatch must include explicit `cwd` guards or it drifts to main.
- **Auto-commit:** commit on user's behalf on feature branches/worktrees per milestone. Never commit to main without explicit instruction.
- **TypeScript checks:** use `npm run build --workspace=<pkg>`, not bare `npx tsc`.
- **TDD:** write/update tests first, then implement. No exceptions.
- **Type safety:** never write type-unsafe code. Avoid non-null assertions (`!`); use proper narrowing, defaults, or refactor to eliminate `undefined`/`null`.

## Conventions

- File naming: kebab-case (case-insensitive filesystem).
- Node v24.14.0 via nvm (`.nvmrc`).
- Test runner: `npm test --workspace=packages/core` from project root.
- npm workspaces monorepo. State tree files in `packages/core/src/state/`.

## Reference docs (read first when picking up work)

- **Architecture (start here):** `docs/architecture/overview.md` and the per-package overviews it links to.
- **Implementation status:** `docs/architecture/state-of-branch.md` (current code vs target architecture).
- **Plan 3 work history:** `docs/superpowers/plans/2026-04-29-plan-3-summary.md` (what shipped during the architectural foundation rewrite).
- **Per-phase plans + followups (historical):** `docs/superpowers/plans/2026-04-29-plan-3{a..k}-*.md`.

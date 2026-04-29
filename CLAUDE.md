# Taleweaver — Project Instructions for Claude

## Durability rule (load-bearing)

**Roadmap-level and scope decisions must be committed to a spec or plan doc
before continuing past the decision. Chat is not durable.**

Compaction summaries preserve implementation-detail-level context (commits,
file changes, plan-task lists). They do NOT reliably preserve strategic
choices, scope framings, or path/option decisions made in conversation. If
a decision will inform work spanning more than one phase or session, write
it to disk before the next tool call.

Concretely:
- New scope or path decisions → write to a spec under `docs/superpowers/specs/`
  before continuing.
- New plan structure or phase decomposition → write to a plan under
  `docs/superpowers/plans/` before dispatching implementer subagents.
- Mid-brainstorm decisions (e.g., "vertical writing-mode is in for Plan 4
  not deferred") → checkpoint into the spec doc as they happen, don't
  batch-write at the end.

## Workflow

- **Worktree:** all Plan-3-and-beyond work happens in
  `.worktrees/dom-redesign/` on `feature/dom-architecture-redesign`. Use
  absolute paths for git (`git -C <worktree>`). Pre-flight check on every
  task.
- **Subagent dispatch:** every implementer subagent dispatch must include
  explicit `cwd` guards or it drifts to main.
- **Auto-commit:** commit on user's behalf on feature branches/worktrees
  per milestone. Never commit to main without explicit instruction.
- **TypeScript checks:** use `npm run build --workspace=<pkg>`, not bare
  `npx tsc`.
- **TDD:** write/update tests first, then implement. No exceptions.
- **Type safety:** never write type-unsafe code. Avoid non-null assertions
  (`!`); use proper narrowing, defaults, or refactor to eliminate
  `undefined`/`null`.

## Conventions

- File naming: kebab-case (case-insensitive filesystem).
- Node v24.14.0 via nvm (`.nvmrc`).
- Test runner: `npm test --workspace=packages/core` from project root.
- npm workspaces monorepo. State tree files in `packages/core/src/state/`.

## Reference docs (read first when picking up work)

- **Where Plan 3 left off:** `docs/superpowers/plans/2026-04-29-plan-3-summary.md`
- **Original architecture spec:** `docs/superpowers/specs/2026-04-27-dom-architecture-design.md`
- **Plan 3 architectural spec:** `docs/superpowers/specs/2026-04-29-plan-3-architectural-foundation-rewrite.md`
- **Plan 3 retrospective + revisions:** `docs/superpowers/plans/2026-04-29-plan-3-retrospective-and-revisions.md`
- **Per-phase plan + followups:** `docs/superpowers/plans/2026-04-29-plan-3{a,b,c,d,e,f,g,h,i,j}-*.md`

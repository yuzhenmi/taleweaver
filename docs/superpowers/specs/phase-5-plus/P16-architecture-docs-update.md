# P16 — Architecture docs update

**Subject:** Update `docs/architecture/` to describe the new state model. Refresh per-module docs (state, render, cascade, editor, cursor) where they reference legacy types or design.

**Reference:** Master spec migration step 15; spec lines 541-546.

## Goal

The `docs/architecture/` tree is the timeless target-state documentation. Phase 5+ has substantially changed which target state is current. P16 refreshes the docs to match.

Per spec lines 541-546:
- `docs/architecture/1-core/1.1-state.md` rewritten to describe the new state module.
- `docs/architecture/overview.md` updated where it references the state module.
- `docs/architecture/1-core/overview.md` updated.
- CLAUDE.md performance line revised (per "State consumers" section of master spec).

## Dependencies

P15 (legacy code is gone; the new module IS the architecture).

## Current state

`docs/architecture/` tree (per CLAUDE.md):
- `overview.md` — top-level packages and inter-package touchpoints.
- `1-core/overview.md` — core's modules and the pipeline.
- `1-core/1.0-styles.md`
- `1-core/1.1-state.md` — to be rewritten.
- `1-core/1.2-render.md`
- `1-core/1.3-cascade.md`
- `1-core/1.4-layout/...` (folder)
- `1-core/1.5-pagination.md`
- `1-core/1.6-text.md`
- `1-core/1.7-editor.md`
- `1-core/1.8-perf.md`
- `1-core/1.9-positioning.md`
- `2-dom/overview.md`, etc.
- `3-react/overview.md`, etc.
- `state-of-branch.md` — implementation status audit.

CLAUDE.md is in the project root.

## Files involved

**Modified:**
- `docs/architecture/1-core/1.1-state.md` — rewrite.
- `docs/architecture/overview.md` — update state-module references.
- `docs/architecture/1-core/overview.md` — update.
- `docs/architecture/1-core/1.2-render.md` — likely updates (renderer is rewritten).
- `docs/architecture/1-core/1.3-cascade.md` — verify still accurate (cascade was Phase 3 done).
- `docs/architecture/1-core/1.7-editor.md` — likely substantial updates (editor rewritten).
- `docs/architecture/state-of-branch.md` — refresh implementation status (everything green now, no legacy code).
- `CLAUDE.md` (root) — performance line update.

**Possibly modified:**
- Other architecture docs that reference old types or terminology.

## Key technical considerations

1. **Architecture docs are timeless.** They describe target state, not history. Don't write "we used to have X, now we have Y" — just describe what IS.

2. **Status flags.** Per CLAUDE.md, status flags `[implemented]`, `[partial]`, `[missing]` annotate items that diverge from target. After P15 + P16, most/all flags should clear.

3. **No unstable references.** Per CLAUDE.md, architecture docs MUST NOT reference numbers that change (LOC, file sizes, test counts). Stable refs (type names, file paths within a package, algorithm names) are fine.

4. **Top-to-bottom coherence pass.** When updating any file, walk top-down from `00-overview.md` and verify interfaces between layers haven't drifted.

## Risks and patterns to apply

- **No code in this phase.** Pure docs. Risk is staleness or inaccuracy. Cross-reference against current code.
- **Coherence check:** read every architecture doc end-to-end after edits. Inconsistencies between docs are the most likely failure mode.

## Test strategy

No automated tests. Manual review:
- Read every modified doc.
- Cross-reference each section against the actual code.
- Verify status flags accurately reflect post-P15 state.

## Open questions

1. **Granularity.** Does P16 update ALL architecture docs that touched any state-related thing, or just the listed ones? Prefer "all that need updating" with a grep-pass to identify.

## Success criteria

- All architecture docs accurately describe the post-migration state.
- No stale references to legacy types in any architecture doc.
- CLAUDE.md updated.
- `state-of-branch.md` reflects "all green."

## Review cycle expectations

Pre-execution: yes (small plan, verify scope). Post-execution: replaced by manual review confirmation.

## Estimated commits

~3 (could be 1-3 per doc family).

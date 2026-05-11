# Phase 5+ per-phase context

This directory contains one MD file per phase of the state-redesign migration's Phase 5+ work. Each file captures the available context (current code state, dependencies, file inventory, key technical considerations, risks, open questions) so a future implementer drafting the per-phase plan doesn't have to re-derive it.

## When to use these files

When drafting a per-phase plan, read the corresponding context file FIRST. It contains:
- The phase's goal and master-spec mapping.
- Current code state (file paths, types, imports as of 2026-05-08).
- Dependencies on prior phases with rationale.
- Files likely involved (created / modified / deleted).
- Key technical considerations and design decisions still to make.
- Risks and patterns from Phase 4 to apply.
- Test strategy at the right grain for the phase.
- Open questions specific to the phase.
- Success criteria.
- Review cycle expectations.
- Estimated commit count.

## Top-level strategy

See the parent doc: `../2026-05-08-phase-5-plus-sequencing-strategy.md`. It covers the cross-phase strategic decisions (Path B, noUnusedLocals, embedContents, editor sub-phasing, review cycles).

## Phase index

| File | Phase | Subject |
|---|---|---|
| `P4e-yjs-rebase.md` | P4e | Rebase state module on Yjs primitives (CRDT foundation) |
| `P5-tsconfig-hardening.md` | P5 | tsconfig `noUnusedLocals` |
| `P6-state-embed-contents.md` | P6 | `state.embedContents` separation + cascade-delete |
| `P7-render-rewrite.md` | P7 | Render module rewrite (parallel) |
| `P8-components-rewrite.md` | P8 | Components rewrite (parallel) |
| `P9-cursor-types.md` | P9 | Cursor types + position math |
| `P10-cursor-hit-test.md` | P10 | Cursor hit-test + selection-geometry |
| `P11.0-editor-state-type-flip.md` | P11.0 | EditorState.state type flip |
| `P11.1-editor-inline-text-actions.md` | P11.1 | Editor: inline-text actions |
| `P11.2-editor-block-structure-actions.md` | P11.2 | Editor: block-structure actions |
| `P11.3-editor-selection-actions.md` | P11.3 | Editor: selection actions |
| `P11.4-editor-layout-coupled-actions.md` | P11.4 | Editor: layout-coupled actions |
| `P12-layout-styles-cleanup.md` | P12 | Layout / styles cleanup |
| `P13-integration-tests-rewrite.md` | P13 | Integration tests rewrite |
| `P14-perf-benchmarks.md` | P14 | Performance benchmarks |
| `P15-cleanup-legacy-delete.md` | P15 | Legacy file deletion + public exports |
| `P16-architecture-docs-update.md` | P16 | Architecture docs update |
| `P17-final-greening.md` | P17 | Final greening pass |

## Refresh cadence

Per CLAUDE.md's living-docs principle: when a phase's per-phase plan is drafted (or executed), if context drifts (e.g., a file gets renamed, a dependency changes), update the corresponding context file to match. Don't let the context file rot — fix it as part of the per-phase work.

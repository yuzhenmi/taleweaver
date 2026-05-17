# P15 — Cleanup commit (legacy file deletion + public exports)

**Subject:** Delete every legacy state-module file. Finalize `packages/core/src/index.ts` public exports per the master spec's "Public API surface" section. This is the single greening commit that consolidates Path B's accumulated debt.

**Reference:** Master spec migration step 14; spec lines 487-499 (Public API surface).

## Goal

After P11.x and P12, every consumer has migrated to new types. The legacy state-module files (`state-node.ts`, `transformations.ts`, `formatting.ts`, etc.) are no longer referenced. P15 deletes them. Same commit also finalizes the public exports of the package.

This is the "Path B exception" allowed in the strategy doc: a single deletion commit, not the all-broken-intermediates pattern.

## Dependencies

P11.4 + P12 + P13 + P14 complete. No legacy refs anywhere.

## Current state

By P15, cutover has happened at the end of P11.4 (per Decision D Affected phases). The cutover commit ALREADY deleted: `EditorState.stateLegacy`, `EditorState.historyLegacy`, `rebuildStateFromLegacy`, `downgradeToStateNode`, `newPositionToLegacy`, `legacyPositionToNew`, all paired equivalence tests, the `History` wrapper's `historyLegacy` branch, and the legacy renderer import in the editor. P15 is what remains: the legacy file family that the cutover commit left in place.

**Legacy files to delete (per Decision E `*-legacy.ts` and the earlier `state/` migration):**
- All `*-legacy.ts` files (introduced by P7, P8, P9, P11.0, others). Each one has been unreferenced since cutover. Examples: `render/render-legacy.ts`, `components/component-registry-legacy.ts`, `components/<name>-legacy.ts` for each migrated component family, `cursor/cursor-ops-legacy.ts`, `state/initial-state-legacy.ts`.
- Legacy state-module files in `packages/core/src/state/`:
  - `state-node.ts`, `create-node.ts`, `new-node.ts`, `formatting.ts`, `transformations.ts`, `find-path.ts`, `normalize.ts`, `node-operations.ts`, `position.ts`, `extract-text.ts`, `dirty.ts`, `change.ts`, legacy `history.ts` (the `EditorHistory` implementation — Decision D point 9 confirms it's deleted at cutover; if any remnants survive, delete here).
  - `text-utils.ts` — may have new-state-relevant utilities; review and keep what's still used.
- `EditorConfig.registry` field (the legacy `ComponentRegistry` field per Decision F point 4): deleted at P15; `componentRegistry` becomes required.

Public exports in `packages/core/src/index.ts` — currently a mix of legacy + new. Per master spec § "Public API surface", finalize to only new exports.

## Files involved

**Deleted:**
Files listed above that are unreferenced. Run `grep` per file before deletion to confirm zero refs. (Pre-flight check critical.)

**Renamed:**
- `new-extract-text.ts` → `extract-text.ts` (and corresponding test file).
- `new-initial-state.ts` → `initial-state.ts` (and test).
- `block-position.ts` → maybe `position.ts` (after legacy `position.ts` is deleted). The master spec's file inventory at line 470 calls the file `position.ts`.

**Modified:**
- `packages/core/src/index.ts` — finalize public surface. Per master spec lines 487-498.

## Key technical considerations

1. **Pre-flight grep per file.** Before deleting `state-node.ts`, run `grep -r "state-node\|StateNode" packages/core/src/`. Result must be EMPTY (or only in this spec doc). If non-empty, P15 plan reverts: a consumer didn't migrate, rewind.

2. **Renames vs deletes.** Some files want to be renamed (`new-*.ts` → original name). Two ways:
   - (a) `git rm new-X.ts && git mv X.ts new_temp.ts` no this doesn't work.
   - (b) Delete legacy `X.ts`, then rename `new-X.ts` → `X.ts`.
   - (c) Just delete the `new-` prefix from filenames where applicable.
   git tracks moves automatically when content stays the same. Just `git mv new-X.ts X.ts` after `git rm` of the old `X.ts`.

3. **Public API finalize.** Per spec lines 487-499, the index.ts should export specific Layer 1 types, factories, Layer 2 utilities, Layer 3 operations, history types, OperationResult, and cascade interpreters. Compare current exports vs target list; add missing, remove obsolete.

4. **Final compile gate.** `npm run build` must be clean after P15. `npm test` 100%. Browser smoke. Full sweep.

5. **No new functionality.** P15 is destructive. Don't add features here — those go in their own phases.

## Risks and patterns to apply

- **Pre-flight grep is non-negotiable.** Each file deletion gated on confirming zero refs.
- **Browser smoke** since this is the final pass.
- **Implementer escalation:** if any legacy file has unexpected refs, STOP and surface — there's still consumer work to do.

## Test strategy

No new tests. Existing tests run; all should pass.

`grep -r "StateNode" packages/core/src/` returns empty. (Spec line 503.)
`grep -r "state-node\|new-extract-text\|new-initial-state\|new-node" packages/core/src/` returns empty after renames.

## Open questions

1. **Renames.** Does git track moves cleanly? Verify by doing a small dry-run.
2. ✅ **`change.ts` and `history.ts` final shapes — resolved by Decisions C + D.** Both deleted at cutover (end of P11.4). If any remnants survive into P15, delete here.

## Success criteria

- All listed legacy files deleted.
- Renames complete.
- `packages/core/src/index.ts` exports per spec.
- `npm run build` clean.
- `npm test` 100% pass.
- Browser smoke green.
- `grep -r "StateNode" packages/core/src/` returns empty.

## Review cycle expectations

Pre-execution: yes (verify scope and pre-flight greps). Post-execution: replaced by build-green / test-green / smoke-green confirmation per Strategy Decision 5 exception.

## Estimated commits

**One commit.** P15 is a single atomic deletion + index.ts rewrite that goes green-to-green. The pre-flight grep work happens out of band; the commit itself is one atomic change. No intermediate split (splitting would leave red intermediate states because the deletes interlock).

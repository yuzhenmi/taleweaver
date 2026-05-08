# P5 — tsconfig hardening

**Subject:** Enable `noUnusedLocals` (and `noUnusedParameters` if clean) in tsconfig. Clean up any pre-existing violations.

**Reference:** Strategy doc Decision 2.

**Spec step:** New (added by Phase 5+ sequencing strategy).

## Goal

Prevent the entire class of unused-import bug that the IDE caught twice during Phase 4 but `npm run build` missed. Trivial systemic fix that pays dividends throughout Phase 5+ (which will produce many import edits during consumer cutovers).

## Dependencies

None. P5 is the warm-up phase; can run any time.

## Current state

- `/Users/hansyu/code/taleweaver/tsconfig.json` — root config
- `/Users/hansyu/code/taleweaver/packages/core/tsconfig.json` — package config
- `noUnusedLocals` is currently NOT set in either. Confirmed in round 2 of strategy review.

## Files likely modified

- `tsconfig.json` (root) and/or `packages/core/tsconfig.json` — one-line addition.
- Whichever source files have pre-existing unused locals/imports — clean up in same commit.

## Key technical considerations

- `noUnusedLocals` is compilation-unit-wide. Cannot apply to a subdirectory (`src/state/`) only — the flag applies to the entire workspace at once.
- If too many legacy violations surface, options are:
  - (a) clean them up in the same P5 commit (most likely small — these files have been well-maintained).
  - (b) suppress at the offending location with `// @ts-expect-error: <one-line reason>` (NOT `// @ts-ignore`, NOT `// eslint-disable` — eslint-disable does not suppress TS6133 from the TypeScript compiler).
  - (c) split `packages/core` into separate TypeScript project references — overkill, do not do this just for this purpose.
- Default expectation: option (a). Survey the tree first; if it's a handful of files, fix them inline.

## Risks and patterns to apply

- (none Phase-4-specific — this is infra)
- Verify with `npm run build --workspace=packages/core` after enabling. Then run `npm test --workspace=packages/core` to confirm nothing breaks.

## Test strategy

No new tests. P5 is pure infra:
- Build green after the flag is enabled.
- All existing tests still pass.

## Open questions

- Does enabling `noUnusedLocals` also enable `noUnusedParameters`? If both are clean, do both. Otherwise just `noUnusedLocals`.

## Success criteria

- `tsconfig.json` (or `packages/core/tsconfig.json`) has `"noUnusedLocals": true` (and ideally `"noUnusedParameters": true`).
- `npm run build --workspace=packages/core` clean.
- `npm test --workspace=packages/core` 1213 + 4 skipped pass (or equivalent if Phase 4 final count drifts).

## Review cycle expectations

Pre-execution review: yes. Post-execution review: replaced by build-green / test-green confirmation per Strategy Decision 5 exception.

## Estimated commits

~3.

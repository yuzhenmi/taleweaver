# Phase 5 — tsconfig hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `noUnusedLocals` (and `noUnusedParameters` if clean) in the root `tsconfig.json`. Clean up any pre-existing violations in the same phase. Prevents the entire class of unused-import bugs that surfaced twice during Phase 4 and were caught only by the IDE (not `npm run build`).

**Architecture:** No code architecture changes. Pure infra. Per Phase 5+ Sequencing Strategy (Decision 2) and per-phase context at `docs/superpowers/specs/phase-5-plus/P5-tsconfig-hardening.md`.

**Tech Stack:** TypeScript 5.7, vitest 3.0, npm workspaces.

**Phase 1 - 4d status (assumed complete):**
- All Phase 4 phases shipped. Build green, 1213 tests passing + 4 skipped.

**Per-phase scope notes:**

- Modify: `tsconfig.json` (root, shared by all three packages: core, dom, react). Single line addition: `"noUnusedLocals": true`.
- Modify (potentially many files): any source file with pre-existing unused imports/locals across `packages/core/src/`, `packages/dom/src/`, `packages/react/src/`, `examples/dom/`, `examples/react/`. Cleaned up in same phase.
- Per CLAUDE.md: TDD throughout. Verify with both `npm test` AND `npm run build`.
- **Important — per Phase 5+ context note**: TypeScript does NOT support enabling `noUnusedLocals` for a subdirectory within a single compilation unit. The flag applies to the entire workspace at once. If too many legacy violations surface, options are:
  - (a) clean them up in the same P5 commit (default expectation),
  - (b) suppress at the offending location with `// @ts-expect-error: <one-line reason>` per location (NOT `// @ts-ignore`, NOT `// eslint-disable` — eslint-disable does not suppress TS6133),
  - (c) split into separate TypeScript project references — overkill, do NOT do this for P5.
  Default: option (a). The Phase 4 codebase has been well-maintained; expect a small number of violations.

**Why a "warm-up" phase:** Strategy doc Decision 2. P5 is intentionally the smallest phase — both to provide systemic protection for Phase 5+ refactoring AND to serve as a low-risk warm-up of the Path B workflow.

---

## File structure (this phase)

**Modified:**

| Path | Change |
|---|---|
| `tsconfig.json` (root) | Add `"noUnusedLocals": true` (and possibly `"noUnusedParameters": true` if clean) to `compilerOptions`. |
| Source files with violations | Fix unused imports/locals as surfaced by the build. |

**Created / Deleted:** none.

---

## Task 1: Survey existing violations

**Files:**
- Read: `tsconfig.json` (root and per-package).
- Run: `npm run build` workspace-by-workspace with the flag temporarily enabled.

- [ ] **Step 1: Confirm starting state**

```bash
git status --short      # Should be clean.
npm test --workspace=packages/core --run 2>&1 | tail -3      # 1213 + 4 skipped.
npm run build --workspace=packages/core 2>&1 | tail -3       # Clean.
```

If anything is amiss (uncommitted changes, failing tests, broken build), STOP and report `Status: BLOCKED`.

- [ ] **Step 2: Survey violations across all packages and examples**

Run a temporary build with the flag(s) enabled for each workspace, capturing the violations. Use `-p <path>` from the project root (no `cd` chains):

```bash
# All five workspaces that extend the root tsconfig:
npx tsc --noEmit --noUnusedLocals --noUnusedParameters -p packages/core 2>&1 | tee /tmp/p5-core-violations.txt
npx tsc --noEmit --noUnusedLocals --noUnusedParameters -p packages/dom 2>&1 | tee /tmp/p5-dom-violations.txt
npx tsc --noEmit --noUnusedLocals --noUnusedParameters -p packages/react 2>&1 | tee /tmp/p5-react-violations.txt
npx tsc --noEmit --noUnusedLocals --noUnusedParameters -p examples/dom 2>&1 | tee /tmp/p5-examples-dom-violations.txt
npx tsc --noEmit --noUnusedLocals --noUnusedParameters -p examples/react 2>&1 | tee /tmp/p5-examples-react-violations.txt
```

(If a workspace doesn't have its own `tsconfig.json` distinct from the root, the `-p` invocation will still work as long as it points at the directory containing one. If `examples/dom` or `examples/react` lack `tsconfig.json`, drop those two lines and report the absence in your task report.)

Read each `/tmp/p5-*-violations.txt`. Summarize:
- Per-workspace count of `noUnusedLocals` violations (TS6133).
- Per-workspace count of `noUnusedParameters` violations (TS6133, but for parameters).
- Files with violations (for each workspace).

- [ ] **Step 3: Decide whether to enable both flags or just `noUnusedLocals`**

Decision rule:
- If `noUnusedLocals` violations are ≤30 across all three packages, AND `noUnusedParameters` violations are ≤30, enable BOTH flags.
- If `noUnusedLocals` is small but `noUnusedParameters` produces a large number (say >50 or many false positives in interface implementations), enable ONLY `noUnusedLocals` for P5; defer `noUnusedParameters` to a future cleanup.
- If `noUnusedLocals` itself produces an overwhelming number of violations (>100), STOP and report `Status: NEEDS_CONTEXT` — the assumption that this is a quick warm-up phase is wrong, and we need a different approach.

Document the decision (which flag(s) to enable) in your task report.

- [ ] **Step 4: Report findings**

Report (don't commit yet):
- Per-package violation counts.
- Decision on which flag(s) to enable.
- Estimated number of files to touch in Task 2.

(No commit in Task 1.)

## Context for Task 1

**Working directory:** `/Users/hansyu/code/taleweaver/`
**Branch:** `feature/dom-architecture-redesign`

**Where this fits:** Phase 5 task 1 of 3. Survey-only task; no commits.

**Critical implementer note:** the temporary `npx tsc --noEmit --noUnusedLocals` invocation does NOT modify `tsconfig.json`. Don't accidentally commit a tsconfig change in this task.

## Your Job (Task 1)

Run Steps 1-4 in order. Report violation counts and decision. Do NOT modify any files.

## Report Format (Task 1)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Per-package violation counts (locals, parameters).
- List of files with violations (per package).
- Decision: enable `noUnusedLocals` only, OR both flags.
- Estimated files to touch in Task 2.

---

## Task 2: Clean up violations

**Files:**
- Modify: each source file with unused imports/locals as surfaced by Task 1's survey.

- [ ] **Step 1: Read Task 1's report**

Receive Task 1's findings: list of files + violations.

- [ ] **Step 2: For each violation file, fix the unused import/local**

For each file:
1. Read the file.
2. Identify the unused symbol (line:col + symbol name from the error).
3. If it's an import, remove it.
4. If it's a local variable assignment that's never read, remove the assignment.
5. If it's a parameter (only relevant if `noUnusedParameters` is being enabled), prefix with `_` (TypeScript convention) to mark intentionally unused.
6. If a symbol is genuinely needed but unused at the source-code level (rare cases — e.g., a side-effect-only import where the side effect can't be expressed otherwise), the cleanup priority order is:
   - **(a)** Restructure the code so the symbol becomes properly used (preferred). Example: a "re-export-only" import can be replaced with `export { X } from "./module"` directly in the index, eliminating the unused-import situation.
   - **(b)** If restructuring isn't tractable, suppress at the location with `// @ts-expect-error: <one-line reason>` (NOT `// @ts-ignore`). `@ts-expect-error` is stricter — TypeScript errors if the suppressed error disappears later, preventing the suppression from outliving its purpose.
   - **(c)** Note: `// eslint-disable-next-line @typescript-eslint/no-unused-vars` does NOT suppress TS6133 (the TypeScript-compiler error from `noUnusedLocals`); it only affects ESLint. Don't use eslint-disable to silence TypeScript-compiler errors.

**Hard rules:**
- No `// @ts-ignore` (use `// @ts-expect-error` with reason if needed; see Item 6 above).
- Restructure rather than suppress where reasonable.
- No `!` non-null assertions added during cleanup.
- No collateral changes (refactors beyond what's necessary to remove the violation, renames, comment cleanups). Pure violation cleanup ONLY.

- [ ] **Step 3: Per-file verification**

After each file:
- Re-run `npx tsc --noEmit --noUnusedLocals` (and `--noUnusedParameters` if enabled) for the package.
- Confirm the violation in that file is resolved.
- Confirm no new violations introduced.

- [ ] **Step 4: Final per-workspace verification**

After all files cleaned, re-run the survey across ALL surveyed workspaces. Each must produce zero violations:
```bash
npx tsc --noEmit --noUnusedLocals [--noUnusedParameters] -p packages/core      # Should produce zero violations.
npx tsc --noEmit --noUnusedLocals [--noUnusedParameters] -p packages/dom       # Same.
npx tsc --noEmit --noUnusedLocals [--noUnusedParameters] -p packages/react     # Same.
npx tsc --noEmit --noUnusedLocals [--noUnusedParameters] -p examples/dom       # If examples/dom has tsconfig.
npx tsc --noEmit --noUnusedLocals [--noUnusedParameters] -p examples/react     # If examples/react has tsconfig.
npm test --workspace=packages/core --run                                        # 1213 + 4 skipped, all pass.
```

- [ ] **Step 5: Commit cleanup**

```bash
git add packages/ examples/      # Whichever paths had cleanups.
git commit -m "$(cat <<'EOF'
chore: clean up unused imports/locals across packages

Pre-flight cleanup before enabling noUnusedLocals (Task 3 of Phase 5).
[Brief summary of file count and category — fill in based on actual cleanups.]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Context for Task 2

**Critical implementer note:** Task 2 makes potentially many small edits. After each file, re-run the targeted `tsc --noUnusedLocals` to confirm convergence. Don't commit until ALL violations across all three packages are resolved.

If a violation requires a non-trivial code change to resolve (e.g., a function whose only "use" is in a now-deleted test fixture, or a type-only import that's actually load-bearing for a downstream consumer), STOP and report `Status: BLOCKED` with the specific case.

## Self-review (Task 2)

- All targeted-tsc invocations return zero violations.
- All tests still pass.
- No `!` assertions introduced.
- No `// @ts-ignore` introduced. If suppression was unavoidable, only `// @ts-expect-error: <reason>` was used (per Hard rules + Item 6 cascade).
- Commit contains ONLY violation cleanups, no other changes.

## Report Format (Task 2)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- File count touched.
- Categories of violations cleaned (e.g., "8 unused imports, 2 unused locals").
- Test output (last ~5 lines).
- Build output (result line).
- Commit SHA + `git show <SHA> --stat`.
- Self-review findings.

---

## Task 3: Enable the flag(s) in root tsconfig + final verification

**Files:**
- Modify: `tsconfig.json` (root).

- [ ] **Step 1: Edit `tsconfig.json`**

Add the flag(s) decided in Task 1 to `compilerOptions`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUnusedLocals": true,
    /* possibly: */ "noUnusedParameters": true,
    "esModuleInterop": true,
    /* ... rest unchanged ... */
  }
}
```

(Place the new flag(s) near `"strict": true` for thematic grouping.)

- [ ] **Step 2: Verify**

Build every workspace that inherits the root tsconfig (skip examples/* if they don't have their own tsconfig.json):

```bash
npm run build --workspace=packages/core 2>&1 | tail -3      # Clean.
npm run build --workspace=packages/dom 2>&1 | tail -3       # Clean.
npm run build --workspace=packages/react 2>&1 | tail -3     # Clean.
npm run build --workspace=examples/dom 2>&1 | tail -3       # Clean (if tsconfig present).
npm run build --workspace=examples/react 2>&1 | tail -3     # Clean (if tsconfig present).
npm test --workspace=packages/core --run 2>&1 | tail -5     # 1213 + 4 skipped, all pass.
```

If any build fails: a violation slipped through Task 2. Identify, fix, re-verify before committing.

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "$(cat <<'EOF'
build(tsconfig): enable noUnusedLocals (and noUnusedParameters)

Catches unused imports + locals at build time. Phase 4 had two cases
where unused imports landed in commits because the build didn't catch
them (the IDE did, post-commit, requiring a fix-up commit). Phase 5+
will produce many import edits; this flag prevents the class of bug
systemically.

Pre-flight cleanup happened in the prior commit. Build + tests green
across all three packages.

Per Phase 5+ Sequencing Strategy Decision 2 / per-phase context at
docs/superpowers/specs/phase-5-plus/P5-tsconfig-hardening.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Context for Task 3

**Critical implementer note:** the actual flag-enabling commit MUST come after the cleanup commit (Task 2). If you reverse the order, the flag-enable commit fails to build until cleanup lands — that violates the Path B "build green throughout" discipline.

If for any reason a violation slipped past Task 2 and the flag-enable build fails, do NOT commit. Go back to Task 2, fix the missed file, then return.

## Self-review (Task 3)

- `tsconfig.json` has the new flag(s).
- `npm run build --workspace=packages/core` clean. Same for dom and react.
- `npm test --workspace=packages/core --run` 1213 + 4 skipped, all pass.
- Single-file commit (`tsconfig.json` only).
- No `!` assertions added (this should be vacuous — no source code touched in Task 3).

## Report Format (Task 3)

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Build outputs (per package).
- Test output summary.
- Commit SHA + `git show <SHA> --stat`.
- Final state confirmation: `noUnusedLocals` (and possibly `noUnusedParameters`) is now enabled across all packages.

---

## Self-review (phase)

**Spec coverage** (Phase 5 scope per per-phase context):
- ✅ Survey existing violations — Task 1.
- ✅ Clean up violations — Task 2.
- ✅ Enable flag(s) in tsconfig — Task 3.

**Placeholder scan:** no "TBD"/"TODO" patterns. No new code; only configuration.

**Type consistency:** N/A (no new types).

**Out of scope (deferred):**
- Other tsconfig hardening flags (`exactOptionalPropertyTypes`, `noImplicitOverride`, etc.) — separate cleanup phase if/when wanted. Not in scope here.
- ESLint configuration changes — separate.

The Phase 5 plan above produces 1-3 commits depending on cleanup volume, leaves the build green throughout. Estimated execution time: 1-2 hours (most of it in Task 1 survey + Task 2 cleanup).

## Review cycle expectations

Per Strategy Decision 5 exception: pre-execution review yes; post-execution review replaced by build-green / test-green confirmation.

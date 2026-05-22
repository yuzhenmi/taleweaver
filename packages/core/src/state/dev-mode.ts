/**
 * True iff we should run dev-mode invariant checks. Reads `process.env`
 * defensively because the engine compiles for browsers (no `process`
 * global) — `globalThis` is the safe vehicle and the typeof guard keeps
 * us from referencing a missing identifier.
 *
 * Used to gate cheap-but-non-trivial assertions that catch programmer
 * errors in tests and dev builds, while staying off the hot path in
 * production.
 */
export function isDevMode(): boolean {
  const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process;
  return proc?.env?.NODE_ENV !== "production";
}

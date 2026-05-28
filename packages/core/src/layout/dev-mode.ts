/**
 * Layout-module dev-mode flag.
 *
 * Deliberately a separate copy of `state/dev-mode.ts` (not an import): the
 * layout module avoids importing from `state/` to keep the layer's dependency
 * graph clean — layout depends on cascade and on its own primitives, not on
 * state-module internals. The check itself is trivial (one env read) so the
 * duplication is cheap; consolidating the THREE prior copies
 * (`isDevModeForBox` / `isDevModeForMeasurePass` / `isDevModeForVirtualLayout`)
 * into one layout-internal function removes the within-layer DRY violation
 * while preserving the inter-layer boundary.
 *
 * Reads `process.env` defensively because the engine compiles for browsers
 * (no `process` global) — `globalThis` is the safe vehicle and the typeof
 * guard keeps us from referencing a missing identifier.
 *
 * Used to gate cheap-but-non-trivial layout invariant asserts (frozen-box
 * mutation checks, slot-cap effContentBlockSize > 0 guards) that catch
 * programmer errors in tests and dev builds, while staying off the hot path
 * in production.
 */
export function isDevMode(): boolean {
  const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
  return proc?.env?.NODE_ENV !== "production";
}

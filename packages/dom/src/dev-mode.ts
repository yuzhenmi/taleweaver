/**
 * Dom-local dev-mode gate. Core's `isDevMode()` is state-module-internal
 * (barrel-excluded) — unreachable from `packages/dom` through `@taleweaver/core`
 * — so dom reads `process.env.NODE_ENV` via a typed `globalThis` access (the
 * same pattern as `canvas-measurer.ts`). Returns `true` outside production so
 * dev-only assertions / warnings fire in tests and development builds.
 */
export function isDevMode(): boolean {
  const g = globalThis as { process?: { env?: { NODE_ENV?: string } } };
  return g.process?.env?.NODE_ENV !== "production";
}

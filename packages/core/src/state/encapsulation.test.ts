/**
 * Compile-time guard: State's public type surface must not expose `doc`
 * or `snapshotCache`. The `@ts-expect-error` directives below FAIL the
 * `npm run build --workspace=packages/core` step if either field ever
 * becomes accessible at the public type level. This is the canonical
 * encapsulation breach defense — if you find yourself wanting to delete
 * one of these directives, you are breaking the rule documented in
 * `docs/architecture/1-core/1.1-state.md` (Yjs encapsulation) and must
 * STOP and surface for coordination.
 */
import { describe, it, expect } from "vitest";
import type { State } from "./state";
import { createState } from "./state";
import type { BlockId } from "./block-id";

// --- Type-only assertions. These are checked at `npm run build` time.
//
// `declare` symbols never exist at runtime, so this block never executes.
// The `@ts-expect-error` directives must point at expressions that WOULD
// be type errors; if doc / snapshotCache ever leaked back onto the public
// type surface, the directives would become "unused suppressions" and
// `tsc` would fail. That is the encapsulation guard.
declare const __phantom_state__: State;
// @ts-expect-error — doc is not part of State's public type surface;
// it lives behind STATE_INTERNAL and is reachable only from inside state/.
type _ProvesDocIsPrivate = typeof __phantom_state__.doc;
// @ts-expect-error — snapshotCache is also private; same reasoning as doc.
type _ProvesSnapshotCacheIsPrivate = typeof __phantom_state__.snapshotCache;

// Reference the local type aliases so `noUnusedLocals` doesn't flag them.
// (They exist purely for the directive payload.)
type _Used = _ProvesDocIsPrivate | _ProvesSnapshotCacheIsPrivate;

describe("State encapsulation (runtime)", () => {
  it("rootId is the only enumerable string-keyed field on State", () => {
    // Runtime sanity: the public-accessible keys are { rootId }. The
    // internal {doc, snapshotCache} live behind a Symbol and so do not
    // appear via Object.keys / for..in / spread. (Symbol-keyed props
    // are still enumerable via Reflect.ownKeys; that's expected — the
    // encapsulation is type-level, not a runtime sandbox.)
    const state = createState({ rootId: "root" as BlockId });
    expect(Object.keys(state)).toEqual(["rootId"]);
    // Throwaway reference so the `_Used` alias survives strict checks.
    const _ignore: _Used | undefined = undefined;
    expect(_ignore).toBeUndefined();
  });
});

/**
 * @module cascade/counter-scope
 *
 * The PURE counter-state accumulator for CSS 2.1 §12.4 counters
 * (`counter-reset` / `counter-increment` / `counter()` / `counters()`),
 * threaded through the document-order cascade walk. This module is the data
 * structure + helpers ONLY; the wiring into the cascade walk lives in
 * `cascade-pass.ts` (P9a.3). It is fully unit-tested in isolation.
 *
 * ## Model
 *
 * A `CounterScope` holds, per counter NAME, a STACK of integer values
 * (innermost = top of stack). The stack POSITION — not a tree-depth number —
 * identifies an element's reset, so two siblings at the same depth that both
 * reset the same name never collide.
 *
 * ## CHILD-BRACKET usage contract (CSS §12.4.1 visibility)
 *
 * A `counter-reset` on element E is visible to E's DESCENDANTS and E's FOLLOWING
 * SIBLINGS, bounded by E's PARENT (NOT to ancestors or preceding siblings). To
 * satisfy this, each node brackets only its CHILDREN — it leaves its OWN resets
 * pushed when it returns, so following siblings see them; the PARENT pops them
 * (via the parent's own child-bracket) after the whole child list:
 *
 * ```
 * cascadeNode(E, scopeIn):
 *   { scope, marks } = applyResets(scopeIn, E.counterReset)  // E's OWN resets: pushed, NOT popped here
 *   scope = applyIncrements(scope, E.counterIncrement)
 *   resolveContent(E, scope)                                 // E's content + ::before/::after counters
 *   childMarks = saveMarks(scope)                            // bracket E's CHILDREN
 *   s = scope
 *   for c in E.children: s = cascadeNode(c, s)               // thread left-to-right (following-sibling visibility)
 *   s = restore(s, childMarks)                               // pop ONLY what E's descendants pushed
 *   return s                                                 // E's own resets stay visible to E's siblings
 * ```
 *
 * The root call uses a fresh `createCounterScope()`; after the root element
 * returns, the scope is discarded. `saveMarks` is `applyResets(scope, [])` (the
 * `.marks` of a no-op reset is exactly the current per-name stack lengths).
 *
 * ## Purity
 *
 * Every helper returns a NEW `CounterScope` (or a read); inputs are never
 * mutated. `styles/` is the only core dependency (the bare `formatCounter` and
 * the `CounterAction`/`CounterStyle` types). No `layout`/`editor`/`render`
 * imports — `cascade/` may depend on `styles/`.
 */

import { formatCounter, type CounterStyle } from "../styles/format-counter";
import type { CounterAction } from "../styles/style";

/**
 * Per-name counter value stacks. Innermost (most-recently reset) value is the
 * LAST element of each name's array. A name absent from the map has never been
 * reset or incremented (create-on-use: reads as if reset to 0 at the root).
 *
 * Treated as immutable: helpers return a new `CounterScope` rather than mutating.
 */
export interface CounterScope {
  readonly stacks: ReadonlyMap<string, readonly number[]>;
}

/**
 * The per-name "save" recorded by `applyResets` before pushing this element's
 * resets — the stack lengths to truncate back to in the matching `restore`.
 */
export type CounterMarks = ReadonlyMap<string, number>;

/** An empty scope (no counters instantiated). */
export function createCounterScope(): CounterScope {
  return { stacks: new Map() };
}

/**
 * Apply this element's `counter-reset` actions: PUSH a fresh value entry onto
 * each named stack. Returns the new scope AND `marks` = the per-name stack
 * lengths recorded BEFORE these resets (the "save" the matching `restore` pops
 * back to). Per §12.4.2, reset is applied before increment on the same element.
 *
 * Passing an empty `actions` is the idiomatic "save marks for the current
 * scope" snapshot (the child-bracket's `saveMarks`): the returned scope is a
 * structural copy and `marks` records every present name's current length.
 */
export function applyResets(
  scope: CounterScope,
  actions: readonly CounterAction[],
): { readonly scope: CounterScope; readonly marks: CounterMarks } {
  // Marks = current per-name stack lengths (the save, BEFORE any pushes here).
  const marks = new Map<string, number>();
  for (const [name, values] of scope.stacks) {
    marks.set(name, values.length);
  }

  if (actions.length === 0) {
    // No resets: still return a fresh scope copy (purity) with the saved marks.
    return { scope: { stacks: copyStacks(scope) }, marks };
  }

  const next = copyStacks(scope);
  for (const { name, value } of actions) {
    const existing = next.get(name) ?? [];
    next.set(name, [...existing, value]);
  }
  return { scope: { stacks: next }, marks };
}

/**
 * Apply this element's `counter-increment` actions: add `value` to the innermost
 * (top-of-stack) entry for each name. CREATE-ON-USE: if a name has no entry,
 * treat it as if `counter-reset: name 0` happened at the document root, then
 * increment — so an increment-only counter reads its increment (e.g. "1").
 */
export function applyIncrements(
  scope: CounterScope,
  actions: readonly CounterAction[],
): CounterScope {
  if (actions.length === 0) {
    return scope;
  }
  const next = copyStacks(scope);
  for (const { name, value } of actions) {
    const existing = next.get(name);
    if (existing === undefined || existing.length === 0) {
      // Create-on-use at root 0, then increment.
      next.set(name, [0 + value]);
    } else {
      const top = existing[existing.length - 1] ?? 0;
      next.set(name, [...existing.slice(0, -1), top + value]);
    }
  }
  return { stacks: next };
}

/**
 * The innermost in-scope value of `name`, formatted BARE via the shared
 * `formatCounter` under `style`. Missing name ⇒ create-on-use at 0 ⇒ "0"
 * (NOT empty string), per §12.4.3.
 */
export function resolveCounter(
  scope: CounterScope,
  name: string,
  style: CounterStyle,
): string {
  const values = scope.stacks.get(name);
  const innermost =
    values === undefined || values.length === 0
      ? 0
      : values[values.length - 1] ?? 0;
  return formatCounter(innermost, style);
}

/**
 * ALL in-scope values of `name` (outermost → innermost), each formatted bare,
 * joined by `sep` (the nested form, e.g. "1.2.3"). Missing name ⇒ a single
 * create-on-use "0" (NOT empty), per §12.4.3.
 */
export function resolveCounters(
  scope: CounterScope,
  name: string,
  sep: string,
  style: CounterStyle,
): string {
  const values = scope.stacks.get(name);
  if (values === undefined || values.length === 0) {
    return formatCounter(0, style);
  }
  return values.map((v) => formatCounter(v, style)).join(sep);
}

/**
 * Truncate each name's stack back to the saved length in `marks` — popping
 * what was pushed since the matching `applyResets` save. Names absent from
 * `marks` (newly created since the save) are removed entirely. Run when the
 * walk LEAVES the bracket that pushed them (the child-bracket exit).
 */
export function restore(scope: CounterScope, marks: CounterMarks): CounterScope {
  const next = new Map<string, readonly number[]>();
  for (const [name, values] of scope.stacks) {
    const savedLength = marks.get(name);
    if (savedLength === undefined) {
      // Name did not exist at save time → created since → drop entirely.
      continue;
    }
    if (savedLength >= values.length) {
      next.set(name, values);
    } else {
      next.set(name, values.slice(0, savedLength));
    }
  }
  return { stacks: next };
}

/** A mutable shallow copy of the per-name stacks (each value array is shared, never mutated in place). */
function copyStacks(scope: CounterScope): Map<string, readonly number[]> {
  return new Map(scope.stacks);
}

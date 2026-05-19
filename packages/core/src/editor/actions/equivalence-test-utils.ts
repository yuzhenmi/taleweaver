import type { StateNode } from "../../state/state-node-legacy";

/**
 * Structural equality for legacy StateNode trees. Used by P11.1+ paired
 * equivalence tests: the same logical action applied via the legacy
 * handler vs the migrated handler should produce structurally-equal
 * `stateLegacy` trees.
 *
 * Compares: `type`, `properties` (deep), `style` (deep), `children`
 * (recursively via the same function). Deliberately IGNORES `id` fields
 * because legacy handlers and `downgradeToStateNode` produce different id
 * strings for structurally-equivalent nodes (legacy: allocator-counted;
 * downgrade: derived from new-state BlockIds + item indices). The
 * semantic shape — types, content, styling, structure — is what matters.
 *
 * Returns true iff the two trees are structurally equal.
 */
export function structurallyEqualStateNode(
  a: StateNode,
  b: StateNode,
): boolean {
  if (a.type !== b.type) return false;
  if (!deepEqual(a.properties, b.properties)) return false;
  if (!deepEqual(a.style, b.style)) return false;
  if (a.children.length !== b.children.length) return false;
  for (let i = 0; i < a.children.length; i++) {
    if (!structurallyEqualStateNode(a.children[i], b.children[i])) {
      return false;
    }
  }
  return true;
}

function deepEqual(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (typeof x !== typeof y) return false;
  if (x === null || y === null) return x === y;
  if (typeof x !== "object") return false;
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  if (Array.isArray(x) && Array.isArray(y)) {
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      if (!deepEqual(x[i], y[i])) return false;
    }
    return true;
  }
  const xObj = x as Record<string, unknown>;
  const yObj = y as Record<string, unknown>;
  const xKeys = Object.keys(xObj);
  const yKeys = Object.keys(yObj);
  if (xKeys.length !== yKeys.length) return false;
  for (const k of xKeys) {
    if (!Object.prototype.hasOwnProperty.call(yObj, k)) return false;
    if (!deepEqual(xObj[k], yObj[k])) return false;
  }
  return true;
}

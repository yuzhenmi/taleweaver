import type { ComputedStyle } from "../styles";

/**
 * Returns true when the box establishes a new Block Formatting Context
 * per CSS 9.4.1. New BFCs scope floats: floats inside a new BFC don't
 * leak out to the parent's float environment; siblings of the BFC root
 * aren't affected by the floats inside.
 *
 * Triggers (CSS 9.4.1 + Display 3):
 *   - cs.float !== "none"        (the box is itself floated)
 *   - cs.display === "inline-block"
 *   - cs.display === "table-cell"
 *   - cs.display === "flow-root"  (explicit BFC trigger)
 *   - (Future) cs.overflow !== "visible" (overflow not yet in schema)
 *   - (Future) cs.position ∈ {"absolute", "fixed"} (Plan 7)
 */
export function establishesNewBFC(cs: ComputedStyle): boolean {
  if (cs.float !== "none") return true;
  if (cs.display === "inline-block") return true;
  if (cs.display === "table-cell") return true;
  if (cs.display === "flow-root") return true;
  return false;
}

import type { Style, ComputedStyle } from "../styles";
import { PROPERTY_META, INITIAL_COMPUTED_STYLE } from "../styles";

/**
 * Compose a computed style for one node from its specified style and
 * its parent's computed style. Inheritance for inheritable properties;
 * initial values for non-inheritable, unspecified properties.
 *
 * `specified` is `Partial<Style>` — `Style` itself is all-optional, but
 * this signature documents that callers pass a partial map. The
 * implementation walks `PROPERTY_META` and checks each key for
 * `undefined`, so omitted properties fall through to inherit/initial.
 */
export function composeComputed(
  specified: Partial<Style>,
  parent: Readonly<ComputedStyle> | null,
): ComputedStyle {
  const out: Partial<ComputedStyle> = {};
  const keys = Object.keys(PROPERTY_META) as (keyof ComputedStyle)[];
  for (const key of keys) {
    const specifiedValue = specified[key];
    if (specifiedValue !== undefined) {
      // Use specified value
      (out as Record<string, unknown>)[key] = specifiedValue;
    } else if (PROPERTY_META[key].inherits && parent !== null) {
      // Inherit from parent
      (out as Record<string, unknown>)[key] = parent[key];
    } else {
      // Initial value
      (out as Record<string, unknown>)[key] = INITIAL_COMPUTED_STYLE[key];
    }
  }
  return out as ComputedStyle;
}

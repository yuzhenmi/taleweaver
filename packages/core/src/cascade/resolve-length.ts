import type { Length, ComputedLength } from "../styles/length";

/**
 * Resolve a length value at cascade time:
 *   - `number` → number (px)
 *   - `{unit: "px"}` → number (px)
 *   - `{unit: "em"}` → number (px = value * fontSize)
 *   - `{unit: "percent"}` → passes through unchanged (layout-time resolution)
 *
 * @param fontSize the resolved font-size in px at this cascade level.
 *   Required — the caller (cascade-pass) ensures parent's fontSize is
 *   propagated; for the document root, INITIAL_COMPUTED_STYLE.fontSize is used.
 */
export function resolveLength(value: Length, fontSize: number): ComputedLength {
  if (typeof value === "number") return value;
  if (value.unit === "px")  return value.value;
  if (value.unit === "em")  return value.value * fontSize;
  // percent: pass through
  return value;
}

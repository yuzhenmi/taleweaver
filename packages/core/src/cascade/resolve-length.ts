import type { Length, LengthOrAuto } from "../styles";

/**
 * Resolve a length value at cascade time. Px and em values flatten to
 * absolute pixel numbers. Percent values pass through (layout resolves
 * them against the appropriate base later). Keywords pass through.
 */
export function resolveLength<T extends LengthOrAuto | "none">(
  value: T,
  fontSize: number,
): T extends Length ? number | { unit: "percent"; value: number } : T;

export function resolveLength(
  value: LengthOrAuto | "none",
  fontSize: number,
): number | { unit: "percent"; value: number } | "auto" | "none" {
  if (value === "auto") return "auto";
  if (value === "none") return "none";
  if (typeof value === "number") return value;
  if (value.unit === "px")  return value.value;
  if (value.unit === "em")  return value.value * fontSize;
  // percent: pass through
  return value;
}

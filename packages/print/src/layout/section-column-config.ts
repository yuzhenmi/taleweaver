/**
 * @module section-column-config
 *
 * Section-level column-config resolution (multi-column slice 1).
 *
 * A `section` block may carry column overrides (`columnCount`, `columnGap`,
 * `columnRule`) in its attrs; the section component stamps those into its
 * ElementBox `metadata` (open-schema, possibly `undefined`). This module
 * resolves a section's EFFECTIVE `ColumnConfig` by validating each override and
 * merging it over a doc default.
 *
 * A pure validator/normalizer (NOT a cascade Style interpreter) — it reads the
 * already-attr-extracted values off the metadata bag and only decides "is this a
 * usable value?". It NEVER throws: section attrs are open-schema, so a malformed
 * value is simply ignored (the doc default wins). Mirrors `section-page-config`.
 */
import type { LayoutBoxMetadata } from "@taleweaver/core";
import type { BorderStyle } from "@taleweaver/core";
import type { ColumnConfig, ColumnRule } from "@taleweaver/core";

/** A finite, non-negative number (gaps, rule widths). */
function isNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** The valid `BorderStyle` members (kept in lockstep with `styles/style.ts`). */
const BORDER_STYLES: ReadonlySet<string> = new Set<BorderStyle>([
  "none",
  "solid",
  "dashed",
  "dotted",
]);

/**
 * Validate a raw `columnRule` override. Accepts an object with a finite
 * `width >= 0`, a recognized `BorderStyle` `style`, and a string `color`;
 * `null` is a valid explicit "no rule". Anything else returns `undefined`
 * (→ the doc default's rule is kept).
 */
function resolveColumnRule(raw: unknown): ColumnRule | null | undefined {
  if (raw === null) {
    return null;
  }
  if (typeof raw !== "object") {
    return undefined;
  }
  const bag = raw as Readonly<Record<string, unknown>>;
  const { width, style, color } = bag;
  if (!isNonNegative(width)) {
    return undefined;
  }
  if (typeof style !== "string" || !BORDER_STYLES.has(style)) {
    return undefined;
  }
  if (typeof color !== "string") {
    return undefined;
  }
  return { width, style: style as BorderStyle, color };
}

/**
 * Resolve a section's effective `ColumnConfig` from the doc default plus the
 * section's stamped metadata.
 *
 * Validation rules (each invalid value keeps the doc default's):
 * - `columnCount`: accepted only if finite and `floor >= 1` (a fractional count
 *   is floored — `2.9 → 2`; `< 1` is unusable).
 * - `columnGap`: accepted if finite and `>= 0`.
 * - `columnRule`: an object `{ width >= 0, style: BorderStyle, color: string }`,
 *   or explicit `null` (no rule); anything else keeps the default's rule.
 */
export function resolveColumnConfig(
  docDefault: ColumnConfig,
  sectionMetadata: Readonly<LayoutBoxMetadata> | undefined,
): ColumnConfig {
  if (sectionMetadata === undefined) {
    return docDefault;
  }

  const rawCount = sectionMetadata.columnCount;
  let columnCount = docDefault.columnCount;
  if (typeof rawCount === "number" && Number.isFinite(rawCount)) {
    const floored = Math.floor(rawCount);
    if (floored >= 1) {
      columnCount = floored;
    }
  }

  const columnGap = isNonNegative(sectionMetadata.columnGap)
    ? sectionMetadata.columnGap
    : docDefault.columnGap;

  const resolvedRule = resolveColumnRule(sectionMetadata.columnRule);
  const columnRule = resolvedRule !== undefined ? resolvedRule : docDefault.columnRule;

  return { columnCount, columnGap, columnRule };
}

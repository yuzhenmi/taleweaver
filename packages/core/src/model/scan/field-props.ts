import type * as Y from "yjs";

/**
 * Field read rule: a `field` item reads as a page field (schema 3's `page-field`
 * embed, `properties: {fieldKind, numberStyle}`); a `field` outside page-number |
 * page-count is INERT; a `numberStyle` outside the page-number styles (schema 3's
 * `PageFieldNumberStyle`: no bullets) reads as `decimal`.
 */
export const FIELD_KINDS: ReadonlySet<string> = new Set(["page-number", "page-count"]);
export const FIELD_NUMBER_STYLES: ReadonlySet<string> = new Set(["decimal", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman"]);

/** A field's read `properties`, or null when it is INERT. */
export function fieldProps(m: Y.Map<unknown>): { fieldKind: string; numberStyle: string } | null {
  const fieldKind = m.get("field");
  const style = m.get("numberStyle");
  if (typeof fieldKind !== "string" || !FIELD_KINDS.has(fieldKind)) return null;
  return { fieldKind, numberStyle: typeof style === "string" && FIELD_NUMBER_STYLES.has(style) ? style : "decimal" };
}

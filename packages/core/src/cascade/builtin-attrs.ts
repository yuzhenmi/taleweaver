import type { AttrInterpreter } from "./attr-registry";

/**
 * Built-in attribute interpreters for the standard text styles.
 *
 * Truthy / falsy convention: each boolean-valued style attribute
 * (bold, italic, underline) contributes the relevant Style
 * property when its value is truthy, and contributes nothing when
 * falsy. This lets attrs `{ bold: true }` toggle bold and
 * `{ bold: false }` (or removing the key) un-toggle it.
 */

export const boldInterpreter: AttrInterpreter = {
  attrKey: "bold",
  toStyle: (value) => (value ? { fontWeight: "bold" } : {}),
};

export const italicInterpreter: AttrInterpreter = {
  attrKey: "italic",
  toStyle: (value) => (value ? { fontStyle: "italic" } : {}),
};

export const underlineInterpreter: AttrInterpreter = {
  attrKey: "underline",
  toStyle: (value) => (value ? { textDecoration: "underline" } : {}),
};

export const fontFamilyInterpreter: AttrInterpreter = {
  attrKey: "fontFamily",
  toStyle: (value) => (typeof value === "string" ? { fontFamily: value } : {}),
};

/**
 * fontSize accepts:
 *   - number → px shorthand (Length accepts bare numbers as px)
 *   - { unit: "px" | "em" | "percent", value: number } → structured Length
 *
 * Strings are intentionally NOT supported. The cascade pass resolves
 * em/rem/percent against parent context and produces the final px value
 * in ComputedStyle; interpreters cannot do that resolution without
 * full cascade context.
 */
export const fontSizeInterpreter: AttrInterpreter = {
  attrKey: "fontSize",
  toStyle: (value) => {
    if (typeof value === "number") return { fontSize: value };
    if (
      typeof value === "object" &&
      value !== null &&
      "unit" in value &&
      "value" in value &&
      typeof (value as { value: unknown }).value === "number"
    ) {
      const v = value as { unit: string; value: number };
      if (v.unit === "px" || v.unit === "em" || v.unit === "percent") {
        return { fontSize: { unit: v.unit, value: v.value } };
      }
    }
    return {};
  },
};

export const colorInterpreter: AttrInterpreter = {
  attrKey: "color",
  toStyle: (value) => (typeof value === "string" ? { color: value } : {}),
};

export const backgroundColorInterpreter: AttrInterpreter = {
  attrKey: "backgroundColor",
  toStyle: (value) => (typeof value === "string" ? { backgroundColor: value } : {}),
};

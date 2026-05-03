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

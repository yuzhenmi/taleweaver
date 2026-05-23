import type { AttrInterpreter } from "./attr-registry";
import type { Length, Style } from "../styles";

/**
 * Built-in attribute interpreters for the standard text styles.
 *
 * Truthy / falsy convention: each boolean-valued style attribute
 * (bold, italic, underline) contributes the relevant Style
 * property when its value is truthy, and contributes nothing when
 * falsy. This lets attrs `{ bold: true }` toggle bold and
 * `{ bold: false }` (or removing the key) un-toggle it.
 *
 * "Component-set" convention: not every `Style` property has an
 * interpreter here. Some properties are synthesized directly by a
 * component's `render` from a user-authored attr key, bypassing the
 * cascade-interpreter pipeline entirely. Two built-in examples:
 *
 *   - `listStyleType` — set by `components/list.ts`, which reads
 *     `view.attrs.listType` (`"ordered"`/`"unordered"`) and emits
 *     `listStyleType: "decimal" | "disc"` on the ElementBox.
 *   - `fontSize` / `fontWeight` / margins on headings — set by
 *     `components/heading.ts`, which reads `view.attrs.level` (1-6)
 *     and synthesizes the matching typography on the ElementBox.
 *
 * These attrs intentionally have no interpreter: the component owns
 * the translation, the cascade just consumes the resulting
 * `Style`. Future audits looking for "missing" interpreters should
 * check this convention first before flagging an attr.
 */

/**
 * Narrow `value` to the structured `Length` object form
 * `{ unit: "px" | "em" | "percent", value: number }`. Numbers and
 * non-objects are NOT matched (callers handle those shapes separately).
 */
function asStructuredLength(value: unknown): Length | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "unit" in value &&
    "value" in value &&
    typeof (value as { value: unknown }).value === "number"
  ) {
    const v = value as { unit: unknown; value: number };
    if (v.unit === "px" || v.unit === "em" || v.unit === "percent") {
      return { unit: v.unit, value: v.value };
    }
  }
  return null;
}

/**
 * Coerce `value` to a `Length` (declared form), accepting either a
 * bare number (px shorthand) or the structured object form. Returns
 * `null` for anything else.
 */
function asLength(value: unknown): Length | null {
  if (typeof value === "number") return value;
  return asStructuredLength(value);
}

const VALID_TEXT_ALIGNS = ["start", "end", "center", "justify"] as const;
type TextAlign = (typeof VALID_TEXT_ALIGNS)[number];

function isTextAlign(value: unknown): value is TextAlign {
  return (
    typeof value === "string" &&
    (VALID_TEXT_ALIGNS as readonly string[]).includes(value)
  );
}

/**
 * Build an interpreter for a Length-or-"normal" Style property
 * (`letterSpacing`, `wordSpacing`). Accepts:
 *   - the string `"normal"` (CSS keyword) → contributes `{ [key]: "normal" }`.
 *   - a `Length` (number or `{ unit, value }`) → contributes `{ [key]: length }`.
 *   - anything else → contributes nothing.
 *
 * The cascade pass handles em flattening downstream; the interpreter
 * just validates the input shape.
 */
function makeLengthOrNormalInterpreter<K extends keyof Style>(
  attrKey: K & string,
): AttrInterpreter {
  return {
    attrKey,
    toStyle: (value) => {
      if (value === "normal") {
        return { [attrKey]: "normal" } as Partial<Style>;
      }
      const length = asLength(value);
      if (length !== null) {
        return { [attrKey]: length } as Partial<Style>;
      }
      return {};
    },
  };
}

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

/**
 * textAlign accepts only the logical CSS keywords declared on
 * `Style.textAlign`: `"start" | "end" | "center" | "justify"`. Physical
 * `"left"`/`"right"` are intentionally rejected — components/users
 * should use logical axes; the layout pass maps to physical via
 * writing-mode.
 */
export const textAlignInterpreter: AttrInterpreter = {
  attrKey: "textAlign",
  toStyle: (value) => (isTextAlign(value) ? { textAlign: value } : {}),
};

/**
 * lineHeight accepts:
 *   - `number` → unitless ratio (preferred; inherits as a ratio so children
 *     scale with their own font size).
 *   - `{ unit: "em" | "percent" | "px", value: number }` → structured Length.
 *
 * Note: `px` is accepted here at the interpreter layer for completeness,
 * but the cascade's `flattenLineHeight` rejects it (warns and falls
 * back to the initial unitless ratio per CSS Inline Layout). See
 * `flatten-lengths.ts`.
 */
export const lineHeightInterpreter: AttrInterpreter = {
  attrKey: "lineHeight",
  toStyle: (value) => {
    if (typeof value === "number") return { lineHeight: value };
    const length = asStructuredLength(value);
    if (length !== null) return { lineHeight: length };
    return {};
  },
};

/**
 * textIndent accepts a `Length` (number for px shorthand, or
 * `{ unit: "px" | "em" | "percent", value: number }`).
 */
export const textIndentInterpreter: AttrInterpreter = {
  attrKey: "textIndent",
  toStyle: (value) => {
    const length = asLength(value);
    return length !== null ? { textIndent: length } : {};
  },
};

/**
 * letterSpacing accepts a `Length` or the CSS keyword `"normal"`.
 */
export const letterSpacingInterpreter: AttrInterpreter =
  makeLengthOrNormalInterpreter("letterSpacing");

/**
 * wordSpacing accepts a `Length` or the CSS keyword `"normal"`.
 */
export const wordSpacingInterpreter: AttrInterpreter =
  makeLengthOrNormalInterpreter("wordSpacing");

import type { AttrRegistry } from "./attr-registry";

/**
 * Register all built-in interpreters into the given registry. Production
 * code calls this with the singleton `attrRegistry` on bootstrap; tests
 * call it with their own AttrRegistry instances for isolation.
 *
 * Idempotent in the sense that re-registering the same key replaces the
 * previous entry — callers can safely call this multiple times.
 */
export function registerBuiltinAttrs(registry: AttrRegistry): void {
  registry.register(boldInterpreter);
  registry.register(italicInterpreter);
  registry.register(underlineInterpreter);
  registry.register(fontFamilyInterpreter);
  registry.register(fontSizeInterpreter);
  registry.register(colorInterpreter);
  registry.register(backgroundColorInterpreter);
  // C-C: typography interpreters for inheritable text properties that
  // no component synthesizes.
  registry.register(textAlignInterpreter);
  registry.register(lineHeightInterpreter);
  registry.register(textIndentInterpreter);
  registry.register(letterSpacingInterpreter);
  registry.register(wordSpacingInterpreter);
}

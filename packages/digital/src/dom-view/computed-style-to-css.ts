import {
  type ComputedStyle,
  type ComputedLength,
  type ComputedLengthOrAuto,
  type ListStyleType,
  INITIAL_COMPUTED_STYLE,
  resolveLogicalSides,
} from "@taleweaver/core";

// A `ComputedLength` is px (number) or a symbolic percent. `auto` passes through.
function lengthToCss(v: ComputedLength): string {
  return typeof v === "number" ? `${v}px` : `${v.value}%`;
}
function sideToCss(v: ComputedLengthOrAuto): string {
  return v === "auto" ? "auto" : lengthToCss(v);
}
function lengthEquals(a: ComputedLengthOrAuto, b: ComputedLengthOrAuto): boolean {
  if (a === "auto" || b === "auto") return a === b;
  if (typeof a === "number" || typeof b === "number") return a === b;
  return a.unit === b.unit && a.value === b.value;
}

function listStyleTypeEquals(a: ListStyleType, b: ListStyleType): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.content === b.content;
}

/**
 * Render a `ListStyleType` as a CSS `list-style-type` value. The keyword forms (`disc`, `decimal`,
 * `lower-alpha`, …) are already valid CSS keywords. The custom `{ content }` form maps to a CSS
 * `<string>` value (CSS Lists 3) — escaped for a CSS string token so a `"` / `\` / newline in the
 * marker cannot break out of the quoted value. All three CSS newline characters (U+000A/U+000D/
 * U+000C) are escaped: CSS Syntax §3.3 input-preprocessing folds CR and FF to LF, so an unescaped
 * one would break the string token exactly as a raw LF would.
 */
function listStyleTypeToCss(v: ListStyleType): string {
  if (typeof v === "string") return v;
  const escaped = v.content.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r\f]/g, "\\A ");
  return `"${escaped}"`;
}

/**
 * Map a node's cascaded `ComputedStyle` to an inline `style=""` declaration
 * string, emitting ONLY non-default props (compared against
 * `INITIAL_COMPUTED_STYLE`). Logical box-model sides map to physical CSS sides
 * via `resolveLogicalSides` so RTL / vertical-writing-mode documents render
 * correctly when the browser flows them. v1 = inline style (a stylesheet/class
 * refactor is a documented later step if DOM size profiles hot).
 */
export function computedStyleToInlineStyle(cs: ComputedStyle): string {
  const I = INITIAL_COMPUTED_STYLE;
  const out: string[] = [];
  const push = (prop: string, value: string): void => { out.push(`${prop}: ${value}`); };

  if (cs.writingMode !== I.writingMode) push("writing-mode", cs.writingMode);
  if (cs.direction !== I.direction) push("direction", cs.direction);

  if (cs.color !== I.color) push("color", cs.color);
  if (cs.backgroundColor !== I.backgroundColor) push("background-color", cs.backgroundColor);
  if (cs.fontFamily !== I.fontFamily) push("font-family", cs.fontFamily);
  if (cs.fontSize !== I.fontSize) push("font-size", `${cs.fontSize}px`);
  if (cs.fontWeight !== I.fontWeight) push("font-weight", String(cs.fontWeight));
  if (cs.fontStyle !== I.fontStyle) push("font-style", cs.fontStyle);
  if (cs.underline !== I.underline || cs.lineThrough !== I.lineThrough) {
    const parts: string[] = [];
    if (cs.underline) parts.push("underline");
    if (cs.lineThrough) parts.push("line-through");
    push("text-decoration-line", parts.length > 0 ? parts.join(" ") : "none");
  }
  if (cs.textAlign !== I.textAlign) push("text-align", cs.textAlign);
  if (cs.lineHeight !== I.lineHeight) {
    push("line-height", typeof cs.lineHeight === "number" ? String(cs.lineHeight) : `${cs.lineHeight.value}%`);
  }
  if (cs.whiteSpace !== I.whiteSpace) push("white-space", cs.whiteSpace);
  if (!lengthEquals(cs.textIndent, I.textIndent)) push("text-indent", lengthToCss(cs.textIndent));
  if (cs.letterSpacing !== "normal") push("letter-spacing", lengthToCss(cs.letterSpacing));
  if (cs.wordSpacing !== "normal") push("word-spacing", lengthToCss(cs.wordSpacing));
  if (cs.textTransform !== I.textTransform) push("text-transform", cs.textTransform);
  // List numbering format. Emitted on the (cascaded) list-item box so its <li> keeps the document's
  // format — without it the browser falls back to <ol>/<ul> defaults (decimal/disc), losing
  // lower-alpha / lower-roman / square / custom markers. (Counter start/override is a separate,
  // not-yet-handled facet of DOM-view list fidelity.)
  if (!listStyleTypeEquals(cs.listStyleType, I.listStyleType)) {
    push("list-style-type", listStyleTypeToCss(cs.listStyleType));
  }

  // Logical box-model → physical sides.
  const sides = resolveLogicalSides(cs);
  const margins: ReadonlyArray<readonly [ComputedLengthOrAuto, ComputedLengthOrAuto, "top" | "right" | "bottom" | "left"]> = [
    [cs.marginBlockStart, I.marginBlockStart, sides.blockStart],
    [cs.marginBlockEnd, I.marginBlockEnd, sides.blockEnd],
    [cs.marginInlineStart, I.marginInlineStart, sides.inlineStart],
    [cs.marginInlineEnd, I.marginInlineEnd, sides.inlineEnd],
  ];
  for (const [v, init, side] of margins) {
    if (!lengthEquals(v, init)) push(`margin-${side}`, sideToCss(v));
  }
  const paddings: ReadonlyArray<readonly [ComputedLength, ComputedLength, "top" | "right" | "bottom" | "left"]> = [
    [cs.paddingBlockStart, I.paddingBlockStart, sides.blockStart],
    [cs.paddingBlockEnd, I.paddingBlockEnd, sides.blockEnd],
    [cs.paddingInlineStart, I.paddingInlineStart, sides.inlineStart],
    [cs.paddingInlineEnd, I.paddingInlineEnd, sides.inlineEnd],
  ];
  for (const [v, init, side] of paddings) {
    if (!lengthEquals(v, init)) push(`padding-${side}`, lengthToCss(v));
  }
  const borders: ReadonlyArray<readonly [number, string, string, number, string, string, "top" | "right" | "bottom" | "left"]> = [
    [cs.borderBlockStartWidth, cs.borderBlockStartStyle, cs.borderBlockStartColor, I.borderBlockStartWidth, I.borderBlockStartStyle, I.borderBlockStartColor, sides.blockStart],
    [cs.borderBlockEndWidth, cs.borderBlockEndStyle, cs.borderBlockEndColor, I.borderBlockEndWidth, I.borderBlockEndStyle, I.borderBlockEndColor, sides.blockEnd],
    [cs.borderInlineStartWidth, cs.borderInlineStartStyle, cs.borderInlineStartColor, I.borderInlineStartWidth, I.borderInlineStartStyle, I.borderInlineStartColor, sides.inlineStart],
    [cs.borderInlineEndWidth, cs.borderInlineEndStyle, cs.borderInlineEndColor, I.borderInlineEndWidth, I.borderInlineEndStyle, I.borderInlineEndColor, sides.inlineEnd],
  ];
  for (const [w, st, co, iw, ist, ico, side] of borders) {
    if (w !== iw) push(`border-${side}-width`, `${w}px`);
    if (st !== ist) push(`border-${side}-style`, st);
    if (co !== ico) push(`border-${side}-color`, co);
  }

  return out.join("; ");
}

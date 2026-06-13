import type { AttrInterpreter } from "./attr-registry";
import type { Length, Style, TextTransform, TabStop, TabAlignment, LeaderStyle } from "../styles";

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
export type TextAlign = (typeof VALID_TEXT_ALIGNS)[number];

/**
 * Type guard for the logical `textAlign` keywords (`"start" | "end" |
 * "center" | "justify"`). Shared between the `textAlignInterpreter` (the
 * generic attr→Style path) and the inline-bearing-leaf components, which
 * synthesize `textAlign` onto their ElementBox `style` directly so the
 * value reaches the layout cascade (the components/builtin-attrs
 * "component-set" convention — see `components/paragraph.ts`).
 */
export function isTextAlign(value: unknown): value is TextAlign {
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
  toStyle: (value) => (value ? { underline: true } : {}),
};

export const strikethroughInterpreter: AttrInterpreter = {
  attrKey: "strikethrough",
  toStyle: (value) => (value ? { lineThrough: true } : {}),
};

/**
 * Hyperlink. The `link` attr value is the target URL (string). When set,
 * the inline run renders as Google-Docs link text — blue (#1a73e8) with
 * an underline. Setting the value to anything non-string (or absent) is a
 * no-op (no link styling).
 *
 * Writes the `underline` flag (disjoint from `strikethrough`'s `lineThrough`),
 * so a struck-through link keeps BOTH decorations. Underline color matches
 * text color today; a separately-colored underline (CSS
 * text-decoration-color) would extend the flag set later.
 *
 * Click handling (Cmd/Ctrl-click to open URL, hover tooltip, etc.) is
 * the DOM editor controller's responsibility, not the cascade's.
 */
export const linkInterpreter: AttrInterpreter = {
  attrKey: "link",
  toStyle: (value) =>
    typeof value === "string"
      ? { color: "#1a73e8", underline: true }
      : {},
};

export const fontFamilyInterpreter: AttrInterpreter = {
  attrKey: "fontFamily",
  toStyle: (value) => (typeof value === "string" ? { fontFamily: value } : {}),
};

/**
 * `lang` attr → `language` cascaded property (selects the content language for
 * auto-hyphenation). The value (a BCP-47 tag, e.g. "en-US") passes through
 * verbatim — BCP-47 normalization is the hyphenator's job, not the cascade's.
 */
export const langInterpreter: AttrInterpreter = {
  attrKey: "lang",
  toStyle: (value) => (typeof value === "string" ? { language: value } : {}),
};

/**
 * `hyphens` attr → `hyphens` cascaded property (`none | manual | auto`). The
 * declarative setter for hyphenation behavior — `auto` opts a block (and its
 * inheriting descendants) into automatic dictionary hyphenation when a
 * `Hyphenator` + content `language` are present. Parallels `langInterpreter`;
 * only the three CSS Text 4 keywords are accepted, anything else contributes
 * nothing (so an unknown attr value falls back to the inherited / initial value).
 */
export const hyphensInterpreter: AttrInterpreter = {
  attrKey: "hyphens",
  toStyle: (value) =>
    value === "none" || value === "manual" || value === "auto"
      ? { hyphens: value }
      : {},
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

const VALID_TEXT_TRANSFORMS = [
  "none",
  "capitalize",
  "uppercase",
  "lowercase",
] as const;

/**
 * Type guard for the CSS `text-transform` keywords (`"none" | "capitalize" |
 * "uppercase" | "lowercase"`). The canonical `TextTransform` type lives in
 * `styles/style.ts`; the layout pass consumes it to map glyphs to display case.
 */
function isTextTransform(value: unknown): value is TextTransform {
  return (
    typeof value === "string" &&
    (VALID_TEXT_TRANSFORMS as readonly string[]).includes(value)
  );
}

/**
 * textTransform accepts only the CSS keywords declared on
 * `Style.textTransform`: `"none" | "capitalize" | "uppercase" | "lowercase"`.
 * Any other value contributes nothing.
 */
export const textTransformInterpreter: AttrInterpreter = {
  attrKey: "textTransform",
  toStyle: (value) =>
    isTextTransform(value) ? { textTransform: value } : {},
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

const TAB_ALIGNMENTS: ReadonlySet<TabAlignment> = new Set<TabAlignment>([
  "left", "center", "right", "decimal", "content-edge",
]);
const LEADER_STYLES: ReadonlySet<LeaderStyle> = new Set<LeaderStyle>([
  "none", "dot", "dash", "line",
]);

function coerceTabAlignment(value: unknown): TabAlignment {
  return typeof value === "string" && TAB_ALIGNMENTS.has(value as TabAlignment)
    ? (value as TabAlignment)
    : "left";
}

function coerceLeaderStyle(value: unknown): LeaderStyle {
  return typeof value === "string" && LEADER_STYLES.has(value as LeaderStyle)
    ? (value as LeaderStyle)
    : "none";
}

/**
 * `tabStops` accepts an array of per-paragraph tab-stop descriptors. Each entry
 * is coerced into a closed `TabStop`: `position` clamped to `>= 0` (negative
 * stops are meaningless; CSS Text 4 disallows them), `alignment` defaulting to
 * `"left"` and `leader` to `"none"` when absent/invalid. The returned array is a
 * NEW array sorted ascending by `position` — the cache-hit gate (`tabStopsEqual`)
 * relies on this canonical order for its per-index comparison; the IFC advance pass
 * uses a nearest-ahead min-scan (`nextStop`), so sort order is NOT load-bearing for
 * advance correctness (and a `content-edge` stop's effective position diverges from
 * its stored `position` anyway). Non-array / non-object inputs contribute nothing.
 */
export const tabStopsInterpreter: AttrInterpreter = {
  attrKey: "tabStops",
  toStyle: (value) => {
    const stops = normalizeTabStops(value);
    return stops !== null ? { tabStops: stops } : {};
  },
};

/**
 * Shared `tabStops` attr → closed `TabStop[]` normalizer. Coerces each entry
 * (clamp `position >= 0`, default `alignment`/`leader`) and returns a NEW array
 * sorted ascending by position, or `null` for a non-array input (so a caller can
 * leave the property unset). Reused by BOTH the `tabStopsInterpreter` (the
 * generic cascade path) AND the leaf component's `tabStopsFromAttrs` (the
 * block-level component-synthesis path that threads the stops onto the
 * ElementBox `style` so they reach the layout cascade — see
 * `components/leaf-style-attrs.ts`).
 */
export function normalizeTabStops(value: unknown): readonly TabStop[] | null {
  if (!Array.isArray(value)) return null;
  const stops: TabStop[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const pos = entry.position;
    const position = typeof pos === "number" && Number.isFinite(pos) ? Math.max(0, pos) : 0;
    stops.push({
      position,
      alignment: coerceTabAlignment(entry.alignment),
      leader: coerceLeaderStyle(entry.leader),
    });
  }
  stops.sort((a, b) => a.position - b.position);
  return stops;
}

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
  registry.register(strikethroughInterpreter);
  registry.register(linkInterpreter);
  registry.register(fontFamilyInterpreter);
  registry.register(langInterpreter);
  registry.register(hyphensInterpreter);
  registry.register(fontSizeInterpreter);
  registry.register(colorInterpreter);
  registry.register(backgroundColorInterpreter);
  // C-C: typography interpreters for inheritable text properties that
  // no component synthesizes.
  registry.register(textAlignInterpreter);
  registry.register(textTransformInterpreter);
  registry.register(lineHeightInterpreter);
  registry.register(textIndentInterpreter);
  registry.register(letterSpacingInterpreter);
  registry.register(wordSpacingInterpreter);
  registry.register(tabStopsInterpreter);
}

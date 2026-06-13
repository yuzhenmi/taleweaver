import { describe, it, expect } from "vitest";
import { boldInterpreter, italicInterpreter, underlineInterpreter, strikethroughInterpreter, linkInterpreter } from "./builtin-attrs";

describe("boldInterpreter", () => {
  it("contributes fontWeight: bold for truthy values", () => {
    expect(boldInterpreter.attrKey).toBe("bold");
    expect(boldInterpreter.toStyle(true)).toEqual({ fontWeight: "bold" });
  });

  it("contributes nothing for falsy values", () => {
    expect(boldInterpreter.toStyle(false)).toEqual({});
    expect(boldInterpreter.toStyle(undefined)).toEqual({});
    expect(boldInterpreter.toStyle(null)).toEqual({});
  });
});

describe("italicInterpreter", () => {
  it("contributes fontStyle: italic for truthy values", () => {
    expect(italicInterpreter.attrKey).toBe("italic");
    expect(italicInterpreter.toStyle(true)).toEqual({ fontStyle: "italic" });
  });

  it("contributes nothing for falsy values", () => {
    expect(italicInterpreter.toStyle(false)).toEqual({});
  });
});

describe("underlineInterpreter", () => {
  it("contributes underline: true for truthy values", () => {
    expect(underlineInterpreter.attrKey).toBe("underline");
    expect(underlineInterpreter.toStyle(true)).toEqual({ underline: true });
  });

  it("contributes nothing for falsy values", () => {
    expect(underlineInterpreter.toStyle(false)).toEqual({});
  });
});

describe("strikethroughInterpreter", () => {
  it("contributes lineThrough: true for truthy values", () => {
    expect(strikethroughInterpreter.attrKey).toBe("strikethrough");
    expect(strikethroughInterpreter.toStyle(true)).toEqual({ lineThrough: true });
  });

  it("contributes nothing for falsy values", () => {
    expect(strikethroughInterpreter.toStyle(false)).toEqual({});
  });
});

describe("linkInterpreter", () => {
  it("contributes color + underline for string URL values", () => {
    expect(linkInterpreter.attrKey).toBe("link");
    expect(linkInterpreter.toStyle("https://example.com")).toEqual({
      color: "#1a73e8",
      underline: true,
    });
  });

  it("contributes nothing for non-string values (link removed / never set)", () => {
    expect(linkInterpreter.toStyle(undefined)).toEqual({});
    expect(linkInterpreter.toStyle(null)).toEqual({});
    expect(linkInterpreter.toStyle(true)).toEqual({});
    expect(linkInterpreter.toStyle(123)).toEqual({});
  });

  it("contributes link styling for the empty string (validation deferred to HL.2 SET_LINK handler)", () => {
    // Empty string is technically a string, so the interpreter applies
    // styling. The interpreter is structural; rejecting empty-string-
    // as-link is a UX decision that lives in the SET_LINK handler
    // (HL.2), not the cascade.
    expect(linkInterpreter.toStyle("")).toEqual({
      color: "#1a73e8",
      underline: true,
    });
  });
});

describe("text-decoration set composition (#393)", () => {
  it("underline + strikethrough compose into BOTH flags (disjoint keys)", () => {
    // The two interpreters own DISJOINT Style keys, so applyAll's Object.assign
    // composes them collision-free — a run can carry both decorations at once
    // (Google Docs / CSS text-decoration-line parity). RED before #393: both
    // wrote the single `textDecoration` key, so last-wins dropped one.
    const r = new AttrRegistry();
    registerBuiltinAttrs(r);
    expect(r.applyAll({ underline: true, strikethrough: true })).toEqual({
      underline: true,
      lineThrough: true,
    });
  });

  it("underline-only contributes underline without lineThrough", () => {
    const r = new AttrRegistry();
    registerBuiltinAttrs(r);
    expect(r.applyAll({ underline: true })).toEqual({ underline: true });
  });

  it("strikethrough-only contributes lineThrough without underline", () => {
    const r = new AttrRegistry();
    registerBuiltinAttrs(r);
    expect(r.applyAll({ strikethrough: true })).toEqual({ lineThrough: true });
  });

  it("neither attr → no decoration flags (both interpreters silent absent their attr)", () => {
    const r = new AttrRegistry();
    registerBuiltinAttrs(r);
    expect(r.applyAll({})).toEqual({});
  });

  it("link + strikethrough → link underline SURVIVES alongside lineThrough", () => {
    // link writes `underline`, strikethrough writes `lineThrough`: disjoint, so
    // the link's underline is no longer clobbered by the strikethrough. RED
    // before #393: both wrote `textDecoration`, so the strikethrough erased the
    // link underline.
    const r = new AttrRegistry();
    registerBuiltinAttrs(r);
    expect(r.applyAll({ link: "https://x.test", strikethrough: true })).toEqual({
      color: "#1a73e8",
      underline: true,
      lineThrough: true,
    });
  });
});

import { fontFamilyInterpreter, fontSizeInterpreter, langInterpreter, hyphensInterpreter } from "./builtin-attrs";

describe("fontFamilyInterpreter", () => {
  it("contributes fontFamily: <value> when value is a string", () => {
    expect(fontFamilyInterpreter.attrKey).toBe("fontFamily");
    expect(fontFamilyInterpreter.toStyle("Helvetica")).toEqual({ fontFamily: "Helvetica" });
    expect(fontFamilyInterpreter.toStyle("Comic Sans MS")).toEqual({ fontFamily: "Comic Sans MS" });
  });

  it("contributes nothing for non-string values", () => {
    expect(fontFamilyInterpreter.toStyle(42)).toEqual({});
    expect(fontFamilyInterpreter.toStyle(undefined)).toEqual({});
    expect(fontFamilyInterpreter.toStyle(null)).toEqual({});
  });
});

describe("langInterpreter", () => {
  it("contributes language: <value> verbatim when value is a string (no BCP-47 normalization)", () => {
    expect(langInterpreter.attrKey).toBe("lang");
    expect(langInterpreter.toStyle("en-US")).toEqual({ language: "en-US" });
    expect(langInterpreter.toStyle("de")).toEqual({ language: "de" });
  });

  it("contributes nothing for non-string values", () => {
    expect(langInterpreter.toStyle(42)).toEqual({});
    expect(langInterpreter.toStyle(undefined)).toEqual({});
    expect(langInterpreter.toStyle(null)).toEqual({});
  });
});

describe("hyphensInterpreter", () => {
  it("contributes hyphens: <keyword> for the three valid keywords", () => {
    expect(hyphensInterpreter.attrKey).toBe("hyphens");
    expect(hyphensInterpreter.toStyle("none")).toEqual({ hyphens: "none" });
    expect(hyphensInterpreter.toStyle("manual")).toEqual({ hyphens: "manual" });
    expect(hyphensInterpreter.toStyle("auto")).toEqual({ hyphens: "auto" });
  });

  it("contributes nothing for invalid keywords or non-string values", () => {
    expect(hyphensInterpreter.toStyle("sometimes")).toEqual({});
    expect(hyphensInterpreter.toStyle(42)).toEqual({});
    expect(hyphensInterpreter.toStyle(undefined)).toEqual({});
    expect(hyphensInterpreter.toStyle(null)).toEqual({});
  });
});

describe("fontSizeInterpreter", () => {
  it("contributes fontSize as number when value is a number (px shorthand per Length)", () => {
    expect(fontSizeInterpreter.attrKey).toBe("fontSize");
    expect(fontSizeInterpreter.toStyle(12)).toEqual({ fontSize: 12 });
    expect(fontSizeInterpreter.toStyle(14.5)).toEqual({ fontSize: 14.5 });
  });

  it("contributes fontSize as a structured Length when value is a {unit, value} object", () => {
    expect(fontSizeInterpreter.toStyle({ unit: "em", value: 1.2 })).toEqual({
      fontSize: { unit: "em", value: 1.2 },
    });
    expect(fontSizeInterpreter.toStyle({ unit: "percent", value: 150 })).toEqual({
      fontSize: { unit: "percent", value: 150 },
    });
  });

  it("contributes nothing for unsupported value types", () => {
    expect(fontSizeInterpreter.toStyle(undefined)).toEqual({});
    expect(fontSizeInterpreter.toStyle(null)).toEqual({});
    expect(fontSizeInterpreter.toStyle("12pt")).toEqual({});  // strings not supported by Length
    expect(fontSizeInterpreter.toStyle({ value: 12 })).toEqual({});  // missing unit
  });
});

import { colorInterpreter, backgroundColorInterpreter } from "./builtin-attrs";

describe("colorInterpreter", () => {
  it("contributes color: <value> when value is a string", () => {
    expect(colorInterpreter.attrKey).toBe("color");
    expect(colorInterpreter.toStyle("red")).toEqual({ color: "red" });
    expect(colorInterpreter.toStyle("#abc")).toEqual({ color: "#abc" });
    expect(colorInterpreter.toStyle("rgb(0, 0, 0)")).toEqual({ color: "rgb(0, 0, 0)" });
  });

  it("contributes nothing for non-string values", () => {
    expect(colorInterpreter.toStyle(42)).toEqual({});
    expect(colorInterpreter.toStyle(undefined)).toEqual({});
  });
});

describe("backgroundColorInterpreter", () => {
  it("contributes backgroundColor: <value> when value is a string", () => {
    expect(backgroundColorInterpreter.attrKey).toBe("backgroundColor");
    expect(backgroundColorInterpreter.toStyle("yellow")).toEqual({ backgroundColor: "yellow" });
  });

  it("contributes nothing for non-string values", () => {
    expect(backgroundColorInterpreter.toStyle(42)).toEqual({});
  });
});

import {
  textAlignInterpreter,
  lineHeightInterpreter,
  textIndentInterpreter,
  letterSpacingInterpreter,
  wordSpacingInterpreter,
} from "./builtin-attrs";

describe("textAlignInterpreter", () => {
  it("contributes textAlign for each valid CSS keyword", () => {
    expect(textAlignInterpreter.attrKey).toBe("textAlign");
    expect(textAlignInterpreter.toStyle("start")).toEqual({ textAlign: "start" });
    expect(textAlignInterpreter.toStyle("end")).toEqual({ textAlign: "end" });
    expect(textAlignInterpreter.toStyle("center")).toEqual({ textAlign: "center" });
    expect(textAlignInterpreter.toStyle("justify")).toEqual({ textAlign: "justify" });
  });

  it("contributes nothing for unknown string values", () => {
    // "left"/"right" are not in Style.textAlign's union (which is logical: start/end/center/justify).
    expect(textAlignInterpreter.toStyle("left")).toEqual({});
    expect(textAlignInterpreter.toStyle("right")).toEqual({});
    expect(textAlignInterpreter.toStyle("middle")).toEqual({});
    expect(textAlignInterpreter.toStyle("")).toEqual({});
  });

  it("contributes nothing for non-string values", () => {
    expect(textAlignInterpreter.toStyle(undefined)).toEqual({});
    expect(textAlignInterpreter.toStyle(null)).toEqual({});
    expect(textAlignInterpreter.toStyle(42)).toEqual({});
    expect(textAlignInterpreter.toStyle({ unit: "px", value: 1 })).toEqual({});
  });
});

describe("lineHeightInterpreter", () => {
  it("contributes lineHeight as a unitless ratio when value is a number", () => {
    expect(lineHeightInterpreter.attrKey).toBe("lineHeight");
    expect(lineHeightInterpreter.toStyle(1.2)).toEqual({ lineHeight: 1.2 });
    expect(lineHeightInterpreter.toStyle(2)).toEqual({ lineHeight: 2 });
  });

  it("contributes lineHeight as a structured Length for em/percent/px units", () => {
    expect(lineHeightInterpreter.toStyle({ unit: "em", value: 1.5 })).toEqual({
      lineHeight: { unit: "em", value: 1.5 },
    });
    expect(lineHeightInterpreter.toStyle({ unit: "percent", value: 150 })).toEqual({
      lineHeight: { unit: "percent", value: 150 },
    });
    // px is accepted at the interpreter layer; cascade's flattenLineHeight warns + falls back.
    expect(lineHeightInterpreter.toStyle({ unit: "px", value: 24 })).toEqual({
      lineHeight: { unit: "px", value: 24 },
    });
  });

  it("contributes nothing for unsupported value types", () => {
    expect(lineHeightInterpreter.toStyle(undefined)).toEqual({});
    expect(lineHeightInterpreter.toStyle(null)).toEqual({});
    expect(lineHeightInterpreter.toStyle("normal")).toEqual({});
    expect(lineHeightInterpreter.toStyle({ unit: "rem", value: 1 })).toEqual({});
    expect(lineHeightInterpreter.toStyle({ value: 1 })).toEqual({});
  });
});

describe("textIndentInterpreter", () => {
  it("contributes textIndent as a number (px shorthand) when value is a number", () => {
    expect(textIndentInterpreter.attrKey).toBe("textIndent");
    expect(textIndentInterpreter.toStyle(20)).toEqual({ textIndent: 20 });
    expect(textIndentInterpreter.toStyle(0)).toEqual({ textIndent: 0 });
  });

  it("contributes textIndent as a structured Length for em/percent/px units", () => {
    expect(textIndentInterpreter.toStyle({ unit: "em", value: 2 })).toEqual({
      textIndent: { unit: "em", value: 2 },
    });
    expect(textIndentInterpreter.toStyle({ unit: "percent", value: 5 })).toEqual({
      textIndent: { unit: "percent", value: 5 },
    });
    expect(textIndentInterpreter.toStyle({ unit: "px", value: 30 })).toEqual({
      textIndent: { unit: "px", value: 30 },
    });
  });

  it("contributes nothing for unsupported value types", () => {
    expect(textIndentInterpreter.toStyle(undefined)).toEqual({});
    expect(textIndentInterpreter.toStyle(null)).toEqual({});
    expect(textIndentInterpreter.toStyle("20px")).toEqual({});
    expect(textIndentInterpreter.toStyle({ unit: "rem", value: 2 })).toEqual({});
    expect(textIndentInterpreter.toStyle({ value: 20 })).toEqual({});
  });
});

describe("letterSpacingInterpreter", () => {
  it("contributes letterSpacing as a number (px shorthand) when value is a number", () => {
    expect(letterSpacingInterpreter.attrKey).toBe("letterSpacing");
    expect(letterSpacingInterpreter.toStyle(0.5)).toEqual({ letterSpacing: 0.5 });
    expect(letterSpacingInterpreter.toStyle(2)).toEqual({ letterSpacing: 2 });
  });

  it("contributes letterSpacing as a structured Length for em/percent/px units", () => {
    expect(letterSpacingInterpreter.toStyle({ unit: "em", value: 0.1 })).toEqual({
      letterSpacing: { unit: "em", value: 0.1 },
    });
    expect(letterSpacingInterpreter.toStyle({ unit: "percent", value: 5 })).toEqual({
      letterSpacing: { unit: "percent", value: 5 },
    });
    expect(letterSpacingInterpreter.toStyle({ unit: "px", value: 1 })).toEqual({
      letterSpacing: { unit: "px", value: 1 },
    });
  });

  it("contributes letterSpacing: 'normal' for the 'normal' keyword", () => {
    expect(letterSpacingInterpreter.toStyle("normal")).toEqual({ letterSpacing: "normal" });
  });

  it("contributes nothing for unsupported value types", () => {
    expect(letterSpacingInterpreter.toStyle(undefined)).toEqual({});
    expect(letterSpacingInterpreter.toStyle(null)).toEqual({});
    expect(letterSpacingInterpreter.toStyle("wide")).toEqual({});
    expect(letterSpacingInterpreter.toStyle({ unit: "rem", value: 1 })).toEqual({});
    expect(letterSpacingInterpreter.toStyle({ value: 1 })).toEqual({});
  });
});

describe("wordSpacingInterpreter", () => {
  it("contributes wordSpacing as a number (px shorthand) when value is a number", () => {
    expect(wordSpacingInterpreter.attrKey).toBe("wordSpacing");
    expect(wordSpacingInterpreter.toStyle(1)).toEqual({ wordSpacing: 1 });
    expect(wordSpacingInterpreter.toStyle(0)).toEqual({ wordSpacing: 0 });
  });

  it("contributes wordSpacing as a structured Length for em/percent/px units", () => {
    expect(wordSpacingInterpreter.toStyle({ unit: "em", value: 0.25 })).toEqual({
      wordSpacing: { unit: "em", value: 0.25 },
    });
    expect(wordSpacingInterpreter.toStyle({ unit: "percent", value: 10 })).toEqual({
      wordSpacing: { unit: "percent", value: 10 },
    });
    expect(wordSpacingInterpreter.toStyle({ unit: "px", value: 4 })).toEqual({
      wordSpacing: { unit: "px", value: 4 },
    });
  });

  it("contributes wordSpacing: 'normal' for the 'normal' keyword", () => {
    expect(wordSpacingInterpreter.toStyle("normal")).toEqual({ wordSpacing: "normal" });
  });

  it("contributes nothing for unsupported value types", () => {
    expect(wordSpacingInterpreter.toStyle(undefined)).toEqual({});
    expect(wordSpacingInterpreter.toStyle(null)).toEqual({});
    expect(wordSpacingInterpreter.toStyle("wide")).toEqual({});
    expect(wordSpacingInterpreter.toStyle({ unit: "rem", value: 1 })).toEqual({});
    expect(wordSpacingInterpreter.toStyle({ value: 1 })).toEqual({});
  });
});

import { textTransformInterpreter } from "./builtin-attrs";

describe("textTransformInterpreter", () => {
  it("contributes textTransform for each valid CSS keyword", () => {
    expect(textTransformInterpreter.attrKey).toBe("textTransform");
    expect(textTransformInterpreter.toStyle("none")).toEqual({ textTransform: "none" });
    expect(textTransformInterpreter.toStyle("capitalize")).toEqual({ textTransform: "capitalize" });
    expect(textTransformInterpreter.toStyle("uppercase")).toEqual({ textTransform: "uppercase" });
    expect(textTransformInterpreter.toStyle("lowercase")).toEqual({ textTransform: "lowercase" });
  });

  it("contributes nothing for unknown string values", () => {
    expect(textTransformInterpreter.toStyle("bogus")).toEqual({});
    expect(textTransformInterpreter.toStyle("small-caps")).toEqual({});
    expect(textTransformInterpreter.toStyle("")).toEqual({});
  });

  it("contributes nothing for non-string values", () => {
    expect(textTransformInterpreter.toStyle(undefined)).toEqual({});
    expect(textTransformInterpreter.toStyle(null)).toEqual({});
    expect(textTransformInterpreter.toStyle(42)).toEqual({});
  });

  it("is registered by registerBuiltinAttrs (guards the declared-but-unregistered regression)", () => {
    const r = new AttrRegistry();
    registerBuiltinAttrs(r);
    expect(r.has("textTransform")).toBe(true);
  });
});

import { registerBuiltinAttrs } from "./builtin-attrs";
import { AttrRegistry } from "./attr-registry";

describe("registerBuiltinAttrs", () => {
  it("registers all built-in interpreters into a fresh registry", () => {
    const r = new AttrRegistry();
    registerBuiltinAttrs(r);

    expect(r.has("bold")).toBe(true);
    expect(r.has("italic")).toBe(true);
    expect(r.has("underline")).toBe(true);
    expect(r.has("strikethrough")).toBe(true);
    expect(r.has("link")).toBe(true);
    expect(r.has("fontFamily")).toBe(true);
    expect(r.has("fontSize")).toBe(true);
    expect(r.has("color")).toBe(true);
    expect(r.has("backgroundColor")).toBe(true);
    expect(r.has("lang")).toBe(true);
  });

  it("registers the C-C typography interpreters", () => {
    const r = new AttrRegistry();
    registerBuiltinAttrs(r);

    expect(r.has("textAlign")).toBe(true);
    expect(r.has("lineHeight")).toBe(true);
    expect(r.has("textIndent")).toBe(true);
    expect(r.has("letterSpacing")).toBe(true);
    expect(r.has("wordSpacing")).toBe(true);
    expect(r.has("textTransform")).toBe(true);
    expect(r.has("tabStops")).toBe(true);
  });

  it("end-to-end: a typical inline attrs bag produces the expected Style contribution", () => {
    const r = new AttrRegistry();
    registerBuiltinAttrs(r);
    const attrs = {
      bold: true,
      italic: true,
      fontFamily: "Helvetica",
      fontSize: 12,
      color: "blue",
    };
    expect(r.applyAll(attrs)).toEqual({
      fontWeight: "bold",
      fontStyle: "italic",
      fontFamily: "Helvetica",
      fontSize: 12,
      color: "blue",
    });
  });

  it("end-to-end: a typography attrs bag produces the expected Style contribution", () => {
    const r = new AttrRegistry();
    registerBuiltinAttrs(r);
    const attrs = {
      textAlign: "center",
      lineHeight: 1.5,
      textIndent: { unit: "em", value: 2 },
      letterSpacing: "normal",
      wordSpacing: { unit: "px", value: 4 },
    };
    expect(r.applyAll(attrs)).toEqual({
      textAlign: "center",
      lineHeight: 1.5,
      textIndent: { unit: "em", value: 2 },
      letterSpacing: "normal",
      wordSpacing: { unit: "px", value: 4 },
    });
  });
});

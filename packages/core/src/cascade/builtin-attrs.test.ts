import { describe, it, expect } from "vitest";
import { boldInterpreter, italicInterpreter, underlineInterpreter } from "./builtin-attrs";

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
  it("contributes textDecoration: underline for truthy values", () => {
    expect(underlineInterpreter.attrKey).toBe("underline");
    expect(underlineInterpreter.toStyle(true)).toEqual({ textDecoration: "underline" });
  });

  it("contributes nothing for falsy values", () => {
    expect(underlineInterpreter.toStyle(false)).toEqual({});
  });
});

import { fontFamilyInterpreter, fontSizeInterpreter } from "./builtin-attrs";

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

import { registerBuiltinAttrs } from "./builtin-attrs";
import { AttrRegistry } from "./attr-registry";

describe("registerBuiltinAttrs", () => {
  it("registers all built-in interpreters into a fresh registry", () => {
    const r = new AttrRegistry();
    registerBuiltinAttrs(r);

    expect(r.has("bold")).toBe(true);
    expect(r.has("italic")).toBe(true);
    expect(r.has("underline")).toBe(true);
    expect(r.has("fontFamily")).toBe(true);
    expect(r.has("fontSize")).toBe(true);
    expect(r.has("color")).toBe(true);
    expect(r.has("backgroundColor")).toBe(true);
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
});

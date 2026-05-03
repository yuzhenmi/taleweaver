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

import { describe, it, expect } from "vitest";
import { transformRun } from "./text-transform";

describe("transformRun", () => {
  it("uppercase 1:1 (ASCII)", () => {
    expect(transformRun("ab", "uppercase")).toEqual({ display: "AB", sourceDisplayLengths: [1, 1] });
  });
  it("uppercase grow (ß→SS)", () => {
    expect(transformRun("straße", "uppercase")).toEqual({ display: "STRASSE", sourceDisplayLengths: [1, 1, 1, 1, 2, 1] });
  });
  it("lowercase", () => {
    expect(transformRun("AB", "lowercase")).toEqual({ display: "ab", sourceDisplayLengths: [1, 1] });
  });
  it("capitalize: first cased letter of each word, run start is a boundary", () => {
    expect(transformRun("foo bar", "capitalize")).toEqual({ display: "Foo Bar", sourceDisplayLengths: [1,1,1,1,1,1,1] });
  });
  it("capitalize: skips leading punctuation to the first cased letter", () => {
    expect(transformRun("'foo", "capitalize")).toEqual({ display: "'Foo", sourceDisplayLengths: [1, 1, 1, 1] });
  });
  it("capitalize: a digit between words does not consume the boundary", () => {
    // "1bar" — the digit is non-cased, so the boundary stays active and 'b' capitalizes.
    expect(transformRun("foo 1bar", "capitalize").display).toBe("Foo 1Bar");
  });
});

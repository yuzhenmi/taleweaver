import { describe, it, expect } from "vitest";
import { parseCssColor } from "./color";

describe("parseCssColor", () => {
  it("parses 6-digit hex", () => {
    expect(parseCssColor("#ff0000")).toEqual({ r: 1, g: 0, b: 0 });
  });
  it("parses 3-digit hex", () => {
    expect(parseCssColor("#0f0")).toEqual({ r: 0, g: 1, b: 0 });
  });
  it("parses rgb()", () => {
    expect(parseCssColor("rgb(0, 128, 255)")).toEqual({ r: 0, g: 128 / 255, b: 1 });
  });
  it("parses rgba() flattening alpha to opaque", () => {
    expect(parseCssColor("rgba(255, 0, 0, 0.3)")).toEqual({ r: 1, g: 0, b: 0 });
  });
  it("parses common named colors", () => {
    expect(parseCssColor("black")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseCssColor("white")).toEqual({ r: 1, g: 1, b: 1 });
  });
  it("returns null for transparent", () => {
    expect(parseCssColor("transparent")).toBeNull();
  });
  it("falls back to black for an unrecognized value", () => {
    expect(parseCssColor("not-a-color")).toEqual({ r: 0, g: 0, b: 0 });
  });
  it("falls back to black for a malformed 3-digit hex (no NaN channel)", () => {
    // Without the 3-digit NaN guard this returned {NaN,NaN,NaN} → corrupt "NaN NaN NaN rg".
    expect(parseCssColor("#xyz")).toEqual({ r: 0, g: 0, b: 0 });
  });
  it("clamps out-of-range rgb() channels to [0,1]", () => {
    // CSS clamps rgb(300,-10,0) toward red; PDF rg operands must be in [0,1].
    expect(parseCssColor("rgb(300, -10, 0)")).toEqual({ r: 1, g: 0, b: 0 });
  });
});

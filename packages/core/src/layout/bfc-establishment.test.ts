import { describe, it, expect } from "vitest";
import { establishesNewBFC } from "./bfc-establishment";
import { INITIAL_COMPUTED_STYLE } from "../styles";

describe("establishesNewBFC", () => {
  it("returns false for plain block", () => {
    expect(establishesNewBFC({ ...INITIAL_COMPUTED_STYLE, display: "block" })).toBe(false);
  });

  it("returns true for floated box", () => {
    expect(establishesNewBFC({ ...INITIAL_COMPUTED_STYLE, float: "inline-start" })).toBe(true);
    expect(establishesNewBFC({ ...INITIAL_COMPUTED_STYLE, float: "inline-end" })).toBe(true);
  });

  it("returns true for inline-block", () => {
    expect(establishesNewBFC({ ...INITIAL_COMPUTED_STYLE, display: "inline-block" })).toBe(true);
  });

  it("returns true for table-cell", () => {
    expect(establishesNewBFC({ ...INITIAL_COMPUTED_STYLE, display: "table-cell" })).toBe(true);
  });

  it("returns true for display: flow-root", () => {
    expect(establishesNewBFC({ ...INITIAL_COMPUTED_STYLE, display: "flow-root" })).toBe(true);
  });

  it("returns false for inline", () => {
    expect(establishesNewBFC({ ...INITIAL_COMPUTED_STYLE, display: "inline" })).toBe(false);
  });
});

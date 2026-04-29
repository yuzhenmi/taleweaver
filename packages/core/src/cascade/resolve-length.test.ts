import { describe, it, expect } from "vitest";
import { resolveLength } from "./resolve-length";

describe("resolveLength", () => {
  it("returns numbers as-is (px shorthand)", () => {
    expect(resolveLength(10, 16)).toBe(10);
  });

  it("resolves explicit px units", () => {
    expect(resolveLength({ unit: "px", value: 20 }, 16)).toBe(20);
  });

  it("resolves em against the given fontSize", () => {
    expect(resolveLength({ unit: "em", value: 1.5 }, 16)).toBe(24);
    expect(resolveLength({ unit: "em", value: 0.5 }, 20)).toBe(10);
  });

  it("returns percent unchanged (resolved at layout time)", () => {
    expect(resolveLength({ unit: "percent", value: 50 }, 16)).toEqual({ unit: "percent", value: 50 });
  });

});

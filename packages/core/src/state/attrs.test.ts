import { describe, it, expect } from "vitest";
import { deepValueEqual } from "./attrs";

describe("deepValueEqual", () => {
  it("compares primitives", () => {
    expect(deepValueEqual(1, 1)).toBe(true);
    expect(deepValueEqual("a", "a")).toBe(true);
    expect(deepValueEqual(true, true)).toBe(true);
    expect(deepValueEqual(1, 2)).toBe(false);
    expect(deepValueEqual("a", "b")).toBe(false);
    expect(deepValueEqual(null, null)).toBe(true);
    expect(deepValueEqual(undefined, undefined)).toBe(true);
    expect(deepValueEqual(null, undefined)).toBe(false);
  });

  it("compares objects by value, recursively", () => {
    expect(deepValueEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(deepValueEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepValueEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepValueEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(deepValueEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it("compares arrays by element", () => {
    expect(deepValueEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepValueEqual([1, 2, 3], [1, 2])).toBe(false);
    expect(deepValueEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
  });

  it("returns false when comparing object to array", () => {
    expect(deepValueEqual({}, [])).toBe(false);
  });
});

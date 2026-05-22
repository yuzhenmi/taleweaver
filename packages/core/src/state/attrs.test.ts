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

import { attrsEqual, mergeAttrs, type ReadonlyAttrs } from "./attrs";

describe("attrsEqual", () => {
  it("returns true for identical attribute bags", () => {
    const a: ReadonlyAttrs = { bold: true, fontSize: 12 };
    const b: ReadonlyAttrs = { bold: true, fontSize: 12 };
    expect(attrsEqual(a, b)).toBe(true);
  });

  it("returns false when key sets differ", () => {
    expect(attrsEqual({ bold: true }, { bold: true, italic: true })).toBe(false);
  });

  it("returns false when a value differs", () => {
    expect(attrsEqual({ bold: true }, { bold: false })).toBe(false);
  });

  it("returns true for two empty attribute bags", () => {
    expect(attrsEqual({}, {})).toBe(true);
  });

  it("compares object-valued attributes recursively", () => {
    expect(attrsEqual({ comment: { id: "c1" } }, { comment: { id: "c1" } })).toBe(true);
    expect(attrsEqual({ comment: { id: "c1" } }, { comment: { id: "c2" } })).toBe(false);
  });
});

describe("mergeAttrs", () => {
  it("merges two non-overlapping bags into their union", () => {
    const existing: ReadonlyAttrs = { bold: true };
    const incoming: ReadonlyAttrs = { italic: true };
    expect(mergeAttrs(existing, incoming)).toEqual({ bold: true, italic: true });
  });

  it("incoming values override existing values for the same key", () => {
    const existing: ReadonlyAttrs = { bold: true, fontSize: 12 };
    const incoming: ReadonlyAttrs = { fontSize: 14 };
    expect(mergeAttrs(existing, incoming)).toEqual({ bold: true, fontSize: 14 });
  });

  it("incoming key with value === undefined DELETES the key from the result", () => {
    const existing: ReadonlyAttrs = { bold: true, italic: true };
    const incoming: ReadonlyAttrs = { bold: undefined };
    const result = mergeAttrs(existing, incoming);
    expect(result).toEqual({ italic: true });
    // The deleted key must not appear at all (not even as `undefined`).
    expect("bold" in result).toBe(false);
  });

  it("deleting a non-existent key is a no-op", () => {
    const existing: ReadonlyAttrs = { italic: true };
    const incoming: ReadonlyAttrs = { bold: undefined };
    const result = mergeAttrs(existing, incoming);
    expect(result).toEqual({ italic: true });
    expect("bold" in result).toBe(false);
  });

  it("can simultaneously add a key and remove another", () => {
    const existing: ReadonlyAttrs = { bold: true };
    const incoming: ReadonlyAttrs = { bold: undefined, italic: true };
    const result = mergeAttrs(existing, incoming);
    expect(result).toEqual({ italic: true });
    expect("bold" in result).toBe(false);
  });

  it("merging an empty incoming bag returns the existing keys unchanged", () => {
    const existing: ReadonlyAttrs = { bold: true, fontSize: 12 };
    expect(mergeAttrs(existing, {})).toEqual({ bold: true, fontSize: 12 });
  });

  it("returns a frozen object for parity with other attrs producers", () => {
    const a: ReadonlyAttrs = { bold: true };
    const b: ReadonlyAttrs = { italic: true };
    expect(Object.isFrozen(mergeAttrs(a, b))).toBe(true);
  });

  it("returns a frozen object even when both inputs are empty", () => {
    expect(Object.isFrozen(mergeAttrs({}, {}))).toBe(true);
  });
});

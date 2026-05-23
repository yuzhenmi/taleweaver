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
import { AttrRegistry } from "../cascade/attr-registry";

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

  // T-C: custom-equals opt-in via the AttrRegistry. Interpreters can opt into
  // a per-key `equals` to override the default deep-value compare. The
  // motivating example is a `comment` attribute whose `timestamp` field
  // shouldn't affect run-merge decisions (two adjacent runs with the same
  // comment id but differing timestamps should still merge).
  describe("AttrRegistry opt-in equality (T-C)", () => {
    interface CommentAttr {
      readonly id: string;
      readonly timestamp: number;
    }

    function isCommentAttr(value: unknown): value is CommentAttr {
      return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { id?: unknown }).id === "string" &&
        typeof (value as { timestamp?: unknown }).timestamp === "number"
      );
    }

    it("falls back to deep value equality when no registry is passed", () => {
      const a: ReadonlyAttrs = { comment: { id: "c1", timestamp: 100 } };
      const b: ReadonlyAttrs = { comment: { id: "c1", timestamp: 200 } };
      // Without a registry, timestamps differ → deep-equal returns false.
      expect(attrsEqual(a, b)).toBe(false);
    });

    it("uses the interpreter's custom equals when registry is passed", () => {
      const registry = new AttrRegistry();
      registry.register({
        attrKey: "comment",
        toStyle: () => ({}),
        equals: (x, y) => {
          if (!isCommentAttr(x) || !isCommentAttr(y)) return false;
          return x.id === y.id;
        },
      });

      const a: ReadonlyAttrs = { comment: { id: "c1", timestamp: 100 } };
      const b: ReadonlyAttrs = { comment: { id: "c1", timestamp: 200 } };
      expect(attrsEqual(a, b, registry)).toBe(true);

      // Different ids → still unequal.
      const c: ReadonlyAttrs = { comment: { id: "c1", timestamp: 100 } };
      const d: ReadonlyAttrs = { comment: { id: "c2", timestamp: 100 } };
      expect(attrsEqual(c, d, registry)).toBe(false);
    });

    it("falls back to deep value equality for keys with no registered equals", () => {
      const registry = new AttrRegistry();
      // No `equals` on the interpreter — only toStyle.
      registry.register({
        attrKey: "bold",
        toStyle: () => ({}),
      });

      // Bold attr: deep equality applies (true === true).
      expect(attrsEqual({ bold: true }, { bold: true }, registry)).toBe(true);
      expect(attrsEqual({ bold: true }, { bold: false }, registry)).toBe(false);
    });

    it("falls back to deep value equality for keys not registered at all", () => {
      const registry = new AttrRegistry();
      // Registry is empty — fontSize has no interpreter.
      expect(attrsEqual({ fontSize: 12 }, { fontSize: 12 }, registry)).toBe(true);
      expect(attrsEqual({ fontSize: 12 }, { fontSize: 14 }, registry)).toBe(false);
    });

    it("returns false when key sets differ, regardless of custom equals", () => {
      const registry = new AttrRegistry();
      registry.register({
        attrKey: "comment",
        toStyle: () => ({}),
        equals: () => true, // "always equal" — but key-set check happens first.
      });
      expect(attrsEqual({ comment: { id: "c1", timestamp: 1 } }, {}, registry)).toBe(false);
      expect(
        attrsEqual(
          { comment: { id: "c1", timestamp: 1 } },
          { comment: { id: "c1", timestamp: 1 }, bold: true },
          registry,
        ),
      ).toBe(false);
    });
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

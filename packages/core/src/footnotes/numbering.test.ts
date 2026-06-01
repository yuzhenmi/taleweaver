import { describe, it, expect } from "vitest";
import { footnoteNumbers } from "./numbering";
import type { FootnoteAnchorRef, FootnoteNumberingPolicy } from "./types";
import type { BlockId } from "../state";

/** Build an anchor ref fixture (only the fields numbering cares about). */
function ref(contentBlockId: string, sectionId: string | null): FootnoteAnchorRef {
  return {
    contentBlockId: contentBlockId as BlockId,
    blockId: "blk" as BlockId,
    sectionId: sectionId === null ? null : (sectionId as BlockId),
  };
}

describe("footnoteNumbers — continuous", () => {
  it("numbers 1..N in document order, never resetting across sections", () => {
    const anchors = [
      ref("fb0", null),
      ref("fb1", "s1"),
      ref("fb2", "s1"),
      ref("fb3", "s2"),
    ];
    const policy: FootnoteNumberingPolicy = { reset: "continuous", format: "decimal" };
    const map = footnoteNumbers(anchors, policy);
    expect(map.get("fb0" as BlockId)).toEqual({ value: 1, formatted: "1" });
    expect(map.get("fb1" as BlockId)).toEqual({ value: 2, formatted: "2" });
    expect(map.get("fb2" as BlockId)).toEqual({ value: 3, formatted: "3" });
    expect(map.get("fb3" as BlockId)).toEqual({ value: 4, formatted: "4" });
  });

  it("returns an empty map for no anchors", () => {
    const map = footnoteNumbers([], { reset: "continuous", format: "decimal" });
    expect(map.size).toBe(0);
  });

  it("applies the format to the raw value", () => {
    const anchors = [ref("a", null), ref("b", null), ref("c", null)];
    const map = footnoteNumbers(anchors, { reset: "continuous", format: "lower-roman" });
    expect(map.get("a" as BlockId)).toEqual({ value: 1, formatted: "i" });
    expect(map.get("b" as BlockId)).toEqual({ value: 2, formatted: "ii" });
    expect(map.get("c" as BlockId)).toEqual({ value: 3, formatted: "iii" });
  });
});

describe("footnoteNumbers — restart-per-section", () => {
  it("resets the counter to 1 at each section boundary", () => {
    const anchors = [
      ref("fb0", null), // implicit root section
      ref("fb1", "s1"), // section s1 starts → reset
      ref("fb2", "s1"),
      ref("fb3", "s2"), // section s2 starts → reset
      ref("fb4", "s2"),
    ];
    const policy: FootnoteNumberingPolicy = {
      reset: "restart-per-section",
      format: "decimal",
    };
    const map = footnoteNumbers(anchors, policy);
    expect(map.get("fb0" as BlockId)?.value).toBe(1);
    expect(map.get("fb1" as BlockId)?.value).toBe(1);
    expect(map.get("fb2" as BlockId)?.value).toBe(2);
    expect(map.get("fb3" as BlockId)?.value).toBe(1);
    expect(map.get("fb4" as BlockId)?.value).toBe(2);
  });

  it("two sections each restart at 1 (formatted)", () => {
    const anchors = [
      ref("a1", "s1"),
      ref("a2", "s1"),
      ref("b1", "s2"),
    ];
    const map = footnoteNumbers(anchors, {
      reset: "restart-per-section",
      format: "lower-alpha",
    });
    expect(map.get("a1" as BlockId)).toEqual({ value: 1, formatted: "a" });
    expect(map.get("a2" as BlockId)).toEqual({ value: 2, formatted: "b" });
    expect(map.get("b1" as BlockId)).toEqual({ value: 1, formatted: "a" });
  });

  it("treats the implicit root section (null) as its own reset scope", () => {
    const anchors = [
      ref("r1", null),
      ref("r2", null),
      ref("s", "s1"),
    ];
    const map = footnoteNumbers(anchors, {
      reset: "restart-per-section",
      format: "decimal",
    });
    expect(map.get("r1" as BlockId)?.value).toBe(1);
    expect(map.get("r2" as BlockId)?.value).toBe(2);
    expect(map.get("s" as BlockId)?.value).toBe(1);
  });
});

describe("footnoteNumbers — restart-per-page (FN-6)", () => {
  it("throws a clear error when no pageAssignment is given", () => {
    const anchors = [ref("a", null)];
    expect(() =>
      footnoteNumbers(anchors, { reset: "restart-per-page", format: "decimal" }),
    ).toThrow(/restart-per-page requires pageAssignment/i);
  });

  it("numbers anchors all on page 0 as a single 1..N sequence", () => {
    const anchors = [ref("cb1", null), ref("cb2", null), ref("cb3", null)];
    const pageAssignment = new Map<BlockId, number>([
      ["cb1" as BlockId, 0],
      ["cb2" as BlockId, 0],
      ["cb3" as BlockId, 0],
    ]);
    const policy: FootnoteNumberingPolicy = {
      reset: "restart-per-page",
      format: "decimal",
    };
    const map = footnoteNumbers(anchors, policy, pageAssignment);
    expect(map.get("cb1" as BlockId)).toEqual({ value: 1, formatted: "1" });
    expect(map.get("cb2" as BlockId)).toEqual({ value: 2, formatted: "2" });
    expect(map.get("cb3" as BlockId)).toEqual({ value: 3, formatted: "3" });
  });

  it("resets the counter to 1 at each page boundary", () => {
    const anchors = [
      ref("cb1", null), // page 0
      ref("cb2", null), // page 0
      ref("cb3", null), // page 1 → reset
      ref("cb4", null), // page 2 → reset
      ref("cb5", null), // page 2
    ];
    const pageAssignment = new Map<BlockId, number>([
      ["cb1" as BlockId, 0],
      ["cb2" as BlockId, 0],
      ["cb3" as BlockId, 1],
      ["cb4" as BlockId, 2],
      ["cb5" as BlockId, 2],
    ]);
    const policy: FootnoteNumberingPolicy = {
      reset: "restart-per-page",
      format: "decimal",
    };
    const map = footnoteNumbers(anchors, policy, pageAssignment);
    expect(map.get("cb1" as BlockId)).toEqual({ value: 1, formatted: "1" });
    expect(map.get("cb2" as BlockId)).toEqual({ value: 2, formatted: "2" });
    expect(map.get("cb3" as BlockId)).toEqual({ value: 1, formatted: "1" });
    expect(map.get("cb4" as BlockId)).toEqual({ value: 1, formatted: "1" });
    expect(map.get("cb5" as BlockId)).toEqual({ value: 2, formatted: "2" });
  });

  it("numbers a single anchor on a non-zero page as 1 (reset fires on first anchor)", () => {
    const anchors = [ref("cb1", null)];
    const pageAssignment = new Map<BlockId, number>([["cb1" as BlockId, 3]]);
    const map = footnoteNumbers(
      anchors,
      { reset: "restart-per-page", format: "decimal" },
      pageAssignment,
    );
    expect(map.get("cb1" as BlockId)).toEqual({ value: 1, formatted: "1" });
  });

  it("applies the format to per-page counters (lower-roman)", () => {
    const anchors = [
      ref("cb1", null), // page 0
      ref("cb2", null), // page 0
      ref("cb3", null), // page 1 → reset
      ref("cb4", null), // page 1
    ];
    const pageAssignment = new Map<BlockId, number>([
      ["cb1" as BlockId, 0],
      ["cb2" as BlockId, 0],
      ["cb3" as BlockId, 1],
      ["cb4" as BlockId, 1],
    ]);
    const map = footnoteNumbers(
      anchors,
      { reset: "restart-per-page", format: "lower-roman" },
      pageAssignment,
    );
    expect(map.get("cb1" as BlockId)).toEqual({ value: 1, formatted: "i" });
    expect(map.get("cb2" as BlockId)).toEqual({ value: 2, formatted: "ii" });
    expect(map.get("cb3" as BlockId)).toEqual({ value: 1, formatted: "i" });
    expect(map.get("cb4" as BlockId)).toEqual({ value: 2, formatted: "ii" });
  });

  it("throws naming the contentBlockId when an anchor is absent from pageAssignment", () => {
    const anchors = [ref("cb1", null), ref("cb2", null)];
    const pageAssignment = new Map<BlockId, number>([["cb1" as BlockId, 0]]);
    expect(() =>
      footnoteNumbers(
        anchors,
        { reset: "restart-per-page", format: "decimal" },
        pageAssignment,
      ),
    ).toThrow(/cb2/);
  });
});

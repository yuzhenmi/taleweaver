import { describe, it, expect } from "vitest";
import { createPosition, type Position, createSpan, positionsEqual, type Span, comparePositionsWithinBlock } from "./block-position";
import type { BlockId } from "./block-id";

describe("createPosition", () => {
  it("constructs a frozen position", () => {
    const p: Position = createPosition("blk-0" as BlockId, 5);
    expect(p.blockId).toBe("blk-0");
    expect(p.offset).toBe(5);
    expect(Object.isFrozen(p)).toBe(true);
  });
});

describe("createSpan", () => {
  it("constructs a frozen span from anchor and focus", () => {
    const a = createPosition("blk-0" as BlockId, 0);
    const b = createPosition("blk-0" as BlockId, 5);
    const s: Span = createSpan(a, b);
    expect(s.anchor).toBe(a);
    expect(s.focus).toBe(b);
    expect(Object.isFrozen(s)).toBe(true);
  });
});

describe("positionsEqual", () => {
  it("returns true for positions with equal blockId and offset", () => {
    const a = createPosition("blk-0" as BlockId, 5);
    const b = createPosition("blk-0" as BlockId, 5);
    expect(positionsEqual(a, b)).toBe(true);
  });

  it("returns false when blockId differs", () => {
    const a = createPosition("blk-0" as BlockId, 5);
    const b = createPosition("blk-1" as BlockId, 5);
    expect(positionsEqual(a, b)).toBe(false);
  });

  it("returns false when offset differs", () => {
    const a = createPosition("blk-0" as BlockId, 5);
    const b = createPosition("blk-0" as BlockId, 6);
    expect(positionsEqual(a, b)).toBe(false);
  });
});

describe("comparePositionsWithinBlock", () => {
  it("returns negative when a.offset < b.offset (same block)", () => {
    const a = createPosition("blk-0" as BlockId, 1);
    const b = createPosition("blk-0" as BlockId, 5);
    expect(comparePositionsWithinBlock(a, b)).toBeLessThan(0);
  });

  it("returns positive when a.offset > b.offset (same block)", () => {
    const a = createPosition("blk-0" as BlockId, 5);
    const b = createPosition("blk-0" as BlockId, 1);
    expect(comparePositionsWithinBlock(a, b)).toBeGreaterThan(0);
  });

  it("returns 0 when positions are equal (same block)", () => {
    const a = createPosition("blk-0" as BlockId, 5);
    const b = createPosition("blk-0" as BlockId, 5);
    expect(comparePositionsWithinBlock(a, b)).toBe(0);
  });

  it("throws when blockIds differ", () => {
    const a = createPosition("blk-0" as BlockId, 5);
    const b = createPosition("blk-1" as BlockId, 5);
    expect(() => comparePositionsWithinBlock(a, b)).toThrow(/different blocks/);
  });
});

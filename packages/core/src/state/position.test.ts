import { describe, it, expect } from "vitest";
import {
  createPosition,
  createSpan,
  comparePositions,
  normalizeSpan,
} from "./position";

describe("createPosition", () => {
  it("creates a frozen position", () => {
    const pos = createPosition([0, 1], 5);
    expect(pos.path).toEqual([0, 1]);
    expect(pos.offset).toBe(5);
    expect(Object.isFrozen(pos)).toBe(true);
    expect(Object.isFrozen(pos.path)).toBe(true);
  });

  it("copies the path array", () => {
    const path = [0, 1];
    const pos = createPosition(path, 0);
    path[0] = 99;
    expect(pos.path[0]).toBe(0);
  });
});

describe("createSpan", () => {
  it("creates a frozen span", () => {
    const anchor = createPosition([0], 0);
    const focus = createPosition([0], 5);
    const span = createSpan(anchor, focus);
    expect(span.anchor).toBe(anchor);
    expect(span.focus).toBe(focus);
    expect(Object.isFrozen(span)).toBe(true);
  });
});

describe("comparePositions", () => {
  it("returns 0 for equal positions", () => {
    const a = createPosition([0, 0], 3);
    const b = createPosition([0, 0], 3);
    expect(comparePositions(a, b)).toBe(0);
  });

  it("returns negative when a < b by offset", () => {
    const a = createPosition([0, 0], 2);
    const b = createPosition([0, 0], 5);
    expect(comparePositions(a, b)).toBeLessThan(0);
  });

  it("returns positive when a > b by offset", () => {
    const a = createPosition([0, 0], 5);
    const b = createPosition([0, 0], 2);
    expect(comparePositions(a, b)).toBeGreaterThan(0);
  });

  it("compares by path before offset", () => {
    const a = createPosition([0, 1], 0);
    const b = createPosition([0, 0], 99);
    expect(comparePositions(a, b)).toBeGreaterThan(0);
  });

  it("compares across different paragraph indices", () => {
    const a = createPosition([0, 0], 5);
    const b = createPosition([1, 0], 0);
    expect(comparePositions(a, b)).toBeLessThan(0);
  });

  it("shorter path (ancestor) comes before longer path", () => {
    const a = createPosition([0], 0);
    const b = createPosition([0, 0], 0);
    expect(comparePositions(a, b)).toBeLessThan(0);
  });

  it("handles empty paths", () => {
    const a = createPosition([], 0);
    const b = createPosition([0], 0);
    expect(comparePositions(a, b)).toBeLessThan(0);
  });
});

describe("normalizeSpan", () => {
  it("returns same span when anchor <= focus", () => {
    const anchor = createPosition([0, 0], 2);
    const focus = createPosition([0, 0], 5);
    const span = createSpan(anchor, focus);
    const normalized = normalizeSpan(span);
    expect(normalized.anchor).toBe(anchor);
    expect(normalized.focus).toBe(focus);
  });

  it("swaps when anchor > focus", () => {
    const anchor = createPosition([0, 0], 5);
    const focus = createPosition([0, 0], 2);
    const span = createSpan(anchor, focus);
    const normalized = normalizeSpan(span);
    expect(normalized.anchor.offset).toBe(2);
    expect(normalized.focus.offset).toBe(5);
  });

  it("swaps when anchor is in later paragraph", () => {
    const anchor = createPosition([1, 0], 0);
    const focus = createPosition([0, 0], 3);
    const span = createSpan(anchor, focus);
    const normalized = normalizeSpan(span);
    expect(normalized.anchor.path[0]).toBe(0);
    expect(normalized.focus.path[0]).toBe(1);
  });

  it("returns same span when collapsed", () => {
    const pos = createPosition([0, 0], 3);
    const span = createSpan(pos, pos);
    const normalized = normalizeSpan(span);
    expect(normalized).toBe(span);
  });
});

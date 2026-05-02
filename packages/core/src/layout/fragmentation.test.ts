// packages/core/src/layout/fragmentation.test.ts
import { describe, it, expect } from "vitest";
import { normalizeBreakValue } from "./fragmentation";

describe("normalizeBreakValue", () => {
  it.each([
    ["auto", "auto"],
    ["page", "page"],
    ["always", "page"],
    ["avoid", "avoid"],
    ["avoid-page", "avoid"],
    // Unsupported values for P1.B → auto.
    ["recto", "auto"],
    ["verso", "auto"],
    ["left", "auto"],
    ["right", "auto"],
    ["column", "auto"],
    ["region", "auto"],
    ["avoid-column", "auto"],
    ["avoid-region", "auto"],
  ])("normalizes %s → %s", (raw, expected) => {
    expect(normalizeBreakValue(raw)).toBe(expected);
  });

  it("treats unknown strings as auto", () => {
    expect(normalizeBreakValue("garbage")).toBe("auto");
  });
});

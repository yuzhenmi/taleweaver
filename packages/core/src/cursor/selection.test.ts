import { describe, it, expect } from "vitest";
import { selectionsEqual } from "./selection";
import { createPosition, createSpan, asBlockId } from "../state";

const p = (b: string, o: number) => createPosition(asBlockId(b), o);

describe("selectionsEqual (digital idempotency guard — 2a-core)", () => {
  it("true for identical spans", () => {
    const s = createSpan(p("b1", 2), p("b1", 5));
    expect(selectionsEqual(s, createSpan(p("b1", 2), p("b1", 5)))).toBe(true);
  });

  it("true for anchor↔focus-flipped spans (unordered compare)", () => {
    const a = createSpan(p("b1", 2), p("b1", 5));
    const flipped = createSpan(p("b1", 5), p("b1", 2));
    expect(selectionsEqual(a, flipped)).toBe(true);
  });

  it("false when an endpoint differs in offset", () => {
    expect(selectionsEqual(createSpan(p("b1", 2), p("b1", 5)), createSpan(p("b1", 2), p("b1", 6)))).toBe(false);
  });

  it("false when an endpoint differs in blockId", () => {
    expect(selectionsEqual(createSpan(p("b1", 2), p("b1", 5)), createSpan(p("b2", 2), p("b1", 5)))).toBe(false);
  });

  it("true for a collapsed caret compared to itself", () => {
    const c = createSpan(p("b1", 3), p("b1", 3));
    expect(selectionsEqual(c, createSpan(p("b1", 3), p("b1", 3)))).toBe(true);
  });
});

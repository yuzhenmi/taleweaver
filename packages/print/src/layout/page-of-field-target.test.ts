import { describe, it, expect } from "vitest";
import type { BlockId } from "@taleweaver/core";
import { pageOfFieldTarget, nearestTopLevelIndexedAncestor, type BlockParentLookup } from "./page-of-field-target";

const bid = (s: string): BlockId => s as unknown as BlockId;

// A fixture plan: only top-level blocks are indexed (mirrors recordBlockMaps).
function planWith(spans: Record<string, { first: number; last: number }>) {
  return { pageSpanOfBlock: (k: string) => spans[k] ?? null };
}
// A fixture parent map.
function parentOfFrom(parents: Record<string, string | null>): BlockParentLookup {
  return (id) => {
    const p = parents[id as unknown as string];
    return p == null ? null : bid(p);
  };
}

describe("pageOfFieldTarget", () => {
  it("top-level target → its own first page (exact)", () => {
    const plan = planWith({ h1: { first: 3, last: 3 } });
    expect(pageOfFieldTarget(plan, bid("h1"), undefined)).toBe(3);
  });

  it("N1: target in a single-page container → the container's page (exact)", () => {
    const plan = planWith({ tbl: { first: 2, last: 2 } });
    const parentOf = parentOfFrom({ h: "cell", cell: "row", row: "tbl", tbl: null });
    expect(pageOfFieldTarget(plan, bid("h"), parentOf)).toBe(2);
  });

  it("N2: target in a page-spanning container → container-start (the ancestor's first page)", () => {
    const plan = planWith({ tbl: { first: 4, last: 6 } });
    const parentOf = parentOfFrom({ h: "cell", cell: "tbl", tbl: null });
    expect(pageOfFieldTarget(plan, bid("h"), parentOf)).toBe(4);
  });

  it("nested but no parentOf capability → -1 (today's broken-ref)", () => {
    const plan = planWith({ tbl: { first: 2, last: 2 } });
    expect(pageOfFieldTarget(plan, bid("h"), undefined)).toBe(-1);
  });

  it("orphan (no indexed ancestor) → -1", () => {
    const plan = planWith({});
    const parentOf = parentOfFrom({ h: "x", x: null });
    expect(pageOfFieldTarget(plan, bid("h"), parentOf)).toBe(-1);
  });

  it("cycle guard: a parent cycle terminates and returns -1", () => {
    const plan = planWith({});
    const parentOf = parentOfFrom({ a: "b", b: "a" });
    expect(nearestTopLevelIndexedAncestor(parentOf, plan, bid("a"))).toBe(null);
    expect(pageOfFieldTarget(plan, bid("a"), parentOf)).toBe(-1);
  });
});

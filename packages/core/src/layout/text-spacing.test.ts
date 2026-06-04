import { describe, it, expect } from "vitest";
import { resolveSpacingPx, isWordSeparatorCluster, clusterSpacing } from "./text-spacing";

describe("text-spacing", () => {
  it("resolveSpacingPx: normal → 0, number → itself, percent → 0", () => {
    expect(resolveSpacingPx("normal")).toBe(0);
    expect(resolveSpacingPx(4)).toBe(4);
    expect(resolveSpacingPx({ unit: "percent", value: 50 })).toBe(0);
  });

  it("isWordSeparatorCluster: U+0020 and U+00A0 only", () => {
    expect(isWordSeparatorCluster(" ")).toBe(true);        // U+0020
    expect(isWordSeparatorCluster("\u00A0")).toBe(true);   // U+00A0 NO-BREAK SPACE
    expect(isWordSeparatorCluster("a")).toBe(false);
    expect(isWordSeparatorCluster("\t")).toBe(false);      // tab is NOT a v1 word separator
    expect(isWordSeparatorCluster("")).toBe(false);
  });

  it("clusterSpacing: letter on every cluster; word added only on separators", () => {
    expect(clusterSpacing("a", 4, 8)).toBe(4);             // letter only
    expect(clusterSpacing(" ", 4, 8)).toBe(12);            // letter + word
    expect(clusterSpacing("a", 0, 0)).toBe(0);             // normal-identity
    expect(clusterSpacing(" ", 0, 0)).toBe(0);             // normal-identity
  });
});

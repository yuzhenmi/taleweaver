import { describe, it, expect } from "vitest";
import type {
  LayoutBoxMetadata,
  ComputedLength,
  ComputedLengthOrAuto,
  LogicalSideContext,
  SuggestionView,
} from "./index";

describe("@taleweaver/core barrel — Phase 1 viewer surface", () => {
  it("exports LayoutBoxMetadata as a usable type", () => {
    const m: LayoutBoxMetadata = { headingLevel: 2 };
    expect(m.headingLevel).toBe(2);
  });

  it("exports the computed-length + logical-side-context types (Phase 1 viewer)", () => {
    const len: ComputedLength = 10;
    const lenOrAuto: ComputedLengthOrAuto = "auto";
    const ctx: LogicalSideContext = { writingMode: "horizontal-tb", direction: "ltr" };
    expect([len, lenOrAuto, ctx.direction]).toEqual([10, "auto", "ltr"]);
  });

  it("exports SuggestionView as a usable type (Phase 1 viewer)", () => {
    const v: SuggestionView = "final";
    expect(v).toBe("final");
  });
});

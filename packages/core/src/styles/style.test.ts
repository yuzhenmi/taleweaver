import { describe, it, expect } from "vitest";
import type { Style } from "./style";

describe("Style", () => {
  it("accepts logical inset and sizing properties", () => {
    const s: Style = {
      display: "block",
      inlineSize: 100,
      blockSize: 50,
      marginBlockStart: 10, marginBlockEnd: 10,
      marginInlineStart: 10, marginInlineEnd: 10,
      paddingBlockStart: 5, paddingBlockEnd: 5,
      paddingInlineStart: 5, paddingInlineEnd: 5,
      borderBlockStartWidth: 1, borderBlockEndWidth: 1,
      borderInlineStartWidth: 1, borderInlineEndWidth: 1,
      borderBlockStartStyle: "solid",
      borderBlockStartColor: "#000",
    };
    expect(s.marginInlineStart).toBe(10);
    expect(s.inlineSize).toBe(100);
  });

  it("accepts writingMode and direction", () => {
    const s: Style = { writingMode: "horizontal-tb", direction: "rtl" };
    expect(s.writingMode).toBe("horizontal-tb");
    expect(s.direction).toBe("rtl");
  });

  it("accepts logical float and clear values", () => {
    const s: Style = { float: "inline-start", clear: "both" };
    expect(s.float).toBe("inline-start");
  });
});

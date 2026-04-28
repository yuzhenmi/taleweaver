import { describe, it, expect } from "vitest";
import type { ComputedStyle } from "./computed-style";

describe("ComputedStyle", () => {
  it("requires every property to be defined", () => {
    const cs: ComputedStyle = {
      display: "block",
      inlineSize: "auto", blockSize: "auto",
      minInlineSize: 0, minBlockSize: 0,
      maxInlineSize: "none", maxBlockSize: "none",
      boxSizing: "content-box",
      marginBlockStart: 0, marginInlineEnd: 0, marginBlockEnd: 0, marginInlineStart: 0,
      paddingBlockStart: 0, paddingInlineEnd: 0, paddingBlockEnd: 0, paddingInlineStart: 0,
      borderBlockStartWidth: 0, borderInlineEndWidth: 0, borderBlockEndWidth: 0, borderInlineStartWidth: 0,
      borderBlockStartStyle: "none", borderInlineEndStyle: "none", borderBlockEndStyle: "none", borderInlineStartStyle: "none",
      borderBlockStartColor: "black", borderInlineEndColor: "black", borderBlockEndColor: "black", borderInlineStartColor: "black",
      backgroundColor: "transparent",
      fontFamily: "system-ui",
      fontSize: 16,
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
      lineHeight: 1.2,
      color: "black",
      whiteSpace: "normal",
      verticalAlign: "baseline",
      float: "none",
      clear: "none",
      breakBefore: "auto", breakAfter: "auto", breakInside: "auto",
      listStyleType: "disc",
      listStylePosition: "outside",
      writingMode: "horizontal-tb",
      direction: "ltr",
    };
    expect(cs.display).toBe("block");
  });
});

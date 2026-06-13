import { describe, it, expect } from "vitest";
import type { UsedStyle } from "./used-style";

describe("UsedStyle", () => {
  it("accepts fully numeric length values", () => {
    const us: UsedStyle = {
      display: "block",
      writingMode: "horizontal-tb",
      direction: "ltr",

      boxSizing: "content-box",

      marginBlockStart: 10, marginBlockEnd: 10,
      marginInlineStart: 0, marginInlineEnd: 0,

      paddingBlockStart: 5, paddingBlockEnd: 5,
      paddingInlineStart: 0, paddingInlineEnd: 0,

      borderBlockStartWidth: 1, borderBlockEndWidth: 1,
      borderInlineStartWidth: 0, borderInlineEndWidth: 0,
      borderBlockStartStyle: "solid", borderBlockEndStyle: "none",
      borderInlineStartStyle: "none", borderInlineEndStyle: "none",
      borderBlockStartColor: "#000", borderBlockEndColor: "#000",
      borderInlineStartColor: "#000", borderInlineEndColor: "#000",

      backgroundColor: "transparent",

      fontFamily: "sans-serif",
      fontSize: 16,
      fontWeight: "normal",
      fontStyle: "normal",
      underline: false,
      lineThrough: false,
      lineHeight: 19.2,
      color: "#000",

      whiteSpace: "normal",
      verticalAlign: "baseline",

      textAlign: "start",
      textIndent: 0,
      textWrap: "wrap",
      hyphens: "manual",
      overflowWrap: "normal",
      letterSpacing: "normal",
      wordSpacing: "normal",
      textTransform: "none",
      fontFeatureSettings: [],
      tabStops: [],
      defaultTabStop: 48,
      language: "",
      hyphenateLimitChars: [5, 2, 2],

      float: "none", clear: "none",

      breakBefore: "auto", breakAfter: "auto", breakInside: "auto",

      widows: 2,
      orphans: 2,

      listStyleType: "disc",
      listStylePosition: "outside",
    };
    expect(us.fontSize).toBe(16);
  });
});

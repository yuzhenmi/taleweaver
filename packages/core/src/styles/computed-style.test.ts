import { describe, it, expect } from "vitest";
import type { ComputedStyle } from "./computed-style";

describe("ComputedStyle", () => {
  it("requires every property to be defined", () => {
    const cs: ComputedStyle = {
      display: "block",
      width: "auto", height: "auto",
      minWidth: 0, minHeight: 0,
      maxWidth: "none", maxHeight: "none",
      boxSizing: "content-box",
      marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0,
      borderTopStyle: "none", borderRightStyle: "none", borderBottomStyle: "none", borderLeftStyle: "none",
      borderTopColor: "black", borderRightColor: "black", borderBottomColor: "black", borderLeftColor: "black",
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
      widows: 2, orphans: 2,
      listStyleType: "disc",
      listStylePosition: "outside",
    };
    expect(cs.display).toBe("block");
  });
});

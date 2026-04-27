import { describe, it, expect } from "vitest";
import type { Style } from "./style";

describe("Style", () => {
  it("all properties are optional", () => {
    const empty: Style = {};
    expect(empty).toEqual({});
  });

  it("accepts display values", () => {
    const s: Style = { display: "block" };
    expect(s.display).toBe("block");
  });

  it("accepts margin/padding/border on all four sides", () => {
    const s: Style = {
      marginTop: 10, marginRight: 10, marginBottom: 10, marginLeft: 10,
      paddingTop: 5, paddingRight: 5, paddingBottom: 5, paddingLeft: 5,
      borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderLeftWidth: 1,
    };
    expect(s.marginLeft).toBe(10);
  });

  it("accepts typography properties", () => {
    const s: Style = {
      fontFamily: "Arial",
      fontSize: 16,
      fontWeight: "bold",
      fontStyle: "italic",
      textDecoration: "underline",
      lineHeight: 1.5,
      color: "black",
    };
    expect(s.fontWeight).toBe("bold");
  });

  it("accepts numeric font weights", () => {
    const s: Style = { fontWeight: 600 };
    expect(s.fontWeight).toBe(600);
  });

  it("accepts whitespace and verticalAlign", () => {
    const s: Style = { whiteSpace: "pre-wrap", verticalAlign: "middle" };
    expect(s.whiteSpace).toBe("pre-wrap");
  });

  it("accepts float, clear, fragmentation, list properties", () => {
    const s: Style = {
      float: "left", clear: "both",
      breakBefore: "page", breakAfter: "avoid", breakInside: "avoid",
      widows: 2, orphans: 2,
      listStyleType: "decimal", listStylePosition: "outside",
    };
    expect(s.float).toBe("left");
  });

  it("listStyleType accepts custom content object", () => {
    const s: Style = { listStyleType: { content: "→" } };
    expect(s.listStyleType).toEqual({ content: "→" });
  });
});

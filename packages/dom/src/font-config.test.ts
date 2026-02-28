import { describe, it, expect } from "vitest";
import { FONT_CONFIG, buildCssFontString, getEffectiveStyles } from "./font-config";

describe("FONT_CONFIG", () => {
  it("has monospace fontFamily", () => {
    expect(FONT_CONFIG.fontFamily).toBe("monospace");
  });

  it("has fontSize 16", () => {
    expect(FONT_CONFIG.fontSize).toBe(16);
  });

  it("has lineHeight 24", () => {
    expect(FONT_CONFIG.lineHeight).toBe(24);
  });
});

describe("buildCssFontString", () => {
  it("builds font string from defaults", () => {
    expect(buildCssFontString({})).toBe("16px monospace");
  });

  it("uses provided fontSize and fontFamily", () => {
    expect(buildCssFontString({ fontSize: 20, fontFamily: "serif" })).toBe(
      "20px serif",
    );
  });

  it("includes fontWeight when specified", () => {
    expect(buildCssFontString({ fontWeight: "bold" })).toBe(
      "bold 16px monospace",
    );
  });

  it("includes fontStyle when specified", () => {
    expect(buildCssFontString({ fontStyle: "italic" })).toBe(
      "italic 16px monospace",
    );
  });

  it("includes both fontStyle and fontWeight", () => {
    expect(
      buildCssFontString({ fontStyle: "italic", fontWeight: "bold" }),
    ).toBe("italic bold 16px monospace");
  });
});

describe("getEffectiveStyles", () => {
  it("fills defaults for empty styles", () => {
    const result = getEffectiveStyles({});
    expect(result.fontFamily).toBe("monospace");
    expect(result.fontSize).toBe(16);
    expect(result.lineHeight).toBe(24);
  });

  it("preserves provided values", () => {
    const result = getEffectiveStyles({
      fontFamily: "serif",
      fontSize: 20,
      lineHeight: 30,
    });
    expect(result.fontFamily).toBe("serif");
    expect(result.fontSize).toBe(20);
    expect(result.lineHeight).toBe(30);
  });

  it("passes through other style properties", () => {
    const result = getEffectiveStyles({
      fontWeight: "bold",
      fontStyle: "italic",
    });
    expect(result.fontWeight).toBe("bold");
    expect(result.fontStyle).toBe("italic");
  });
});

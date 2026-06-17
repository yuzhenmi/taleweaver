import { describe, it, expect } from "vitest";
import { buildCssFontString, getEffectiveStyles } from "./font-config";

describe("buildCssFontString", () => {
  it("builds font string from defaults", () => {
    expect(buildCssFontString({})).toBe('16px "Inter", sans-serif');
  });

  it("uses provided fontSize and fontFamily", () => {
    expect(buildCssFontString({ fontSize: 20, fontFamily: "serif" })).toBe(
      "20px serif",
    );
  });

  it("includes fontWeight when specified", () => {
    expect(buildCssFontString({ fontWeight: "bold" })).toBe(
      'bold 16px "Inter", sans-serif',
    );
  });

  it("includes fontStyle when specified", () => {
    expect(buildCssFontString({ fontStyle: "italic" })).toBe(
      'italic 16px "Inter", sans-serif',
    );
  });

  it("includes both fontStyle and fontWeight", () => {
    expect(
      buildCssFontString({ fontStyle: "italic", fontWeight: "bold" }),
    ).toBe('italic bold 16px "Inter", sans-serif');
  });
});

describe("getEffectiveStyles", () => {
  it("fills defaults for empty styles", () => {
    const result = getEffectiveStyles({});
    expect(result.fontFamily).toBe("\"Inter\", sans-serif");
    expect(result.fontSize).toBe(16);
    expect(result.lineHeight).toBe(1.2);
  });

  it("preserves provided values", () => {
    const result = getEffectiveStyles({
      fontFamily: "serif",
      fontSize: 20,
      lineHeight: 2,
    });
    expect(result.fontFamily).toBe("serif");
    expect(result.fontSize).toBe(20);
    expect(result.lineHeight).toBe(2);
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

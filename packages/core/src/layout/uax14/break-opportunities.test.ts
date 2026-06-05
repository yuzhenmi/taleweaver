import { describe, it, expect } from "vitest";
import { lineBreakOpportunities } from "./break-opportunities";

/** Helper: the set of offsets where a (soft or mandatory) break is allowed. */
function breakIdx(text: string): number[] {
  return lineBreakOpportunities(text).map((p) => p.index).sort((a, b) => a - b);
}
function mandatoryIdx(text: string): number[] {
  return lineBreakOpportunities(text)
    .filter((p) => p.mandatory)
    .map((p) => p.index)
    .sort((a, b) => a - b);
}

describe("lineBreakOpportunities — headline behavior", () => {
  it("CJK: break allowed between every ideograph (spaceless wrapping)", () => {
    const text = "你好世界"; // 你好世界 — 4 ideographs, no spaces
    expect(text.length).toBe(4);
    expect(breakIdx(text)).toEqual([1, 2, 3]);
  });

  it("hyphen: soft break allowed after a hyphen-minus", () => {
    // "well-known" → break opportunity after the '-' (offset 5), not inside words
    expect(breakIdx("well-known")).toContain(5);
  });

  it("NBSP (U+00A0, class GL): NO break at the non-breaking space", () => {
    const text = "a b"; // a + NBSP + b
    expect(text.length).toBe(3); // guard: not normalized away
    expect(breakIdx(text)).not.toContain(1); // no break before the NBSP
    expect(breakIdx(text)).not.toContain(2); // no break after the NBSP
  });

  it("number: no break inside a numeric group (LB25 number tailoring)", () => {
    // "123,456" — the comma is IS/SY inside the number run; no interior break.
    expect(breakIdx("123,456")).toEqual([]);
  });

  it("regional indicators: no break inside a flag pair, break between pairs", () => {
    // Two flags: 🇺🇸🇬🇧 = RI RI RI RI (each RI is an astral pair = 2 code units).
    const text = "\u{1F1FA}\u{1F1F8}\u{1F1EC}\u{1F1E7}";
    // Break allowed only between the two flags (offset 4 = after the first pair).
    expect(breakIdx(text)).toEqual([4]);
  });

  it("mandatory breaks at LF, LS (U+2028), PS (U+2029)", () => {
    // UAX #14 LB4/LB5: the mandatory break is AFTER the separator, i.e. before
    // the following character (offset 2 in "a<sep>b"), not before the separator.
    expect(mandatoryIdx("a\nb")).toEqual([2]); // LF (LB5)
    expect(mandatoryIdx("a b")).toEqual([2]); // LINE SEPARATOR (BK, LB4)
    expect(mandatoryIdx("a b")).toEqual([2]); // PARAGRAPH SEPARATOR (BK, LB4)
  });

  it("no opportunity at offset 0 or at end of text", () => {
    const pts = lineBreakOpportunities("ab cd");
    expect(pts.map((p) => p.index)).not.toContain(0);
    expect(pts.map((p) => p.index)).not.toContain(5);
  });

  it("empty string yields no opportunities", () => {
    expect(lineBreakOpportunities("")).toEqual([]);
  });
});

import * as coreBarrel from "../../index";

describe("uax14 public barrel", () => {
  it("re-exports the classifier from @taleweaver/core", () => {
    expect(typeof coreBarrel.lineBreakOpportunities).toBe("function");
    expect(typeof coreBarrel.lineBreakClass).toBe("function");
    expect(coreBarrel.UAX14_UNICODE_VERSION).toBe("16.0.0");
    expect(coreBarrel.lineBreakClass(0x0041)).toBe("AL");
    expect(coreBarrel.lineBreakOpportunities("ab cd").map((p) => p.index)).toEqual([3]);
  });
});

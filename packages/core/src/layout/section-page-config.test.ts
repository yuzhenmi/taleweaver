import { describe, it, expect } from "vitest";
import { resolveSectionPageConfig } from "./section-page-config";
import type { PageConfig } from "./page-config";

// A reference doc-wide config. 800px block-size, 60px top/bottom margins ⇒
// 680px content block-size (well above zero, so margin overrides can't trip
// the content-size guard unless deliberately huge).
const DOC_WIDE: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 800,
  pageMargins: { blockStart: 60, blockEnd: 60, inlineStart: 72, inlineEnd: 72 },
  pageGap: 20,
};

describe("resolveSectionPageConfig", () => {
  it("undefined metadata → returns docWide (deep-equal)", () => {
    expect(resolveSectionPageConfig(DOC_WIDE, undefined)).toEqual(DOC_WIDE);
  });

  it("empty metadata → returns docWide (deep-equal)", () => {
    expect(resolveSectionPageConfig(DOC_WIDE, {})).toEqual(DOC_WIDE);
  });

  it("a valid pageBlockSize override applies; other fields unchanged", () => {
    const cfg = resolveSectionPageConfig(DOC_WIDE, { pageBlockSize: 1000 });
    expect(cfg.pageBlockSize).toBe(1000);
    expect(cfg.pageInlineSize).toBe(DOC_WIDE.pageInlineSize);
    expect(cfg.pageGap).toBe(DOC_WIDE.pageGap);
    expect(cfg.pageMargins).toEqual(DOC_WIDE.pageMargins);
  });

  it("a valid pageInlineSize override applies", () => {
    const cfg = resolveSectionPageConfig(DOC_WIDE, { pageInlineSize: 720 });
    expect(cfg.pageInlineSize).toBe(720);
    expect(cfg.pageBlockSize).toBe(DOC_WIDE.pageBlockSize);
  });

  it("negative size → ignored (docWide)", () => {
    expect(resolveSectionPageConfig(DOC_WIDE, { pageBlockSize: -50 })).toEqual(DOC_WIDE);
    expect(resolveSectionPageConfig(DOC_WIDE, { pageInlineSize: -1 })).toEqual(DOC_WIDE);
  });

  it("zero size → ignored (docWide)", () => {
    expect(resolveSectionPageConfig(DOC_WIDE, { pageBlockSize: 0 })).toEqual(DOC_WIDE);
    expect(resolveSectionPageConfig(DOC_WIDE, { pageInlineSize: 0 })).toEqual(DOC_WIDE);
  });

  it("NaN / Infinity size → ignored (docWide)", () => {
    expect(resolveSectionPageConfig(DOC_WIDE, { pageBlockSize: NaN })).toEqual(DOC_WIDE);
    expect(
      resolveSectionPageConfig(DOC_WIDE, { pageInlineSize: Number.POSITIVE_INFINITY }),
    ).toEqual(DOC_WIDE);
  });

  it("string / non-number size → ignored (docWide)", () => {
    expect(resolveSectionPageConfig(DOC_WIDE, { pageBlockSize: "1000" })).toEqual(DOC_WIDE);
    expect(resolveSectionPageConfig(DOC_WIDE, { pageInlineSize: {} })).toEqual(DOC_WIDE);
  });

  it("pageGap 0 is accepted (>= 0)", () => {
    const cfg = resolveSectionPageConfig(DOC_WIDE, { pageGap: 0 });
    expect(cfg.pageGap).toBe(0);
  });

  it("negative / NaN pageGap → ignored (docWide)", () => {
    expect(resolveSectionPageConfig(DOC_WIDE, { pageGap: -5 })).toEqual(DOC_WIDE);
    expect(resolveSectionPageConfig(DOC_WIDE, { pageGap: NaN })).toEqual(DOC_WIDE);
  });

  it("partial pageMargins merge: only inlineStart overridden, rest from docWide", () => {
    const cfg = resolveSectionPageConfig(DOC_WIDE, {
      pageMargins: { inlineStart: 100 },
    });
    expect(cfg.pageMargins).toEqual({
      blockStart: 60,
      blockEnd: 60,
      inlineStart: 100,
      inlineEnd: 72,
    });
  });

  it("pageMargins 0 values are accepted (>= 0)", () => {
    const cfg = resolveSectionPageConfig(DOC_WIDE, {
      pageMargins: { blockStart: 0, inlineEnd: 0 },
    });
    expect(cfg.pageMargins).toEqual({
      blockStart: 0,
      blockEnd: 60,
      inlineStart: 72,
      inlineEnd: 0,
    });
  });

  it("invalid pageMargins entries (negative/NaN/string) are ignored individually", () => {
    const cfg = resolveSectionPageConfig(DOC_WIDE, {
      pageMargins: { blockStart: -10, blockEnd: NaN, inlineStart: "x", inlineEnd: 99 },
    });
    expect(cfg.pageMargins).toEqual({
      blockStart: 60,
      blockEnd: 60,
      inlineStart: 72,
      inlineEnd: 99,
    });
  });

  it("non-object pageMargins → ignored (docWide margins kept)", () => {
    expect(resolveSectionPageConfig(DOC_WIDE, { pageMargins: 5 })).toEqual(DOC_WIDE);
    expect(resolveSectionPageConfig(DOC_WIDE, { pageMargins: "x" })).toEqual(DOC_WIDE);
    expect(resolveSectionPageConfig(DOC_WIDE, { pageMargins: null })).toEqual(DOC_WIDE);
  });

  it("content-size <= 0 (huge margins) → full docWide fallback", () => {
    // blockStart + blockEnd >= pageBlockSize ⇒ non-positive content area.
    // Even though the override block-size is valid on its own, the combination
    // is unusable, so we fall back entirely.
    const cfg = resolveSectionPageConfig(DOC_WIDE, {
      pageMargins: { blockStart: 500, blockEnd: 500 },
    });
    expect(cfg).toEqual(DOC_WIDE);
  });

  it("content-size <= 0 via overridden tiny pageBlockSize → full docWide fallback", () => {
    // Tiny block-size with docWide's 120px combined block margins ⇒ negative.
    const cfg = resolveSectionPageConfig(DOC_WIDE, { pageBlockSize: 50 });
    expect(cfg).toEqual(DOC_WIDE);
  });

  it("content-size exactly 0 → fallback (strictly positive required)", () => {
    // pageBlockSize 120, blockStart+blockEnd = 120 ⇒ content size 0.
    const cfg = resolveSectionPageConfig(DOC_WIDE, { pageBlockSize: 120 });
    expect(cfg).toEqual(DOC_WIDE);
  });

  it("INLINE content-size <= 0 (huge inline margins) → full docWide fallback", () => {
    // inlineStart + inlineEnd >= pageInlineSize ⇒ non-positive content inline
    // size; measurePass / makeVirtualLayoutTree throw on that, so fall back.
    const cfg = resolveSectionPageConfig(DOC_WIDE, {
      pageInlineSize: 100,
      pageMargins: { inlineStart: 60, inlineEnd: 60 },
    });
    expect(cfg).toEqual(DOC_WIDE);
  });

  it("does not mutate the input docWide or its margins", () => {
    const frozen: PageConfig = {
      ...DOC_WIDE,
      pageMargins: { ...DOC_WIDE.pageMargins },
    };
    const snapshot = JSON.stringify(frozen);
    resolveSectionPageConfig(frozen, { pageBlockSize: 1000, pageMargins: { inlineStart: 1 } });
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it("combined valid overrides (size + margins + gap) all apply together", () => {
    const cfg = resolveSectionPageConfig(DOC_WIDE, {
      pageBlockSize: 1000,
      pageInlineSize: 700,
      pageGap: 40,
      pageMargins: { blockStart: 50, inlineStart: 80 },
    });
    expect(cfg).toEqual({
      pageInlineSize: 700,
      pageBlockSize: 1000,
      pageGap: 40,
      pageMargins: { blockStart: 50, blockEnd: 60, inlineStart: 80, inlineEnd: 72 },
    });
  });
});

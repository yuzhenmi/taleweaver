import { describe, it, expect } from "vitest";
import type { ComputedStyle } from "@taleweaver/core";
import { createStandard14FontProvider } from "./font-provider";
import { PdfWriter } from "./pdf-writer";
import { parsePdf } from "./pdf-parse";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

function cs(partial: Partial<ComputedStyle>): ComputedStyle {
  // The provider reads only fontFamily/fontWeight/fontStyle; cast a minimal stub.
  return partial as ComputedStyle;
}

describe("standard-14 font provider", () => {
  it("resolves a plain sans family to Helvetica", () => {
    const p = createStandard14FontProvider();
    const h = p.resolveFont(cs({ fontFamily: "Inter, sans-serif", fontWeight: 400, fontStyle: "normal" }));
    expect(h.baseFont).toBe("Helvetica");
  });

  it("resolves bold + italic to the Bold-Oblique variant", () => {
    const p = createStandard14FontProvider();
    const h = p.resolveFont(cs({ fontFamily: "Arial", fontWeight: 700, fontStyle: "italic" }));
    expect(h.baseFont).toBe("Helvetica-BoldOblique");
  });

  it("detects the STRING fontWeight 'bold' (the cascade's literal) → Bold variant", () => {
    // ComputedStyle.fontWeight can be the literal string "bold" (cascade/
    // builtin-attrs.ts), NOT just a number. A numeric-only check would miss it.
    const p = createStandard14FontProvider();
    const h = p.resolveFont(cs({ fontFamily: "Arial", fontWeight: "bold", fontStyle: "normal" }));
    expect(h.baseFont).toBe("Helvetica-Bold");
  });

  it("resolves a serif family to Times", () => {
    const p = createStandard14FontProvider();
    const h = p.resolveFont(cs({ fontFamily: "Georgia, serif", fontWeight: 400, fontStyle: "normal" }));
    expect(h.baseFont).toBe("Times-Roman");
  });

  it("classifies a NAMED serif primary even with a sans-serif fallback", () => {
    // "Times, sans-serif" contains both "serif" and "sans"; the primary font is
    // Times (serif), so it must resolve to Times-Roman, not Helvetica. (Guards
    // against over-fixing the sans-serif misclassification.)
    const p = createStandard14FontProvider();
    const h = p.resolveFont(cs({ fontFamily: "Times, sans-serif", fontWeight: 400, fontStyle: "normal" }));
    expect(h.baseFont).toBe("Times-Roman");
  });

  it("exposes a per-program fontKey on a resolved handle", () => {
    const p = createStandard14FontProvider();
    const h = p.resolveFont(cs({ fontFamily: "Inter, sans-serif", fontWeight: 400, fontStyle: "normal" }));
    expect(h.fontKey).toBe("Helvetica");
  });

  it("writes a simple Type1 font object through the writeFontObjects seam", () => {
    const p = createStandard14FontProvider();
    const h = p.resolveFont(cs({ fontFamily: "Inter, sans-serif", fontWeight: 400, fontStyle: "normal" }));
    const w = new PdfWriter();
    const map = p.writeFontObjects([h], w);
    const id = map.get(h);
    expect(typeof id).toBe("number");
    // Close out a valid PDF so the object is parse-back-able.
    const cat = w.allocate();
    w.writeObject(cat, "<< /Type /Catalog >>");
    const pdf = parsePdf(w.finish(cat));
    const body = id === undefined ? null : pdf.object(id);
    expect(body).not.toBeNull();
    expect(body ?? "").toContain("/Type /Font");
    expect(body ?? "").toContain("/Subtype /Type1");
    expect(body ?? "").toContain("/BaseFont /Helvetica");
    expect(body ?? "").toContain("/Encoding /WinAnsiEncoding");
  });

  it("encodes a run into one cluster per code point, ASCII bytes", () => {
    const p = createStandard14FontProvider();
    const h = p.resolveFont(cs({ fontFamily: "sans", fontWeight: 400, fontStyle: "normal" }));
    const { clusters, dropped } = p.encodeRun(h, "AB");
    expect(clusters).toHaveLength(2);
    expect(Array.from(nth(clusters, 0, "cluster").bytes)).toEqual([0x41]);
    expect(Array.from(nth(clusters, 1, "cluster").bytes)).toEqual([0x42]);
    expect(dropped).toBe(0);
  });
});

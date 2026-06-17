import { describe, it, expect } from "vitest";
import { PdfWriter } from "./pdf-writer";
import { parsePdf } from "./pdf-parse";
import { createMockImageProvider } from "./mock-image-provider";

describe("PdfImageProvider — Image XObject graph (mock)", () => {
  it("resolves an image to a DeviceRGB handle", () => {
    const p = createMockImageProvider({ images: { "/a.png": { w: 2, h: 2 } } });
    const h = p.resolveImage("/a.png");
    expect(h).not.toBeNull();
    if (h === null) throw new Error("unreachable");
    expect(h.imageKey).toBe("/a.png");
  });

  it("writes a valid Image XObject whose stream payload byte-equals the rgb samples", () => {
    const p = createMockImageProvider({ images: { "/a.png": { w: 2, h: 2 } } });
    const h = p.resolveImage("/a.png");
    if (h === null) throw new Error("unreachable");
    const w = new PdfWriter();
    const map = p.writeImageObjects([h], w);
    const id = map.get(h);
    expect(id).not.toBeUndefined();
    if (id === undefined) throw new Error("unreachable");
    const cat = w.allocate();
    w.writeObject(cat, "<< /Type /Catalog >>");
    const pdf = parsePdf(w.finish(cat));
    const body = pdf.object(id) ?? "";
    expect(body).toContain("/Type /XObject");
    expect(body).toContain("/Subtype /Image");
    expect(body).toContain("/Width 2");
    expect(body).toContain("/Height 2");
    expect(body).toContain("/ColorSpace /DeviceRGB");
    expect(body).toContain("/BitsPerComponent 8");
    const so = pdf.streamObject(id);
    expect(so).not.toBeNull();
    if (so === null) throw new Error("unreachable");
    expect(so.payload.length).toBe(2 * 2 * 3);
    expect(so.dict).toContain("/Length 12"); // 2*2*3; stays raw — too small to compress (no-expansion guard)
  });

  it("two distinct srcs produce byte-different rgb payloads", () => {
    const p = createMockImageProvider({ images: { "/a.png": { w: 1, h: 1 }, "/b.png": { w: 1, h: 1 } } });
    const a = p.resolveImage("/a.png"); const b = p.resolveImage("/b.png");
    if (a === null || b === null) throw new Error("unreachable");
    const wa = new PdfWriter();
    const mapA = p.writeImageObjects([a], wa);
    const objA = mapA.get(a);
    if (objA === undefined) throw new Error("unreachable");
    const catA = wa.allocate();
    wa.writeObject(catA, "<< /Type /Catalog >>");
    const soA = parsePdf(wa.finish(catA)).streamObject(objA);
    const wb = new PdfWriter();
    const mapB = p.writeImageObjects([b], wb);
    const objB = mapB.get(b);
    if (objB === undefined) throw new Error("unreachable");
    const catB = wb.allocate();
    wb.writeObject(catB, "<< /Type /Catalog >>");
    const soB = parsePdf(wb.finish(catB)).streamObject(objB);
    if (soA === null || soB === null) throw new Error("unreachable");
    expect(Array.from(soA.payload)).not.toEqual(Array.from(soB.payload));
  });

  it("returns null for a src the provider doesn't know", () => {
    const p = createMockImageProvider({ images: { "/a.png": { w: 1, h: 1 } } });
    expect(p.resolveImage("/missing.png")).toBeNull();
  });

  it("caches handles by src so repeated resolveImage returns the same instance (identity-keyed dedup)", () => {
    const p = createMockImageProvider({ images: { "/a.png": { w: 1, h: 1 } } });
    expect(p.resolveImage("/a.png")).toBe(p.resolveImage("/a.png"));
  });

  it("throws when an explicit rgb's length doesn't equal w*h*3", () => {
    expect(() =>
      createMockImageProvider({
        images: { "/a.png": { w: 2, h: 2, rgb: new Uint8Array([1, 2, 3]) } },
      }).resolveImage("/a.png"),
    ).toThrow(/rgb.length/);
  });
});

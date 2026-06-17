import { describe, it, expect } from "vitest";
import { PdfWriter } from "./pdf-writer";
import { parsePdf } from "./pdf-parse";
import { createImageProvider } from "./image-provider-impl";
import { MalformedImageError } from "./image-errors";
import { buildPng } from "./test-support/png-fixtures";

/** An 8x8 RGBA PNG (filter 0), constant RGB (10,20,30), alpha = column*32 each
 *  row → compresses (so the main image gets /Filter /FlateDecode) and gives a
 *  deterministic SMask. */
function rgbaPng(): { png: Uint8Array; rgb: number[]; alpha: number[] } {
  const W = 8, H = 8;
  const rows: number[] = [];
  const rgb: number[] = [];
  const alpha: number[] = [];
  for (let y = 0; y < H; y++) {
    rows.push(0); // filter None
    for (let x = 0; x < W; x++) {
      const a = x * 32;
      rows.push(10, 20, 30, a);
      rgb.push(10, 20, 30);
      alpha.push(a);
    }
  }
  return { png: buildPng({ width: W, height: H, bitDepth: 8, colorType: 6, scanlines: Uint8Array.from(rows) }), rgb, alpha };
}

const RGB_3x2 = Uint8Array.of(
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03,
  0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
);
const CMYK_ADOBE_1x1 = Uint8Array.of(
  0xff, 0xd8,
  0xff, 0xee, 0x00, 0x0e, 0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x02,
  0xff, 0xc0, 0x00, 0x12, 0x08, 0x00, 0x01, 0x00, 0x01, 0x04,
  0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0x04, 0x11, 0x01,
  0xff, 0xd9,
);
/** Resolve a src, write its XObject through a fresh PdfWriter, return the parsed object id + pdf. */
function embedOne(provider: ReturnType<typeof createImageProvider>, src: string) {
  const h = provider.resolveImage(src);
  if (h === null) throw new Error("expected a handle");
  const w = new PdfWriter();
  const map = provider.writeImageObjects([h], w);
  const id = map.get(h);
  if (id === undefined) throw new Error("expected an object id");
  const cat = w.allocate();
  w.writeObject(cat, "<< /Type /Catalog >>");
  return { pdf: parsePdf(w.finish(cat)), id };
}

describe("createImageProvider — JPEG /DCTDecode embed", () => {
  it("embeds an RGB JPEG as a DCTDecode Image XObject (right dict + verbatim bytes)", () => {
    const { pdf, id } = embedOne(createImageProvider({ images: new Map([["photo.jpg", RGB_3x2]]) }), "photo.jpg");
    const body = pdf.object(id) ?? "";
    expect(body).toContain("/Subtype /Image");
    expect(body).toContain("/Width 3");
    expect(body).toContain("/Height 2");
    expect(body).toContain("/ColorSpace /DeviceRGB");
    expect(body).toContain("/BitsPerComponent 8");
    expect(body).toContain("/Filter /DCTDecode");
    const so = pdf.streamObject(id);
    if (so === null) throw new Error("no image stream");
    expect([...so.payload]).toEqual([...RGB_3x2]); // verbatim — T1 guard skips re-compression
  });

  it("embeds an Adobe CMYK JPEG with /ColorSpace /DeviceCMYK + /Decode inversion", () => {
    const { pdf, id } = embedOne(createImageProvider({ images: new Map([["c.jpg", CMYK_ADOBE_1x1]]) }), "c.jpg");
    const body = pdf.object(id) ?? "";
    expect(body).toContain("/ColorSpace /DeviceCMYK");
    expect(body).toContain("/Decode [1 0 1 0 1 0 1 0]");
    expect(body).toContain("/Filter /DCTDecode");
  });

  it("returns null for an absent src (→ grey placeholder, unchanged)", () => {
    expect(createImageProvider({ images: new Map() }).resolveImage("missing.jpg")).toBeNull();
  });

  it("returns null for a genuinely unrecognized format (GIF magic) — grey placeholder", () => {
    const gif = Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // "GIF89a"
    expect(createImageProvider({ images: new Map([["x.gif", gif]]) }).resolveImage("x.gif")).toBeNull();
  });

  it("throws (MalformedImageError) on a recognized-but-malformed PNG (bare signature, no IHDR)", () => {
    const bare = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    const provider = createImageProvider({ images: new Map([["bad.png", bare]]) });
    expect(() => provider.resolveImage("bad.png")).toThrow(MalformedImageError);
  });

  it("throws at resolve time on a MALFORMED JPEG (loud failure on a format we support)", () => {
    // JPEG magic (FF D8 FF) but a truncated SOF segment → parseJpeg throws.
    const bad = Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0x00, 0xff);
    const provider = createImageProvider({ images: new Map([["bad.jpg", bad]]) });
    expect(() => provider.resolveImage("bad.jpg")).toThrow(/jpeg|past the end|truncat/i);
  });
});

describe("createImageProvider — PNG /FlateDecode embed", () => {
  it("embeds an RGBA PNG as a FlateDecode Image XObject + a DeviceGray SMask", () => {
    const { png, rgb, alpha } = rgbaPng();
    const provider = createImageProvider({ images: new Map([["a.png", png]]) });
    const h = provider.resolveImage("a.png");
    if (h === null) throw new Error("expected a handle");
    const w = new PdfWriter();
    const map = provider.writeImageObjects([h], w);
    // M2 discharge: exactly ONE mapped object per handle (the main image). The
    // SMask is written as a SEPARATE object but is NOT a map value, so the
    // page-emitter — which builds `/Resources /XObject` SOLELY from this map keyed
    // by imageKey (page-emitter.ts) — structurally cannot place the SMask in page
    // resources. (The page-emitter's own resource-dict build is covered by
    // page-emitter.test.ts; this assertion is M2 expressed at the provider seam.)
    expect(map.size).toBe(1);
    const id = map.get(h);
    if (id === undefined) throw new Error("expected an object id");
    const cat = w.allocate();
    w.writeObject(cat, "<< /Type /Catalog >>");
    const pdf = parsePdf(w.finish(cat));

    const body = pdf.object(id) ?? "";
    expect(body).toContain("/Subtype /Image");
    expect(body).toContain("/Width 8");
    expect(body).toContain("/Height 8");
    expect(body).toContain("/ColorSpace /DeviceRGB");
    expect(body).toContain("/BitsPerComponent 8");
    expect(body).toContain("/Filter /FlateDecode");

    // The /SMask reference points at a SEPARATE object id (NOT the mapped main id).
    const sm = body.match(/\/SMask (\d+) 0 R/);
    if (sm === null) throw new Error("expected an /SMask reference");
    const smaskId = Number(sm[1]);
    expect(smaskId).not.toBe(id);
    const smaskBody = pdf.object(smaskId) ?? "";
    expect(smaskBody).toContain("/ColorSpace /DeviceGray");
    expect(smaskBody).toContain("/BitsPerComponent 8");

    // Stream payloads (transparently inflated) byte-equal the decoded planes.
    const mainSo = pdf.streamObject(id);
    const smaskSo = pdf.streamObject(smaskId);
    if (mainSo === null || smaskSo === null) throw new Error("missing stream payloads");
    expect([...mainSo.payload]).toEqual(rgb);
    expect([...smaskSo.payload]).toEqual(alpha);
  });

  it("embeds a palette PNG with /Indexed colorspace", () => {
    const png = buildPng({
      width: 2, height: 1, bitDepth: 8, colorType: 3,
      palette: Uint8Array.of(255, 0, 0, 0, 255, 0),
      scanlines: Uint8Array.of(0, 1, 0),
    });
    const provider = createImageProvider({ images: new Map([["p.png", png]]) });
    const h = provider.resolveImage("p.png");
    if (h === null) throw new Error("expected a handle");
    const w = new PdfWriter();
    const id = provider.writeImageObjects([h], w).get(h);
    if (id === undefined) throw new Error("expected an object id");
    const cat = w.allocate();
    w.writeObject(cat, "<< /Type /Catalog >>");
    const body = parsePdf(w.finish(cat)).object(id) ?? "";
    expect(body).toContain("/ColorSpace [/Indexed /DeviceRGB 1 <FF000000FF00>]");
  });

  it("embeds a grayscale-tRNS PNG with a native-space color-key /Mask", () => {
    // 8-bit grayscale, tRNS gray = 200 (low byte of the 2-byte field) → /Mask [200 200].
    const png = buildPng({
      width: 1, height: 1, bitDepth: 8, colorType: 0,
      trns: Uint8Array.of(0, 200),
      scanlines: Uint8Array.of(0, 123),
    });
    const provider = createImageProvider({ images: new Map([["k.png", png]]) });
    const h = provider.resolveImage("k.png");
    if (h === null) throw new Error("expected a handle");
    const w = new PdfWriter();
    const id = provider.writeImageObjects([h], w).get(h);
    if (id === undefined) throw new Error("expected an object id");
    const cat = w.allocate();
    w.writeObject(cat, "<< /Type /Catalog >>");
    const body = parsePdf(w.finish(cat)).object(id) ?? "";
    expect(body).toContain("/ColorSpace /DeviceGray");
    expect(body).toContain("/Mask [200 200]");
    expect(body).not.toContain("/SMask"); // color-key, not a soft mask
  });

  it("caches handles so repeated resolveImage returns the same instance (JPEG and PNG)", () => {
    const { png } = rgbaPng();
    const provider = createImageProvider({ images: new Map([["a.png", png], ["b.jpg", RGB_3x2]]) });
    expect(provider.resolveImage("a.png")).toBe(provider.resolveImage("a.png"));
    expect(provider.resolveImage("b.jpg")).toBe(provider.resolveImage("b.jpg"));
    expect(provider.resolveImage("absent.png")).toBe(provider.resolveImage("absent.png")); // both null
  });
});

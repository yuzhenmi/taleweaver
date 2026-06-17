import { describe, it, expect } from "vitest";
import { PdfWriter } from "./pdf-writer";
import { parsePdf } from "./pdf-parse";

describe("parsePdf streamObject", () => {
  it("extracts a stream payload by /Length even when it contains 'endobj' bytes", () => {
    const w = new PdfWriter();
    const id = w.allocate();
    // bytes: 1, 2, 255, then ASCII "endobj" (0x65 0x6e 0x64 0x6f 0x62 0x6a), then 7 — 10 bytes total
    const payload = new Uint8Array([1, 2, 255, 0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 7]);
    w.writeStream(id, "<< /Length1 10 >>", payload);
    const cat = w.allocate();
    w.writeObject(cat, "<< /Type /Catalog >>");
    const pdf = w.finish(cat);

    const so = parsePdf(pdf).streamObject(id);
    expect(so).not.toBeNull();
    if (so === null) throw new Error("unreachable"); // narrow for TS without `!`
    expect(Array.from(so.payload)).toEqual([1, 2, 255, 0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 7]);
    expect(so.dict).toContain("/Length1 10");
    expect(so.dict).toContain("/Length 10"); // stays raw — too small to compress (no-expansion guard)
  });

  it("returns null for a missing object", () => {
    const w = new PdfWriter();
    const cat = w.allocate();
    w.writeObject(cat, "<< /Type /Catalog >>");
    const pdf = w.finish(cat);
    expect(parsePdf(pdf).streamObject(999)).toBeNull();
  });

  it("returns null for a non-stream object (even when a stream object follows it)", () => {
    const w = new PdfWriter();
    const plain = w.allocate();
    // A plain object that legally carries a `/Length` key (e.g. a font descriptor).
    // The old code parsed this `/Length`, then forward-searched for `stream\n` and
    // wrongly latched onto the LATER stream object's payload → non-null. A non-stream
    // object must return null.
    w.writeObject(plain, "<< /Type /FontDescriptor /Length 3 >>");
    const streamId = w.allocate();
    w.writeStream(streamId, "<< /Type /XObject >>", new Uint8Array([9, 8, 7]));
    const pdf = w.finish(plain);

    expect(parsePdf(pdf).streamObject(plain)).toBeNull();
  });

  it("does not match a one-digit id inside a larger id (false-id boundary)", () => {
    const w = new PdfWriter();
    // Allocate enough objects that both id 2 (one digit) and id 12 (two digits) exist.
    const ids: number[] = [];
    for (let i = 0; i < 13; i++) {
      ids.push(w.allocate());
    }
    // ids are 1..13. Write distinct stream payloads at id 2 and id 12.
    const payload2 = new Uint8Array([2, 2, 2, 2]);
    const payload12 = new Uint8Array([12, 12, 12]);
    for (const id of ids) {
      if (id === 2) {
        w.writeStream(id, "<< /Type /XObject >>", payload2);
      } else if (id === 12) {
        w.writeStream(id, "<< /Type /XObject >>", payload12);
      } else {
        // Filler so every allocated id is written before finish().
        w.writeObject(id, "<< /Type /Catalog >>");
      }
    }
    const pdf = w.finish(1);
    const parsed = parsePdf(pdf);

    const so2 = parsed.streamObject(2);
    const so12 = parsed.streamObject(12);
    expect(so2).not.toBeNull();
    expect(so12).not.toBeNull();
    if (so2 === null || so12 === null) throw new Error("unreachable");
    expect(Array.from(so2.payload)).toEqual([2, 2, 2, 2]);
    expect(Array.from(so12.payload)).toEqual([12, 12, 12]);
    expect(Array.from(so2.payload)).not.toEqual(Array.from(so12.payload));
  });

  it("handles a nested dict (balanced `>>`) without truncating the dict", () => {
    const w = new PdfWriter();
    const id = w.allocate();
    const payload = new Uint8Array([42, 0, 255, 17]);
    w.writeStream(id, "<< /DecodeParms << /Predictor 12 >> >>", payload);
    const cat = w.allocate();
    w.writeObject(cat, "<< /Type /Catalog >>");
    const pdf = w.finish(cat);

    const so = parsePdf(pdf).streamObject(id);
    expect(so).not.toBeNull();
    if (so === null) throw new Error("unreachable");
    expect(Array.from(so.payload)).toEqual([42, 0, 255, 17]);
    expect(so.dict).toContain("/DecodeParms");
    expect(so.dict).toContain("/Predictor 12");
    // The dict must be the FULL balanced `<< ... >>` — not truncated at the inner
    // `>>`. With the old first-`>>` logic, dict ended after `/Predictor 12 >>`,
    // leaving the outer `<<` unclosed (counts 2 `<<` vs 1 `>>`).
    const opens = (so.dict.match(/<</g) ?? []).length;
    const closes = (so.dict.match(/>>/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(so.dict.startsWith("<<")).toBe(true);
    expect(so.dict.endsWith(">>")).toBe(true);
  });
});

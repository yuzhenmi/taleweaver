import { describe, it, expect } from "vitest";
import { PdfWriter, decodeLatin1, pdfString, pdfTextString } from "./pdf-writer";
import { parsePdf } from "./pdf-parse";

const decode = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

describe("PdfWriter", () => {
  it("allocates sequential object numbers starting at 1", () => {
    const w = new PdfWriter();
    expect(w.allocate()).toBe(1);
    expect(w.allocate()).toBe(2);
  });

  it("emits a header, a dictionary object, xref, and trailer", () => {
    const w = new PdfWriter();
    const id = w.allocate();
    w.writeObject(id, "<< /Type /Catalog >>");
    const bytes = w.finish(id);
    const s = decode(bytes);
    expect(s.startsWith("%PDF-1.7")).toBe(true);
    expect(s).toContain("1 0 obj");
    expect(s).toContain("<< /Type /Catalog >>");
    expect(s).toContain("endobj");
    expect(s).toContain("xref");
    expect(s).toContain("trailer");
    expect(s).toContain("/Root 1 0 R");
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("writes a stream object with a correct /Length", () => {
    const w = new PdfWriter();
    const id = w.allocate();
    const content = new TextEncoder().encode("BT ET");
    w.writeStream(id, "<< >>", content);
    const bytes = w.finish(id);
    const s = decode(bytes);
    expect(s).toContain("/Length 5"); // stays raw — too small to compress (no-expansion guard)
    expect(s).toContain("stream\nBT ET\nendstream");
  });

  it("xref offsets point at the start of each object", () => {
    const w = new PdfWriter();
    const a = w.allocate();
    const b = w.allocate();
    w.writeObject(a, "<< /A 1 >>");
    w.writeObject(b, "<< /B 2 >>");
    const bytes = w.finish(a);
    const s = decode(bytes);
    // The xref subsection header declares (count+1) entries: the free obj 0 + ours.
    expect(s).toContain("xref\n0 3\n");
    // object b's declared offset must equal the byte index of "2 0 obj"
    const off = s.indexOf("2 0 obj");
    const xrefBody = s.slice(s.indexOf("xref\n0 3\n") + "xref\n0 3\n".length);
    const lines = xrefBody.split("\n");
    // line 0 = free entry (object 0); line 1 = obj 1; line 2 = obj 2.
    const obj2Line = lines[2];
    expect(obj2Line).toBe(String(off).padStart(10, "0") + " 00000 n ");
  });

  it("throws if an allocated object id is never written (would emit a dangling xref entry)", () => {
    const w = new PdfWriter();
    const a = w.allocate();
    w.allocate(); // id 2 allocated but never written → a gap
    w.writeObject(a, "<< /A 1 >>");
    expect(() => w.finish(a)).toThrow(/object 2 was allocated but never written/);
  });

  it("throws on a duplicate object-id write", () => {
    const w = new PdfWriter();
    const a = w.allocate();
    w.writeObject(a, "<< /A 1 >>");
    expect(() => w.writeObject(a, "<< /A 2 >>")).toThrow(/written more than once/);
  });

  it("throws when a stream dictBody does not start with '<<'", () => {
    const w = new PdfWriter();
    const a = w.allocate();
    expect(() => w.writeStream(a, "/Type /XObject >>", new Uint8Array())).toThrow(/must start with/);
  });

  it("throws on a non-Latin1 code unit in a PDF syntax string", () => {
    const w = new PdfWriter();
    const a = w.allocate();
    // U+2026 (…) is > 0xFF — would silently truncate without the guard.
    expect(() => w.writeObject(a, "<< /Title (caf…) >>")).toThrow(RangeError);
  });

  it("decodeLatin1 round-trips every byte (incl. 0x80–0x9F) byte-identically", () => {
    // ISO-8859-1, NOT windows-1252: bytes 0x80–0x9F must map to the SAME code
    // points, not be remapped (e.g. 0x84 → U+201E). A windows-1252 decode here
    // would corrupt an embedded FontFile2 payload (real font bytes span 0x80–0x9F).
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    const decoded = decodeLatin1(all);
    expect(decoded.length).toBe(256);
    for (let i = 0; i < 256; i++) expect(decoded.charCodeAt(i)).toBe(i);
    // The previously-corrupted window, explicitly:
    expect(decodeLatin1(new Uint8Array([0x80, 0x84, 0x9f])).split("").map((c) => c.charCodeAt(0))).toEqual([
      0x80, 0x84, 0x9f,
    ]);
  });
});

describe("writeStream — FlateDecode compression", () => {
  it("compresses a large repetitive stream: /Filter present, /Length smaller, inflates back", () => {
    const content = new TextEncoder().encode("BT /F1 12 Tf (hello) Tj ET\n".repeat(200));
    const w = new PdfWriter();
    const sid = w.allocate();
    w.writeStream(sid, "<< >>", content);
    const rootId = w.allocate();
    w.writeObject(rootId, "<< /Type /Catalog >>");
    const pdf = parsePdf(w.finish(rootId));
    const so = pdf.streamObject(sid);
    if (so === null) throw new Error("no stream object");
    expect(so.dict).toContain("/Filter /FlateDecode");
    expect(so.dict).toMatch(/\/Length \d+/);
    // streamObject inflates transparently → payload === the original content.
    expect([...so.payload]).toEqual([...content]);
  });

  it("does NOT compress a tiny/incompressible stream (no /Filter, raw payload)", () => {
    const content = Uint8Array.of(1, 2, 3, 4, 5);
    const w = new PdfWriter();
    const sid = w.allocate();
    w.writeStream(sid, "<< >>", content);
    const rootId = w.allocate();
    w.writeObject(rootId, "<< /Type /Catalog >>");
    const pdf = parsePdf(w.finish(rootId));
    const so = pdf.streamObject(sid);
    if (so === null) throw new Error("no stream object");
    expect(so.dict).not.toContain("/Filter");
    expect(so.dict).toContain("/Length 5");
    expect([...so.payload]).toEqual([1, 2, 3, 4, 5]);
  });

  it("preserves caller-set dict keys (e.g. /Length1) alongside the injected /Filter", () => {
    const content = new TextEncoder().encode("X".repeat(500));
    const w = new PdfWriter();
    const sid = w.allocate();
    w.writeStream(sid, "<< /Length1 500 >>", content);
    const rootId = w.allocate();
    w.writeObject(rootId, "<< /Type /Catalog >>");
    const pdf = parsePdf(w.finish(rootId));
    const so = pdf.streamObject(sid);
    if (so === null) throw new Error("no stream object");
    expect(so.dict).toContain("/Length1 500"); // UNCHANGED (uncompressed length)
    expect(so.dict).toContain("/Filter /FlateDecode");
    expect([...so.payload]).toEqual([...content]);
  });
});

describe("writeStream — caller-declared /Filter", () => {
  it("embeds a pre-filtered stream verbatim (no re-compression, /Length = raw)", () => {
    // A repetitive payload that WOULD FlateDecode-compress if the writer touched it.
    const content = new TextEncoder().encode("X".repeat(500));
    const w = new PdfWriter();
    const sid = w.allocate();
    w.writeStream(sid, "<< /Type /XObject /Subtype /Image /Filter /DCTDecode >>", content);
    const rootId = w.allocate();
    w.writeObject(rootId, "<< /Type /Catalog >>");
    const pdf = parsePdf(w.finish(rootId));
    const so = pdf.streamObject(sid);
    if (so === null) throw new Error("no stream object");
    expect(so.dict).toContain("/Filter /DCTDecode"); // caller's filter preserved
    expect(so.dict).not.toContain("/FlateDecode"); // writer did NOT add its own
    expect(so.dict).toContain("/Length 500"); // raw length, not compressed
    expect([...so.payload]).toEqual([...content]); // verbatim (streamObject does NOT inflate a non-Flate filter)
  });

  it("still FlateDecode-compresses a stream with NO caller /Filter (d.2 behavior intact)", () => {
    const content = new TextEncoder().encode("Y".repeat(500));
    const w = new PdfWriter();
    const sid = w.allocate();
    w.writeStream(sid, "<< >>", content);
    const rootId = w.allocate();
    w.writeObject(rootId, "<< /Type /Catalog >>");
    const pdf = parsePdf(w.finish(rootId));
    const so = pdf.streamObject(sid);
    if (so === null) throw new Error("no stream object");
    expect(so.dict).toContain("/Filter /FlateDecode");
    expect([...so.payload]).toEqual([...content]); // streamObject inflates transparently
  });
});

describe("pdfString", () => {
  it("wraps in parens and escapes backslash + parens", () => {
    expect(pdfString("a")).toBe("(a)");
    expect(pdfString("a(b)c")).toBe("(a\\(b\\)c)");
    expect(pdfString("a\\b")).toBe("(a\\\\b)");
    expect(pdfString("https://x.com/p?q=1")).toBe("(https://x.com/p?q=1)");
  });
});

describe("pdfTextString", () => {
  it("emits a Latin-1 literal for ASCII (paren-escaped)", () => {
    expect(pdfTextString("Chapter (1)")).toBe("(Chapter \\(1\\))");
  });

  it("keeps a pure-Latin-1 accented char (U+00E9 ≤ 0xFF) as a literal (boundary at 0xFF)", () => {
    expect(pdfTextString("é")).toBe("(é)");
  });

  it("emits UTF-16BE hex with a BOM for non-Latin-1 (CJK)", () => {
    // 中文 = U+4E2D U+6587
    expect(pdfTextString("中文")).toBe("<FEFF4E2D6587>");
  });

  it("encodes an astral char as its UTF-16 surrogate pair", () => {
    // U+1F600 = surrogate pair D83D DE00
    expect(pdfTextString("\u{1F600}")).toBe("<FEFFD83DDE00>");
  });
});

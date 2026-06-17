import { describe, it, expect } from "vitest";
import { PdfWriter, decodeLatin1 } from "./pdf-writer";
import { parsePdf } from "./pdf-parse";
import {
  writeCompositeFontObjects,
  sanitizePdfName,
  type CompositeFontData,
} from "./composite-font";

/** A minimal, deterministic CompositeFontData for the graph-emission unit test. */
function makeData(): CompositeFontData {
  return {
    baseFont: "AAAAAA+TestFont",
    programBytes: Uint8Array.of(0x00, 0x01, 0x00, 0x00, 0x54, 0x45, 0x53, 0x54), // "\0\1\0\0TEST"
    descriptor: {
      flags: 32,
      fontBBox: [-200, -250, 1000, 900],
      italicAngle: 0,
      ascent: 750,
      descent: -250,
      capHeight: 700,
      stemV: 80,
      fontName: "AAAAAA+TestFont",
    },
    widths: new Map([[65, 540]]),
    defaultWidth: 1000,
    cidToUnicode: new Map([[65, "A"]]),
    embed: { kind: "truetype" },
  };
}

describe("writeCompositeFontObjects (shared composite-font object graph)", () => {
  it("writes a Type0/CIDFontType2 graph with embedded FontFile2, /W, descriptor, ToUnicode", () => {
    const data = makeData();
    const writer = new PdfWriter();
    const t0Id = writeCompositeFontObjects(data, writer);

    // The writer requires a /Root + that root be written; emit a trivial catalog
    // so finish() does not throw on the unwritten-allocated-object guard.
    const rootId = writer.allocate();
    writer.writeObject(rootId, "<< /Type /Catalog >>");
    const pdf = parsePdf(writer.finish(rootId));

    // --- Type0 root font ---
    const t0 = pdf.object(t0Id) ?? "";
    expect(t0).toContain("/Type /Font");
    expect(t0).toContain("/Subtype /Type0");
    expect(t0).toContain("/Encoding /Identity-H");
    expect(t0).toMatch(/\/DescendantFonts \[\d+ 0 R\]/);
    expect(t0).toMatch(/\/ToUnicode \d+ 0 R/);
    expect(t0).toContain("/BaseFont /AAAAAA+TestFont");

    // --- CIDFontType2 descendant ---
    const descM = t0.match(/\/DescendantFonts \[(\d+) 0 R\]/);
    expect(descM).not.toBeNull();
    const descId = Number(descM?.[1]);
    const desc = pdf.object(descId) ?? "";
    expect(desc).toContain("/Type /Font");
    expect(desc).toContain("/Subtype /CIDFontType2");
    expect(desc).toContain("/CIDToGIDMap /Identity");
    expect(desc).toMatch(
      /\/CIDSystemInfo << \/Registry \(Adobe\) \/Ordering \(Identity\) \/Supplement 0 >>/,
    );
    expect(desc).toMatch(/\/FontDescriptor \d+ 0 R/);
    expect(desc).toMatch(/\/DW 1000/);
    // /W array in the per-cid `[ cid [w] ]` form — same regex embedded-font.test validates.
    expect(desc).toMatch(/\/W \[[^\n]*\b65 \[540\]/);

    // --- FontDescriptor ---
    const fdM = desc.match(/\/FontDescriptor (\d+) 0 R/);
    expect(fdM).not.toBeNull();
    const fdId = Number(fdM?.[1]);
    const fd = pdf.object(fdId) ?? "";
    expect(fd).toContain("/Type /FontDescriptor");
    expect(fd).toContain("/FontName /AAAAAA+TestFont");
    expect(fd).toMatch(/\/Flags 32/);
    expect(fd).toMatch(/\/FontBBox \[-200 -250 1000 900\]/);
    expect(fd).toContain("/ItalicAngle 0");
    expect(fd).toMatch(/\/Ascent 750/);
    expect(fd).toMatch(/\/Descent -250/);
    expect(fd).toMatch(/\/CapHeight 700/);
    expect(fd).toMatch(/\/StemV 80/);
    expect(fd).toMatch(/\/FontFile2 \d+ 0 R/);

    // --- FontFile2 stream: payload byte-equals programBytes, /Length1 present ---
    const ffM = fd.match(/\/FontFile2 (\d+) 0 R/);
    expect(ffM).not.toBeNull();
    const ffId = Number(ffM?.[1]);
    const ff = pdf.streamObject(ffId);
    expect(ff).not.toBeNull();
    expect(ff?.dict).toContain(`/Length1 ${data.programBytes.length}`);
    expect(ff?.payload).toEqual(data.programBytes);

    // --- ToUnicode stream: maps cid 65 → "A" (<0041> <0041>) ---
    const tuM = t0.match(/\/ToUnicode (\d+) 0 R/);
    expect(tuM).not.toBeNull();
    const tuId = Number(tuM?.[1]);
    const tu = pdf.streamObject(tuId);
    expect(tu).not.toBeNull();
    const tuText = decodeLatin1(tu?.payload ?? new Uint8Array());
    expect(tuText).toContain("begincmap");
    expect(tuText).toContain("<0000> <FFFF>");
    expect(tuText).toContain("<0041> <0041>");
  });

  it("accepts a non-zero italicAngle (the type is `number`, not `0`)", () => {
    const data: CompositeFontData = { ...makeData(), descriptor: { ...makeData().descriptor, italicAngle: -12 } };
    const writer = new PdfWriter();
    const t0Id = writeCompositeFontObjects(data, writer);
    const rootId = writer.allocate();
    writer.writeObject(rootId, "<< /Type /Catalog >>");
    const pdf = parsePdf(writer.finish(rootId));
    const t0 = pdf.object(t0Id) ?? "";
    const descId = Number(t0.match(/\/DescendantFonts \[(\d+) 0 R\]/)?.[1]);
    const desc = pdf.object(descId) ?? "";
    const fdId = Number(desc.match(/\/FontDescriptor (\d+) 0 R/)?.[1]);
    const fd = pdf.object(fdId) ?? "";
    expect(fd).toContain("/ItalicAngle -12");
  });

  it("escapes PDF Name delimiters in baseFont/fontName (no syntax injection)", () => {
    // sanitizePdfName unit: regular chars pass through; delimiters/whitespace/'#'
    // and non-ASCII become #HH per PDF §7.3.5.
    expect(sanitizePdfName("Plain-Font_1.0")).toBe("Plain-Font_1.0");
    expect(sanitizePdfName("Evil) /Type /Catalog")).toBe("Evil#29#20#2FType#20#2FCatalog");
    expect(sanitizePdfName("a#b")).toBe("a#23b");

    // A hostile font name carrying a `)` + `>>` must NOT break the dict syntax:
    // the emitted /BaseFont and /FontName are escaped, and the graph still parses.
    const hostile = "X)>> /Evil";
    const data: CompositeFontData = {
      ...makeData(),
      baseFont: hostile,
      descriptor: { ...makeData().descriptor, fontName: hostile },
    };
    const writer = new PdfWriter();
    const t0Id = writeCompositeFontObjects(data, writer);
    const rootId = writer.allocate();
    writer.writeObject(rootId, "<< /Type /Catalog >>");
    const pdf = parsePdf(writer.finish(rootId));
    const t0 = pdf.object(t0Id) ?? "";
    const escaped = sanitizePdfName(hostile); // "X#29#3E#3E#20#2FEvil"
    expect(t0).toContain(`/BaseFont /${escaped}`);
    // The raw injection string must NOT appear verbatim anywhere in the Type0 dict.
    expect(t0).not.toContain(") >>");
    const descId = Number(t0.match(/\/DescendantFonts \[(\d+) 0 R\]/)?.[1]);
    const desc = pdf.object(descId) ?? "";
    expect(desc).toContain(`/BaseFont /${escaped}`);
    const fdId = Number(desc.match(/\/FontDescriptor (\d+) 0 R/)?.[1]);
    const fd = pdf.object(fdId) ?? "";
    expect(fd).toContain(`/FontName /${escaped}`);
  });

  it("CFF embed: emits CIDFontType0 + FontFile3 (/CIDFontType0C), no CIDToGIDMap, ROS CIDSystemInfo", () => {
    const writer = new PdfWriter();
    const data: CompositeFontData = {
      baseFont: "TestCFF",
      programBytes: Uint8Array.of(1, 0, 4, 1),
      descriptor: {
        flags: 4,
        fontBBox: [0, 0, 1000, 1000],
        italicAngle: 0,
        ascent: 800,
        descent: -200,
        capHeight: 700,
        stemV: 80,
        fontName: "TestCFF",
      },
      widths: new Map([[5, 600]]),
      defaultWidth: 1000,
      cidToUnicode: new Map([[5, "A"]]),
      embed: {
        kind: "cff",
        cidSystemInfo: { registry: "Adobe", ordering: "Identity", supplement: 0 },
      },
    };
    const t0Id = writeCompositeFontObjects(data, writer);
    const rootId = writer.allocate();
    writer.writeObject(rootId, "<< /Type /Catalog >>");
    const pdf = parsePdf(writer.finish(rootId));

    // Reach the CIDFontType0 descendant + FontDescriptor via the Type0 root's refs
    // (the same reference-following approach the TrueType graph test uses).
    const t0 = pdf.object(t0Id) ?? "";
    const cidBody = pdf.object(Number(t0.match(/\/DescendantFonts \[(\d+) 0 R\]/)?.[1])) ?? "";
    const fdBody = pdf.object(Number(cidBody.match(/\/FontDescriptor (\d+) 0 R/)?.[1])) ?? "";

    expect(cidBody).toMatch(/\/Subtype \/CIDFontType0\b/);
    expect(cidBody).not.toMatch(/CIDToGIDMap/);
    expect(cidBody).toMatch(
      /\/CIDSystemInfo << \/Registry \(Adobe\) \/Ordering \(Identity\) \/Supplement 0 >>/,
    );
    // per-CID widths still emitted on the CFF descendant (DW + the W array under CID 5).
    expect(cidBody).toMatch(/\/DW 1000/);
    expect(cidBody).toMatch(/\/W \[ 5 \[600\] \]/);
    expect(fdBody).toMatch(/\/FontFile3 \d+ 0 R/);
    expect(fdBody).not.toMatch(/\/FontFile2/);

    // FontFile3 stream carries /Subtype /CIDFontType0C and the raw program bytes,
    // and NOT /Length1 (that key is FontFile2-only).
    const ffId = Number(fdBody.match(/\/FontFile3 (\d+) 0 R/)?.[1]);
    const ff = pdf.streamObject(ffId);
    expect(ff).not.toBeNull();
    expect(ff?.dict).toContain("/Subtype /CIDFontType0C");
    expect(ff?.dict).not.toContain("/Length1");
    expect(ff?.payload).toEqual(data.programBytes);
  });
});

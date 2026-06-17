import type { PdfWriter } from "./pdf-writer";
import { pdfString } from "./pdf-writer";
import { buildToUnicodeCMap } from "./tounicode";

/**
 * The shared composite-font (Type0) object-graph writer. Both the mock
 * embedded-font provider (unit-test fixture) and the real font-backed providers
 * assemble a {@link CompositeFontData} from their own sources and call
 * {@link writeCompositeFontObjects}, guaranteeing they emit the BYTE-IDENTICAL
 * PDF object graph for a given input. The `embed` discriminator selects the
 * embedded-font organisation:
 *  - **TrueType** (`{kind:"truetype"}`): a FontFile2 stream (`/Length1` + raw
 *    sfnt bytes) → a CIDFontType2 descendant (`/CIDToGIDMap /Identity`, Identity
 *    `/CIDSystemInfo`).
 *  - **CFF** (`{kind:"cff"}`): a FontFile3 stream (`/Subtype /CIDFontType0C` +
 *    raw CFF bytes) → a CIDFontType0 descendant (NO `/CIDToGIDMap`, the font's
 *    own ROS in `/CIDSystemInfo`).
 *
 * Both branches share the rest of the graph: a real `/ToUnicode` CMap → a
 * FontDescriptor (the FontFile key differs) → the `/DW` + per-CID `/W` widths →
 * the Type0 root (`/Identity-H`, `/DescendantFonts`, `/ToUnicode`).
 *
 * All metrics are in 1000-unit em (font design) space — NOT px/pt.
 */

// The ToUnicode CMap and dict tokens are pure ASCII (a subset of UTF-8), so this
// is byte-exact.
const UTF8 = new TextEncoder();

// PDF §7.3.5 name-object delimiters + the `#` escape char — none may appear raw
// after `/` in a Name object.
const PDF_NAME_RESERVED = new Set(
  "()<>[]{}/%#".split("").map((c) => c.charCodeAt(0)),
);

/**
 * Escape a string into a PDF Name token body (the part after `/`), per PDF
 * §7.3.5. A Name's "regular characters" are the printable ASCII bytes 0x21–0x7E
 * minus the delimiters `()<>[]{}/%` and the `#` escape itself; every other byte
 * (whitespace, delimiter, control, and any non-ASCII — taken over the string's
 * UTF-8 bytes) is written as `#HH`. **Load-bearing for security:** the embedded
 * font's `baseFont`/`fontName` come from the untrusted sfnt `name` table, so a
 * malicious `.ttf` could otherwise inject PDF syntax (e.g. `)`/`>>`/operators)
 * into the dict. Names of trusted fonts (std-14, plain TrueType names) contain
 * only regular characters, so this is a no-op for them.
 */
export function sanitizePdfName(s: string): string {
  let out = "";
  for (const byte of UTF8.encode(s)) {
    if (byte >= 0x21 && byte <= 0x7e && !PDF_NAME_RESERVED.has(byte)) {
      out += String.fromCharCode(byte);
    } else {
      out += `#${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

/** FontDescriptor metrics for an embedded composite font (1000-em space). */
export interface CompositeFontDescriptor {
  readonly flags: number;
  readonly fontBBox: readonly [number, number, number, number];
  /** Caption angle in degrees; `number` (not `0`) so a real parser can supply a
   *  non-zero angle for an italic face. */
  readonly italicAngle: number;
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly stemV: number;
  readonly fontName: string;
}

/** Everything needed to write one embedded composite font's object graph. */
export interface CompositeFontData {
  readonly baseFont: string;
  readonly programBytes: Uint8Array;
  readonly descriptor: CompositeFontDescriptor;
  /** CID → advance (1000-em units). */
  readonly widths: ReadonlyMap<number, number>;
  /** The `/DW` default width (1000-em units). */
  readonly defaultWidth: number;
  /** CID → its Unicode text, for the `/ToUnicode` CMap. */
  readonly cidToUnicode: ReadonlyMap<number, string>;
  /** Which embedded-font organisation to emit. */
  readonly embed:
    | { readonly kind: "truetype" }
    | {
        readonly kind: "cff";
        readonly cidSystemInfo: {
          readonly registry: string;
          readonly ordering: string;
          readonly supplement: number;
        };
      };
}

/**
 * Write the composite-font object graph for `data` through `writer` and return
 * the Type0 root object id (the object a resource dict references). The allocate
 * order, dict key strings, and `/W` array form are fixed — both providers MUST
 * produce identical bytes.
 */
export function writeCompositeFontObjects(
  data: CompositeFontData,
  writer: PdfWriter,
): number {
  const d = data.descriptor;
  const prog = data.programBytes;
  // `/BaseFont` and `/FontName` are PDF Name objects fed from the (untrusted)
  // sfnt `name` table — escape per §7.3.5 so a hostile font can't inject syntax.
  const baseFont = sanitizePdfName(data.baseFont);
  const fontName = sanitizePdfName(d.fontName);

  // 1. FontFile stream (writer injects /Length). TrueType → FontFile2 (`/Length1`
  //    = sfnt byte length); CFF → FontFile3 (`/Subtype /CIDFontType0C`).
  const ffId = writer.allocate();
  if (data.embed.kind === "cff") {
    writer.writeStream(ffId, "<< /Subtype /CIDFontType0C >>", prog);
  } else {
    writer.writeStream(ffId, `<< /Length1 ${prog.length} >>`, prog);
  }

  // 2. ToUnicode stream — a real, valid CMap (no placeholder), built from the
  //    CID→unicode entries via the shared tounicode.ts builder.
  const tuBytes = UTF8.encode(buildToUnicodeCMap(data.cidToUnicode));
  const tuId = writer.allocate();
  writer.writeStream(tuId, "<< >>", tuBytes);

  // 3. FontDescriptor. The embedded-program key is FontFile3 for CFF, FontFile2
  //    for TrueType.
  const bbox = d.fontBBox.join(" ");
  const fontFileKey = data.embed.kind === "cff" ? "FontFile3" : "FontFile2";
  const fdId = writer.allocate();
  writer.writeObject(
    fdId,
    `<< /Type /FontDescriptor /FontName /${fontName} /Flags ${d.flags} ` +
      `/FontBBox [${bbox}] /ItalicAngle ${d.italicAngle} /Ascent ${d.ascent} ` +
      `/Descent ${d.descent} /CapHeight ${d.capHeight} /StemV ${d.stemV} ` +
      `/${fontFileKey} ${ffId} 0 R >>`,
  );

  // 4. /W array in the per-cid form `[ cid [w] cid [w] … ]` (PDF §9.7.4.3).
  const wEntries: string[] = [];
  for (const [cid, w] of [...data.widths.entries()].sort((a, b) => a[0] - b[0])) {
    wEntries.push(`${cid} [${w}]`);
  }
  const wArray = wEntries.join(" ");

  // 5. CIDFont descendant. CFF → CIDFontType0 with the font's own ROS in
  //    /CIDSystemInfo and NO /CIDToGIDMap (CID==GID is implied by the CFF charset).
  //    TrueType → CIDFontType2 with Identity ROS + /CIDToGIDMap /Identity.
  const cidId = writer.allocate();
  if (data.embed.kind === "cff") {
    const ros = data.embed.cidSystemInfo;
    writer.writeObject(
      cidId,
      `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${baseFont} ` +
        `/CIDSystemInfo << /Registry ${pdfString(ros.registry)} /Ordering ${pdfString(ros.ordering)} /Supplement ${ros.supplement} >> ` +
        `/FontDescriptor ${fdId} 0 R /DW ${data.defaultWidth} /W [ ${wArray} ] >>`,
    );
  } else {
    writer.writeObject(
      cidId,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseFont} ` +
        `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
        `/FontDescriptor ${fdId} 0 R /CIDToGIDMap /Identity /DW ${data.defaultWidth} /W [ ${wArray} ] >>`,
    );
  }

  // 6. Type0 root — the object the resource dict references.
  const t0Id = writer.allocate();
  writer.writeObject(
    t0Id,
    `<< /Type /Font /Subtype /Type0 /BaseFont /${baseFont} ` +
      `/Encoding /Identity-H /DescendantFonts [${cidId} 0 R] ` +
      `/ToUnicode ${tuId} 0 R >>`,
  );
  return t0Id;
}

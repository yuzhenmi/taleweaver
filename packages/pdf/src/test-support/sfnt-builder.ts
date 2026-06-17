/**
 * SHARED TEST SUPPORT — a spec-valid `glyf`-flavoured TrueType (sfnt) byte
 * builder, used by `truetype-parser.test.ts` (parser-level table reads) and
 * `embedded-font-provider.test.ts` (end-to-end provider → emitPdf → parsePdf).
 * Extracted from the parser test so both suites build identical synthesized
 * fonts without duplicating ~300 lines of table assembly.
 *
 * Test-only support: imported solely from `*.test.ts`, and NOT re-exported from
 * the public barrel (`index.ts`), so it is unreachable through the package's
 * `exports` (which resolves consumers to `src/index.ts`). Like the package's
 * other internal helpers it is compiled into the (unpublished, never-imported)
 * `dist/` artifact; a dedicated `tsconfig.build` that drops `*.test.ts` +
 * `test-support/` from emission is the right move IF this package is ever
 * published — tracked separately so it doesn't also drop test typechecking.
 */

/**
 * A 4-byte-aligned sfnt table. Builders produce a `{ tag, body }` and
 * {@link buildTestSfnt} lays out the directory + bodies.
 */
export interface SfntTable {
  readonly tag: string;
  readonly body: Uint8Array;
}

export interface HMetric {
  readonly advanceWidth: number;
  readonly lsb: number;
}

export interface BuildTestSfntOpts {
  readonly unitsPerEm: number;
  readonly numGlyphs: number;
  readonly hMetrics: readonly HMetric[];
  readonly numberOfHMetrics: number;
  readonly ascender: number;
  readonly descender: number;
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
  readonly macStyle: number;
  readonly indexToLocFormat?: number;
  /** sfnt version override (defaults to 0x00010000); used to exercise OTTO/bad paths. */
  readonly sfntVersion?: number;
  /** Extra tables (cmap/OS-2/post/name). */
  readonly extraTables?: readonly SfntTable[];
}

/** Pad `body` up to a 4-byte boundary (sfnt tables must be 4-byte aligned). */
function pad4(body: Uint8Array): Uint8Array {
  const rem = body.length % 4;
  if (rem === 0) {
    return body;
  }
  const out = new Uint8Array(body.length + (4 - rem));
  out.set(body);
  return out;
}

function buildHead(opts: BuildTestSfntOpts): Uint8Array {
  const buf = new ArrayBuffer(54);
  const v = new DataView(buf);
  v.setUint16(18, opts.unitsPerEm);
  v.setInt16(36, opts.xMin);
  v.setInt16(38, opts.yMin);
  v.setInt16(40, opts.xMax);
  v.setInt16(42, opts.yMax);
  v.setUint16(44, opts.macStyle);
  v.setInt16(50, opts.indexToLocFormat ?? 0);
  return new Uint8Array(buf);
}

function buildHhea(opts: BuildTestSfntOpts): Uint8Array {
  const buf = new ArrayBuffer(36);
  const v = new DataView(buf);
  v.setInt16(4, opts.ascender);
  v.setInt16(6, opts.descender);
  v.setUint16(34, opts.numberOfHMetrics);
  return new Uint8Array(buf);
}

function buildMaxp(opts: BuildTestSfntOpts): Uint8Array {
  const buf = new ArrayBuffer(6);
  const v = new DataView(buf);
  v.setUint16(4, opts.numGlyphs);
  return new Uint8Array(buf);
}

function buildHmtx(opts: BuildTestSfntOpts): Uint8Array {
  const buf = new ArrayBuffer(opts.hMetrics.length * 4);
  const v = new DataView(buf);
  opts.hMetrics.forEach((m, i) => {
    v.setUint16(i * 4, m.advanceWidth);
    v.setInt16(i * 4 + 2, m.lsb);
  });
  return new Uint8Array(buf);
}

/** A format-4 (segment-mapped BMP) cmap subtable spec. */
export interface Fmt4Segment {
  readonly endCode: number;
  readonly startCode: number;
  readonly idDelta: number;
  /** idRangeOffset in BYTES (per spec); 0 means resolve via idDelta. */
  readonly idRangeOffset: number;
}

/**
 * Build a format-4 subtable body. The caller supplies the segments (the
 * terminating 0xFFFF segment must be included) and an optional glyphIdArray
 * that the idRangeOffset arithmetic indexes into. `searchRange`/`entrySelector`/
 * `rangeShift` are deliberately zeroed — the parser must not depend on them.
 */
export function buildCmapFormat4(
  segments: readonly Fmt4Segment[],
  glyphIdArray: readonly number[] = [],
): Uint8Array {
  const segCount = segments.length;
  // header(2+2+2) + segCountX2(2) + search fields(6) + endCodes + pad(2)
  //   + startCodes + idDeltas + idRangeOffsets + glyphIdArray
  const length =
    2 + 2 + 2 + 2 + 6 + segCount * 2 + 2 + segCount * 2 + segCount * 2 + segCount * 2 + glyphIdArray.length * 2;
  const buf = new ArrayBuffer(length);
  const v = new DataView(buf);
  let p = 0;
  v.setUint16(p, 4); // format
  p += 2;
  v.setUint16(p, length); // length
  p += 2;
  v.setUint16(p, 0); // language
  p += 2;
  v.setUint16(p, segCount * 2); // segCountX2
  p += 2;
  v.setUint16(p, 0); // searchRange (zeroed on purpose)
  p += 2;
  v.setUint16(p, 0); // entrySelector
  p += 2;
  v.setUint16(p, 0); // rangeShift
  p += 2;
  for (const s of segments) {
    v.setUint16(p, s.endCode);
    p += 2;
  }
  v.setUint16(p, 0); // reservedPad
  p += 2;
  for (const s of segments) {
    v.setUint16(p, s.startCode);
    p += 2;
  }
  for (const s of segments) {
    v.setInt16(p, s.idDelta);
    p += 2;
  }
  for (const s of segments) {
    v.setUint16(p, s.idRangeOffset);
    p += 2;
  }
  for (const g of glyphIdArray) {
    v.setUint16(p, g);
    p += 2;
  }
  return new Uint8Array(buf);
}

/** A format-12 (segmented coverage) group. */
export interface Fmt12Group {
  readonly startCharCode: number;
  readonly endCharCode: number;
  readonly startGlyphID: number;
}

/** Build a format-12 subtable body. */
export function buildCmapFormat12(groups: readonly Fmt12Group[]): Uint8Array {
  const nGroups = groups.length;
  const length = 2 + 2 + 4 + 4 + 4 + nGroups * 12;
  const buf = new ArrayBuffer(length);
  const v = new DataView(buf);
  let p = 0;
  v.setUint16(p, 12); // format
  p += 2;
  v.setUint16(p, 0); // reserved
  p += 2;
  v.setUint32(p, length); // length
  p += 4;
  v.setUint32(p, 0); // language
  p += 4;
  v.setUint32(p, nGroups);
  p += 4;
  for (const g of groups) {
    v.setUint32(p, g.startCharCode);
    p += 4;
    v.setUint32(p, g.endCharCode);
    p += 4;
    v.setUint32(p, g.startGlyphID);
    p += 4;
  }
  return new Uint8Array(buf);
}

/** Build an `OS/2` table body of the given `version`.
 *
 * Field offsets (sfnt `OS/2`): usWeightClass u16 @4, fsSelection u16 @62,
 * sTypoAscender i16 @68, sTypoDescender i16 @70, sxHeight i16 @86 (v≥2),
 * sCapHeight i16 @88 (v≥2). The body is sized to the real per-version table
 * length: v0 → 78 bytes, v1 → 86 bytes (adds ulCodePageRange1/2), v2+ → 96
 * bytes (through sCapHeight). Crucially, NO version below 2 defines sx/sCapHeight
 * — so an un-guarded read at offset 88 WOULD overrun a v0 (88+2 > 78) or v1
 * (88+2 > 86) body, proving the `version >= 2` guard is what prevents it.
 */
export interface Os2Opts {
  readonly version: number;
  readonly usWeightClass?: number;
  readonly fsSelection?: number;
  readonly sTypoAscender?: number;
  readonly sTypoDescender?: number;
  readonly sxHeight?: number;
  readonly sCapHeight?: number;
}

export function buildOs2(opts: Os2Opts): Uint8Array {
  const size = opts.version >= 2 ? 96 : opts.version === 1 ? 86 : 78;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  v.setUint16(0, opts.version);
  v.setUint16(4, opts.usWeightClass ?? 400);
  v.setUint16(62, opts.fsSelection ?? 0);
  v.setInt16(68, opts.sTypoAscender ?? 0);
  v.setInt16(70, opts.sTypoDescender ?? 0);
  if (opts.version >= 2) {
    v.setInt16(86, opts.sxHeight ?? 0);
    v.setInt16(88, opts.sCapHeight ?? 0);
  }
  return new Uint8Array(buf);
}

/** Build a `post` table body. italicAngle Fixed16.16 i32 @4, isFixedPitch u32 @12. */
export interface PostOpts {
  /** italicAngle in degrees (encoded as degrees × 65536). */
  readonly italicAngle?: number;
  readonly isFixedPitch?: number;
}

export function buildPost(opts: PostOpts): Uint8Array {
  const buf = new ArrayBuffer(32);
  const v = new DataView(buf);
  // version 0x00030000 (no glyph-name subtable), then italicAngle Fixed @4.
  v.setUint32(0, 0x00030000);
  v.setInt32(4, Math.round((opts.italicAngle ?? 0) * 65536));
  v.setUint32(12, opts.isFixedPitch ?? 0);
  return new Uint8Array(buf);
}

/** A single `name` record (platform/encoding/language/nameID → a string). */
export interface NameRecord {
  readonly platformID: number;
  readonly encodingID: number;
  readonly languageID: number;
  readonly nameID: number;
  /** The string bytes already encoded in the platform's encoding. */
  readonly bytes: Uint8Array;
}

/** Encode an ASCII string as UTF-16BE bytes (platform 3 / encoding 1). */
export function utf16be(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  const v = new DataView(out.buffer);
  for (let i = 0; i < s.length; i++) {
    v.setUint16(i * 2, s.charCodeAt(i));
  }
  return out;
}

/** Encode an ASCII string as single-byte Latin-1 (platform 1 / encoding 0). */
export function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * Build a `name` table (format 0). Layout: format u16=0, count u16,
 * stringOffset u16, then `count` records {platformID, encodingID, languageID,
 * nameID, length, offset(from stringOffset)} (12 bytes each), then the string
 * storage. Strings are concatenated; each record's offset/length addresses its
 * slice.
 */
export function buildName(records: readonly NameRecord[]): Uint8Array {
  const count = records.length;
  const headerSize = 6;
  const recordsSize = count * 12;
  const stringOffset = headerSize + recordsSize;
  // Concatenate string storage, recording each slice's (offset, length).
  const slices: { offset: number; length: number }[] = [];
  let cursor = 0;
  for (const rec of records) {
    slices.push({ offset: cursor, length: rec.bytes.length });
    cursor += rec.bytes.length;
  }
  const storageSize = cursor;
  const total = stringOffset + storageSize;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0); // format
  v.setUint16(2, count);
  v.setUint16(4, stringOffset);
  records.forEach((rec, i) => {
    const recOff = headerSize + i * 12;
    const slice = slices[i];
    // slices was built one-per-record in the loop above, so slices[i] is present.
    if (slice === undefined) throw new Error(`buildName: slice at ${i} unexpectedly undefined`);
    v.setUint16(recOff, rec.platformID);
    v.setUint16(recOff + 2, rec.encodingID);
    v.setUint16(recOff + 4, rec.languageID);
    v.setUint16(recOff + 6, rec.nameID);
    v.setUint16(recOff + 8, slice.length);
    v.setUint16(recOff + 10, slice.offset);
  });
  records.forEach((rec, i) => {
    const slice = slices[i];
    if (slice === undefined) throw new Error(`buildName: slice at ${i} unexpectedly undefined`);
    out.set(rec.bytes, stringOffset + slice.offset);
  });
  return out;
}

/** A cmap encoding record (platform/encoding → subtable). */
export interface CmapEncoding {
  readonly platformID: number;
  readonly encodingID: number;
  readonly subtable: Uint8Array;
}

/**
 * Assemble a full `cmap` table: header (version 0 + numTables) + one encoding
 * record per subtable (4-byte-aligned subtable offsets relative to the cmap
 * start) + the subtable bodies.
 */
export function buildCmapTable(encodings: readonly CmapEncoding[]): Uint8Array {
  const headerSize = 4 + encodings.length * 8;
  // Lay out subtable bodies after the records, each 4-byte-aligned.
  const placed: { offset: number; padded: Uint8Array }[] = [];
  let cursor = headerSize;
  for (const e of encodings) {
    const padded = pad4(e.subtable);
    placed.push({ offset: cursor, padded });
    cursor += padded.length;
  }
  const out = new Uint8Array(cursor);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0); // version
  v.setUint16(2, encodings.length); // numTables
  encodings.forEach((e, i) => {
    const recOff = 4 + i * 8;
    const p = placed[i];
    // placed was built one-per-encoding in the loop above, so placed[i] is present.
    if (p === undefined) throw new Error(`buildCmapTable: placed at ${i} unexpectedly undefined`);
    v.setUint16(recOff, e.platformID);
    v.setUint16(recOff + 2, e.encodingID);
    v.setUint32(recOff + 4, p.offset);
  });
  for (const p of placed) {
    out.set(p.padded, p.offset);
  }
  return out;
}

/**
 * Lay out a SPEC-VALID sfnt from a sfntVersion + an ordered `SfntTable[]`: write
 * the sfnt header (sfntVersion + numTables + 3 search fields), the table
 * directory (per-table tag/checksum/offset/length), then the 4-byte-aligned
 * table bodies with correct offsets/lengths. Shared by {@link buildTestSfnt}
 * (glyf TrueType) and {@link buildTestOtf} (OpenType-CFF / `OTTO`).
 */
function assembleSfnt(sfntVersion: number, tables: readonly SfntTable[]): Uint8Array {
  const numTables = tables.length;
  const headerSize = 12; // sfntVersion(4) + numTables(2) + 3 search fields(6)
  const dirSize = numTables * 16; // each entry: tag(4)+checksum(4)+offset(4)+length(4)
  const bodyStart = headerSize + dirSize;

  // Lay out bodies (each padded to 4) and record (offset, real length).
  const placed: { tag: string; offset: number; length: number; padded: Uint8Array }[] = [];
  let cursor = bodyStart;
  for (const t of tables) {
    const padded = pad4(t.body);
    placed.push({ tag: t.tag, offset: cursor, length: t.body.length, padded });
    cursor += padded.length;
  }
  const total = cursor;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  // Header.
  view.setUint32(0, sfntVersion);
  view.setUint16(4, numTables);
  // search fields: parser ignores these; compute them to be spec-valid.
  let entrySelector = 0;
  let pow2 = 1;
  while (pow2 * 2 <= numTables) {
    pow2 *= 2;
    entrySelector++;
  }
  const searchRange = pow2 * 16;
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, numTables * 16 - searchRange);

  // Directory entries.
  placed.forEach((p, i) => {
    const entryOff = headerSize + i * 16;
    for (let c = 0; c < 4; c++) {
      out[entryOff + c] = p.tag.charCodeAt(c);
    }
    view.setUint32(entryOff + 4, 0); // checksum (parser ignores)
    view.setUint32(entryOff + 8, p.offset);
    view.setUint32(entryOff + 12, p.length);
  });

  // Bodies.
  for (const p of placed) {
    out.set(p.padded, p.offset);
  }

  return out;
}

/**
 * Write a SPEC-VALID sfnt (`glyf`-flavoured TrueType) `Uint8Array`: sfntVersion,
 * a real table directory (numTables + search fields + per-table tag/checksum/
 * offset/length), then the 4-byte-aligned table bodies. Callers pass
 * `extraTables` (cmap/OS-2/post/name) and the directory layout here writes them
 * with correct offsets/lengths automatically.
 */
export function buildTestSfnt(opts: BuildTestSfntOpts): Uint8Array {
  const tables: SfntTable[] = [
    { tag: "head", body: buildHead(opts) },
    { tag: "hhea", body: buildHhea(opts) },
    { tag: "maxp", body: buildMaxp(opts) },
    { tag: "hmtx", body: buildHmtx(opts) },
    ...(opts.extraTables ?? []),
  ];
  return assembleSfnt(opts.sfntVersion ?? 0x00010000, tables);
}

// ── glyf / loca fixtures (for subset-glyf tests) ────────────────────────────
//
// Subsetting never parses SIMPLE glyph outlines (it copies their bytes verbatim);
// it only parses COMPOSITE glyphs to expand the used-GID closure. So a simple-glyph
// fixture just needs a non-negative numberOfContours and a non-zero length; a
// composite-glyph fixture needs numberOfContours = -1 and a parseable component
// record (flags, glyphIndex) AFTER the standard 10-byte glyph header.

/** A minimal SIMPLE glyph: numberOfContours = 1 (>=0 ⇒ not composite) + filler (12 bytes, even). */
export function buildSimpleGlyph(): Uint8Array {
  const buf = new ArrayBuffer(12);
  const v = new DataView(buf);
  v.setInt16(0, 1);
  return new Uint8Array(buf);
}

/**
 * A minimal COMPOSITE glyph referencing ONE component `refGid`. Like ALL glyphs it
 * begins with the 10-byte glyph header (numberOfContours i16 = -1, then 4-i16 bbox),
 * THEN the component record at byte 10: flags(u16 = 0) + glyphIndex(u16 = refGid) +
 * 2 arg bytes. flags = 0 ⇒ args are 2 bytes, single component, no scale. Total 16.
 * The 4-i16 bbox is left zeroed: subsetting never inspects a composite's bbox (it
 * only reads the component records), so a zeroed bbox is fine for this fixture's purpose.
 */
export function buildCompositeGlyph(refGid: number): Uint8Array {
  const buf = new ArrayBuffer(16);
  const v = new DataView(buf);
  v.setInt16(0, -1); // composite marker; bytes 2..9 = bbox (left 0)
  v.setUint16(10, 0); // flags: no words, no more, no scale
  v.setUint16(12, refGid); // glyphIndex
  // bytes 14..15 = the 2 arg bytes (left 0)
  return new Uint8Array(buf);
}

/**
 * A MALFORMED composite whose only component has MORE_COMPONENTS (0x20) set but no
 * room for a second record — exercises the closure walk's loca-extent bound (it must
 * throw). 10-byte header + a single 6-byte component, total 16 bytes.
 */
export function buildTruncatedComposite(refGid: number): Uint8Array {
  const buf = new ArrayBuffer(16);
  const v = new DataView(buf);
  v.setInt16(0, -1);
  v.setUint16(10, 0x0020); // MORE_COMPONENTS set, but the glyph ends after this record
  v.setUint16(12, refGid);
  return new Uint8Array(buf);
}

/**
 * Build `glyf` + `loca` table bodies for an ordered glyph list (index = GID). Short
 * loca (longLoca false) stores offset/2 so each glyph is padded to even; long loca
 * stores exact offsets. An empty glyph contributes 0 bytes. Returns the two bodies.
 */
export function buildGlyfAndLoca(
  glyphs: readonly Uint8Array[],
  longLoca: boolean,
): { glyf: Uint8Array; loca: Uint8Array } {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [0];
  let cursor = 0;
  for (const g of glyphs) {
    let body = g;
    if (!longLoca && body.length % 2 !== 0) {
      const padded = new Uint8Array(body.length + 1);
      padded.set(body);
      body = padded;
    }
    parts.push(body);
    cursor += body.length;
    offsets.push(cursor);
  }
  const glyf = new Uint8Array(cursor);
  let p = 0;
  for (const part of parts) {
    glyf.set(part, p);
    p += part.length;
  }
  const loca = new Uint8Array((longLoca ? 4 : 2) * offsets.length);
  const lv = new DataView(loca.buffer);
  offsets.forEach((off, i) => {
    if (longLoca) lv.setUint32(i * 4, off);
    else lv.setUint16(i * 2, off / 2);
  });
  return { glyf, loca };
}

// ── OpenType-CFF (`OTTO`) test fixture ──────────────────────────────────────
//
// `buildTestOtf` wraps a hand-built `CFF ` table (Adobe TN#5176) — minimal but
// exactly what the shipped `cff-parser.ts` (`parseCff`) reads: CFF header →
// Name INDEX → Top DICT INDEX → String INDEX → charset → CharStrings INDEX.

/** Concatenate byte chunks into one Uint8Array. */
function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Build a CFF INDEX (Adobe TN#5176 §5) with offSize 1 (all test items are
 * tiny, so every offset fits in one byte). count===0 encodes as `[0,0]`. */
function cffIndex(items: readonly Uint8Array[]): Uint8Array {
  if (items.length === 0) return new Uint8Array([0, 0]);
  const offsets: number[] = [1];
  let last = 1; // running 1-based offset; avoids a non-null index read
  for (const it of items) {
    last += it.length;
    offsets.push(last);
  }
  const offSize = 1;
  const head = [items.length >> 8, items.length & 0xff, offSize, ...offsets];
  const data = items.flatMap((it) => [...it]);
  return new Uint8Array([...head, ...data]);
}

/** CFF DICT integer operand in the 5-byte `29` form (big-endian i32). */
function dictInt29(v: number): Uint8Array {
  return new Uint8Array([29, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

/** CFF DICT SID operand in the 3-byte `28` form (big-endian i16). */
function dictSid28(v: number): Uint8Array {
  return new Uint8Array([28, (v >> 8) & 0xff, v & 0xff]);
}

/** Encode a CFF DICT real operand (byte 30 + BCD nibbles, 0xf terminator;
 *  Adobe TN#5176 §4). Supports digits, '.', '-', 'E'. Used for FontMatrix reals. */
export function dictReal(s: string): Uint8Array {
  const nibbles: number[] = [];
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") nibbles.push(ch.charCodeAt(0) - 48);
    else if (ch === ".") nibbles.push(0xa);
    else if (ch === "E") nibbles.push(0xb);
    else if (ch === "-") nibbles.push(0xe);
    else throw new Error(`dictReal: unsupported char ${ch}`);
  }
  nibbles.push(0xf); // terminator
  if (nibbles.length % 2 !== 0) nibbles.push(0xf); // pad to a whole byte
  const out = new Uint8Array(1 + nibbles.length / 2);
  out[0] = 30;
  for (let i = 0; i < nibbles.length; i += 2) {
    out[1 + i / 2] = ((nibbles[i] ?? 0xf) << 4) | (nibbles[i + 1] ?? 0xf);
  }
  return out;
}

export interface BuildTestOtfOpts {
  readonly numGlyphs: number;
  readonly cidKeyed: boolean;
  /** CID-keyed: GID i → cidBase + (i-1); default 5. */
  readonly cidBase?: number;
  /** CID-keyed ROS registry; default "Adobe". */
  readonly registry?: string;
  /** CID-keyed ROS ordering; default "Identity". */
  readonly ordering?: string;
  /** default 1000. */
  readonly unitsPerEm?: number;
  /**
   * The `cmap` encoding records to embed. Defaults to a single (3,1) format-4
   * subtable whose ONLY segment is the 0xFFFF terminator — mapping NO real
   * codepoint. Pass a real subtable (e.g. via {@link buildCmapFormat4}) to map a
   * codepoint to a GID for an end-to-end encode test.
   */
  readonly cmap?: readonly CmapEncoding[];
  /**
   * CID-keyed only: emit a full FDArray (one FD DICT) + FDSelect (format 0, all
   * glyphs → FD 0) + a per-FD Private DICT, plus a Top-DICT FontMatrix (real
   * operands). Exercises the c.3 CFF rebuild's structure-relocation AND
   * real-operand-preservation paths. Ignored when `cidKeyed` is false.
   */
  readonly withFdArray?: boolean;
  /**
   * Non-CID only: emit a top-level Private DICT (op 18) so the c.3 CFF rebuild's
   * non-CID Private-relocation path (op-18 offset rewrite + Private blob placement)
   * is exercised. Ignored when cidKeyed is true.
   */
  readonly withTopPrivate?: boolean;
}

/**
 * Build a minimal valid OpenType-CFF (`OTTO`) font wrapping a hand-built `CFF `
 * table that {@link parseCff} parses. Non-CID-keyed → no ROS (parseCff reports
 * isCidKeyed:false); CID-keyed → a custom format-0 charset (GID i → cidBase+i−1)
 * plus a ROS (registry SID 391, ordering SID 392, supplement 0).
 *
 * The `CFF ` table lays out as `[header | NameINDEX | TopDictINDEX | StringINDEX
 * | charset | CharStrings]`. Top-DICT operands (charset/CharStrings offsets are
 * CFF-table-relative) create an offset fixpoint: the offsets depend on where
 * charset/CharStrings land, which depends on the Top-DICT INDEX length, which
 * depends on the Top-DICT length. We break it by using FIXED-WIDTH operands
 * (every offset = 5-byte `29` int, every SID = 3-byte `28` int), so the Top-DICT
 * byte length is CONSTANT regardless of the operand VALUES. We therefore size
 * the dict once with placeholder offsets, compute the real charset/CharStrings
 * offsets from the now-known layout, then rebuild the dict (identical length)
 * with the real offsets before assembling.
 */
export function buildTestOtf(opts: BuildTestOtfOpts): Uint8Array {
  const { numGlyphs, cidKeyed } = opts;
  const cidBase = opts.cidBase ?? 5;
  const registry = opts.registry ?? "Adobe";
  const ordering = opts.ordering ?? "Identity";
  const unitsPerEm = opts.unitsPerEm ?? 1000;

  // CFF header: major=1, minor=0, hdrSize=4, offSize=1. Name INDEX starts at
  // byte hdrSize (=4).
  const header = new Uint8Array([1, 0, 4, 1]);

  // Name INDEX (the font name; parseCff skips it but it must be well-formed).
  const nameIndex = cffIndex([ascii("TestCFF")]);

  // String INDEX. CID-keyed needs registry @ SID 391 and ordering @ SID 392
  // (parseCff resolves SID − 391 into stringIndex.items). Non-CID-keyed: empty.
  const stringIndex = cidKeyed ? cffIndex([ascii(registry), ascii(ordering)]) : cffIndex([]);

  // Empty Global Subr INDEX (CFF spec §1: immediately follows the String INDEX).
  // parseCff navigates by offset and skips it, but a spec-correct CFF has one, and
  // the c.3 CFF rebuild reads it at stringIndex.end.
  const globalSubrIndex = cffIndex([]);

  // charset (format 0): format byte 0, then a u16 per glyph for GID 1..n−1.
  // CID-keyed → the CID (cidBase + gid − 1); else the GID itself (parseCff
  // ignores it when not CID-keyed, but emit a valid one anyway).
  const charset = (() => {
    const out = new Uint8Array(1 + Math.max(0, numGlyphs - 1) * 2);
    const v = new DataView(out.buffer);
    out[0] = 0; // format 0
    for (let gid = 1; gid < numGlyphs; gid++) {
      v.setUint16(1 + (gid - 1) * 2, cidKeyed ? cidBase + (gid - 1) : gid);
    }
    return out;
  })();

  // CharStrings INDEX: one 2-byte charstring per glyph — `[139, 14]` = push 0
  // (op 139 = integer 0) + `endchar` (14). Its count u16 must equal numGlyphs
  // (parseCff cross-checks against maxp). The charstring is deliberately MULTI-byte
  // so subsetting (which replaces an unused glyph with a single 1-byte `endchar`)
  // measurably shrinks the table — and so the round-trip exercises preserving a
  // multi-byte USED charstring verbatim, not just the trivial 1-byte case.
  const charStrings = cffIndex(Array.from({ length: numGlyphs }, () => new Uint8Array([139, 14])));

  // Build the Top DICT given charset/CharStrings CFF-relative offsets. Uses only
  // fixed-width operands so its byte length is independent of the offset values.
  const buildTopDict = (charsetOffset: number, charStringsOffset: number): Uint8Array => {
    const parts: Uint8Array[] = [];
    if (cidKeyed) {
      // ROS: registry SID 391, ordering SID 392, supplement 0, operator 12 30.
      parts.push(dictSid28(391), dictSid28(392), dictInt29(0), new Uint8Array([12, 30]));
    }
    // charset: operand, operator 15.
    parts.push(dictInt29(charsetOffset), new Uint8Array([15]));
    // CharStrings: operand, operator 17.
    parts.push(dictInt29(charStringsOffset), new Uint8Array([17]));
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let p = 0;
    for (const part of parts) {
      out.set(part, p);
      p += part.length;
    }
    return out;
  };

  // FDArray-bearing CID layout: header | Name | TopDict | String | GlobalSubr |
  // charset | FDSelect | CharStrings | FDArray | Private. Every offset operator
  // (Top DICT: charset 15, CharStrings 17, FDArray 12·36, FDSelect 12·37; FD DICT:
  // Private 18) uses fixed-width dictInt29 ⇒ constant DICT length ⇒ a solvable
  // fixpoint. FontMatrix (12·7) carries real operands to lock real-preservation.
  let cffBytes: Uint8Array;
  if (cidKeyed && opts.withFdArray === true) {
    const fontMatrix = (() => {
      const reals = ["0.001", "0", "0", "0.001", "0", "0"].map((s) => dictReal(s));
      const parts = [...reals, new Uint8Array([12, 7])];
      return concatBytes(parts);
    })();
    const fdSelect = (() => {
      const out = new Uint8Array(1 + numGlyphs); // format 0 + 1 FD-index byte/glyph
      out[0] = 0; // bytes 1.. already 0 ⇒ every glyph maps to FD 0
      return out;
    })();
    const privateDict = new Uint8Array([139, 20, 139, 21]); // defaultWidthX=0, nominalWidthX=0
    const buildFdDict = (privOffset: number): Uint8Array =>
      concatBytes([dictInt29(privateDict.length), dictInt29(privOffset), new Uint8Array([18])]);
    const buildTopDictFd = (
      charsetOff: number,
      charStringsOff: number,
      fdArrayOff: number,
      fdSelectOff: number,
    ): Uint8Array =>
      concatBytes([
        fontMatrix,
        dictSid28(391),
        dictSid28(392),
        dictInt29(0),
        new Uint8Array([12, 30]), // ROS
        dictInt29(charsetOff),
        new Uint8Array([15]),
        dictInt29(charStringsOff),
        new Uint8Array([17]),
        dictInt29(fdArrayOff),
        new Uint8Array([12, 36]),
        dictInt29(fdSelectOff),
        new Uint8Array([12, 37]),
      ]);
    // (1) Size DICTs/INDEXes with placeholders (fixed-width ⇒ final lengths now).
    const topDictLen = buildTopDictFd(0, 0, 0, 0).length;
    const topDictIndexLen = cffIndex([new Uint8Array(topDictLen)]).length;
    const fdDictLen = buildFdDict(0).length;
    const fdArrayLen = cffIndex([new Uint8Array(fdDictLen)]).length;
    // (2) Compute CFF-relative offsets in the canonical order.
    const prefixLen =
      header.length + nameIndex.length + topDictIndexLen + stringIndex.length + globalSubrIndex.length;
    const charsetOffset = prefixLen;
    const fdSelectOffset = charsetOffset + charset.length;
    const charStringsOffset = fdSelectOffset + fdSelect.length;
    const fdArrayOffset = charStringsOffset + charStrings.length;
    const privateOffset = fdArrayOffset + fdArrayLen;
    // (3) Rebuild with real offsets (lengths must match the placeholders).
    const fdDict = buildFdDict(privateOffset);
    const fdArray = cffIndex([fdDict]);
    const topDict = buildTopDictFd(charsetOffset, charStringsOffset, fdArrayOffset, fdSelectOffset);
    if (topDict.length !== topDictLen || fdArray.length !== fdArrayLen) {
      throw new Error("buildTestOtf: FDArray fixpoint broken (DICT length changed)");
    }
    const topDictIndex = cffIndex([topDict]);
    // (4) Assemble in the canonical order.
    cffBytes = concatBytes([
      header,
      nameIndex,
      topDictIndex,
      stringIndex,
      globalSubrIndex,
      charset,
      fdSelect,
      charStrings,
      fdArray,
      privateDict,
    ]);
  } else if (!cidKeyed && opts.withTopPrivate === true) {
    // Non-CID Top DICT with a Private DICT (op 18) + charset(15) + CharStrings(17).
    const privateDict = new Uint8Array([139, 20, 139, 21]); // defaultWidthX=0, nominalWidthX=0
    const buildTopDictPriv = (charsetOff: number, charStringsOff: number, privOff: number): Uint8Array =>
      concatBytes([
        dictInt29(charsetOff), new Uint8Array([15]),
        dictInt29(charStringsOff), new Uint8Array([17]),
        dictInt29(privateDict.length), dictInt29(privOff), new Uint8Array([18]),
      ]);
    const topDictLen = buildTopDictPriv(0, 0, 0).length;
    const topDictIndexLen = cffIndex([new Uint8Array(topDictLen)]).length;
    const prefixLen = header.length + nameIndex.length + topDictIndexLen + stringIndex.length + globalSubrIndex.length;
    const charsetOffset = prefixLen;
    const charStringsOffset = charsetOffset + charset.length;
    const privateOffset = charStringsOffset + charStrings.length;
    const topDict = buildTopDictPriv(charsetOffset, charStringsOffset, privateOffset);
    if (topDict.length !== topDictLen) {
      throw new Error("buildTestOtf: withTopPrivate fixpoint broken (Top DICT length changed)");
    }
    const topDictIndex = cffIndex([topDict]);
    cffBytes = concatBytes([
      header, nameIndex, topDictIndex, stringIndex, globalSubrIndex, charset, charStrings, privateDict,
    ]);
  } else {
    // (1) Size the Top DICT (and its INDEX wrapper) with placeholder offsets —
    // fixed-width operands ⇒ the length is final.
    const topDictLen = buildTopDict(0, 0).length;
    const topDictIndexLen = cffIndex([new Uint8Array(topDictLen)]).length;

    // (2) Compute the real CFF-relative offsets from the now-known layout.
    const charsetOffset =
      header.length + nameIndex.length + topDictIndexLen + stringIndex.length + globalSubrIndex.length;
    const charStringsOffset = charsetOffset + charset.length;

    // (3) Rebuild the Top DICT with the real offsets (identical length) and wrap.
    const topDict = buildTopDict(charsetOffset, charStringsOffset);
    if (topDict.length !== topDictLen) {
      throw new Error("buildTestOtf: Top DICT length changed with real offsets (fixpoint broken)");
    }
    const topDictIndex = cffIndex([topDict]);

    // (4) Assemble the `CFF ` table.
    cffBytes = concatBytes([
      header,
      nameIndex,
      topDictIndex,
      stringIndex,
      globalSubrIndex,
      charset,
      charStrings,
    ]);
  }

  // Minimal sfnt tables matching buildTestSfnt's set so parseSfnt's descriptor
  // path resolves (head/hhea/maxp/hmtx + cmap/OS-2/post/name), plus `CFF `.
  const sfntOpts: BuildTestSfntOpts = {
    unitsPerEm,
    numGlyphs,
    hMetrics: Array.from({ length: numGlyphs }, () => ({ advanceWidth: 500, lsb: 0 })),
    numberOfHMetrics: numGlyphs,
    ascender: 800,
    descender: -200,
    xMin: 0,
    yMin: -200,
    xMax: 500,
    yMax: 800,
    macStyle: 0,
  };
  const cmap = buildCmapTable(
    opts.cmap ?? [
      {
        platformID: 3,
        encodingID: 1,
        subtable: buildCmapFormat4(
          [{ endCode: 0xffff, startCode: 0xffff, idDelta: 1, idRangeOffset: 0 }],
          [],
        ),
      },
    ],
  );
  const tables: SfntTable[] = [
    { tag: "head", body: buildHead(sfntOpts) },
    { tag: "hhea", body: buildHhea(sfntOpts) },
    { tag: "maxp", body: buildMaxp(sfntOpts) },
    { tag: "hmtx", body: buildHmtx(sfntOpts) },
    { tag: "cmap", body: cmap },
    { tag: "OS/2", body: buildOs2({ version: 3 }) },
    { tag: "post", body: buildPost({}) },
    {
      tag: "name",
      body: buildName([
        { platformID: 3, encodingID: 1, languageID: 0x409, nameID: 6, bytes: utf16be("TestCFF") },
      ]),
    },
    { tag: "CFF ", body: cffBytes },
  ];
  return assembleSfnt(0x4f54544f, tables);
}

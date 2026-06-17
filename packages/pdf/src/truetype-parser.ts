/**
 * A pure-byte parser for `glyf`-flavoured TrueType sfnt fonts — the table source
 * the PDF composite-font (Type0 / CIDFontType2) graph needs. Platform-agnostic:
 * reads raw bytes only, no DOM/Node APIs.
 *
 * This CORE reads the sfnt header + table directory and the four always-required
 * tables: `head` (units/bbox/macStyle/loca-format), `hhea` (asc/desc/hMetrics
 * count), `maxp` (glyph count), and `hmtx` (per-glyph advances). The directory
 * `Map` and raw `bytes` are exposed so later tasks can read `cmap`/`OS-2`/`post`/
 * `name` and emit the `FontFile2` program stream — all WITHOUT re-parsing.
 *
 * All metrics are in font design units (`unitsPerEm` per em), NOT px/pt; the
 * composite-font writer rescales to the PDF 1000-em space.
 */

import { parseCff, type CffInfo } from "./cff-parser";

/** A malformed/unsupported sfnt — a host error, surfaced loudly (never defaulted). */
export class MalformedFontError extends Error {
  constructor(message: string) {
    super(`pdf: malformed font: ${message}`);
    this.name = "MalformedFontError";
  }
}

/** A `glyf` sfnt version (`0x00010000`). */
const SFNT_VERSION_TRUETYPE = 0x00010000;
/** An OpenType-CFF (`OTTO`) sfnt — not supported until c.2b. */
const SFNT_VERSION_OTTO = 0x4f54544f;

/** A located sfnt table within the source bytes. */
export interface TableRecord {
  readonly offset: number;
  readonly length: number;
}

/**
 * A PDF `/FontDescriptor`'s metrics, in 1000-em (PDF design) space. Structurally
 * assignable to `CompositeFontDescriptor` (composite-font.ts) — the field set and
 * units match exactly, so `parsed.descriptor` can flow straight into
 * `writeCompositeFontObjects` without a shim.
 */
export interface FontDescriptor {
  /** PDF `/Flags` bitfield (Nonsymbolic | Italic | FixedPitch | ForceBold). */
  readonly flags: number;
  /** `/FontBBox` `[xMin, yMin, xMax, yMax]` scaled into 1000-em space. */
  readonly fontBBox: readonly [number, number, number, number];
  /** `/ItalicAngle` in degrees (from `post`; 0 if absent). */
  readonly italicAngle: number;
  /** `/Ascent` in 1000-em units. */
  readonly ascent: number;
  /** `/Descent` in 1000-em units (typically negative). */
  readonly descent: number;
  /** `/CapHeight` in 1000-em units. */
  readonly capHeight: number;
  /** `/StemV` — an approximation derived from weight (real StemV needs outlines). */
  readonly stemV: number;
  /** `/FontName` — the PostScript name (`name` nameID 6), or a synthesized fallback. */
  readonly fontName: string;
}

/** A parsed sfnt font (`glyf` TrueType or OpenType-CFF) — the table source for
 * the composite-font graph. */
export interface ParsedFont {
  /**
   * Which glyph-outline format the sfnt carries: `"glyf"` (TrueType, `head`
   * version `0x00010000`, embedded as `FontFile2`/CIDFontType2) or `"cff"`
   * (OpenType-CFF, `OTTO`, embedded as `FontFile3`/CIDFontType0C).
   */
  readonly glyphFormat: "glyf" | "cff";
  /** The parsed `CFF ` table — present iff `glyphFormat === "cff"`. */
  readonly cff?: CffInfo;
  /** Em square in design units (`head.unitsPerEm`). */
  readonly unitsPerEm: number;
  /** Glyph count (`maxp.numGlyphs`). */
  readonly numGlyphs: number;
  /** `head` glyph bounding box `[xMin, yMin, xMax, yMax]` in design units. */
  readonly bbox: readonly [number, number, number, number];
  /** `head.macStyle` bitfield (bit 0 = bold, bit 1 = italic). */
  readonly macStyle: number;
  /** `head.indexToLocFormat` (0 = short `loca`, 1 = long). */
  readonly indexToLocFormat: number;
  /** `hhea.ascender` in design units. */
  readonly ascender: number;
  /** `hhea.descender` in design units (typically negative). */
  readonly descender: number;
  /**
   * The horizontal advance of glyph `gid` in design units. For `gid >=`
   * `numberOfHMetrics` the LAST explicit advance repeats (the sfnt `hmtx`
   * tail-repeat rule for monospaced trailing runs).
   */
  advanceOf(gid: number): number;
  /**
   * Map a Unicode codepoint to a glyph id (GID) via the best Unicode `cmap`
   * subtable (preference `(3,10)` → `(3,1)` → `(0,*)`). Returns `0` (`.notdef`)
   * for an unmapped codepoint or a font without a Unicode `cmap`. Throws
   * {@link MalformedFontError} if the selected subtable is truncated/malformed.
   */
  cmapLookup(codepoint: number): number;
  /** The raw source bytes (for the future `FontFile2` program stream). */
  readonly bytes: Uint8Array;
  /** The table directory, keyed by 4-char tag (for T2/T3 cmap/OS-2/post/name). */
  readonly tables: ReadonlyMap<string, TableRecord>;
  /**
   * The PDF `/FontDescriptor` metrics in 1000-em space, derived from `head`,
   * `hhea`, and (when present) `OS/2`, `post`, and `name`. Ready to flow into the
   * composite-font writer.
   */
  readonly descriptor: FontDescriptor;
}

// PDF `/Flags` bits (PDF §9.8.2, "Font descriptor flags").
const FLAG_FIXED_PITCH = 0x1;
const FLAG_NONSYMBOLIC = 0x20;
const FLAG_ITALIC = 0x40;
const FLAG_FORCE_BOLD = 0x40000;
/** `head.macStyle` italic bit. */
const MACSTYLE_ITALIC = 0x2;
/** `OS/2.fsSelection` USE_TYPO_METRICS bit. */
const FS_SELECTION_USE_TYPO_METRICS = 0x80;

/**
 * Derive the PDF `/FontDescriptor` (1000-em space) from the parsed tables. `OS/2`,
 * `post`, and `name` are all optional; sensible fallbacks fill in for an absent
 * table (hhea metrics for asc/desc/cap, 0 italic angle, a synthesized font name).
 */
function buildDescriptor(
  r: Reader,
  tables: ReadonlyMap<string, TableRecord>,
  opts: {
    readonly unitsPerEm: number;
    readonly bbox: readonly [number, number, number, number];
    readonly macStyle: number;
    readonly hheaAscender: number;
    readonly hheaDescender: number;
    readonly numGlyphs: number;
  },
): FontDescriptor {
  // Scale a font-unit value into 1000-em (PDF design) space.
  const s = (u: number): number => Math.round((u * 1000) / opts.unitsPerEm);

  // --- OS/2: weight, USE_TYPO_METRICS, typo ascent/descent, cap height ---
  let usWeightClass = 400; // default "Regular" if no OS/2.
  let useTypoMetrics = false;
  let typoAscender = opts.hheaAscender;
  let typoDescender = opts.hheaDescender;
  // version >= 2 is the guard for the v2+ fields (sxHeight @86, sCapHeight @88)
  // AND for honoring USE_TYPO_METRICS (HarfBuzz/FreeType/fonttools honor the bit
  // on any OS/2 v>=2; sTypo* is reliably populated from v2 onward — a >= 4 guard
  // would wrongly ignore typo metrics on widely-shipped v2/v3 fonts).
  let capHeightFromOs2: number | undefined;
  const os2 = tables.get("OS/2");
  if (os2 !== undefined) {
    const version = r.u16(os2.offset);
    usWeightClass = r.u16(os2.offset + 4);
    const fsSelection = r.u16(os2.offset + 62);
    if (version >= 2) {
      typoAscender = r.i16(os2.offset + 68);
      typoDescender = r.i16(os2.offset + 70);
      useTypoMetrics = (fsSelection & FS_SELECTION_USE_TYPO_METRICS) !== 0;
      // sCapHeight @88 only exists on v>=2 — guarded so a short v0/v1 body never
      // over-reads.
      capHeightFromOs2 = r.i16(os2.offset + 88);
    }
  }

  // --- post: italic angle + fixed pitch (offsets version-independent v1/v2/v3) ---
  let italicAngle = 0;
  let isFixedPitch = 0;
  const post = tables.get("post");
  if (post !== undefined) {
    // italicAngle is a Fixed16.16 (i32 / 65536) in degrees.
    italicAngle = r.i32(post.offset + 4) / 65536;
    isFixedPitch = r.u32(post.offset + 12);
  }

  // --- name: PostScript name (nameID 6), preferring (3,1) UTF-16BE ---
  const fontName = readPostScriptName(r, tables, opts.numGlyphs);

  // --- Compose ---
  const ascent = useTypoMetrics ? s(typoAscender) : s(opts.hheaAscender);
  const descent = useTypoMetrics ? s(typoDescender) : s(opts.hheaDescender);
  // capHeight: OS/2 v>=2 supplies it; otherwise fall back to ascent.
  const capHeight = capHeightFromOs2 !== undefined ? s(capHeightFromOs2) : ascent;

  // StemV: real stem-width needs glyph-outline analysis; approximate from weight.
  const stemV = Math.max(0, Math.round(50 + (usWeightClass - 400) / 4));

  let flags = FLAG_NONSYMBOLIC; // Nonsymbolic always set (TrueType text fonts).
  if ((opts.macStyle & MACSTYLE_ITALIC) !== 0) {
    flags |= FLAG_ITALIC;
  }
  if (isFixedPitch !== 0) {
    flags |= FLAG_FIXED_PITCH;
  }
  if (usWeightClass >= 700) {
    flags |= FLAG_FORCE_BOLD;
  }

  return {
    flags,
    fontBBox: [s(opts.bbox[0]), s(opts.bbox[1]), s(opts.bbox[2]), s(opts.bbox[3])],
    italicAngle,
    ascent,
    descent,
    capHeight,
    stemV,
    fontName,
  };
}

/**
 * Read the PostScript font name from the `name` table's nameID-6 record. Prefers
 * platform (3,1) (Windows, UTF-16BE) → platform (1,0) (Macintosh, ASCII/Latin-1)
 * → a synthesized `Font-<numGlyphs>` fallback when neither is present.
 */
function readPostScriptName(
  r: Reader,
  tables: ReadonlyMap<string, TableRecord>,
  numGlyphs: number,
): string {
  const synth = `Font-${numGlyphs}`;
  const name = tables.get("name");
  if (name === undefined) {
    return synth;
  }
  const base = name.offset;
  // header: format(2) + count(2) + stringOffset(2).
  const count = r.u16(base + 2);
  const stringStorage = base + r.u16(base + 4);

  // Scan records for nameID 6, tracking the best platform match.
  let winRecord: { offset: number; length: number } | undefined;
  let macRecord: { offset: number; length: number } | undefined;
  for (let i = 0; i < count; i++) {
    const rec = base + 6 + i * 12;
    const platformID = r.u16(rec);
    const encodingID = r.u16(rec + 2);
    const nameID = r.u16(rec + 6);
    if (nameID !== 6) {
      continue;
    }
    const length = r.u16(rec + 8);
    const strOffset = stringStorage + r.u16(rec + 10);
    if (platformID === 3 && encodingID === 1) {
      winRecord = { offset: strOffset, length };
    } else if (platformID === 1 && encodingID === 0) {
      macRecord = { offset: strOffset, length };
    }
  }

  if (winRecord !== undefined) {
    return decodeUtf16Be(r, winRecord.offset, winRecord.length);
  }
  if (macRecord !== undefined) {
    return decodeLatin1NameBytes(r, macRecord.offset, macRecord.length);
  }
  return synth;
}

/** Decode `length` bytes at `offset` as UTF-16BE (BMP code units → chars). */
function decodeUtf16Be(r: Reader, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i + 1 < length; i += 2) {
    out += String.fromCharCode(r.u16(offset + i));
  }
  return out;
}

/**
 * Decode `length` bytes of a font `name`-table record at `offset` as single-byte
 * Latin-1/ASCII (the (1,0) Mac/ASCII platform path). Distinct from
 * `pdf-writer.decodeLatin1`, which decodes a whole PDF byte stream.
 */
function decodeLatin1NameBytes(r: Reader, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(r.u8(offset + i));
  }
  return out;
}

/**
 * A bounds-checked big-endian reader over a `Uint8Array`. Every read validates
 * its span lies inside the buffer and throws {@link MalformedFontError} otherwise
 * — a truncated/over-claiming font never reads garbage or out-of-range memory.
 */
export class Reader {
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private check(at: number, size: number): void {
    if (at < 0 || at + size > this.bytes.byteLength) {
      throw new MalformedFontError(
        `read of ${size} byte(s) at ${at} is past the ${this.bytes.byteLength}-byte buffer`,
      );
    }
  }

  u8(at: number): number {
    this.check(at, 1);
    return this.view.getUint8(at);
  }

  u16(at: number): number {
    this.check(at, 2);
    return this.view.getUint16(at);
  }

  i16(at: number): number {
    this.check(at, 2);
    return this.view.getInt16(at);
  }

  u32(at: number): number {
    this.check(at, 4);
    return this.view.getUint32(at);
  }

  i32(at: number): number {
    this.check(at, 4);
    return this.view.getInt32(at);
  }

  /** A 4-byte ASCII tag as a string (sfnt tags are ASCII). */
  tag(at: number): string {
    this.check(at, 4);
    return (
      String.fromCharCode(this.view.getUint8(at)) +
      String.fromCharCode(this.view.getUint8(at + 1)) +
      String.fromCharCode(this.view.getUint8(at + 2)) +
      String.fromCharCode(this.view.getUint8(at + 3))
    );
  }
}

/** Look up a required table, throwing {@link MalformedFontError} if absent. */
function requireTable(
  tables: ReadonlyMap<string, TableRecord>,
  tag: string,
): TableRecord {
  const rec = tables.get(tag);
  if (rec === undefined) {
    throw new MalformedFontError(`required table '${tag}' is missing`);
  }
  return rec;
}

/**
 * A `codepoint → gid` lookup over one selected Unicode `cmap` subtable. The
 * absolute byte `offset` of the subtable within the source buffer is captured;
 * the actual format parse + array reads happen lazily on first lookup so a font
 * whose codepoints are never queried never pays for a malformed subtable.
 */
type CmapLookup = (codepoint: number) => number;

/**
 * Select the best Unicode `cmap` subtable and return a {@link CmapLookup}.
 * Preference order: `(3,10)` (Windows UCS-4, astral-capable) → `(3,1)` (Windows
 * BMP) → `(0,*)` (Unicode platform, any encoding). A font with none of these has
 * no usable Unicode mapping, so the lookup returns `0` for every codepoint.
 */
function buildCmapLookup(r: Reader, tables: ReadonlyMap<string, TableRecord>): CmapLookup {
  const cmap = tables.get("cmap");
  if (cmap === undefined) {
    return () => 0;
  }
  const base = cmap.offset;
  // header: version(2) + numTables(2).
  const numSubtables = r.u16(base + 2);

  // Score each encoding record; higher score = more preferred.
  let bestScore = -1;
  let bestSubtableOffset = -1;
  for (let i = 0; i < numSubtables; i++) {
    const rec = base + 4 + i * 8;
    const platformID = r.u16(rec);
    const encodingID = r.u16(rec + 2);
    const subtableOffset = r.u32(rec + 4);
    let score = -1;
    if (platformID === 3 && encodingID === 10) {
      score = 3;
    } else if (platformID === 3 && encodingID === 1) {
      score = 2;
    } else if (platformID === 0) {
      score = 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestSubtableOffset = base + subtableOffset;
    }
  }

  if (bestSubtableOffset < 0) {
    return () => 0;
  }

  const subBase = bestSubtableOffset;
  const format = r.u16(subBase);
  if (format === 4) {
    return makeFormat4Lookup(r, subBase);
  }
  if (format === 12) {
    return makeFormat12Lookup(r, subBase);
  }
  return () => {
    throw new Error(
      `pdf: cmap format ${format} not supported (c.2a covers 4+12)`,
    );
  };
}

/** A format-4 (segment-mapped BMP) `codepoint → gid` lookup. */
function makeFormat4Lookup(r: Reader, subBase: number): CmapLookup {
  // format(2) + length(2) + language(2) + segCountX2(2) + search fields(6),
  // then endCode[], reservedPad(2), startCode[], idDelta[], idRangeOffset[],
  // glyphIdArray[]. We capture array base offsets; reads are bounds-checked.
  const segCount = r.u16(subBase + 6) / 2;
  const endBase = subBase + 14;
  const startBase = endBase + segCount * 2 + 2; // + reservedPad
  const deltaBase = startBase + segCount * 2;
  const rangeOffsetBase = deltaBase + segCount * 2;
  const glyphIdArrayBase = rangeOffsetBase + segCount * 2;

  return (codepoint: number): number => {
    // Format 4 only covers the BMP; astral codepoints are unmapped here.
    if (codepoint > 0xffff) {
      return 0;
    }
    // Linear segment search: first segment whose endCode >= codepoint.
    for (let i = 0; i < segCount; i++) {
      const endCode = r.u16(endBase + i * 2);
      if (endCode < codepoint) {
        continue;
      }
      const startCode = r.u16(startBase + i * 2);
      if (codepoint < startCode) {
        return 0; // hole between segments
      }
      const idDelta = r.i16(deltaBase + i * 2);
      const idRangeOffset = r.u16(rangeOffsetBase + i * 2);
      if (idRangeOffset === 0) {
        return (codepoint + idDelta) & 0xffff;
      }
      // glyphIdArray index, per spec, converting pointer-relative addressing
      // (relative to &idRangeOffset[i]) into a flat glyphIdArray index:
      //   glyphIdArray[ idRangeOffset/2 + (c - startCode) - (segCount - i) ]
      const glyphArrayIndex =
        idRangeOffset / 2 + (codepoint - startCode) - (segCount - i);
      const entry = r.u16(glyphIdArrayBase + glyphArrayIndex * 2);
      if (entry === 0) {
        return 0; // in-range hole → .notdef (NOT idDelta-shifted)
      }
      return (entry + idDelta) & 0xffff;
    }
    return 0;
  };
}

/** A format-12 (segmented coverage) `codepoint → gid` lookup. */
function makeFormat12Lookup(r: Reader, subBase: number): CmapLookup {
  // format(2) + reserved(2) + length(4) + language(4) + nGroups(4), then groups.
  const nGroups = r.u32(subBase + 12);
  const groupsBase = subBase + 16;

  return (codepoint: number): number => {
    // Linear group search: first group containing the codepoint.
    for (let i = 0; i < nGroups; i++) {
      const g = groupsBase + i * 12;
      const startCharCode = r.u32(g);
      const endCharCode = r.u32(g + 4);
      if (codepoint < startCharCode) {
        return 0; // groups are sorted ascending; past coverage
      }
      if (codepoint <= endCharCode) {
        const startGlyphID = r.u32(g + 8);
        return startGlyphID + (codepoint - startCharCode);
      }
    }
    return 0;
  };
}

/**
 * Parse an sfnt font — `glyf`-flavoured TrueType (`head` version `0x00010000`) or
 * OpenType-CFF (`OTTO`). The shared header/`head`/`hhea`/`maxp`/`hmtx`/`cmap`/
 * descriptor path is identical for both; the discriminant is `glyphFormat`, and an
 * `OTTO` font additionally parses its `CFF ` table into {@link ParsedFont.cff}.
 * Throws {@link MalformedFontError} on a malformed/truncated font, an unknown sfnt
 * version, or an `OTTO` font missing its required `CFF ` table.
 */
export function parseSfnt(bytes: Uint8Array): ParsedFont {
  const r = new Reader(bytes);

  const sfntVersion = r.u32(0);
  const isCff = sfntVersion === SFNT_VERSION_OTTO;
  if (sfntVersion !== SFNT_VERSION_TRUETYPE && !isCff) {
    throw new MalformedFontError(
      `unknown sfnt version 0x${sfntVersion.toString(16).padStart(8, "0")}`,
    );
  }

  // Table directory: numTables(2) + searchRange/entrySelector/rangeShift(6),
  // then numTables × { tag(4), checksum(4), offset(4), length(4) }.
  const numTables = r.u16(4);
  const tables = new Map<string, TableRecord>();
  const DIRECTORY_START = 12;
  const ENTRY_SIZE = 16;
  for (let i = 0; i < numTables; i++) {
    const entry = DIRECTORY_START + i * ENTRY_SIZE;
    const tag = r.tag(entry);
    // checksum @ entry + 4 is intentionally ignored.
    const offset = r.u32(entry + 8);
    const length = r.u32(entry + 12);
    tables.set(tag, { offset, length });
  }

  // head — units, bbox, macStyle, loca format.
  const head = requireTable(tables, "head");
  const unitsPerEm = r.u16(head.offset + 18);
  const xMin = r.i16(head.offset + 36);
  const yMin = r.i16(head.offset + 38);
  const xMax = r.i16(head.offset + 40);
  const yMax = r.i16(head.offset + 42);
  const macStyle = r.u16(head.offset + 44);
  const indexToLocFormat = r.i16(head.offset + 50);

  // hhea — ascender, descender, hMetrics count.
  const hhea = requireTable(tables, "hhea");
  const ascender = r.i16(hhea.offset + 4);
  const descender = r.i16(hhea.offset + 6);
  const numberOfHMetrics = r.u16(hhea.offset + 34);
  if (numberOfHMetrics < 1) {
    throw new MalformedFontError(
      `hhea.numberOfHMetrics must be >= 1, got ${numberOfHMetrics}`,
    );
  }

  // maxp — glyph count.
  const maxp = requireTable(tables, "maxp");
  const numGlyphs = r.u16(maxp.offset + 4);

  // hmtx — numberOfHMetrics × { advanceWidth(u16), lsb(i16) }.
  const hmtx = requireTable(tables, "hmtx");
  const advances: number[] = new Array<number>(numberOfHMetrics);
  for (let i = 0; i < numberOfHMetrics; i++) {
    advances[i] = r.u16(hmtx.offset + i * 4);
  }
  const lastAdvance = advances[numberOfHMetrics - 1];
  // The loop above filled indices 0..numberOfHMetrics-1, and numberOfHMetrics >= 1
  // was asserted, so the last advance is present.
  if (lastAdvance === undefined) {
    throw new MalformedFontError("hmtx: last advance unexpectedly absent");
  }

  // cmap — Unicode codepoint → gid (optional; absent → always .notdef).
  const cmapLookup = buildCmapLookup(r, tables);

  const advanceOf = (gid: number): number => {
    if (gid < 0) {
      throw new MalformedFontError(`advanceOf: negative gid ${gid}`);
    }
    // Tail-repeat: gid >= numberOfHMetrics reuses the last explicit advance.
    if (gid >= numberOfHMetrics) return lastAdvance;
    const advance = advances[gid];
    // gid is in [0, numberOfHMetrics), exactly the filled index range above.
    if (advance === undefined) {
      throw new MalformedFontError(`hmtx: advance for gid ${gid} unexpectedly absent`);
    }
    return advance;
  };

  const bbox: readonly [number, number, number, number] = [xMin, yMin, xMax, yMax];

  // descriptor — PDF /FontDescriptor metrics in 1000-em space (OS/2, post, name).
  const descriptor = buildDescriptor(r, tables, {
    unitsPerEm,
    bbox,
    macStyle,
    hheaAscender: ascender,
    hheaDescender: descender,
    numGlyphs,
  });

  // glyph-outline source: OTTO requires a `CFF ` table; a `glyf` TrueType carries
  // its outlines in `glyf`/`loca`, which this parser never reads (it only emits the
  // raw program bytes downstream), so those tables are deliberately NOT required
  // here — only their format is recorded.
  let glyphFormat: "glyf" | "cff";
  let cff: CffInfo | undefined;
  if (isCff) {
    const cffRec = requireTable(tables, "CFF ");
    cff = parseCff(bytes, cffRec.offset, cffRec.length, numGlyphs);
    glyphFormat = "cff";
  } else {
    glyphFormat = "glyf";
  }

  return {
    glyphFormat,
    cff,
    unitsPerEm,
    numGlyphs,
    bbox,
    macStyle,
    indexToLocFormat,
    ascender,
    descender,
    advanceOf,
    cmapLookup,
    bytes,
    tables,
    descriptor,
  };
}

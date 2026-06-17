/**
 * `glyf`-flavoured TrueType subsetting: keep the outlines of the used GIDs and
 * their transitively-referenced composite components; zero every other glyph's
 * outline (a 0-length `loca` range). GID numbering is preserved (numGlyphs, the
 * loca count, every other table) so the rest of the PDF pipeline is untouched —
 * only the `glyf` and `loca` table BODIES change.
 */

import { MalformedFontError, Reader, type TableRecord } from "./truetype-parser";
import { assembleSfnt, type SfntTableOut } from "./sfnt-assembler";

// TrueType composite-glyph component flag bits (OpenType `glyf` spec).
const ARG_1_AND_2_ARE_WORDS = 0x0001;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;

function requireTableRec(tables: ReadonlyMap<string, TableRecord>, tag: string): TableRecord {
  const rec = tables.get(tag);
  if (rec === undefined) {
    throw new MalformedFontError(`glyf subsetting requires table '${tag}'`);
  }
  return rec;
}

/** Read the `loca` offsets (numGlyphs+1 entries) into absolute `glyf`-relative byte offsets. */
function readLoca(r: Reader, locaOffset: number, numGlyphs: number, longLoca: boolean): number[] {
  const offsets: number[] = [];
  for (let i = 0; i <= numGlyphs; i++) {
    offsets.push(longLoca ? r.u32(locaOffset + i * 4) : r.u16(locaOffset + i * 2) * 2);
  }
  return offsets;
}

/**
 * Expand `usedGids` to include every transitively-referenced composite component.
 * A glyph with numberOfContours < 0 is composite; its component records each name
 * a `glyphIndex` that must also survive. Bounds every read by the glyph's own
 * [base, glyphEnd) so a malformed record can't walk into the next glyph.
 */
function computeGlyfClosure(
  r: Reader,
  glyfOffset: number,
  loca: readonly number[],
  usedGids: ReadonlySet<number>,
  numGlyphs: number,
): Set<number> {
  const closure = new Set<number>(usedGids);
  const stack = [...usedGids];
  while (stack.length > 0) {
    const gid = stack.pop();
    if (gid === undefined || gid < 0 || gid >= numGlyphs) continue;
    const start = loca[gid];
    const end = loca[gid + 1];
    if (start === undefined || end === undefined || end <= start) continue; // empty glyph
    if (end - start < 10) continue; // shorter than the 10-byte glyph header → not a composite
    const base = glyfOffset + start;
    const glyphEnd = glyfOffset + end;
    const numberOfContours = r.i16(base);
    if (numberOfContours >= 0) continue; // simple glyph — no components
    let p = base + 10; // component records start after the 10-byte glyph header
    for (;;) {
      if (p + 4 > glyphEnd) {
        throw new MalformedFontError(`glyf composite glyph ${gid} component record overruns its loca extent`);
      }
      const flags = r.u16(p);
      const componentGid = r.u16(p + 2);
      if (!closure.has(componentGid)) {
        closure.add(componentGid);
        stack.push(componentGid);
      }
      p += 4; // flags(2) + glyphIndex(2)
      p += (flags & ARG_1_AND_2_ARE_WORDS) !== 0 ? 4 : 2; // args
      if ((flags & WE_HAVE_A_SCALE) !== 0) p += 2;
      else if ((flags & WE_HAVE_AN_X_AND_Y_SCALE) !== 0) p += 4;
      else if ((flags & WE_HAVE_A_TWO_BY_TWO) !== 0) p += 8;
      if ((flags & MORE_COMPONENTS) === 0) break;
    }
  }
  return closure;
}

export function subsetGlyf(
  bytes: Uint8Array,
  tables: ReadonlyMap<string, TableRecord>,
  indexToLocFormat: number,
  numGlyphs: number,
  usedGids: ReadonlySet<number>,
): Uint8Array {
  const r = new Reader(bytes);
  const loca = requireTableRec(tables, "loca");
  const glyf = requireTableRec(tables, "glyf");
  const longLoca = indexToLocFormat === 1;

  const locaOffsets = readLoca(r, loca.offset, numGlyphs, longLoca);
  const closure = computeGlyfClosure(r, glyf.offset, locaOffsets, usedGids, numGlyphs);

  // Rebuild glyf in GID order: kept glyphs verbatim, unused glyphs contribute 0 bytes.
  const parts: Uint8Array[] = [];
  const newOffsets: number[] = [0];
  let cursor = 0;
  for (let gid = 0; gid < numGlyphs; gid++) {
    const start = locaOffsets[gid];
    const end = locaOffsets[gid + 1];
    if (closure.has(gid) && start !== undefined && end !== undefined && end > start) {
      // Short-loca source offsets are stored as offset/2, so every source glyph
      // extent (end-start) is even; long-loca offsets are exact. Either way the
      // copied body length is already loca-representable, so the rebuilt loca
      // offsets stay exact with no per-glyph padding.
      const body = bytes.subarray(glyf.offset + start, glyf.offset + end);
      parts.push(body);
      cursor += body.length;
    }
    newOffsets.push(cursor);
  }

  const newGlyf = new Uint8Array(cursor);
  let p = 0;
  for (const part of parts) {
    newGlyf.set(part, p);
    p += part.length;
  }

  const newLoca = new Uint8Array((longLoca ? 4 : 2) * newOffsets.length);
  const lv = new DataView(newLoca.buffer);
  newOffsets.forEach((off, i) => {
    if (longLoca) lv.setUint32(i * 4, off);
    else lv.setUint16(i * 2, off / 2);
  });

  // Reassemble: every original table verbatim except glyf+loca replaced (sorted by
  // tag for deterministic output).
  const out: SfntTableOut[] = [];
  for (const [tag, rec] of [...tables.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (tag === "glyf") out.push({ tag, body: newGlyf });
    else if (tag === "loca") out.push({ tag, body: newLoca });
    else out.push({ tag, body: bytes.subarray(rec.offset, rec.offset + rec.length) });
  }
  return assembleSfnt(0x00010000, out);
}

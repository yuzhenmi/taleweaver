/**
 * PRODUCTION sfnt table-directory writer. Lays out an sfnt from a sfntVersion and
 * an ordered list of `{ tag, body }` tables: the 12-byte header (sfntVersion +
 * numTables + 3 search fields), the table directory (per-table tag/checksum/
 * offset/length), then the 4-byte-aligned table bodies at the recorded offsets.
 *
 * This duplicates the ~50-line layout of `test-support/sfnt-builder.ts`'s
 * (test-only) `assembleSfnt` ON PURPOSE: subsetting runs in production (`src/`),
 * which must not import test-support. Table checksums are written 0 (PDF viewers
 * don't validate them); a copied `head` body's checkSumAdjustment is left as-is.
 */

/** A 4-byte-aligned sfnt table to emit. */
export interface SfntTableOut {
  readonly tag: string;
  readonly body: Uint8Array;
}

/** Pad `body` up to a 4-byte boundary (sfnt tables must be 4-byte aligned). */
function pad4(body: Uint8Array): Uint8Array {
  const rem = body.length % 4;
  if (rem === 0) return body;
  const out = new Uint8Array(body.length + (4 - rem));
  out.set(body);
  return out;
}

export function assembleSfnt(sfntVersion: number, tables: readonly SfntTableOut[]): Uint8Array {
  const numTables = tables.length;
  const headerSize = 12; // sfntVersion(4) + numTables(2) + 3 search fields(6)
  const dirSize = numTables * 16; // each entry: tag(4)+checksum(4)+offset(4)+length(4)
  const bodyStart = headerSize + dirSize;

  const placed: { tag: string; offset: number; length: number; padded: Uint8Array }[] = [];
  let cursor = bodyStart;
  for (const t of tables) {
    const padded = pad4(t.body);
    placed.push({ tag: t.tag, offset: cursor, length: t.body.length, padded });
    cursor += padded.length;
  }

  const out = new Uint8Array(cursor);
  const view = new DataView(out.buffer);

  view.setUint32(0, sfntVersion);
  view.setUint16(4, numTables);
  // Spec-valid search fields (the parser ignores them; compute for correctness).
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

  placed.forEach((p, i) => {
    const entryOff = headerSize + i * 16;
    for (let c = 0; c < 4; c++) {
      out[entryOff + c] = p.tag.charCodeAt(c);
    }
    view.setUint32(entryOff + 4, 0); // checksum (parser ignores)
    view.setUint32(entryOff + 8, p.offset);
    view.setUint32(entryOff + 12, p.length);
  });

  for (const p of placed) {
    out.set(p.padded, p.offset);
  }
  return out;
}

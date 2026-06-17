import { MalformedFontError, Reader } from "./truetype-parser";

/** A located CFF INDEX item, as absolute byte offset+length into the source. */
export interface CffIndexItem {
  readonly offset: number;
  readonly length: number;
}

/** A parsed CFF INDEX: item ranges + the byte offset just past the INDEX. */
export interface CffIndex {
  readonly items: readonly CffIndexItem[];
  readonly end: number;
}

/** Read a big-endian unsigned integer of `size` (1..4) bytes at `at`. */
function uBE(r: Reader, at: number, size: number): number {
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + r.u8(at + i);
  return v;
}

/**
 * Read a CFF INDEX at `pos` (CFF spec / Adobe TN#5176 §5). An INDEX is
 * count(u16); if count===0 the INDEX is just those 2 bytes. Otherwise
 * offSize(u8) then (count+1) offsets of offSize bytes (1-based, relative to the
 * byte BEFORE the object data), then the object data.
 */
export function readCffIndex(r: Reader, pos: number): CffIndex {
  const count = r.u16(pos);
  if (count === 0) return { items: [], end: pos + 2 };
  const offSize = r.u8(pos + 2);
  if (offSize < 1 || offSize > 4) {
    throw new MalformedFontError(`cff INDEX offSize ${offSize} out of [1,4]`);
  }
  const offsetArrayStart = pos + 3;
  const dataBase = offsetArrayStart + (count + 1) * offSize - 1;
  const offsetAt = (i: number): number =>
    uBE(r, offsetArrayStart + i * offSize, offSize);
  const items: CffIndexItem[] = [];
  for (let i = 0; i < count; i++) {
    const start = dataBase + offsetAt(i);
    const next = dataBase + offsetAt(i + 1);
    if (next < start) throw new MalformedFontError(`cff INDEX offset ${i} decreases`);
    items.push({ offset: start, length: next - start });
  }
  return { items, end: dataBase + offsetAt(count) };
}

/** The Top DICT entries we consume (offsets are bytes from the CFF table start). */
export interface CffTopDict {
  readonly charsetOffset: number | undefined;
  readonly charStringsOffset: number | undefined;
  readonly ros:
    | {
        readonly registrySid: number;
        readonly orderingSid: number;
        readonly supplement: number;
      }
    | undefined;
}

/**
 * Parse a CFF Top DICT (the bytes `[start,end)`), returning the entries we need
 * (CFF spec §4). A DICT is a sequence of operands followed by an operator;
 * operators 0..21 (with 12 = a 2-byte "escape" operator). We collect operator
 * 15 (charset offset), 17 (CharStrings offset), and 12 30 (ROS → CID-keyed).
 * Real-number operands (b0 === 30) and operators we don't use are skipped.
 */
export function parseTopDict(r: Reader, start: number, end: number): CffTopDict {
  const operands: number[] = [];
  let charsetOffset: number | undefined;
  let charStringsOffset: number | undefined;
  let ros: CffTopDict["ros"];
  let i = start;
  while (i < end) {
    const b0 = r.u8(i);
    if (b0 <= 21) {
      // operator
      let op = b0;
      i += 1;
      if (b0 === 12) {
        op = 1200 + r.u8(i);
        i += 1;
      }
      if (op === 15) charsetOffset = operands[operands.length - 1];
      else if (op === 17) charStringsOffset = operands[operands.length - 1];
      else if (op === 1230) {
        // ROS: registry SID, ordering SID, supplement. Destructure with explicit
        // undefined-checks (NO `!`); a short ROS is malformed → skip it.
        const [reg, ord, supp] = operands;
        if (reg !== undefined && ord !== undefined && supp !== undefined) {
          ros = { registrySid: reg, orderingSid: ord, supplement: supp };
        }
      }
      operands.length = 0;
      continue;
    }
    // operand
    if (b0 === 28) {
      operands.push(r.i16(i + 1)); // signed int16
      i += 3;
    } else if (b0 === 29) {
      operands.push(r.i32(i + 1)); // signed int32
      i += 5;
    } else if (b0 === 30) {
      // real: nibbles until 0xf. Value unused by us — skip to the terminator.
      i += 1;
      let done = false;
      while (i < end && !done) {
        const byte = r.u8(i);
        i += 1;
        if ((byte & 0x0f) === 0x0f || (byte >> 4) === 0x0f) done = true;
      }
      operands.push(0); // placeholder operand (we never read a real for our ops)
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      i += 1;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + r.u8(i + 1) + 108);
      i += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - r.u8(i + 1) - 108);
      i += 2;
    } else {
      throw new MalformedFontError(`cff DICT reserved operand byte ${b0}`);
    }
  }
  return { charsetOffset, charStringsOffset, ros };
}

/**
 * Parse a CFF `charset` (CFF spec §13) into GID→CID. The charset enumerates GIDs
 * 1..numGlyphs−1 (GID 0 = .notdef is implicit and maps to CID 0). Formats:
 * 0 = one SID/CID (u16) per glyph; 1 = ranges (first u16, nLeft u8); 2 = ranges
 * (first u16, nLeft u16). For a CID-keyed font the "SID" values ARE CIDs.
 */
export function parseCharset(r: Reader, offset: number, numGlyphs: number): Map<number, number> {
  const map = new Map<number, number>();
  const format = r.u8(offset);
  let gid = 1;
  if (format === 0) {
    let p = offset + 1;
    while (gid < numGlyphs) {
      map.set(gid, r.u16(p));
      p += 2;
      gid += 1;
    }
  } else if (format === 1 || format === 2) {
    let p = offset + 1;
    while (gid < numGlyphs) {
      const first = r.u16(p);
      p += 2;
      const nLeft = format === 1 ? r.u8(p) : r.u16(p);
      p += format === 1 ? 1 : 2;
      for (let k = 0; k <= nLeft && gid < numGlyphs; k++) {
        map.set(gid, first + k);
        gid += 1;
      }
    }
  } else {
    throw new MalformedFontError(`cff charset format ${format} unsupported`);
  }
  return map;
}

/** First SID assigned to the String INDEX (SIDs below this are standard strings). */
const N_STD_STRINGS = 391;

/**
 * Resolve a CFF String ID to its string. SID ≥ 391 indexes the String INDEX
 * (`stringIndex.items[SID − 391]`); SID < 391 is a standard string — which we do
 * NOT carry (design §4.2): a ROS using one is rejected (never silent garbage).
 */
export function resolveStringSid(r: Reader, stringIndex: CffIndex, sid: number): string {
  if (sid < N_STD_STRINGS) {
    throw new MalformedFontError(`cff ROS uses a standard-string SID ${sid}; unsupported`);
  }
  const item = stringIndex.items[sid - N_STD_STRINGS];
  if (item === undefined) {
    throw new MalformedFontError(`cff SID ${sid} out of String INDEX range`);
  }
  let s = "";
  for (let i = 0; i < item.length; i++) s += String.fromCharCode(r.u8(item.offset + i));
  return s;
}

/** Everything embedding needs from the `CFF ` table. */
export interface CffInfo {
  readonly isCidKeyed: boolean;
  /** The bare `CFF `-table bytes (for FontFile3 /CIDFontType0C). */
  readonly programBytes: Uint8Array;
  /** GID→CID — present iff isCidKeyed (else CID === GID; not built). */
  readonly gidToCid?: ReadonlyMap<number, number>;
  /** Registry/Ordering/Supplement from the Top DICT ROS — present iff isCidKeyed. */
  readonly ros?: { readonly registry: string; readonly ordering: string; readonly supplement: number };
}

/**
 * Parse a `CFF ` table located at `[cffOffset, cffOffset+cffLength)` in `bytes`,
 * cross-validated against the sfnt `maxp` glyph count. Reads only what embedding
 * needs (header → Name INDEX skip → Top DICT → String INDEX → charset); the
 * charstrings/outlines pass through bytewise in `programBytes`.
 */
export function parseCff(bytes: Uint8Array, cffOffset: number, cffLength: number, numGlyphs: number): CffInfo {
  const programBytes = bytes.subarray(cffOffset, cffOffset + cffLength);
  const r = new Reader(programBytes); // CFF offsets are relative to the CFF table start
  const hdrSize = r.u8(2);
  // Name INDEX (skipped) → Top DICT INDEX → String INDEX.
  const nameIndex = readCffIndex(r, hdrSize);
  const topDictIndex = readCffIndex(r, nameIndex.end);
  const stringIndex = readCffIndex(r, topDictIndex.end);
  const top = topDictIndex.items[0];
  if (top === undefined) throw new MalformedFontError("cff Top DICT INDEX is empty");
  const td = parseTopDict(r, top.offset, top.offset + top.length);

  // Cross-validate maxp.numGlyphs against the CharStrings INDEX count (design §4.2).
  if (td.charStringsOffset === undefined) {
    throw new MalformedFontError("cff Top DICT has no CharStrings");
  }
  const charStringsCount = r.u16(td.charStringsOffset);
  if (charStringsCount !== numGlyphs) {
    throw new MalformedFontError(
      `cff CharStrings count ${charStringsCount} != maxp numGlyphs ${numGlyphs}`,
    );
  }

  if (td.ros === undefined) {
    return { isCidKeyed: false, programBytes };
  }
  if (td.charsetOffset === undefined || td.charsetOffset <= 2) {
    // 0/1/2 are predefined charsets (ISOAdobe/Expert/ExpertSubset) — a CID-keyed
    // font always has a custom charset offset > 2.
    throw new MalformedFontError("cff CID-keyed font lacks a custom charset");
  }
  const gidToCid = parseCharset(r, td.charsetOffset, numGlyphs);
  const ros = {
    registry: resolveStringSid(r, stringIndex, td.ros.registrySid),
    ordering: resolveStringSid(r, stringIndex, td.ros.orderingSid),
    supplement: td.ros.supplement,
  };
  return { isCidKeyed: true, programBytes, gidToCid, ros };
}

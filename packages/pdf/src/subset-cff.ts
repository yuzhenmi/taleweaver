/**
 * OpenType-CFF subsetting: rebuild the CharStrings INDEX (used glyphs verbatim,
 * unused → a single `endchar`) and re-emit the whole `CFF ` table in a canonical
 * layout, copying every non-CharStrings structure VERBATIM at recomputed
 * positions and rewriting the Top-DICT (and, for CID-keyed fonts, the FD-DICT)
 * offset operators with FIXED-WIDTH operands. GID/CID numbering is preserved.
 *
 * THIS FILE (T4) provides the parsing half: a generic DICT decoder that captures
 * raw operand bytes, and a structure locator. T5/T6 add the INDEX encoder,
 * CharStrings rebuild, and the canonical re-emit.
 */

import { MalformedFontError, Reader } from "./truetype-parser";
import { readCffIndex, type CffIndex } from "./cff-parser";

/**
 * A decoded CFF DICT entry: an operator (12-escapes encoded as 1200 + b1), its
 * decoded operand values, AND the RAW source bytes of those operands. The raw
 * bytes are load-bearing: when the rebuild re-emits an operator it does NOT
 * relocate, it copies `operandBytes` VERBATIM — preserving real-number operands
 * (e.g. FontMatrix `12 7` = `0.001 0 0 0.001 0 0`) byte-for-byte. Decoding reals
 * to a numeric value is lossy (b0 === 30 → a 0 placeholder), so only the verbatim
 * bytes are trustworthy for non-rewritten operators; `operands` is consulted ONLY
 * for the integer offset operators the rebuild rewrites (15/16/17/18/12·36/12·37).
 */
export interface DictEntry {
  readonly op: number;
  readonly operands: number[];
  /** The raw source bytes of this entry's operands (excluding the operator byte(s)). */
  readonly operandBytes: Uint8Array;
}

/**
 * Decode a CFF DICT (`[start, end)`) into operator entries. Captures the raw
 * operand bytes of each entry (for verbatim re-emit). Real operands (b0 === 30)
 * decode to a 0 numeric placeholder, but their raw bytes are preserved.
 */
export function decodeDict(r: Reader, start: number, end: number): DictEntry[] {
  const entries: DictEntry[] = [];
  let operands: number[] = [];
  let runStart = start; // first byte of the current operand run
  let i = start;
  while (i < end) {
    const b0 = r.u8(i);
    if (b0 <= 21) {
      let op = b0;
      const opStart = i;
      i += 1;
      if (b0 === 12) {
        op = 1200 + r.u8(i);
        i += 1;
      }
      const operandBytes = new Uint8Array(opStart - runStart);
      for (let k = 0; k < operandBytes.length; k++) operandBytes[k] = r.u8(runStart + k);
      entries.push({ op, operands, operandBytes });
      operands = [];
      runStart = i;
      continue;
    }
    if (b0 === 28) {
      operands.push(r.i16(i + 1));
      i += 3;
    } else if (b0 === 29) {
      operands.push(r.i32(i + 1));
      i += 5;
    } else if (b0 === 30) {
      i += 1;
      let done = false;
      while (i < end && !done) {
        const byte = r.u8(i);
        i += 1;
        if ((byte & 0x0f) === 0x0f || (byte >> 4) === 0x0f) done = true;
      }
      operands.push(0);
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
  return entries;
}

/** Find the single (last) operand value of operator `op` in `entries` (or undefined). */
function dictVal(entries: readonly DictEntry[], op: number): number | undefined {
  const e = entries.find((x) => x.op === op);
  if (e === undefined) return undefined;
  return e.operands[e.operands.length - 1];
}

/** Find the two operands `[size, offset]` of a Private (op 18) entry. */
function privateVal(entries: readonly DictEntry[]): { size: number; offset: number } | undefined {
  const e = entries.find((x) => x.op === 18);
  if (e === undefined) return undefined;
  const size = e.operands[0];
  const offset = e.operands[1];
  if (size === undefined || offset === undefined) return undefined;
  return { size, offset };
}

/** Byte length of a `charset` at `offset` for `numGlyphs` glyphs (CFF spec §13). */
export function charsetLength(r: Reader, offset: number, numGlyphs: number): number {
  const format = r.u8(offset);
  if (format === 0) return 1 + Math.max(0, numGlyphs - 1) * 2;
  if (format === 1 || format === 2) {
    let gid = 1;
    let p = offset + 1;
    while (gid < numGlyphs) {
      p += 2; // first SID/CID (u16)
      const nLeft = format === 1 ? r.u8(p) : r.u16(p);
      p += format === 1 ? 1 : 2;
      gid += nLeft + 1;
    }
    return p - offset;
  }
  throw new MalformedFontError(`cff charset format ${format} unsupported`);
}

/** Byte length of an `Encoding` at `offset` (CFF spec §12); offsets 0/1 are predefined. */
export function encodingLength(r: Reader, offset: number): number {
  const format = r.u8(offset);
  const base = format & 0x7f;
  let len: number;
  if (base === 0) {
    const nCodes = r.u8(offset + 1);
    len = 2 + nCodes;
  } else if (base === 1) {
    const nRanges = r.u8(offset + 1);
    len = 2 + nRanges * 2;
  } else {
    throw new MalformedFontError(`cff Encoding format ${format} unsupported`);
  }
  if ((format & 0x80) !== 0) {
    const nSups = r.u8(offset + len);
    len += 1 + nSups * 3;
  }
  return len;
}

/** Byte length of an `FDSelect` at `offset` for `numGlyphs` glyphs (CFF spec §19). */
export function fdselectLength(r: Reader, offset: number, numGlyphs: number): number {
  const format = r.u8(offset);
  if (format === 0) return 1 + numGlyphs;
  if (format === 3) {
    const nRanges = r.u16(offset + 1);
    return 1 + 2 + nRanges * 3 + 2; // format + nRanges + ranges + sentinel
  }
  throw new MalformedFontError(`cff FDSelect format ${format} unsupported`);
}

/** A located, copy-verbatim CFF byte range. */
export interface CffBlob {
  readonly offset: number;
  readonly length: number;
}

/** A located Private DICT (+ its Local Subrs), copied as one verbatim blob. */
export interface PrivateBlob {
  readonly blob: CffBlob;
  /** The op-18 size operand (preserved unchanged; only the offset is rewritten). */
  readonly size: number;
}

/** Everything the CFF rebuild needs, located within the bare CFF bytes. */
export interface CffStructures {
  readonly hdrSize: number;
  readonly nameIndex: CffIndex;
  readonly topDictIndexEnd: number;
  readonly topDict: DictEntry[];
  readonly stringIndex: CffIndex;
  readonly globalSubrIndex: CffIndex;
  readonly charStrings: CffIndex;
  readonly isCidKeyed: boolean;
  readonly charset?: CffBlob;
  readonly encoding?: CffBlob;
  readonly fdSelect?: CffBlob;
  readonly fdArray?: CffIndex;
  readonly fdPrivates?: PrivateBlob[];
  readonly topPrivate?: PrivateBlob;
}

/** Read a Private DICT (+ optional Local Subrs) as one verbatim blob. */
function readPrivateBlob(r: Reader, size: number, offset: number): PrivateBlob {
  const priv = decodeDict(r, offset, offset + size);
  const subrsRel = dictVal(priv, 19); // Subrs offset, relative to the Private DICT
  let end = offset + size;
  if (subrsRel !== undefined && subrsRel > 0) {
    const localSubrs = readCffIndex(r, offset + subrsRel);
    end = Math.max(end, localSubrs.end);
  }
  return { blob: { offset, length: end - offset }, size };
}

/**
 * Parse the `CFF ` table and locate every structure the rebuild must place.
 * Validates `CharStrings.count === numGlyphs`.
 */
export function locateCffStructures(cff: Uint8Array, numGlyphs: number): CffStructures {
  const r = new Reader(cff);
  const hdrSize = r.u8(2);
  const nameIndex = readCffIndex(r, hdrSize);
  const topDictIndex = readCffIndex(r, nameIndex.end);
  const stringIndex = readCffIndex(r, topDictIndex.end);
  const globalSubrIndex = readCffIndex(r, stringIndex.end);

  const topItem = topDictIndex.items[0];
  if (topItem === undefined) throw new MalformedFontError("cff Top DICT INDEX is empty");
  const topDict = decodeDict(r, topItem.offset, topItem.offset + topItem.length);

  const charStringsOffset = dictVal(topDict, 17);
  if (charStringsOffset === undefined) {
    throw new MalformedFontError("cff Top DICT has no CharStrings");
  }
  const charStrings = readCffIndex(r, charStringsOffset);
  if (charStrings.items.length !== numGlyphs) {
    throw new MalformedFontError(
      `cff CharStrings count ${charStrings.items.length} != numGlyphs ${numGlyphs}`,
    );
  }

  const isCidKeyed = topDict.some((e) => e.op === 1230); // ROS

  let charset: CffBlob | undefined;
  const charsetOffset = dictVal(topDict, 15);
  if (charsetOffset !== undefined && charsetOffset > 2) {
    charset = { offset: charsetOffset, length: charsetLength(r, charsetOffset, numGlyphs) };
  }

  if (!isCidKeyed) {
    // Encoding (op 16) applies only to non-CID fonts; a custom Encoding (offset > 1)
    // is a relocatable blob. CID-keyed fonts have no Encoding (CFF spec — they map
    // glyphs via FDSelect), so it is computed only on this branch.
    let encoding: CffBlob | undefined;
    const encodingOffset = dictVal(topDict, 16);
    if (encodingOffset !== undefined && encodingOffset > 1) {
      encoding = { offset: encodingOffset, length: encodingLength(r, encodingOffset) };
    }
    const priv = privateVal(topDict);
    const topPrivate = priv !== undefined ? readPrivateBlob(r, priv.size, priv.offset) : undefined;
    return {
      hdrSize,
      nameIndex,
      topDictIndexEnd: topDictIndex.end,
      topDict,
      stringIndex,
      globalSubrIndex,
      charStrings,
      isCidKeyed: false,
      charset,
      encoding,
      topPrivate,
    };
  }

  const fdArrayOffset = dictVal(topDict, 1236);
  const fdSelectOffset = dictVal(topDict, 1237);
  if (fdArrayOffset === undefined || fdSelectOffset === undefined) {
    throw new MalformedFontError("cff CID-keyed font missing FDArray/FDSelect");
  }
  const fdArray = readCffIndex(r, fdArrayOffset);
  const fdSelect: CffBlob = {
    offset: fdSelectOffset,
    length: fdselectLength(r, fdSelectOffset, numGlyphs),
  };
  const fdPrivates: PrivateBlob[] = [];
  for (const fd of fdArray.items) {
    const fdDict = decodeDict(r, fd.offset, fd.offset + fd.length);
    const priv = privateVal(fdDict);
    if (priv === undefined) throw new MalformedFontError("cff FD DICT lacks a Private");
    fdPrivates.push(readPrivateBlob(r, priv.size, priv.offset));
  }
  return {
    hdrSize,
    nameIndex,
    topDictIndexEnd: topDictIndex.end,
    topDict,
    stringIndex,
    globalSubrIndex,
    charStrings,
    isCidKeyed: true,
    charset,
    // no `encoding` — CID-keyed CFF has none
    fdSelect,
    fdArray,
    fdPrivates,
  };
}

/** Encode a CFF INDEX (Adobe TN#5176 §5) from byte items. count===0 → `[0,0]`. */
export function encodeCffIndex(items: readonly Uint8Array[]): Uint8Array {
  if (items.length === 0) return Uint8Array.of(0, 0);
  let total = 0;
  for (const it of items) total += it.length;
  // offSize: the smallest byte width that holds the largest 1-based offset (total+1).
  const maxOffset = total + 1;
  const offSize = maxOffset <= 0xff ? 1 : maxOffset <= 0xffff ? 2 : maxOffset <= 0xffffff ? 3 : 4;
  const offsets: number[] = [1];
  let running = 1;
  for (const it of items) {
    running += it.length;
    offsets.push(running);
  }
  const headerSize = 2 + 1 + offsets.length * offSize; // count(2) + offSize(1) + offsets
  const out = new Uint8Array(headerSize + total);
  const v = new DataView(out.buffer);
  v.setUint16(0, items.length);
  out[2] = offSize;
  let p = 3;
  for (const off of offsets) {
    for (let b = offSize - 1; b >= 0; b--) out[p++] = (off >> (b * 8)) & 0xff;
  }
  for (const it of items) {
    out.set(it, p);
    p += it.length;
  }
  return out;
}

/**
 * Rebuild the per-GID CharStrings items: a used GID's charstring bytes verbatim,
 * an unused GID → a single `endchar` (0x0E) — a complete, valid empty Type2
 * charstring (TN#5177; the width defaults from the Private DICT, no preamble).
 */
export function rebuildCharStrings(
  cff: Uint8Array,
  charStrings: CffIndex,
  usedGids: ReadonlySet<number>,
): Uint8Array[] {
  return charStrings.items.map((item, gid) =>
    usedGids.has(gid) ? cff.subarray(item.offset, item.offset + item.length) : Uint8Array.of(0x0e),
  );
}

/** A 5-byte fixed-width CFF DICT integer operand (`29` + big-endian i32). */
function fixedOperand(v: number): Uint8Array {
  return Uint8Array.of(29, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
}

/**
 * Re-encode a DICT. An operator in `rewrites` (always an INTEGER offset operator)
 * has its offset operand replaced by the new value in fixed-width 5-byte form; the
 * Private op (18) keeps its [size] operand (also fixed-width integer) and rewrites
 * the offset. EVERY OTHER operator is re-emitted with its ORIGINAL operand bytes
 * VERBATIM (`e.operandBytes`) — this is what preserves real-number operands like
 * FontMatrix (`12 7`) byte-for-byte (decoding them to numbers is lossy).
 *
 * Length-invariance for the fixpoint: a non-rewritten operator's bytes are
 * identical across the placeholder and real passes (verbatim), and a rewritten
 * operator is fixed-width (constant 5 bytes — or 10 for op 18) regardless of the
 * offset VALUE. So the DICT length is identical between the two passes; the
 * caller's `length !== placeholder.length` assert guards any violation.
 */
function encodeDict(entries: readonly DictEntry[], rewrites: ReadonlyMap<number, number>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    if (rewrites.has(e.op)) {
      if (e.op === 18) {
        // Private: [size, offset]. Keep size (an integer); rewrite the offset.
        const size = e.operands[0] ?? 0;
        const offset = rewrites.get(18) ?? 0;
        parts.push(fixedOperand(size), fixedOperand(offset));
      } else {
        // A single-operand integer offset operator (15/16/17/12·36/12·37).
        parts.push(fixedOperand(rewrites.get(e.op) ?? 0));
      }
    } else {
      // Not relocated → original operand bytes verbatim (reals survive intact).
      parts.push(e.operandBytes);
    }
    parts.push(e.op >= 1200 ? Uint8Array.of(12, e.op - 1200) : Uint8Array.of(e.op));
  }
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

export function subsetCff(cff: Uint8Array, numGlyphs: number, usedGids: ReadonlySet<number>): Uint8Array {
  const loc = locateCffStructures(cff, numGlyphs);

  // Rebuild the dynamic structures whose SIZE differs from the original.
  const charStringsBytes = encodeCffIndex(rebuildCharStrings(cff, loc.charStrings, usedGids));

  // Fixed prefix structures, copied VERBATIM at recomputed positions: header,
  // Name INDEX, String INDEX, Global Subr INDEX. The Top DICT INDEX is rebuilt
  // (its offset operators rewritten); rewritten operators are fixed-width and
  // non-rewritten operators keep their original bytes, so the DICT length is
  // value-independent and we can size everything BEFORE knowing final offsets.
  //
  // Copy each INDEX by its known [start, end): the String INDEX starts at the Top
  // DICT INDEX's end (= the offset just past the Name INDEX → Top DICT INDEX).
  const header = cff.subarray(0, loc.hdrSize);
  const nameBytes = cff.subarray(loc.hdrSize, loc.nameIndex.end);
  const stringStart = loc.topDictIndexEnd; // = Top DICT INDEX end
  const stringBytes = cff.subarray(stringStart, loc.stringIndex.end);
  const globalBytes = cff.subarray(loc.stringIndex.end, loc.globalSubrIndex.end);

  // Size the rewritten Top DICT (and FD DICTs) with placeholder offsets — fixed
  // width ⇒ final length now. We rebuild the Top DICT INDEX wrapper around it.
  const placeholderRewrites = topDictRewriteKeys(loc);
  const topDictPlaceholder = encodeDict(loc.topDict, placeholderRewrites);
  const topDictIndexLen = encodeCffIndex([topDictPlaceholder]).length;

  // FD DICTs (CID): decode ONCE here, then reuse for both the placeholder sizing
  // (rewritten with placeholder Private offset → constant length) and the real
  // re-encode (with real Private offsets) below.
  const fdDicts: DictEntry[][] =
    loc.isCidKeyed && loc.fdArray !== undefined
      ? loc.fdArray.items.map((fd) => decodeDict(new Reader(cff), fd.offset, fd.offset + fd.length))
      : [];
  const fdDictPlaceholders = fdDicts.map((d) => encodeDict(d, new Map([[18, 0]])));
  const fdArrayLen = loc.isCidKeyed ? encodeCffIndex(fdDictPlaceholders).length : 0;

  // ---- Lay out canonical positions ----
  // A custom charset/Encoding (offset > 2 / > 1) is a relocatable blob whose Top-DICT
  // operator IS rewritten; a PREDEFINED charset (0/1/2) or Encoding (0/1) is
  // position-independent and is intentionally NOT in the rewrite map — `encodeDict`
  // re-emits its original small-int operand unchanged. The `: …` fallbacks below are
  // therefore only ever read when the blob is absent (predefined), and the value they
  // carry is harmless because that operator is not relocated.
  let pos = header.length + nameBytes.length + topDictIndexLen + stringBytes.length + globalBytes.length;
  const charsetPos = loc.charset !== undefined ? pos : (dictVal(loc.topDict, 15) ?? 0);
  if (loc.charset !== undefined) pos += loc.charset.length;
  const encodingPos = loc.encoding !== undefined ? pos : (dictVal(loc.topDict, 16) ?? 0);
  if (loc.encoding !== undefined) pos += loc.encoding.length;
  const fdSelectPos = loc.fdSelect !== undefined ? pos : 0;
  if (loc.fdSelect !== undefined) pos += loc.fdSelect.length;
  const charStringsPos = pos;
  pos += charStringsBytes.length;
  const fdArrayPos = loc.isCidKeyed ? pos : 0;
  pos += fdArrayLen;
  const privatePositions: number[] = [];
  const privBlobs: PrivateBlob[] = loc.isCidKeyed
    ? (loc.fdPrivates ?? [])
    : loc.topPrivate !== undefined
      ? [loc.topPrivate]
      : [];
  for (const pb of privBlobs) {
    privatePositions.push(pos);
    pos += pb.blob.length;
  }
  const totalLen = pos;

  // ---- Build the rewritten Top DICT with real offsets ----
  const topRewrites = new Map<number, number>();
  if (loc.charset !== undefined) topRewrites.set(15, charsetPos);
  if (loc.encoding !== undefined) topRewrites.set(16, encodingPos);
  topRewrites.set(17, charStringsPos);
  if (loc.isCidKeyed) {
    topRewrites.set(1236, fdArrayPos);
    topRewrites.set(1237, fdSelectPos);
  } else if (loc.topPrivate !== undefined) {
    topRewrites.set(18, privatePositions[0] ?? 0);
  }
  const topDict = encodeDict(loc.topDict, topRewrites);
  if (topDict.length !== topDictPlaceholder.length) {
    throw new MalformedFontError("cff Top DICT length changed with real offsets (fixpoint broken)");
  }
  const topDictIndexBytes = encodeCffIndex([topDict]);

  // ---- Build the rewritten FDArray (CID) with real Private offsets ----
  // Annotated as the (wider) type `encodeCffIndex` returns so the reassignment
  // below type-checks: `new Uint8Array(0)` alone narrows to a stricter buffer type.
  // Reassigned on the CID branch; the empty placeholder is never emitted because
  // `put(fdArrayBytes)` below is guarded by `loc.isCidKeyed`.
  let fdArrayBytes: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  if (loc.isCidKeyed && loc.fdArray !== undefined) {
    const fdDictBytes: Uint8Array[] = fdDicts.map((d, i) =>
      encodeDict(d, new Map([[18, privatePositions[i] ?? 0]])),
    );
    fdArrayBytes = encodeCffIndex(fdDictBytes);
    if (fdArrayBytes.length !== fdArrayLen) {
      throw new MalformedFontError("cff FDArray length changed with real offsets (fixpoint broken)");
    }
  }

  // ---- Emit the canonical CFF ----
  const out = new Uint8Array(totalLen);
  let w = 0;
  const put = (b: Uint8Array): void => {
    out.set(b, w);
    w += b.length;
  };
  put(header);
  put(nameBytes);
  put(topDictIndexBytes);
  put(stringBytes);
  put(globalBytes);
  if (loc.charset !== undefined) put(cff.subarray(loc.charset.offset, loc.charset.offset + loc.charset.length));
  if (loc.encoding !== undefined)
    put(cff.subarray(loc.encoding.offset, loc.encoding.offset + loc.encoding.length));
  if (loc.fdSelect !== undefined)
    put(cff.subarray(loc.fdSelect.offset, loc.fdSelect.offset + loc.fdSelect.length));
  put(charStringsBytes);
  if (loc.isCidKeyed) put(fdArrayBytes);
  for (const pb of privBlobs) put(cff.subarray(pb.blob.offset, pb.blob.offset + pb.blob.length));
  return out;
}

/** The Top-DICT operators the rebuild may rewrite (placeholders for sizing). */
function topDictRewriteKeys(loc: CffStructures): Map<number, number> {
  const m = new Map<number, number>();
  if (loc.charset !== undefined) m.set(15, 0);
  if (loc.encoding !== undefined) m.set(16, 0);
  m.set(17, 0);
  if (loc.isCidKeyed) {
    m.set(1236, 0);
    m.set(1237, 0);
  } else if (loc.topPrivate !== undefined) {
    m.set(18, 0);
  }
  return m;
}

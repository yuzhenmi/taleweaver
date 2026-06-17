/**
 * Minimal in-package PNG chunk parser for PDF embedding. Validates the signature,
 * parses IHDR, and walks chunks collecting PLTE / tRNS / the concatenated IDAT
 * (a single zlib stream). Throws `MalformedImageError` on any malformed or
 * unsupported-but-recognized variant (16-bit, interlaced, bad combos, …) — a PNG
 * we cannot faithfully embed must never be silently mis-embedded. CRC is NOT
 * verified (a hardening refinement; corruption still fails at inflate / unfilter /
 * the IDAT zlib Adler-32 — see the design doc).
 */
import { MalformedImageError } from "./image-errors";

export interface PngChunks {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number; // 1,2,4,8 (16 rejected)
  readonly colorType: number; // 0,2,3,4,6
  readonly interlace: number; // always 0 here (1 rejected)
  readonly palette: Uint8Array | null; // PLTE bytes (RGB triplets)
  readonly trns: Uint8Array | null; // tRNS bytes
  readonly idat: Uint8Array; // concatenated IDAT data (a zlib stream)
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** channels per color type; undefined → unknown color type. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** allowed bit depths per color type AFTER 16-bit is globally rejected. */
const ALLOWED_DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8],
  2: [8],
  3: [1, 2, 4, 8],
  4: [8],
  6: [8],
};

function u32(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)) >>> 0
  );
}

function chunkType(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
}

export function parsePng(bytes: Uint8Array): PngChunks {
  if (bytes.length < 8) throw new MalformedImageError("png: too short for signature");
  for (let i = 0; i < 8; i++) {
    if ((bytes[i] ?? 0) !== SIGNATURE[i]) throw new MalformedImageError("png: bad signature");
  }

  let pos = 8;
  // First chunk MUST be IHDR.
  if (pos + 8 > bytes.length) throw new MalformedImageError("png: truncated before IHDR");
  const ihdrLen = u32(bytes, pos);
  if (chunkType(bytes, pos + 4) !== "IHDR" || ihdrLen !== 13) {
    throw new MalformedImageError("png: first chunk is not a 13-byte IHDR");
  }
  if (pos + 12 + 13 > bytes.length) throw new MalformedImageError("png: truncated IHDR");
  const d = pos + 8; // IHDR data start
  const width = u32(bytes, d);
  const height = u32(bytes, d + 4);
  const bitDepth = bytes[d + 8] ?? 0;
  const colorType = bytes[d + 9] ?? 0;
  const compressionMethod = bytes[d + 10] ?? 0;
  const filterMethod = bytes[d + 11] ?? 0;
  const interlace = bytes[d + 12] ?? 0;

  if (width === 0 || height === 0) throw new MalformedImageError("png: zero width/height");
  if (compressionMethod !== 0) throw new MalformedImageError(`png: unsupported compression method ${compressionMethod}`);
  if (filterMethod !== 0) throw new MalformedImageError(`png: unsupported filter method ${filterMethod}`);
  if (interlace === 1) throw new MalformedImageError("interlaced PNG not yet supported");
  if (interlace !== 0) throw new MalformedImageError(`png: unsupported interlace method ${interlace}`);
  if (bitDepth === 16) throw new MalformedImageError("16-bit PNG not yet supported");
  if (CHANNELS[colorType] === undefined) throw new MalformedImageError(`png: unsupported color type ${colorType}`);
  if (!(ALLOWED_DEPTHS[colorType] ?? []).includes(bitDepth)) {
    throw new MalformedImageError(`png: color type ${colorType} does not allow bit depth ${bitDepth}`);
  }

  pos += 12 + 13; // advance past IHDR (len+type+data+crc)

  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idatParts: Uint8Array[] = [];
  let sawIend = false;

  while (pos + 8 <= bytes.length) {
    const len = u32(bytes, pos);
    const type = chunkType(bytes, pos + 4);
    const dataStart = pos + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) throw new MalformedImageError(`png: chunk ${type} runs past end (truncated)`);
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "PLTE") {
      palette = data.slice();
    } else if (type === "tRNS") {
      trns = data.slice();
    } else if (type === "IDAT") {
      idatParts.push(data.slice());
    } else if (type === "IEND") {
      sawIend = true;
      pos = dataEnd + 4;
      break;
    }
    // (gAMA/pHYs/tEXt/… and unknown ancillary chunks are skipped.)
    pos = dataEnd + 4; // advance past len+type+data+crc
  }

  if (!sawIend && idatParts.length === 0) throw new MalformedImageError("png: no IDAT / IEND (truncated)");
  if (trns !== null && (colorType === 4 || colorType === 6)) {
    throw new MalformedImageError(`png: tRNS is forbidden for color type ${colorType} (already has an alpha channel)`);
  }
  if (colorType === 3 && palette === null) throw new MalformedImageError("png: color type 3 requires a PLTE chunk");
  if (idatParts.length === 0) throw new MalformedImageError("png: no IDAT data");

  const idatLen = idatParts.reduce((n, p) => n + p.length, 0);
  const idat = new Uint8Array(idatLen);
  let o = 0;
  for (const p of idatParts) {
    idat.set(p, o);
    o += p.length;
  }

  return { width, height, bitDepth, colorType, interlace, palette, trns, idat };
}

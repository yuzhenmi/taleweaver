/**
 * Decode a PNG to raw PDF-embeddable samples: inflate the IDAT zlib stream,
 * reverse the 5 scanline filters, and resolve the color type to a PDF
 * representation (+ a DeviceGray SMask for an alpha channel / palette tRNS, or a
 * native-space color-key /Mask for grayscale/RGB tRNS). See the design doc.
 */
import { MalformedImageError } from "./image-errors";
import { parsePng, type PngChunks } from "./png-parser";
import { zlibDecompress } from "./zlib";

export type PngColorSpace =
  | { readonly kind: "DeviceGray" }
  | { readonly kind: "DeviceRGB" }
  | { readonly kind: "Indexed"; readonly hival: number; readonly palette: Uint8Array };

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly colorSpace: PngColorSpace;
  readonly bitsPerComponent: number; // 1,2,4,8
  readonly samples: Uint8Array;
  readonly smask: { readonly width: number; readonly height: number; readonly samples: Uint8Array } | null;
  readonly colorKeyMask: number[] | null;
}

const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Reverse the per-row PNG filters into a contiguous `height*rowBytes` buffer. */
function unfilter(inflated: Uint8Array, height: number, rowBytes: number, bpp: number): Uint8Array {
  const raw = new Uint8Array(height * rowBytes);
  const stride = 1 + rowBytes; // filter byte + row
  for (let row = 0; row < height; row++) {
    const filterType = inflated[row * stride] ?? 0;
    const src = row * stride + 1;
    const dst = row * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const f = inflated[src + i] ?? 0;
      const a = i >= bpp ? raw[dst + i - bpp] ?? 0 : 0; // left
      const b = row > 0 ? raw[dst - rowBytes + i] ?? 0 : 0; // up
      const c = row > 0 && i >= bpp ? raw[dst - rowBytes + i - bpp] ?? 0 : 0; // up-left
      let val: number;
      switch (filterType) {
        case 0: val = f; break;
        case 1: val = f + a; break;
        case 2: val = f + b; break;
        case 3: val = f + ((a + b) >> 1); break; // floor((a+b)/2)
        case 4: val = f + paeth(a, b, c); break;
        default: throw new MalformedImageError(`png: unknown filter type ${filterType} on row ${row}`);
      }
      raw[dst + i] = val & 0xff;
    }
  }
  return raw;
}

/** Unpack one palette/grayscale index per pixel, MSB-first, skipping per-row pad bits. */
function unpackIndices(raw: Uint8Array, width: number, height: number, bitDepth: number, rowBytes: number): Uint8Array {
  const out = new Uint8Array(width * height);
  const mask = (1 << bitDepth) - 1;
  let o = 0;
  for (let row = 0; row < height; row++) {
    const rowStart = row * rowBytes;
    let bitPos = 0;
    for (let x = 0; x < width; x++) {
      const byteIndex = rowStart + (bitPos >> 3);
      const shift = 8 - bitDepth - (bitPos & 7);
      out[o++] = ((raw[byteIndex] ?? 0) >> shift) & mask;
      bitPos += bitDepth;
    }
    // trailing pad bits of this row are skipped: the next row restarts at rowStart.
  }
  return out;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  const chunks: PngChunks = parsePng(bytes);
  const { width, height, bitDepth, colorType, palette, trns } = chunks;
  const channels = CHANNELS[colorType] ?? 1;
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const rowBytes = Math.ceil((bitsPerPixel * width) / 8);

  const inflated = zlibDecompress(chunks.idat);
  const expected = height * (1 + rowBytes);
  if (inflated.length !== expected) {
    throw new MalformedImageError(
      `png: inflated length ${inflated.length} != expected scanline length ${expected} (height*(1+rowBytes))`,
    );
  }
  const raw = unfilter(inflated, height, rowBytes, bpp);

  // Color-key /Mask helper: PNG tRNS stores each component as a 2-byte value; the
  // /Mask value is in the image's NATIVE sample space (low byte for 8-bit; the
  // native index for sub-byte). `(hi<<8)|lo` yields exactly that for both.
  const tval = (i: number): number => (((trns?.[i] ?? 0) << 8) | (trns?.[i + 1] ?? 0)) & 0xffff;

  if (colorType === 0) {
    const colorKeyMask = trns !== null ? [tval(0), tval(0)] : null;
    return { width, height, colorSpace: { kind: "DeviceGray" }, bitsPerComponent: bitDepth, samples: raw, smask: null, colorKeyMask };
  }

  if (colorType === 2) {
    const colorKeyMask = trns !== null ? [tval(0), tval(0), tval(2), tval(2), tval(4), tval(4)] : null;
    return { width, height, colorSpace: { kind: "DeviceRGB" }, bitsPerComponent: 8, samples: raw, smask: null, colorKeyMask };
  }

  if (colorType === 3) {
    const pal = palette ?? new Uint8Array(0);
    const hival = pal.length / 3 - 1;
    let smask: DecodedPng["smask"] = null;
    if (trns !== null) {
      const indices = unpackIndices(raw, width, height, bitDepth, rowBytes);
      const alpha = new Uint8Array(width * height);
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i] ?? 0;
        alpha[i] = idx < trns.length ? trns[idx] ?? 255 : 255; // trailing indices opaque
      }
      smask = { width, height, samples: alpha };
    }
    return { width, height, colorSpace: { kind: "Indexed", hival, palette: pal }, bitsPerComponent: bitDepth, samples: raw, smask, colorKeyMask: null };
  }

  if (colorType === 4) {
    // 8-bit gray+alpha: rowBytes = 2*width (byte-aligned), de-interleave linearly.
    const n = width * height;
    const gray = new Uint8Array(n);
    const alpha = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      gray[i] = raw[i * 2] ?? 0;
      alpha[i] = raw[i * 2 + 1] ?? 0;
    }
    return { width, height, colorSpace: { kind: "DeviceGray" }, bitsPerComponent: 8, samples: gray, smask: { width, height, samples: alpha }, colorKeyMask: null };
  }

  // colorType === 6: 8-bit RGBA, de-interleave linearly.
  const n = width * height;
  const rgb = new Uint8Array(n * 3);
  const alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = raw[i * 4] ?? 0;
    rgb[i * 3 + 1] = raw[i * 4 + 1] ?? 0;
    rgb[i * 3 + 2] = raw[i * 4 + 2] ?? 0;
    alpha[i] = raw[i * 4 + 3] ?? 0;
  }
  return { width, height, colorSpace: { kind: "DeviceRGB" }, bitsPerComponent: 8, samples: rgb, smask: { width, height, samples: alpha }, colorKeyMask: null };
}

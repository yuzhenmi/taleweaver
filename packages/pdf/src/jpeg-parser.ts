/**
 * Minimal in-package JPEG header parser for PDF /DCTDecode embedding. PDF's
 * DCTDecode filter decodes the JPEG itself, so this NEVER decodes pixels — it
 * walks the segment markers only far enough to read the Start-Of-Frame geometry
 * (dims / 8-bit precision / component count) and to detect an Adobe APP14 marker
 * (which flags inverted CMYK). Throws loudly on any malformed / unsupported input
 * — a JPEG we can't faithfully embed must never be silently mis-embedded.
 */

import { MalformedImageError } from "./image-errors";

export interface JpegImageInfo {
  readonly width: number;
  readonly height: number;
  readonly bitsPerComponent: 8; // v1 supports 8-bit precision only
  readonly colorSpace: "DeviceGray" | "DeviceRGB" | "DeviceCMYK";
  /** True → the PDF Image XObject must carry `/Decode [1 0 1 0 1 0 1 0]` (Adobe inverted CMYK). */
  readonly invertCmyk: boolean;
}

// SOF markers PDF /DCTDecode can embed: baseline (C0), extended sequential (C1),
// progressive (C2). All other SOFn (lossless/arithmetic/differential) are not.
const SOF_DCT = new Set<number>([0xc0, 0xc1, 0xc2]);
const SOF_UNSUPPORTED = new Set<number>([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function u16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

export function parseJpeg(bytes: Uint8Array): JpegImageInfo {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new MalformedImageError("jpeg: missing SOI marker (FFD8)");
  }
  let pos = 2;
  let hasAdobe = false;
  for (;;) {
    // Each header segment starts with 0xFF then a marker id; runs of 0xFF are fill.
    if (pos >= bytes.length) throw new MalformedImageError("jpeg: read past the end of input (no SOF before end)");
    if (bytes[pos] !== 0xff) throw new MalformedImageError("jpeg: expected a marker (0xFF)");
    while (pos < bytes.length && bytes[pos] === 0xff) pos++; // skip 0xFF fill bytes (bounds-check before deref)
    if (pos >= bytes.length) throw new MalformedImageError("jpeg: read past the end of input (truncated marker)");
    const marker = bytes[pos] ?? 0;
    pos++;

    if (marker === 0xd9) throw new MalformedImageError("jpeg: EOI before SOF (no frame header)");
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      continue; // standalone markers (SOI / RSTn / TEM) carry no length
    }

    // Every other marker introduces a segment: 2-byte big-endian length (incl. itself).
    const len = u16(bytes, pos);
    if (len < 2 || pos + len > bytes.length) throw new MalformedImageError("jpeg: segment runs past the end of input (truncated)");
    const body = pos + 2; // first byte after the length field

    if (SOF_DCT.has(marker)) {
      const precision = bytes[body] ?? 0;
      if (precision !== 8) throw new MalformedImageError(`jpeg: unsupported sample precision ${precision} (only 8-bit)`);
      const height = u16(bytes, body + 1);
      const width = u16(bytes, body + 3);
      const numComponents = bytes[body + 5] ?? 0;
      if (width === 0 || height === 0) throw new MalformedImageError("jpeg: zero width/height in SOF");
      if (numComponents === 1) {
        return { width, height, bitsPerComponent: 8, colorSpace: "DeviceGray", invertCmyk: false };
      }
      if (numComponents === 3) {
        return { width, height, bitsPerComponent: 8, colorSpace: "DeviceRGB", invertCmyk: false };
      }
      if (numComponents === 4) {
        return { width, height, bitsPerComponent: 8, colorSpace: "DeviceCMYK", invertCmyk: hasAdobe };
      }
      throw new MalformedImageError(`jpeg: unsupported component count ${numComponents} (expected 1, 3, or 4)`);
    }
    if (SOF_UNSUPPORTED.has(marker)) {
      throw new MalformedImageError(
        `jpeg: unsupported SOF marker 0xFF${marker.toString(16).toUpperCase()} (arithmetic / lossless / differential not DCTDecode-embeddable)`,
      );
    }
    if (marker === 0xee && len >= 7) {
      // APP14 — "Adobe" (41 64 6F 62 65) prefix marks an Adobe (inverted-CMYK) JPEG.
      if (
        bytes[body] === 0x41 && bytes[body + 1] === 0x64 && bytes[body + 2] === 0x6f &&
        bytes[body + 3] === 0x62 && bytes[body + 4] === 0x65
      ) {
        hasAdobe = true;
      }
    }
    pos += len; // skip this segment's body
  }
}

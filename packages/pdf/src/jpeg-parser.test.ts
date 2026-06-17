import { describe, it, expect } from "vitest";
import { parseJpeg } from "./jpeg-parser";
import { MalformedImageError } from "./image-errors";

// Hand-built minimal JPEG headers (SOI + [APP14] + SOFn + EOI). DCTDecode is a
// VERBATIM passthrough — the package never decodes pixels — so a structurally
// valid header is sufficient to exercise parse + colorspace + every loud-failure
// path. (Real-viewer rendering of a full JPEG is the user's post-merge smoke.)
const GRAY_1x1 = Uint8Array.of(
  0xff, 0xd8, // SOI
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, // SOF0: 8-bit 1x1 1-comp
  0xff, 0xd9, // EOI
);
const RGB_3x2 = Uint8Array.of(
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03,
  0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // SOF0: 8-bit h=2 w=3 3-comp
  0xff, 0xd9,
);
const CMYK_ADOBE_1x1 = Uint8Array.of(
  0xff, 0xd8,
  0xff, 0xee, 0x00, 0x0e, 0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x02, // APP14 "Adobe" transform=2
  0xff, 0xc0, 0x00, 0x12, 0x08, 0x00, 0x01, 0x00, 0x01, 0x04,
  0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0x04, 0x11, 0x01, // SOF0: 8-bit 1x1 4-comp
  0xff, 0xd9,
);

describe("parseJpeg — colorspace + dims", () => {
  it("1-component → DeviceGray", () => {
    expect(parseJpeg(GRAY_1x1)).toEqual({
      width: 1, height: 1, bitsPerComponent: 8, colorSpace: "DeviceGray", invertCmyk: false,
    });
  });
  it("3-component → DeviceRGB (DCTDecode does YCbCr→RGB internally), dims w=3 h=2", () => {
    expect(parseJpeg(RGB_3x2)).toEqual({
      width: 3, height: 2, bitsPerComponent: 8, colorSpace: "DeviceRGB", invertCmyk: false,
    });
  });
  it("4-component with Adobe APP14 → DeviceCMYK + invertCmyk (needs /Decode)", () => {
    expect(parseJpeg(CMYK_ADOBE_1x1)).toEqual({
      width: 1, height: 1, bitsPerComponent: 8, colorSpace: "DeviceCMYK", invertCmyk: true,
    });
  });
});

describe("parseJpeg — loud failure", () => {
  it("throws on a missing SOI", () => {
    expect(() => parseJpeg(Uint8Array.of(0x00, 0x00, 0xff, 0xc0))).toThrow(/SOI/i);
    expect(() => parseJpeg(Uint8Array.of(0x00, 0x00, 0xff, 0xc0))).toThrow(MalformedImageError);
  });
  it("throws on an unsupported SOF (arithmetic/lossless)", () => {
    // SOF3 (FFC3) lossless
    const bytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xc3, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9);
    expect(() => parseJpeg(bytes)).toThrow(/unsupported SOF|arithmetic|lossless/i);
    expect(() => parseJpeg(bytes)).toThrow(MalformedImageError);
  });
  it("throws on precision != 8", () => {
    // SOF0 precision = 12 (0x0c)
    const bytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x0c, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9);
    expect(() => parseJpeg(bytes)).toThrow(/precision/i);
  });
  it("throws on an unsupported component count (2)", () => {
    const bytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0e, 0x08, 0x00, 0x01, 0x00, 0x01, 0x02, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0xff, 0xd9);
    expect(() => parseJpeg(bytes)).toThrow(/component/i);
  });
  it("throws on a truncated segment (length runs past end)", () => {
    const bytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0x00, 0xff); // SOF0 claims len 0xFF, stream ends
    expect(() => parseJpeg(bytes)).toThrow(/past the end|truncat/i);
  });
  it("throws on EOI before any SOF", () => {
    expect(() => parseJpeg(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9))).toThrow(/SOF|EOI/i);
  });
});

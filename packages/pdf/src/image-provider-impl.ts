import type { PdfWriter } from "./pdf-writer";
import type { PdfImageProvider, PdfImageHandle } from "./image-provider";
import { parseJpeg, type JpegImageInfo } from "./jpeg-parser";
import { decodePng, type DecodedPng, type PngColorSpace } from "./png-decode";

/** A package-shipped in-package image provider. The host supplies SOURCE FILE
 *  bytes per `src` (fetching a URL / decoding a data: URI is host I/O); this
 *  parses the format + writes the correct PDF Image XObject. JPEG embeds via
 *  /DCTDecode (verbatim). PNG is decoded in-package (d.3b-2) and embedded as a
 *  /FlateDecode Image XObject (+ a DeviceGray /SMask for alpha, or a color-key
 *  /Mask). Mirrors `createEmbeddedFontProvider`. */
export function createImageProvider(opts: {
  readonly images: ReadonlyMap<string, Uint8Array>;
}): PdfImageProvider {
  type Resolved =
    | { readonly format: "jpeg"; readonly bytes: Uint8Array; readonly info: JpegImageInfo }
    | { readonly format: "png"; readonly decoded: DecodedPng };
  const rich = new WeakMap<PdfImageHandle, Resolved>();
  // Cache by src so repeated resolveImage(src) returns the SAME result (no
  // re-decode per page). Caches successful handles AND null (unknown/absent
  // format). A THROWING decode is NOT cached (it throws on every call).
  const cache = new Map<string, PdfImageHandle | null>();

  const isJpeg = (b: Uint8Array): boolean => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const isPng = (b: Uint8Array): boolean =>
    b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;

  const toHex = (b: Uint8Array): string => {
    let s = "";
    for (let i = 0; i < b.length; i++) s += (b[i] ?? 0).toString(16).toUpperCase().padStart(2, "0");
    return s;
  };
  const colorSpaceDict = (cs: PngColorSpace): string => {
    if (cs.kind === "DeviceGray") return "/DeviceGray";
    if (cs.kind === "DeviceRGB") return "/DeviceRGB";
    return `[/Indexed /DeviceRGB ${cs.hival} <${toHex(cs.palette)}>]`;
  };

  return {
    resolveImage(src: string): PdfImageHandle | null {
      const cached = cache.get(src);
      if (cached !== undefined || cache.has(src)) return cached ?? null;
      const bytes = opts.images.get(src);
      if (bytes === undefined) {
        cache.set(src, null); // absent → grey placeholder (cached)
        return null;
      }
      if (isJpeg(bytes)) {
        // A malformed JPEG throws (loud) and is NOT cached.
        const info = parseJpeg(bytes);
        const handle: PdfImageHandle = { imageKey: src };
        rich.set(handle, { format: "jpeg", bytes, info });
        cache.set(src, handle);
        return handle;
      }
      if (isPng(bytes)) {
        // A malformed / 16-bit / interlaced PNG throws (loud) and is NOT cached.
        const decoded = decodePng(bytes);
        const handle: PdfImageHandle = { imageKey: src };
        rich.set(handle, { format: "png", decoded });
        cache.set(src, handle);
        return handle;
      }
      // A genuinely unrecognized format → null (grey placeholder), cached.
      cache.set(src, null);
      return null;
    },

    writeImageObjects(
      used: readonly PdfImageHandle[],
      writer: PdfWriter,
    ): ReadonlyMap<PdfImageHandle, number> {
      const out = new Map<PdfImageHandle, number>();
      for (const handle of used) {
        const r = rich.get(handle);
        if (r === undefined) throw new Error("createImageProvider: handle not resolved by this provider");
        if (r.format === "jpeg") {
          const { width, height, colorSpace, invertCmyk } = r.info;
          const decode = invertCmyk ? " /Decode [1 0 1 0 1 0 1 0]" : "";
          const id = writer.allocate();
          writer.writeStream(
            id,
            `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode${decode} >>`,
            r.bytes,
          );
          out.set(handle, id);
          continue;
        }
        // PNG: write the SMask (if any) first, then the main image referencing it.
        const dec = r.decoded;
        let smaskRef = "";
        if (dec.smask !== null) {
          const smaskId = writer.allocate();
          writer.writeStream(
            smaskId,
            `<< /Type /XObject /Subtype /Image /Width ${dec.smask.width} /Height ${dec.smask.height} /ColorSpace /DeviceGray /BitsPerComponent 8 >>`,
            dec.smask.samples,
          );
          smaskRef = ` /SMask ${smaskId} 0 R`;
        }
        const maskRef = dec.colorKeyMask !== null ? ` /Mask [${dec.colorKeyMask.join(" ")}]` : "";
        const id = writer.allocate();
        writer.writeStream(
          id,
          `<< /Type /XObject /Subtype /Image /Width ${dec.width} /Height ${dec.height} /ColorSpace ${colorSpaceDict(dec.colorSpace)} /BitsPerComponent ${dec.bitsPerComponent}${smaskRef}${maskRef} >>`,
          dec.samples,
        );
        out.set(handle, id);
      }
      return out;
    },
  };
}

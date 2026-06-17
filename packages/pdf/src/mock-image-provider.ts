import type { PdfWriter } from "./pdf-writer";
import type { PdfImageProvider, PdfImageHandle } from "./image-provider";

/**
 * A MOCK image provider for unit-testing the Image XObject object-graph machinery
 * WITHOUT a real JPEG/PNG decoder or alpha handling (those land in slice d.2). It
 * synthesizes a deterministic, per-src-distinct opaque DeviceRGB sample buffer,
 * then writes the Image XObject stream through the same `writeImageObjects` seam
 * the real d.2 provider will use.
 *
 * NOT added to the public barrel — it is a test fixture + a conformance target for
 * the real d.2 image provider's object graph.
 */

/** A tiny deterministic string hash (FNV-1a-ish), so two srcs seed distinct fills. */
function hashSrc(src: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Build a deterministic opaque DeviceRGB fill of length w*h*3 seeded from `src`,
 *  so two distinct srcs byte-differ. */
function makeRgb(src: string, w: number, h: number): Uint8Array {
  const seed = hashSrc(src);
  const len = w * h * 3;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = (seed + i) & 0xff;
  }
  return out;
}

export function createMockImageProvider(opts: {
  images: Record<string, { w: number; h: number; rgb?: Uint8Array }>;
}): PdfImageProvider {
  const images = opts.images;
  const cache = new Map<string, PdfImageHandle>();
  // The mock carries its rich per-image data PRIVATELY, keyed by the handle
  // instance it minted — the narrowed PdfImageHandle exposes only `imageKey`.
  interface RichImage {
    readonly widthPx: number;
    readonly heightPx: number;
    readonly rgb: Uint8Array;
  }
  const rich = new WeakMap<PdfImageHandle, RichImage>();
  return {
    resolveImage(src: string): PdfImageHandle | null {
      const cached = cache.get(src);
      if (cached !== undefined) return cached;
      const spec = images[src];
      if (spec === undefined) return null;
      const rgb = spec.rgb ?? makeRgb(src, spec.w, spec.h);
      const expectedLen = spec.w * spec.h * 3;
      if (rgb.length !== expectedLen) {
        throw new Error(
          `MockImageProvider: rgb.length ${rgb.length} !== w*h*3 ${expectedLen} for src "${src}"`,
        );
      }
      const h: PdfImageHandle = { imageKey: src };
      rich.set(h, { widthPx: spec.w, heightPx: spec.h, rgb });
      cache.set(src, h);
      return h;
    },

    writeImageObjects(
      used: readonly PdfImageHandle[],
      writer: PdfWriter,
    ): ReadonlyMap<PdfImageHandle, number> {
      const map = new Map<PdfImageHandle, number>();
      for (const h of used) {
        const r = rich.get(h);
        if (r === undefined) {
          throw new Error("mock-image-provider: handle not resolved by this provider");
        }
        const id = writer.allocate();
        writer.writeStream(
          id,
          `<< /Type /XObject /Subtype /Image /Width ${r.widthPx} /Height ${r.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 >>`,
          r.rgb,
        );
        map.set(h, id);
      }
      return map;
    },
  };
}

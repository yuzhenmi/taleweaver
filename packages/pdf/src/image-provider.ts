import type { PdfWriter } from "./pdf-writer";

/**
 * One resolved, embeddable image — the MINIMAL contract the page-emitter needs.
 * The page-emitter uses only `imageKey` (resource-name lookup + dedup); the cm
 * placement matrix uses the layout box's display dims, not the handle. A provider
 * carries its own per-image data (format / dims / colorspace / bytes) PRIVATELY
 * in a `WeakMap<PdfImageHandle, ...>` populated in `resolveImage` and read back in
 * `writeImageObjects` (which receives the same handle instances) — never via a
 * cast off this narrowed type.
 */
export interface PdfImageHandle {
  readonly imageKey: string; // dedup identity + resource-name key
}

export interface PdfImageProvider {
  /** Resolve a layout image `src` to an embeddable handle, or null when it can't
   *  be resolved (→ the emitter draws a grey placeholder). Image handles are
   *  expected to be validated at resolve time (e.g. a malformed/wrong-length
   *  `rgb` buffer throws here, not at write time). */
  resolveImage(src: string): PdfImageHandle | null;
  /** Write the Image XObject stream objects for the used handles; returns a
   *  handle→objectId map. Mirrors PdfFontProvider.writeFontObjects. */
  writeImageObjects(
    used: readonly PdfImageHandle[],
    writer: PdfWriter,
  ): ReadonlyMap<PdfImageHandle, number>;
}

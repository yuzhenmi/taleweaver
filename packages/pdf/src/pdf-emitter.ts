import type { PrintPdfEmitInput } from "@taleweaver/print";
import { emitPdf } from "./emit-pdf";
import { mapAccessibilityTree } from "./pdf-structure";
import type { PdfFontProvider } from "./font-provider";
import type { PdfImageProvider } from "./image-provider";

/**
 * Adapt print's pdf-type-free {@link PrintPdfEmitInput} → {@link emitPdf}:
 * supply the font/image providers and map the RAW core accessibility tree to the
 * PDF structure model. The host passes the returned function to
 * `controller.exportToPdf(...)` so `@taleweaver/print` never imports
 * `@taleweaver/pdf` (the one-way exporter direction is `pdf → print`).
 *
 * Absent providers ⇒ standard-14 fonts / grey image placeholders (emitPdf's own
 * defaults). A `null` accessibility tree, or one that maps to nothing, ⇒ no
 * `/StructTreeRoot`.
 */
export function createPdfEmitter(opts?: {
  readonly fontProvider?: PdfFontProvider;
  readonly imageProvider?: PdfImageProvider;
}): (input: PrintPdfEmitInput) => Uint8Array {
  return (input) =>
    emitPdf({
      pageCount: input.pageCount,
      getPage: input.getPage,
      fontProvider: opts?.fontProvider,
      imageProvider: opts?.imageProvider,
      resolveInternalDestination: input.resolveInternalDestination,
      outline: input.outline,
      structureTree:
        input.accessibilityTree !== null
          ? (mapAccessibilityTree(input.accessibilityTree) ?? undefined)
          : undefined,
      ...(input.lang !== undefined && input.lang !== "" ? { lang: input.lang } : {}),
    });
}

export const PDF_PACKAGE_NAME = "@taleweaver/pdf";
export { emitPdf } from "./emit-pdf";
export type { EmitPdfInput } from "./emit-pdf";
// Host-injected emitter that adapts print's pdf-type-free `PrintPdfEmitInput` →
// `emitPdf` (keeps `@taleweaver/print` free of any `@taleweaver/pdf` import).
export { createPdfEmitter } from "./pdf-emitter";
export { mapAccessibilityTree } from "./pdf-structure";
export type { PdfStructureNode, PdfStructRole } from "./pdf-structure";
export type {
  PdfFontProvider,
  PdfFontHandle,
  EncodedRun,
  EncodedCluster,
} from "./font-provider";
export { createStandard14FontProvider } from "./font-provider";
export { createEmbeddedFontProvider } from "./embedded-font-provider";
export { MalformedFontError } from "./truetype-parser";
export type { PdfImageProvider, PdfImageHandle } from "./image-provider";
export { createImageProvider } from "./image-provider-impl";
export { parseJpeg } from "./jpeg-parser";
export type { JpegImageInfo } from "./jpeg-parser";
// Test-support: parse a PDF byte stream back into objects (used by export-surface
// consumers' e2e tests to assert the emitted structure — pages, /Outlines, annots).
export { parsePdf } from "./pdf-parse";
export type { ParsedPdf } from "./pdf-parse";

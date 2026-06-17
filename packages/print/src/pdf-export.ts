import type { AccessibilityNode } from "@taleweaver/core";
import type { PageBox } from "./layout/page-box";
import type { PdfOutlineNode } from "./layout/pdf-outline";
import type { InternalDestination } from "./layout/resolve-goto-destination";

/**
 * Print-side, PDF-TYPE-FREE export input. `print` must never import
 * `@taleweaver/pdf` (that would form a `print ⇄ pdf` cycle once `pdf` consumes
 * the geometry types that move into `print`), so `exportToPdf` hands the host
 * this neutral, core-typed payload and the host adapts it to a concrete PDF
 * emitter (e.g. `createPdfEmitter` from `@taleweaver/pdf`).
 *
 * Carries the RAW core accessibility tree (NOT a pdf-mapped structure) and NO
 * font/image providers — those are the injected emitter's concern.
 */
export interface PrintPdfEmitInput {
  readonly pageCount: number;
  readonly getPage: (i: number) => PageBox;
  readonly resolveInternalDestination?: (
    targetId: string,
  ) => InternalDestination | null;
  readonly outline?: readonly PdfOutlineNode[];
  readonly accessibilityTree: AccessibilityNode | null;
  readonly lang?: string;
}

/** A pdf emitter, injected by the host so `print` never imports `@taleweaver/pdf`. */
export type PdfEmitter = (input: PrintPdfEmitInput) => Uint8Array;

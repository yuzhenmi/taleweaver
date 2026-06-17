// packages/pdf/src/pdf-emitter.test.ts
//
// Phase 3-pre — `createPdfEmitter` adapts print's pdf-type-free
// `PrintPdfEmitInput` to `emitPdf`: it supplies the font/image providers and
// maps the RAW core accessibility tree to the PDF structure model. This is the
// `pdf → print` direction that replaces the old `print → pdf` import.
//
// We build a REAL one-page layout via core's pipeline so the `PrintPdfEmitInput`
// carries a genuine, cast-free `PageBox` (mirroring how the print controller
// resolves pages), then assert the emitter produces a well-formed `%PDF` byte
// stream — and that a non-null accessibility tree exercises the
// `mapAccessibilityTree` → `/StructTreeRoot` branch.

import { describe, it, expect } from "vitest";
import type { ContainerBlockNode, AccessibilityNode } from "@taleweaver/core";
import {
  buildDocumentFromTree,
  createTestAllocator,
  createMockMeasurer,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  render,
  cascadePass,
  buildAccessibilityTree,
} from "@taleweaver/core";
import type { PageBox, VirtualLayoutTree, PrintPdfEmitInput } from "@taleweaver/print";
import { layoutTree } from "@taleweaver/print";
import { createPdfEmitter } from "./pdf-emitter";

const CONTAINER_WIDTH = 320;

function pageConfig() {
  return {
    pageInlineSize: CONTAINER_WIDTH,
    pageBlockSize: 200,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

/** A real single-page `VirtualLayoutTree` for a tiny document, plus the doc's raw
 *  core accessibility tree — both built through the genuine core pipeline. */
function buildRealLayout(): {
  tree: VirtualLayoutTree;
  accessibilityTree: AccessibilityNode;
} {
  const componentRegistry = createDefaultComponentRegistry();
  const attrRegistry = createDefaultAttrRegistry();
  const measurer = createMockMeasurer(8, 16);
  const doc: ContainerBlockNode = {
    type: "document",
    children: [
      {
        type: "heading",
        attrs: { level: 1 },
        inlineContent: { items: [{ kind: "text", text: "Title", attrs: {} }] },
      },
      {
        type: "paragraph",
        inlineContent: { items: [{ kind: "text", text: "Body text.", attrs: {} }] },
      },
    ],
  };
  const state = buildDocumentFromTree(doc, {}, createTestAllocator("pdf-emit"));
  const rendered = render(state, componentRegistry, attrRegistry);
  const cascaded = cascadePass(rendered.root);
  const layout = layoutTree(cascaded, CONTAINER_WIDTH, measurer, pageConfig());
  if (layout.type !== "virtual-root") {
    throw new Error("buildRealLayout: expected a paginated VirtualLayoutTree");
  }
  return { tree: layout, accessibilityTree: buildAccessibilityTree(state) };
}

function emitInput(overrides: Partial<PrintPdfEmitInput>): PrintPdfEmitInput {
  const { tree } = buildRealLayout();
  const base: PrintPdfEmitInput = {
    pageCount: tree.plan.entries.length,
    getPage: (i: number): PageBox => tree.getPage(i),
    accessibilityTree: null,
  };
  return { ...base, ...overrides };
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  // "%PDF" = 0x25 0x50 0x44 0x46
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

describe("createPdfEmitter", () => {
  it("emits a non-empty %PDF byte stream from a PrintPdfEmitInput (no accessibility tree)", () => {
    const emit = createPdfEmitter();
    const bytes = emit(emitInput({}));
    expect(bytes.length).toBeGreaterThan(0);
    expect(startsWithPdfMagic(bytes)).toBe(true);
  });

  it("maps a non-null accessibility tree to a /StructTreeRoot (still emits %PDF)", () => {
    const { tree, accessibilityTree } = buildRealLayout();
    const emit = createPdfEmitter();
    const bytes = emit({
      pageCount: tree.plan.entries.length,
      getPage: (i: number): PageBox => tree.getPage(i),
      accessibilityTree,
    });
    expect(startsWithPdfMagic(bytes)).toBe(true);
    // The tagged-structure branch was exercised: a "document" root maps to a PDF
    // "Document" structure element → the catalog carries a /StructTreeRoot.
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("/StructTreeRoot");
  });

  it("threads the document lang to the catalog /Lang", () => {
    // emit-pdf gates `/Lang` on tagging being active (it lives alongside the
    // /StructTreeRoot catalog keys), so a non-null accessibility tree must be
    // present for the lang to surface — exercising the full createPdfEmitter
    // adaptation (structure mapping + lang threading) together.
    const { tree, accessibilityTree } = buildRealLayout();
    const emit = createPdfEmitter();
    const bytes = emit({
      pageCount: tree.plan.entries.length,
      getPage: (i: number): PageBox => tree.getPage(i),
      accessibilityTree,
      lang: "de-DE",
    });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("/Lang");
    expect(text).toContain("de-DE");
  });
});

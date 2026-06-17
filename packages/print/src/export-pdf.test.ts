// packages/print/src/export-pdf.test.ts
//
// #524 / Phase 3-pre — `controller.exportToPdf(emit)` builds a well-formed,
// PDF-TYPE-FREE `PrintPdfEmitInput` from the live document and hands it to the
// injected emitter. `@taleweaver/print` must NOT import `@taleweaver/pdf` (the
// one-way exporter direction is `pdf → print`), so this test injects an INLINE
// capturing stub emitter instead of the real `createPdfEmitter`. The deep
// navigability assertions (real `%PDF` bytes, `/Outlines` / `/GoTo` / `/URI`)
// live in `@taleweaver/pdf`'s `emit-pdf.test.ts` + `pdf-emitter.test.ts`, which
// exercise the emitter over an `EmitPdfInput` directly. Here we assert the
// integration seam: the controller resolves pages, the destination resolver, the
// outline, the RAW accessibility tree, and the document `lang` correctly.
//
// This file deliberately does NOT `vi.mock("@taleweaver/core", …)` (unlike
// `editor-controller.test.ts`, whose module-level mock FIXES
// `resolvePixelPosition` to a single position). `resolveGotoDestination` — used
// inside both `makeInternalDestinationResolver` AND `buildPdfOutline` — calls
// the REAL `resolvePixelPosition`; with the core mock in place every dest would
// resolve to the same coordinate and the resolver assertions would pass
// VACUOUSLY. A fresh, unmocked module gets the real resolution chain.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEditorController } from "./editor-controller";
import type { PrintPdfEmitInput, PdfEmitter } from "./pdf-export";
import * as canvasRenderer from "./canvas-renderer";
import * as keyHandler from "./key-handler";
import * as core from "@taleweaver/core";
import * as printPkg from "./index";

/** A capturing stub emitter: records the `PrintPdfEmitInput` and returns minimal
 *  `%PDF`-prefixed bytes so `exportToPdf`'s return contract stays observable
 *  without pulling in `@taleweaver/pdf`. */
function makeCapturingEmitter(): {
  emit: PdfEmitter;
  captured: () => PrintPdfEmitInput;
} {
  let last: PrintPdfEmitInput | null = null;
  const emit: PdfEmitter = (input) => {
    last = input;
    // "%PDF" — a stand-in for a real byte stream.
    return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  };
  return {
    emit,
    captured: () => {
      if (last === null) throw new Error("emit was not called");
      return last;
    },
  };
}

function nonNull<T>(v: T | null | undefined, what = "value"): T {
  if (v === null || v === undefined) {
    throw new Error(`expected ${what} to be present`);
  }
  return v;
}

// ── Mocks (canvas + key-handler ONLY — NOT @taleweaver/core) ────────────────

vi.mock("./canvas-renderer", () => ({
  paintCanvas: vi.fn(),
  paintPage: vi.fn(),
}));

vi.mock("./key-handler", () => ({
  mapKeyEvent: vi.fn(),
}));

// ── Canvas-context mock (replicated locally from editor-controller.test.ts) ──

const canvasContextMap = new WeakMap<
  HTMLCanvasElement,
  CanvasRenderingContext2D
>();

function createMockCanvasCtx(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    font: "",
    fillStyle: "" as string | CanvasGradient | CanvasPattern,
    textBaseline: "" as CanvasTextBaseline,
    globalAlpha: 1,
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D;
}

let originalGetContext: PropertyDescriptor | undefined;

// ── Real paginated EditorState builder (barrel-only) ─────────────────────────

const CONTAINER_WIDTH = 320;

// Small content area so the document genuinely paginates to ≥2 pages.
function pageConfig(): core.PageConfig {
  return {
    pageInlineSize: CONTAINER_WIDTH,
    pageBlockSize: 96,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

// Phase 0b: `measurer` left core's `EditorConfig` for the backend layout driver.
// The controller carries it via `makeOptions()` below; the paginated-shape check
// in `buildRealPaginatedEditorState` runs core's own pipeline with this measurer.
const layoutMeasurer = core.createMockMeasurer(8, 16);

function editorConfig(): core.EditorConfig {
  return {
    componentRegistry: core.createDefaultComponentRegistry(),
    attrRegistry: core.createDefaultAttrRegistry(),
    containerWidth: CONTAINER_WIDTH,
    pageConfig: pageConfig(),
  };
}

function frozenInline(
  items: ReadonlyArray<core.TextItem | core.EmbedItem>,
): core.InlineContent {
  return Object.freeze({ items: Object.freeze([...items]) }) as core.InlineContent;
}

function textItem(content: string, attrs?: Record<string, unknown>): core.TextItem {
  return Object.freeze({
    kind: "text",
    text: content,
    attrs: Object.freeze({ ...(attrs ?? {}) }),
  }) as core.TextItem;
}

function crossRefItem(targetId: string): core.EmbedItem {
  return Object.freeze({
    kind: "embed",
    embedType: core.CROSS_REFERENCE_EMBED_TYPE,
    attrs: Object.freeze({}),
    properties: Object.freeze({ targetId, refMode: "text" }),
  }) as core.EmbedItem;
}

/**
 * Build a real, paginated `EditorState` whose document has:
 *  - many single-line headings/paragraphs across ≥2 pages,
 *  - two `heading` blocks (→ a non-empty outline),
 *  - a `cross-reference` embed pointing at a heading on a LATER page (→ a
 *    resolvable internal destination),
 *  - a text run carrying a safe `link` attr.
 *
 * Built via the safe declarative `buildDocumentFromTree` (mints all ids), so the
 * cross-ref `targetId` must reference a MINTED id. We therefore build, find the
 * minted id of the LAST heading, and rebuild the host paragraph's cross-ref to
 * point at it — the two-pass approach keeps the construction barrel-only.
 */
function buildRealPaginatedEditorState(): {
  editorState: core.EditorState;
  targetHeadingId: core.BlockId;
} {
  const config = editorConfig();

  const buildTree = (
    targetId: string | null,
  ): core.ContainerBlockNode => {
    const children: core.BlockNode[] = [];
    children.push({
      type: "heading",
      attrs: { level: 1 },
      inlineContent: frozenInline([textItem("Introduction")]),
    });
    // Hyperlink-bearing paragraph (external link).
    children.push({
      type: "paragraph",
      inlineContent: frozenInline([
        textItem("Visit "),
        textItem("our site", { link: "https://example.com/" }),
        textItem(" today."),
      ]),
    });
    // Filler to push the second heading onto a later page.
    for (let i = 0; i < 12; i++) {
      children.push({
        type: "paragraph",
        inlineContent: frozenInline([textItem(`Filler paragraph ${i}.`)]),
      });
    }
    children.push({
      type: "heading",
      attrs: { level: 2 },
      inlineContent: frozenInline([textItem("Conclusion")]),
    });
    // Host paragraph carrying the cross-reference. On the first pass targetId is
    // null → a placeholder pointing at "unresolved" (harmless, resolves to null);
    // the second pass points it at the real heading id.
    children.push({
      type: "paragraph",
      inlineContent: frozenInline([
        textItem("As shown in "),
        crossRefItem(targetId ?? "unresolved"),
      ]),
    });
    return { type: "document", children };
  };

  // Pass 1: discover the last heading's minted id.
  const probe = core.buildDocumentFromTree(
    buildTree(null),
    {},
    core.createTestAllocator("probe"),
  );
  let conclusionId: core.BlockId | null = null;
  let cursor = core.firstLeafBlock(probe, probe.rootId);
  while (cursor !== null) {
    const blk = core.getBlock(probe, cursor);
    const firstItem = blk?.inlineContent?.items[0];
    if (
      blk?.type === "heading" &&
      firstItem?.kind === "text" &&
      firstItem.text === "Conclusion"
    ) {
      conclusionId = cursor;
    }
    cursor = core.nextBlockInDocOrder(probe, cursor);
  }
  if (conclusionId === null) {
    throw new Error("buildRealPaginatedEditorState: could not find Conclusion heading");
  }

  // Pass 2: rebuild with the cross-ref pointing at the (deterministic) minted id.
  const state = core.buildDocumentFromTree(
    buildTree(conclusionId),
    {},
    core.createTestAllocator("probe"),
  );
  const selection = core.initialSelectionForState(state);
  const editorState = core.createEditorStateFromState(state, selection, config);
  // Phase 0b: the layout tree lives in the driver, not on EditorState. Build it
  // here via core's pipeline (what the driver does) to assert the doc paginates.
  const rendered = core.render(state, config.componentRegistry, config.attrRegistry);
  const cascaded = core.cascadePass(rendered.root);
  const layout = printPkg.layoutTree(cascaded, config.containerWidth, layoutMeasurer, config.pageConfig);
  if (layout.type !== "virtual-root") {
    throw new Error(
      "buildRealPaginatedEditorState: expected a paginated VirtualLayoutTree",
    );
  }
  return { editorState, targetHeadingId: conclusionId };
}

// The controller enters paginated mode (and assigns its closure-local
// `virtualTree`) only when `pageHeight` is set — it matches the fixture's
// `pageConfig().pageBlockSize`. Phase 0b: `pageConfig` now lives in the
// controller's OWN geometry options (the backend layout-driver reads it), so the
// driver paginates the doc to a VirtualLayoutTree.
function makeOptions(): Parameters<typeof createEditorController>[1] {
  return {
    measurer: core.createMockMeasurer(8, 16),
    dispatch: vi.fn(),
    pageConfig: pageConfig(),
    pageHeight: pageConfig().pageBlockSize,
    pageGap: pageConfig().pageGap,
  };
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  originalGetContext = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    "getContext",
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: function (this: HTMLCanvasElement) {
      let ctx = canvasContextMap.get(this);
      if (!ctx) {
        ctx = createMockCanvasCtx();
        canvasContextMap.set(this, ctx);
      }
      return ctx;
    },
    writable: true,
    configurable: true,
  });

  globalThis.IntersectionObserver = vi.fn().mockImplementation(
    (callback: IntersectionObserverCallback) => {
      return {
        observe: vi.fn((el: Element) => {
          callback(
            [
              {
                target: el,
                isIntersecting: true,
                intersectionRatio: 1,
              } as unknown as IntersectionObserverEntry,
            ],
            {} as IntersectionObserver,
          );
        }),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      };
    },
  ) as unknown as typeof IntersectionObserver;

  vi.mocked(canvasRenderer.paintCanvas).mockClear();
  vi.mocked(canvasRenderer.paintPage).mockClear();
  vi.mocked(keyHandler.mapKeyEvent).mockClear();
});

afterEach(() => {
  if (originalGetContext) {
    Object.defineProperty(
      HTMLCanvasElement.prototype,
      "getContext",
      originalGetContext,
    );
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("controller.exportToPdf", () => {
  it("builds a PDF-type-free PrintPdfEmitInput from a real doc and returns the emitter's bytes", () => {
    const container = document.createElement("div");
    const ctrl = createEditorController(container, makeOptions());
    const { editorState, targetHeadingId } = buildRealPaginatedEditorState();
    ctrl.update(editorState);

    const { emit, captured } = makeCapturingEmitter();
    const bytes = ctrl.exportToPdf(emit);
    const input = captured();
    ctrl.destroy();

    // The controller returns whatever the injected emitter produced.
    expect(Array.from(bytes)).toEqual([0x25, 0x50, 0x44, 0x46]);

    // Multi-page input.
    expect(input.pageCount).toBeGreaterThanOrEqual(2);

    // `getPage(0)` resolves a real PageBox (not a thunk that throws).
    const page0 = input.getPage(0);
    expect(page0.type).toBe("page");

    // The internal-destination resolver is present and resolves the cross-ref
    // target heading (on a later page) to a non-negative page index.
    const resolve = nonNull(input.resolveInternalDestination, "destination resolver");
    const dest = nonNull(resolve(targetHeadingId), "resolved destination");
    expect(dest.pageIndex).toBeGreaterThanOrEqual(0);
    // A broken target resolves to null (graceful).
    expect(resolve("does-not-exist")).toBeNull();

    // The outline (heading bookmark tree) carries the two headings.
    const outline = nonNull(input.outline, "outline");
    expect(outline.length).toBeGreaterThanOrEqual(1);

    // The RAW core accessibility tree is threaded (a "document" root → non-null).
    // It is the RAW core projection (role "document"), NOT the pdf-mapped
    // "Document" structure — the injected emitter maps it.
    const tree = nonNull(input.accessibilityTree, "accessibility tree");
    expect(tree.role).toBe("document");
    expect(tree.children.length).toBeGreaterThan(0);
  });

  it("throws when no document is loaded", () => {
    const container = document.createElement("div");
    const ctrl = createEditorController(container, makeOptions());
    const { emit } = makeCapturingEmitter();
    expect(() => ctrl.exportToPdf(emit)).toThrow(/no document/i);
    ctrl.destroy();
  });

  it("throws for a non-paginated (float/clear) layout", () => {
    const container = document.createElement("div");
    // No pageHeight/pageGap → the controller stays in non-paginated mode, so its
    // `virtualTree` is never assigned even after `update()` with a real (virtual-
    // root) EditorState. `exportToPdf` must therefore hit the paginated-required
    // guard. The measurer matches `makeOptions()` so cursor resolution succeeds.
    const ctrl = createEditorController(container, {
      measurer: core.createMockMeasurer(8, 16),
      dispatch: vi.fn(),
    });
    const { editorState } = buildRealPaginatedEditorState();
    ctrl.update(editorState);
    const { emit } = makeCapturingEmitter();
    expect(() => ctrl.exportToPdf(emit)).toThrow(/paginated layout required/i);
    ctrl.destroy();
  });

  it("omits the document `lang` when no block carries a content language", () => {
    // The controller computes `lang` from the first body text-run's
    // `computedStyle.language` (a BCP-47 tag), emitting it ONLY when non-empty —
    // the `...(lang !== "" ? { lang } : {})` branch. This fixture sets no `lang`
    // attr on any block, so `computedStyle.language` stays the initial `""` and
    // the controller must OMIT `lang` entirely rather than pass `""`.
    const container = document.createElement("div");
    const ctrl = createEditorController(container, makeOptions());
    const { editorState } = buildRealPaginatedEditorState();
    ctrl.update(editorState);

    const { emit, captured } = makeCapturingEmitter();
    ctrl.exportToPdf(emit);
    expect(captured().lang).toBeUndefined();
    ctrl.destroy();
  });

  it("derives the document `lang` from a document-level `lang` attr and threads it (#527)", () => {
    // End-to-end #527: a document-level `lang` attr now reaches the layout
    // `computedStyle.language` (it inherits down to every body text-run), so the
    // controller's `firstBodyLanguage` walk picks it up and threads it as the
    // PrintPdfEmitInput `lang`. Before #527 the attr was dropped at the component
    // style rebuild and this would be `undefined`.
    const config = editorConfig();
    const tree: core.ContainerBlockNode = {
      type: "document",
      attrs: { lang: "de-DE" },
      children: [
        {
          type: "paragraph",
          inlineContent: frozenInline([textItem("Guten Tag.")]),
        },
      ],
    };
    const state = core.buildDocumentFromTree(tree, {}, core.createTestAllocator("lang"));
    const selection = core.initialSelectionForState(state);
    const editorState = core.createEditorStateFromState(state, selection, config);

    const container = document.createElement("div");
    const ctrl = createEditorController(container, makeOptions());
    ctrl.update(editorState);

    const { emit, captured } = makeCapturingEmitter();
    ctrl.exportToPdf(emit);
    expect(captured().lang).toBe("de-DE");
    ctrl.destroy();
  });
});

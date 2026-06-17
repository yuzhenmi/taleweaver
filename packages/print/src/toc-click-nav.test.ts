/**
 * TOC click-to-navigate gesture (behavior-level, through the real editor +
 * controller in jsdom).
 *
 * A live `table-of-contents` block synthesizes its entry lines at render time;
 * each entry-line BLOCK box carries `metadata: { tocEntry: true, navTarget:
 * <headingBlockId> }`. Those boxes are NOT state-backed, so the normal
 * `resolvePositionFromPixel` hit-test can't detect them — the controller adds a
 * dedicated `pickTocEntryAt` box-walk plus a click-to-navigate gesture: a plain
 * single click on a TOC entry moves the caret to the heading; a DRAG starting on
 * an entry abandons navigation and text-selects instead (Google Docs behavior).
 *
 * Harness mirrors comment-highlights.test.ts: real controller + real renderer +
 * a spy canvas (so `update()` paints and the virtual tree materializes its
 * pages), driven over a seeded TOC doc built via the public
 * `buildDocumentFromTree` → `createEditorStateFromState` seam. The gesture's
 * outcome is read off the controller's `dispatch` spy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEditorController } from "./index";
import * as core from "@taleweaver/core";
import * as printPkg from "./index";

interface SpyCtx extends CanvasRenderingContext2D {
  _ops: unknown[];
}

function createSpyCtx(): SpyCtx {
  const ops: unknown[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _ops: unknown[] } = {
    _ops: ops,
    canvas: { width: 600, height: 800 } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    globalAlpha: 1,
    clearRect() {},
    fillRect() {},
    fillText() {},
    save() {},
    restore() {},
    scale() {},
    setTransform() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    rect() {},
    clip() {},
    stroke() {},
    fill() {},
    measureText: (t: string) => ({ width: t.length * 8 } as TextMetrics),
  };
  return ctx as unknown as SpyCtx;
}

const measurer: core.TextMeasurer = core.createMockMeasurer(8, 16);

/** A short paginated page so the TOC entries materialize on page 0. */
function pageConfig(): core.PageConfig {
  return {
    pageInlineSize: 600,
    pageBlockSize: 800,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

/**
 * Seed an EditorState with a TOC over two headings ("Introduction", "Details").
 * Returns the editor plus the two heading block ids (read back from the built
 * State — `buildDocumentFromTree` mints the ids).
 */
function seededTocEditor(): {
  editor: core.EditorState;
  h1Id: core.BlockId;
  h2Id: core.BlockId;
  config: core.EditorConfig;
} {
  const root: core.ContainerBlockNode = {
    type: "document",
    children: [
      { type: "table-of-contents", attrs: {}, inlineContent: { items: [] } },
      {
        type: "heading",
        attrs: { level: 1 },
        inlineContent: { items: [{ kind: "text", text: "Introduction", attrs: {} }] },
      },
      {
        type: "heading",
        attrs: { level: 1 },
        inlineContent: { items: [{ kind: "text", text: "Details", attrs: {} }] },
      },
    ],
  };
  const state = core.buildDocumentFromTree(root, {}, core.createTestAllocator());

  // Read the two heading ids back (doc-order children after the TOC).
  const doc = core.getBlock(state, state.rootId);
  if (doc === null || doc.firstChildId === null) throw new Error("no toc");
  const toc = core.getBlock(state, doc.firstChildId);
  if (toc === null || toc.nextSiblingId === null) throw new Error("no h1");
  const h1Id = toc.nextSiblingId;
  const h1 = core.getBlock(state, h1Id);
  if (h1 === null || h1.nextSiblingId === null) throw new Error("no h2");
  const h2Id = h1.nextSiblingId;

  const config: core.EditorConfig = {
    componentRegistry: core.createDefaultComponentRegistry(),
    attrRegistry: core.createDefaultAttrRegistry(),
    containerWidth: 600,
    pageConfig: pageConfig(),
  };
  const editor = core.createEditorStateFromState(
    state,
    core.initialSelectionForState(state),
    config,
  );
  return { editor, h1Id, h2Id, config };
}

/**
 * Walk a materialized page box accumulating physical (x, y) offsets (the same
 * convention the painter uses: page-local origin starts at `-pageBox.x/-pageBox.y`
 * so the page itself sits at (0,0), then each descendant adds its own physical
 * x/y). Returns the page-local center pixel of the FIRST box tagged
 * `metadata.tocEntry === true` whose `navTarget` equals `target`, or null.
 */
function tocEntryCenter(
  pageBox: printPkg.LayoutBox,
  target: core.BlockId,
): { x: number; y: number } | null {
  let found: { x: number; y: number } | null = null;
  const walk = (box: printPkg.LayoutBox, parentX: number, parentY: number): void => {
    if (found !== null) return;
    const absX = parentX + box.x;
    const absY = parentY + box.y;
    const meta = "metadata" in box ? box.metadata : undefined;
    if (meta?.tocEntry === true && meta.navTarget === target) {
      found = { x: absX + box.width / 2, y: absY + box.height / 2 };
      return;
    }
    if ("children" in box) {
      for (const child of box.children) walk(child, absX, absY);
    }
    if ("columns" in box) {
      for (const col of box.columns) walk(col, absX, absY);
    }
  };
  walk(pageBox, -pageBox.x, -pageBox.y);
  return found;
}

/**
 * Phase 0b: core's `EditorState` is geometry-free — the layout tree lives in the
 * backend driver. Build it here via core's own render → cascade → layout pipeline
 * (exactly what the driver does) to read page 0's materialized TOC-entry boxes.
 */
function getPage0(editor: core.EditorState, config: core.EditorConfig): printPkg.LayoutBox {
  const rendered = core.render(editor.state, config.componentRegistry, config.attrRegistry);
  const cascaded = core.cascadePass(rendered.root);
  const lt = printPkg.layoutTree(cascaded, config.containerWidth, measurer, config.pageConfig);
  if (lt.type === "virtual-root") return lt.getPage(0);
  if (!("children" in lt)) throw new Error("expected positioned tree");
  const page0 = lt.children[0];
  if (page0 === undefined) throw new Error("expected page 0");
  return page0;
}

describe("TOC click-to-navigate gesture", () => {
  const containers: HTMLElement[] = [];
  let originalGetContext: PropertyDescriptor | undefined;
  const canvasCtxMap = new WeakMap<HTMLCanvasElement, SpyCtx>();

  beforeEach(() => {
    // jsdom has no IntersectionObserver; the paginated controller needs one to
    // decide page visibility. Mark every observed slot visible immediately so
    // page 0's canvas is created and painted (materializing the TOC entries).
    globalThis.IntersectionObserver = vi.fn().mockImplementation(
      (callback: IntersectionObserverCallback) => ({
        observe: vi.fn((el: Element) => {
          callback(
            [{ target: el, isIntersecting: true, intersectionRatio: 1 } as unknown as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        }),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      }),
    ) as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    if (originalGetContext) {
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
    }
    for (const c of containers) c.remove();
    containers.length = 0;
  });

  function mount(): HTMLElement {
    originalGetContext = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "getContext",
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: function (this: HTMLCanvasElement) {
        let ctx = canvasCtxMap.get(this);
        if (!ctx) {
          ctx = createSpyCtx();
          canvasCtxMap.set(this, ctx);
        }
        return ctx;
      },
      writable: true,
      configurable: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    return container;
  }

  /**
   * Point the page-0 slot div's bounding rect at the origin so a MouseEvent's
   * clientX/clientY map 1:1 to page-local coords (matching `tocEntryCenter`).
   */
  function pinSlot0(container: HTMLElement): void {
    const slot = container.querySelector('div[data-page-index="0"]');
    if (slot === null) throw new Error("no page-0 slot");
    (slot as HTMLElement).getBoundingClientRect = vi.fn(() => ({
      left: 0, top: 0, right: 600, bottom: 800, width: 600, height: 800,
      x: 0, y: 0, toJSON: () => {},
    })) as unknown as () => DOMRect;
  }

  /** The most recent SET_SELECTION the controller dispatched, or null. */
  function lastSetSelection(dispatch: ReturnType<typeof vi.fn>): core.Span | null {
    for (let i = dispatch.mock.calls.length - 1; i >= 0; i--) {
      const call = dispatch.mock.calls[i];
      if (call === undefined) continue;
      const a = call[0] as core.EditorAction;
      if (a.type === "SET_SELECTION") return a.selection;
    }
    return null;
  }

  it("a plain click on a TOC entry jumps the caret to its heading", () => {
    const { editor, h2Id, config } = seededTocEditor();
    const container = mount();
    const dispatch = vi.fn();
    const controller = createEditorController(container, {
      measurer, dispatch, pageConfig: pageConfig(), pageHeight: 800, pageGap: 24,
    });
    controller.update(editor);
    pinSlot0(container);

    // The second TOC entry navigates to the SECOND heading (h2) — distinct from
    // the initial caret (block 0), so the assertion is meaningful.
    const center = tocEntryCenter(getPage0(editor, config), h2Id);
    expect(center).not.toBeNull();
    if (center === null) throw new Error("unreachable");

    const slot = container.querySelector('div[data-page-index="0"]')!;
    slot.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: center.x, clientY: center.y, detail: 1, bubbles: true,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    const sel = lastSetSelection(dispatch);
    expect(sel).not.toBeNull();
    if (sel === null) throw new Error("unreachable");
    // Collapsed caret at the heading's start.
    expect(sel.anchor.blockId).toBe(h2Id);
    expect(sel.anchor.offset).toBe(0);
    expect(sel.focus.blockId).toBe(h2Id);
    expect(sel.focus.offset).toBe(0);

    controller.destroy();
  });

  // A drag that starts on a TOC entry ABANDONS the pending nav once it passes the
  // epsilon. Because a synthesized TOC entry has no resolvable state position
  // (`resolvePositionFromPixel` returns null → `dragAnchor` stays null), the drag
  // then text-selects nothing — the important guarantee here is only that it does
  // NOT navigate to the heading (no spurious caret jump).
  it("a DRAG starting on a TOC entry does NOT navigate (nav abandoned past the epsilon)", () => {
    const { editor, h2Id, config } = seededTocEditor();
    const container = mount();
    const dispatch = vi.fn();
    const controller = createEditorController(container, {
      measurer, dispatch, pageConfig: pageConfig(), pageHeight: 800, pageGap: 24,
    });
    controller.update(editor);
    pinSlot0(container);

    const center = tocEntryCenter(getPage0(editor, config), h2Id);
    expect(center).not.toBeNull();
    if (center === null) throw new Error("unreachable");

    const slot = container.querySelector('div[data-page-index="0"]')!;
    slot.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: center.x, clientY: center.y, detail: 1, bubbles: true,
      }),
    );
    // Move well past the 4px epsilon → abandon nav.
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: center.x + 40, clientY: center.y + 40, detail: 1, bubbles: true,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    // The drag must NOT have collapsed the caret onto the heading.
    const sel = lastSetSelection(dispatch);
    const navigated =
      sel !== null &&
      sel.anchor.blockId === h2Id &&
      sel.anchor.offset === 0 &&
      sel.focus.blockId === h2Id &&
      sel.focus.offset === 0;
    expect(navigated).toBe(false);

    controller.destroy();
  });
});

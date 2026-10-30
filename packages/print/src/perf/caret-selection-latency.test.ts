/**
 * Caret-move and selection-extension latency on the PRINT backend, flat in document
 * size (CLAUDE.md: O(1) per caret move). Through the real controller: an ArrowRight
 * keydown (visual step + `caretAfterMarkers`) and a Shift+ArrowDown
 * keydown (line move + the ¶ selection extension) at a ~3-page and an
 * ~85-page document, the same two pages visible. Deterministic gate: per step, no
 * layout, no page-slot / observer pass, and every traced operation runs the same
 * number of times at both sizes. Wall-clock medians are logged only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as core from "@taleweaver/core";
import { createEditorController } from "../editor-controller";
import { finalSection } from "../test-utils/final-section";

const TEST_RESOLVER = core.createDefaultComponentRegistry();
const LETTER: core.PageConfig = {
  pageInlineSize: 816,
  pageBlockSize: 1056,
  pageMargins: { blockStart: 96, blockEnd: 96, inlineStart: 96, inlineEnd: 96 },
  pageGap: 24,
};
const noop = (): void => {};
const STEPS = 50;

function doc(paragraphs: number): core.ContainerBlockNode {
  const words = "the quick brown fox jumps over a lazy dog while Anna watches".split(" ");
  return {
    type: "document",
    children: Array.from({ length: paragraphs }, (_, p) => ({
      type: "paragraph",
      inlineContent: { items: [{ kind: "text" as const, text: Array.from({ length: 50 }, (_, w) => words[(p + w) % words.length]).join(" "), attrs: {} }] },
    })),
  };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const countOf = (label: string): number => core.report().entries.find((e) => e.label === label)?.count ?? 0;

let originalGetContext: PropertyDescriptor | undefined;
let originalIO: typeof IntersectionObserver | undefined;
/** `IntersectionObserver.observe` calls (one per page slot on a page-DOM sync). */
let observes = 0;
beforeEach(() => {
  originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  const ctx = {
    canvas: {}, font: "", textBaseline: "alphabetic", fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1,
    clearRect: noop, fillRect: noop, fillText: noop, setTransform: noop, save: noop, restore: noop, scale: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, stroke: noop, arc: noop, rect: noop, clip: noop,
    fill: noop, strokeRect: noop, setLineDash: noop,
    measureText: (t: string) => ({ width: t.length * 8 }),
  };
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => ctx, writable: true, configurable: true });
  originalIO = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = vi.fn().mockImplementation((cb: IntersectionObserverCallback) => ({
    observe: (el: Element) => {
      observes++;
      const idx = Number((el as HTMLElement).dataset.pageIndex);
      cb([{ target: el, isIntersecting: idx <= 1 } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    },
    unobserve: noop,
    disconnect: noop,
  })) as unknown as typeof IntersectionObserver;
});
afterEach(() => {
  if (originalGetContext !== undefined) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
  if (originalIO !== undefined) globalThis.IntersectionObserver = originalIO;
});

/** Per-step median wall-clock and the traced operation counts per step (label → count / STEPS). */
interface Steps { readonly ms: number; readonly ops: Readonly<Record<string, number>>; readonly observes: number }
interface Result { readonly arrow: Steps; readonly shiftDown: Steps; readonly pages: number }

function run(paragraphs: number): Result {
  const config: core.EditorConfig = {
    componentRegistry: core.createDefaultComponentRegistry(),
    attrRegistry: core.createDefaultAttrRegistry(),
    containerWidth: LETTER.pageInlineSize,
    pageConfig: LETTER,
  };
  const state = core.buildDocumentFromTree(doc(paragraphs), {}, core.createTestAllocator(), TEST_RESOLVER);
  const first = finalSection(state)?.firstChildId ?? null;
  if (first === null) throw new Error("setup");
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  let editor = core.createEditorStateFromState(state, core.createSpan(core.createPosition(first, 0), core.createPosition(first, 0)), config);
  const controller = createEditorController(container, {
    measurer: core.createMockMeasurer(8, 16),
    dispatch: (a) => {
      editor = core.reduceEditor(editor, a);
      controller.update(editor);
    },
    pageHeight: LETTER.pageBlockSize,
    pageGap: LETTER.pageGap,
  });
  controller.update(editor);
  const textarea = container.querySelector("textarea");
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("no textarea");
  const press = (key: string, shiftKey: boolean): number => {
    const t = performance.now();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
    return performance.now() - t;
  };
  const steps = (key: string, shiftKey: boolean): Steps => {
    core.resetPerfTrace();
    core.setPerfTraceEnabled(true);
    const before = observes;
    const times = Array.from({ length: STEPS }, () => press(key, shiftKey));
    core.setPerfTraceEnabled(false);
    // Liveness: the caret was resolved on every step (the trace is on).
    expect(countOf("cursor.cursor-position")).toBeGreaterThanOrEqual(STEPS);
    const ops = Object.fromEntries(core.report().entries.map((e) => [e.label, e.count / STEPS]));
    return { ms: median(times), ops, observes: observes - before };
  };
  const arrow = steps("ArrowRight", false);
  const shiftDown = steps("ArrowDown", true);
  expect(core.isCollapsed(editor.selection)).toBe(false);
  const pages = container.querySelectorAll("div[data-page-index]").length;
  controller.destroy();
  return { arrow, shiftDown, pages };
}

describe("print caret / selection latency is flat in document size", () => {
  it("ArrowRight and Shift+ArrowDown at ~3 pages vs ~85 pages", () => {
    run(30); // warm-up
    const small = run(30);
    const large = run(1000);
    console.log(
      `print caret move median: ${small.arrow.ms.toFixed(3)}ms (${small.pages} pages) / ${large.arrow.ms.toFixed(3)}ms (${large.pages} pages); ` +
        `Shift+Down median: ${small.shiftDown.ms.toFixed(3)}ms / ${large.shiftDown.ms.toFixed(3)}ms`,
    );
    expect(small.pages).toBeGreaterThanOrEqual(2); // both documents fill the two visible pages
    expect(large.pages).toBeGreaterThan(25 * small.pages);
    for (const k of ["arrow", "shiftDown"] as const) {
      // A caret move / selection extension re-lays-out nothing (the driver keeps the
      // tree on a selection-only update) and never re-syncs the page slots / observer.
      for (const r of [small, large]) {
        expect(r[k].ops["ifc.layout"] ?? 0).toBe(0);
        expect(r[k].ops["ctrl.syncPageCanvases"] ?? 0).toBe(0);
        expect(r[k].observes).toBe(0);
      }
      // Every traced operation (cursor resolution, hit-test, line navigation, selection
      // geometry, pages painted, draw calls) runs as often at 85 pages as at 3.
      expect(large[k].ops).toEqual(small[k].ops);
    }
  }, 120_000);
});

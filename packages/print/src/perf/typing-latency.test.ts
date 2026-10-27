import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as core from "@taleweaver/core";
import { createEditorController } from "../editor-controller";

/**
 * Typing-latency gate (print backend): a 20,000-word chapter (400 × 50-word paragraphs)
 * with 1,000 inline decorations + 100 widgets, paginated on Letter pages, three pages
 * visible. Decoration geometry is resolved lazily per painted page and cached, so
 * decorations must add (almost) nothing to a keystroke.
 *
 * The REAL gate is deterministic: per-keystroke operation counts from the perf trace,
 * which do not depend on machine load —
 *  - `ifc.layout` ≤ 30: the edited paragraph's meta + re-materializing the edited page
 *    (~13 paragraphs/page; measured 14). Re-laying the whole document is 400+.
 *  - `render.blockBody` ≤ 10: the edited block (measured 2). A full re-render is 400+.
 *  - `decorations.mapped` ≤ 10: only the edited block's decorations are carried
 *    (measured 3). Mapping every decoration is 1,100.
 *  - `decorations.segmentGeometry` ≤ 100: inline-decoration geometry recomputed for
 *    the re-materialized page only (measured ~30). Resolving every decoration is 1,000.
 *  - `ctrl.widgetResolve` ≤ 20: widgets on the visible pages only (measured 9; all 100
 *    otherwise).
 *  - a one-decoration `setDecorations` recomputes ≤ 5 segment geometries (measured ~1).
 * Wall-clock checks are COARSE backstops only (jsdom on a shared, loaded machine is
 * noisy): median keystroke ≤ 150 ms with and without decorations (measured ~15–20 ms;
 * 220–400 ms when every paragraph was re-laid-out), median decoration update ≤ 100 ms.
 */
const TYPING_BACKSTOP_MS = 150;
const UPDATE_BACKSTOP_MS = 100;
const PER_KEYSTROKE_BUDGET = {
  ifcLayouts: 30,
  blocksRendered: 10,
  decorationsMapped: 10,
  segmentGeometries: 100,
  widgetResolves: 20,
};
const SEGMENTS_PER_UPDATE_BUDGET = 5;

const LETTER: core.PageConfig = {
  pageInlineSize: 816,
  pageBlockSize: 1056,
  pageMargins: { blockStart: 96, blockEnd: 96, inlineStart: 96, inlineEnd: 96 },
  pageGap: 24,
};

function cfg(): core.EditorConfig {
  return {
    componentRegistry: core.createDefaultComponentRegistry(),
    attrRegistry: core.createDefaultAttrRegistry(),
    containerWidth: LETTER.pageInlineSize,
    pageConfig: LETTER,
  };
}

function chapter(): core.ContainerBlockNode {
  const words = "the quick brown fox jumps over a lazy dog while Anna watches".split(" ");
  const children = Array.from({ length: 400 }, (_, p) => ({
    type: "paragraph",
    inlineContent: {
      items: [{ kind: "text" as const, text: Array.from({ length: 50 }, (_, w) => words[(p + w) % words.length]).join(" "), attrs: {} }],
    },
  }));
  return { type: "document", children };
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const noop = (): void => {};
let originalGetContext: PropertyDescriptor | undefined;
let originalIO: typeof IntersectionObserver | undefined;

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
  // Pages 0–2 are "on screen".
  globalThis.IntersectionObserver = vi.fn().mockImplementation((cb: IntersectionObserverCallback) => ({
    observe: (el: Element) => {
      const idx = Number((el as HTMLElement).dataset.pageIndex);
      cb([{ target: el, isIntersecting: idx <= 2 } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    },
    unobserve: noop,
    disconnect: noop,
  })) as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  if (originalGetContext !== undefined) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
  if (originalIO !== undefined) globalThis.IntersectionObserver = originalIO;
});

interface RunResult {
  typing: number;
  update: number;
  count: number;
  decorationMs: number;
  /** Deterministic per-keystroke operation counts (perf-trace counters). */
  perKey: { ifcLayouts: number; blocksRendered: number; decorationsMapped: number; segmentGeometries: number; widgetResolves: number };
  /** Decoration positions resolved by one one-decoration `setDecorations` (median-free: exact). */
  updateResolves: number;
}

const countOf = (label: string): number => core.report().entries.find((e) => e.label === label)?.count ?? 0;

function run(withDecorations: boolean, keystrokes: number): RunResult {
  const config = cfg();
  const state = core.buildDocumentFromTree(chapter(), {}, core.createTestAllocator());
  const ids: core.BlockId[] = [];
  for (let id = core.getBlock(state, state.rootId)?.firstChildId ?? null; id !== null; id = core.getBlock(state, id)?.nextSiblingId ?? null) ids.push(id);
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  const controller = createEditorController(container, {
    measurer: core.createMockMeasurer(8, 16),
    dispatch: noop,
    pageConfig: LETTER,
    pageHeight: LETTER.pageBlockSize,
    pageGap: LETTER.pageGap,
  });
  let editor = core.createEditorStateFromState(state, core.initialSelectionForState(state), config);
  controller.update(editor);

  const decorations: core.Decoration[] = [];
  ids.forEach((id, p) => {
    for (const start of [4, 40, 120].slice(0, p % 2 === 0 ? 3 : 2)) {
      decorations.push({ kind: "inline", id: `d${p}:${start}`, from: core.createPosition(id, start), to: core.createPosition(id, start + 5), style: { backgroundColor: "rgba(0, 0, 255, 0.2)" } });
    }
  });
  expect(decorations.length).toBe(1000);
  // Plus a widget in every fourth paragraph (100 widgets).
  ids.forEach((id, p) => {
    if (p % 4 === 0) decorations.push({ kind: "widget", id: `w${p}`, at: core.createPosition(id, 20), text: "\u2022" });
  });
  if (withDecorations) controller.setDecorations(decorations);

  // Caret in paragraph 10 (on a visible page, among decorated text).
  const target = ids[10];
  if (target === undefined) throw new Error("setup");
  const caret = core.createPosition(target, 10);
  editor = core.reduceEditor(editor, { type: "SET_SELECTION", selection: core.createSpan(caret, caret) }, config);
  controller.update(editor);

  const typing: number[] = [];
  core.resetPerfTrace();
  core.setPerfTraceEnabled(true);
  for (let i = 0; i < keystrokes; i++) {
    const t = performance.now();
    editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text: "x" }, config);
    controller.update(editor);
    typing.push(performance.now() - t);
  }
  core.setPerfTraceEnabled(false);
  // Decoration work per keystroke: carrying the layers through the edit + resolving
  // the visible pages' fragments (the only decoration code on the typing path).
  const entries = core.report().entries;
  const perKey = {
    ifcLayouts: countOf("ifc.layout") / keystrokes,
    blocksRendered: countOf("render.blockBody") / keystrokes,
    decorationsMapped: countOf("decorations.mapped") / keystrokes,
    segmentGeometries: countOf("decorations.segmentGeometry") / keystrokes,
    widgetResolves: countOf("ctrl.widgetResolve") / keystrokes,
  };
  const decorationMs =
    entries
      .filter((e) => e.label === "ctrl.decorationLayers" || e.label === "ctrl.decorationRects" || e.label === "ctrl.syncWidgets")
      .reduce((sum, e) => sum + e.totalMs, 0) / keystrokes;
  const updates: number[] = [];
  let updateResolves = 0;
  if (withDecorations) {
    core.resetPerfTrace();
    core.setPerfTraceEnabled(true);
    for (let i = 0; i < 30; i++) {
      const next = decorations.map((d, k) => (k === 30 ? { ...d, style: { backgroundColor: `rgba(${i}, 0, 0, 0.2)` } } : d));
      const t = performance.now();
      controller.setDecorations(next);
      updates.push(performance.now() - t);
    }
    core.setPerfTraceEnabled(false);
    updateResolves = countOf("decorations.segmentGeometry") / 30;
  }
  const count = controller.decorations.decorations.length;
  controller.destroy();
  return { typing: median(typing), update: median(updates), count, decorationMs, perKey, updateResolves };
}

describe("print typing latency (20k words, 1,000 decorations + 100 widgets)", () => {
  it("decorations add no meaningful keystroke cost; decoration updates stay within budget", () => {
    run(true, 3); // warm-up (JIT, font/line caches)
    const base = run(false, 15);
    const decorated = run(true, 15);
    console.log(
      `print typing median: ${base.typing.toFixed(2)}ms bare / ${decorated.typing.toFixed(2)}ms with 1,000 decorations + 100 widgets; ` +
        `decoration work ${decorated.decorationMs.toFixed(2)}ms/keystroke; decoration update median ${decorated.update.toFixed(2)}ms; ` +
        `per keystroke bare ${JSON.stringify(base.perKey)} decorated ${JSON.stringify(decorated.perKey)}; update resolves ${decorated.updateResolves}`,
    );
    expect(decorated.count).toBe(1100);
    // Deterministic gate (load-independent operation counts).
    for (const r of [base, decorated]) {
      // Liveness first: a renamed / silent trace label must not pass a budget vacuously.
      expect(r.perKey.ifcLayouts).toBeGreaterThan(0);
      expect(r.perKey.ifcLayouts).toBeLessThanOrEqual(PER_KEYSTROKE_BUDGET.ifcLayouts);
      expect(r.perKey.blocksRendered).toBeGreaterThan(0);
      expect(r.perKey.blocksRendered).toBeLessThanOrEqual(PER_KEYSTROKE_BUDGET.blocksRendered);
    }
    expect(decorated.perKey.decorationsMapped).toBeGreaterThan(0); // the counter is live
    expect(decorated.perKey.decorationsMapped).toBeLessThanOrEqual(PER_KEYSTROKE_BUDGET.decorationsMapped);
    expect(decorated.perKey.segmentGeometries).toBeGreaterThan(0);
    expect(decorated.perKey.segmentGeometries).toBeLessThanOrEqual(PER_KEYSTROKE_BUDGET.segmentGeometries);
    expect(decorated.perKey.widgetResolves).toBeGreaterThan(0);
    expect(decorated.perKey.widgetResolves).toBeLessThanOrEqual(PER_KEYSTROKE_BUDGET.widgetResolves);
    expect(decorated.updateResolves).toBeGreaterThan(0);
    expect(decorated.updateResolves).toBeLessThanOrEqual(SEGMENTS_PER_UPDATE_BUDGET);
    // Coarse wall-clock backstops.
    expect(base.typing).toBeLessThan(TYPING_BACKSTOP_MS);
    expect(decorated.typing).toBeLessThan(TYPING_BACKSTOP_MS);
    expect(decorated.update).toBeLessThan(UPDATE_BACKSTOP_MS);
  }, 120_000);
});

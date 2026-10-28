/**
 * Inline marks + typing attributes on the PRINT backend, driven through the REAL
 * controller (textarea input / IME / keyboard / mouse / clipboard → dispatch →
 * real reducer → controller.update) and a spy canvas.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as core from "@taleweaver/core";
import { createEditorController, type EditorController } from "./index";
import { createDefaultComponentRegistry } from "@taleweaver/core";

const TEST_RESOLVER = createDefaultComponentRegistry();

const MENTION_BG = "rgb(10, 20, 30)";

interface Fill { x: number; y: number; w: number; h: number; fillStyle: string }
interface Glyph { text: string; x: number; y: number }

const fillsOf = new WeakMap<HTMLCanvasElement, { fills: Fill[]; glyphs: Glyph[] }>();
let originalGetContext: PropertyDescriptor | undefined;
let originalIO: typeof IntersectionObserver | undefined;

beforeEach(() => {
  // Paginated mounts observe page slots: report every page visible.
  originalIO = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = vi.fn().mockImplementation((cb: IntersectionObserverCallback) => ({
    observe: (el: Element) => cb([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })) as unknown as typeof IntersectionObserver;
  originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: function (this: HTMLCanvasElement) {
      const rec = { fills: [] as Fill[], glyphs: [] as Glyph[] };
      fillsOf.set(this, rec);
      const noop = () => {};
      return {
        canvas: this,
        font: "",
        fillStyle: "",
        strokeStyle: "",
        textBaseline: "alphabetic",
        lineWidth: 1,
        globalAlpha: 1,
        lineJoin: "miter",
        fillRect(this: { fillStyle: string }, x: number, y: number, w: number, h: number) {
          rec.fills.push({ x, y, w, h, fillStyle: this.fillStyle });
        },
        fillText(text: string, x: number, y: number) {
          rec.glyphs.push({ text, x, y });
        },
        measureText: (t: string) => ({ width: t.length * 8 }),
        clearRect: noop, moveTo: noop, lineTo: noop, stroke: noop, drawImage: noop, setTransform: noop,
        save: noop, restore: noop, scale: noop, beginPath: noop, closePath: noop, arc: noop, rect: noop,
        clip: noop, fill: noop, strokeRect: noop, setLineDash: noop,
      };
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  if (originalIO !== undefined) globalThis.IntersectionObserver = originalIO;
  if (originalGetContext !== undefined) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
  document.body.innerHTML = "";
});

function makeConfig(): core.EditorConfig {
  const attrRegistry = core.createDefaultAttrRegistry();
  core.registerMark(attrRegistry, "mention", { atomic: true, toStyle: () => ({ backgroundColor: MENTION_BG }) });
  core.registerMark(attrRegistry, "secret", { copy: "drop" });
  return { componentRegistry: core.createDefaultComponentRegistry(), attrRegistry, containerWidth: 600 };
}

/** A live editor: the controller dispatches into the real reducer and repaints. */
function mount(text: string, pageConfig?: core.PageConfig): {
  container: HTMLElement;
  textarea: HTMLTextAreaElement;
  controller: EditorController;
  get: () => core.EditorState;
  dispatch: (a: core.EditorAction) => void;
  id: core.BlockId;
} {
  const cfg = makeConfig();
  let editor = core.reduceEditor(core.createInitialEditorState(cfg), { type: "INSERT_TEXT", text }, cfg);
  const container = document.createElement("div");
  document.body.appendChild(container);
  let controller: EditorController | null = null;
  const dispatch = (a: core.EditorAction): void => {
    editor = core.reduceEditor(editor, a, cfg);
    controller?.update(editor);
  };
  controller = createEditorController(container, {
    measurer: core.createMockMeasurer(8, 16),
    dispatch,
    config: cfg,
    ...(pageConfig !== undefined ? { pageConfig, pageHeight: pageConfig.pageBlockSize, pageGap: pageConfig.pageGap } : {}),
  });
  controller.update(editor);
  const textarea = container.querySelector("textarea");
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("no textarea");
  return { container, textarea, controller, get: () => editor, dispatch, id: editor.selection.focus.blockId };
}

const span = (id: core.BlockId, a: number, b: number): core.Span =>
  core.createSpan(core.createPosition(id, a), core.createPosition(id, b));

function runsOf(editor: core.EditorState, id: core.BlockId): Array<[string, Record<string, unknown>]> {
  return (core.resolveBlock(editor.state, id)?.block.inlineContent?.items ?? []).map((it) => [it.kind === "text" ? it.text : "", { ...it.attrs }]);
}

function type(textarea: HTMLTextAreaElement, text: string): void {
  textarea.value = text;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("print — typing attributes through the controller", () => {
  it("text typed into a bold word (textarea input) and an IME commit are bold", () => {
    const m = mount("word");
    m.dispatch({ type: "SET_SELECTION", selection: span(m.id, 0, 4) });
    m.dispatch({ type: "TOGGLE_STYLE", style: "bold" });
    m.dispatch({ type: "SET_SELECTION", selection: span(m.id, 2, 2) });
    type(m.textarea, "X");
    m.textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    m.textarea.dispatchEvent(new CompositionEvent("compositionend", { data: "日", bubbles: true }));
    expect(runsOf(m.get(), m.id)).toEqual([["woX日rd", { bold: true }]]);
    m.controller.destroy();
  });

  // The print key handler accepts either platform's single modifier (Ctrl, or Cmd on a Mac).
  it.each([{ ctrlKey: true }, { metaKey: true }])("%o+B at a collapsed caret makes the next typed text bold", (mod) => {
    const m = mount("ab");
    m.textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ...mod, bubbles: true }));
    type(m.textarea, "c");
    expect(runsOf(m.get(), m.id)).toEqual([["ab", {}], ["c", { bold: true }]]);
    m.controller.destroy();
  });
});

describe("print — atomic marks through the controller", () => {
  function withMention() {
    const m = mount("Hi Anna and Bob");
    m.dispatch({ type: "SET_MARK", key: "mention", value: { ref: "a" }, span: span(m.id, 3, 7) });
    return m;
  }

  it("paints the mark's toStyle background behind exactly the mention", () => {
    const m = withMention();
    const canvas = m.container.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no canvas");
    const bands = (fillsOf.get(canvas)?.fills ?? []).filter((f) => f.fillStyle === MENTION_BG);
    expect(bands.map((b) => b.w).reduce((a, b) => a + b, 0)).toBe(4 * 8);
    m.controller.destroy();
  });

  it("a click inside the mention puts the caret at its nearest edge; ArrowRight from its start jumps past it", () => {
    const m = withMention();
    const canvas = m.container.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no canvas");
    const a = fillsOf.get(canvas)?.glyphs.find((g) => g.text === "A");
    if (a === undefined) throw new Error("no glyph");
    // Just right of "A" (offset 4 → nearest edge 3).
    m.container.dispatchEvent(new MouseEvent("mousedown", { clientX: a.x + 9, clientY: a.y - 4, detail: 1, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: a.x + 9, clientY: a.y - 4, bubbles: true }));
    expect(m.get().selection.focus.offset).toBe(3);
    m.textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(m.get().selection.focus.offset).toBe(7);
    m.textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(runsOf(m.get(), m.id)).toEqual([["Hi  and Bob", {}]]);
    m.controller.destroy();
  });

  it("copy keeps a copy:\"keep\" mark in the lossless clip and strips copy:\"drop\" marks", () => {
    const m = withMention();
    m.dispatch({ type: "SET_MARK", key: "secret", value: true, span: span(m.id, 0, 15) });
    m.dispatch({ type: "SET_SELECTION", selection: span(m.id, 0, 15) });
    const store = new Map<string, string>();
    const e = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "clipboardData", { value: { setData: (k: string, v: string) => store.set(k, v), getData: () => "" } });
    m.textarea.dispatchEvent(e);
    const frag = core.decodeFragmentClip(store.get(core.TALEWEAVER_CLIP_MIME) ?? "", TEST_RESOLVER, core.createDefaultAttrRegistry());
    if (frag === null) throw new Error("no clip");
    expect(core.getMarkRanges(frag, "mention").map((r) => r.value)).toEqual([{ ref: "a" }]);
    expect(core.getMarkRanges(frag, "secret")).toEqual([]);
    m.controller.destroy();
  });
});

/** Client point at the caret position (blockId, offset) — +1px inward so it resolves there. */
function pointAt(m: ReturnType<typeof mount>, offset: number, blockId: core.BlockId = m.id): { clientX: number; clientY: number } {
  const r = m.controller.getCaretRect(core.createPosition(blockId, offset));
  if (r === null) throw new Error(`no caret rect for ${offset}`);
  return { clientX: r.left + 1, clientY: r.top + r.height / 2 };
}

function press(m: ReturnType<typeof mount>, key: string, init: KeyboardEventInit = {}): void {
  m.textarea.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
}

function sel(m: ReturnType<typeof mount>): [number, number] {
  const { anchor, focus } = m.get().selection;
  return [anchor.offset, focus.offset];
}

describe("print — atomic marks: pointer + keyboard interplay", () => {
  // "Hi Anna Lee and Bob": mention "Anna Lee" = 3..11.
  function withMention(pageConfig?: core.PageConfig, text = "Hi Anna Lee and Bob", from = 3, to = 11) {
    const m = mount(text, pageConfig);
    m.dispatch({ type: "SET_MARK", key: "mention", value: { ref: "a" }, span: span(m.id, from, to) });
    m.dispatch({ type: "SET_SELECTION", selection: span(m.id, 0, 0) });
    return m;
  }

  function drag(m: ReturnType<typeof mount>, from: number, to: number): void {
    m.container.dispatchEvent(new MouseEvent("mousedown", { ...pointAt(m, from), detail: 1, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { ...pointAt(m, to), bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { ...pointAt(m, to), bubbles: true }));
  }

  it.each([
    [4, 15, [3, 15]],
    [10, 15, [3, 15]],
    [4, 1, [11, 1]],
    [10, 1, [11, 1]],
  ])("a drag from %i (inside the mention) to %i selects the whole mention", (from, to, expected) => {
    const m = withMention();
    drag(m, from, to);
    expect(sel(m)).toEqual(expected);
    m.controller.destroy();
  });

  it("shift-click into the mention extends over all of it, in both directions", () => {
    const m = withMention();
    m.dispatch({ type: "SET_SELECTION", selection: span(m.id, 1, 1) });
    m.container.dispatchEvent(new MouseEvent("mousedown", { ...pointAt(m, 5), detail: 1, shiftKey: true, bubbles: true }));
    expect(sel(m)).toEqual([1, 11]);
    m.dispatch({ type: "SET_SELECTION", selection: span(m.id, 15, 15) });
    m.container.dispatchEvent(new MouseEvent("mousedown", { ...pointAt(m, 9), detail: 1, shiftKey: true, bubbles: true }));
    expect(sel(m)).toEqual([15, 3]);
    m.controller.destroy();
  });

  it("Shift+Arrow crosses the mention as one unit; ArrowLeft from its end jumps before it; forward Delete removes it", () => {
    const m = withMention();
    m.dispatch({ type: "SET_SELECTION", selection: span(m.id, 3, 3) });
    press(m, "ArrowRight", { shiftKey: true });
    expect(sel(m)).toEqual([3, 11]);
    press(m, "ArrowLeft", { shiftKey: true });
    expect(sel(m)).toEqual([3, 3]);
    m.dispatch({ type: "SET_SELECTION", selection: span(m.id, 11, 11) });
    press(m, "ArrowLeft", { shiftKey: true });
    expect(sel(m)).toEqual([11, 3]);
    m.dispatch({ type: "SET_SELECTION", selection: span(m.id, 11, 11) });
    press(m, "ArrowLeft");
    expect(sel(m)).toEqual([3, 3]);
    press(m, "Delete");
    expect(runsOf(m.get(), m.id)).toEqual([["Hi  and Bob", {}]]);
    m.controller.destroy();
  });

  it("double-click inside the mention selects the whole mention, not a partial word", () => {
    const m = withMention();
    m.container.dispatchEvent(new MouseEvent("mousedown", { ...pointAt(m, 5), detail: 2, bubbles: true }));
    expect(sel(m)).toEqual([3, 11]);
    m.controller.destroy();
  });

  // 7 chars per line: "ab Anna " / "Lee cd" — the mention 3..11 wraps across the lines.
  const NARROW: core.PageConfig = {
    pageInlineSize: 56,
    pageBlockSize: 400,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };

  it("ArrowDown / ArrowUp landing inside a mention that wraps across lines go to its nearest edge", () => {
    const m = withMention(NARROW, "ab Anna Lee cd");
    m.dispatch({ type: "SET_SELECTION", selection: span(m.id, 1, 1) });
    press(m, "ArrowDown"); // line 2 at x≈8 → offset 9 ("L|ee"), inside → nearest edge 11
    expect(sel(m)).toEqual([11, 11]);
    m.dispatch({ type: "SET_SELECTION", selection: span(m.id, 13, 13), targetX: null });
    press(m, "ArrowUp"); // line 1 at x≈40 → offset 5 ("An|na"), inside → nearest edge 3
    expect(sel(m)).toEqual([3, 3]);
    m.controller.destroy();
  });

  it("a mention straddling a page break: a click in its page-2 half snaps; ArrowRight from its start reaches its end on page 2", () => {
    // Lines (7 chars): "aaaaaa " / "bb Anna " | page break | "Lee cc " / "dddddd" — two lines
    // per page (orphans/widows 2), the mention 10..18 straddles the break.
    const m = withMention({ ...NARROW, pageBlockSize: 32 }, "aaaaaa bb Anna Lee cc dddddd", 10, 18);
    const onPage2 = pointAt(m, 16);
    expect(onPage2.clientY).toBeGreaterThan(32); // really on the second page
    m.container.dispatchEvent(new MouseEvent("mousedown", { ...onPage2, detail: 1, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { ...onPage2, bubbles: true }));
    expect(sel(m)).toEqual([18, 18]);
    m.dispatch({ type: "SET_SELECTION", selection: span(m.id, 10, 10) });
    press(m, "ArrowRight");
    expect(sel(m)).toEqual([18, 18]);
    press(m, "ArrowLeft");
    expect(sel(m)).toEqual([10, 10]);
    m.controller.destroy();
  });

  it("an RTL mention: a click inside lands on its visually nearest edge", () => {
    // Hebrew paragraph; mention over the 6-letter word at 3..9. Logical start (3) is
    // the word's visual RIGHT edge in RTL.
    const m = withMention(undefined, "אב גדהוזח טי", 3, 9);
    const start = m.controller.getCaretRect(core.createPosition(m.id, 3));
    const end = m.controller.getCaretRect(core.createPosition(m.id, 9));
    if (start === null || end === null) throw new Error("no rects");
    expect(start.left).toBeGreaterThan(end.left); // RTL: start edge is on the right
    // Click 1px inside the right (start) edge → caret at the start edge (3).
    m.container.dispatchEvent(new MouseEvent("mousedown", { clientX: start.left - 2, clientY: start.top + start.height / 2, detail: 1, bubbles: true }));
    expect(sel(m)).toEqual([3, 3]);
    // Click 1px inside the left (end) edge → the end edge (9).
    m.container.dispatchEvent(new MouseEvent("mousedown", { clientX: end.left + 2, clientY: end.top + end.height / 2, detail: 1, bubbles: true }));
    expect(sel(m)).toEqual([9, 9]);
    m.controller.destroy();
  });

  it("a mention in a header body is atomic too", () => {
    const PAGED: core.PageConfig = {
      pageInlineSize: 400,
      pageBlockSize: 200,
      pageMargins: { blockStart: 40, blockEnd: 40, inlineStart: 0, inlineEnd: 0 },
      pageGap: 24,
    };
    const m = mount("Body", PAGED);
    m.dispatch({ type: "INSERT_HEADER" });
    const hid = m.get().selection.focus.blockId;
    expect(hid).not.toBe(m.id);
    m.dispatch({ type: "INSERT_TEXT", text: "To Anna" });
    m.dispatch({ type: "SET_MARK", key: "mention", value: { ref: "a" }, span: span(hid, 3, 7) });
    m.dispatch({ type: "SET_SELECTION", selection: span(hid, 1, 1), caretPageHint: 0 });
    m.container.dispatchEvent(new MouseEvent("mousedown", { ...pointAt(m, 4, hid), detail: 1, bubbles: true }));
    expect(m.get().selection.focus).toEqual(core.createPosition(hid, 3));
    press(m, "ArrowRight");
    expect(m.get().selection.focus).toEqual(core.createPosition(hid, 7));
    press(m, "Backspace");
    expect(runsOf(m.get(), hid)).toEqual([["To ", {}]]);
    m.controller.destroy();
  });
});

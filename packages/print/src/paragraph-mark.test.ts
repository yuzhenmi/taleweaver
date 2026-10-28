/**
 * The ¶ as a text unit on the PRINT backend, driven through
 * the REAL controller (keyboard / mouse → dispatch → real reducer → controller.update):
 * Shift+Enter inserts a soft line break, triple-click selects the paragraph WITH its
 * ¶ (core `selectParagraph`), Shift+End stops before the ¶, a covered ¶ paints the
 * selection extension at its caret, and markers are never caret stops (core
 * `caretAfterMarkers`: hit-test and arrow keys).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as core from "@taleweaver/core";
import { createEditorController, type EditorController } from "./index";

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
  return { componentRegistry: core.createDefaultComponentRegistry(), attrRegistry: core.createDefaultAttrRegistry(), containerWidth: 600 };
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


const pos = (id: core.BlockId, o: number): core.Position => core.createPosition(id, o);
const caretAt = (m: ReturnType<typeof mount>, id: core.BlockId, o: number): void =>
  m.dispatch({ type: "SET_SELECTION", selection: core.createSpan(pos(id, o), pos(id, o)) });
const key = (m: ReturnType<typeof mount>, k: string, init: KeyboardEventInit = {}): void => {
  m.textarea.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
};
/** The last painted glyph `text` (glyphs are painted one per character and accumulate over repaints). */
const lastGlyph = (g: readonly Glyph[], text: string): Glyph | undefined => [...g].reverse().find((x) => x.text === text);
/** The painted glyphs (one per character; accumulated over repaints — read the last). */
const glyphs = (m: ReturnType<typeof mount>): Glyph[] => {
  const canvas = m.container.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no canvas");
  return fillsOf.get(canvas)?.glyphs ?? [];
};
const fills = (m: ReturnType<typeof mount>): Fill[] => {
  const canvas = m.container.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no canvas");
  return fillsOf.get(canvas)?.fills ?? [];
};
const click = (m: ReturnType<typeof mount>, x: number, y: number, detail = 1): void => {
  m.container.dispatchEvent(new MouseEvent("mousedown", { clientX: x, clientY: y, detail, bubbles: true }));
  document.dispatchEvent(new MouseEvent("mouseup", { clientX: x, clientY: y, bubbles: true }));
};
/** The body paragraphs in document order (one section). */
function paragraphs(state: core.State): core.BlockId[] {
  const out: core.BlockId[] = [];
  for (let id: core.BlockId | null = core.firstLeafBlock(state, state.rootId); id !== null; id = core.getBlock(state, id)?.nextSiblingId ?? null) out.push(id);
  return out;
}
/** "Ab" ¶ "Cd": two paragraphs (Enter after "Ab"). */
function twoParagraphs(): { m: ReturnType<typeof mount>; p: core.BlockId; n: core.BlockId } {
  const m = mount("Ab");
  m.dispatch({ type: "SPLIT_NODE" });
  m.dispatch({ type: "INSERT_TEXT", text: "Cd" });
  const [p, n] = paragraphs(m.get().state);
  if (p === undefined || n === undefined) throw new Error("paragraphs");
  return { m, p, n };
}

describe("print — Shift+Enter (soft line break)", () => {
  it("inserts a hard-break inside the paragraph: block count and attrs unchanged, the rest on the next line", () => {
    const m = mount("Hello world");
    caretAt(m, m.id, 5);
    const before = paragraphs(m.get().state);
    const attrs = core.getBlock(m.get().state, m.id)?.attrs;
    key(m, "Enter", { shiftKey: true });
    const s = m.get().state;
    expect(paragraphs(s)).toEqual(before);
    expect(core.getBlock(s, m.id)?.attrs).toEqual(attrs);
    expect(core.resolveBlock(s, m.id)?.block.inlineContent?.items.map((i) => i.kind)).toEqual(["text", "embed", "text"]);
    expect(m.get().selection.focus).toEqual(pos(m.id, 6));
    const g = glyphs(m);
    const hello = lastGlyph(g, "H");
    const world = lastGlyph(g, "w");
    if (hello === undefined || world === undefined) throw new Error("glyphs");
    expect(world.y).toBeGreaterThan(hello.y);
    m.controller.destroy();
  });

  it("plain Enter still splits the paragraph", () => {
    const m = mount("Hello");
    key(m, "Enter");
    expect(paragraphs(m.get().state)).toHaveLength(2);
    m.controller.destroy();
  });
});

describe("print — triple-click / Shift+End (¶ selection)", () => {
  it("triple-click selects (P, 0)–(N, 0) — the paragraph WITH its ¶; on the last paragraph (N, 0)–(N, len)", () => {
    const { m, p, n } = twoParagraphs();
    const a = lastGlyph(glyphs(m), "A");
    const c = lastGlyph(glyphs(m), "C");
    if (a === undefined || c === undefined) throw new Error("glyphs");
    click(m, a.x + 3, a.y + 4, 3);
    expect(m.get().selection).toEqual(core.createSpan(pos(p, 0), pos(n, 0)));
    click(m, c.x + 3, c.y + 4, 3);
    expect(m.get().selection).toEqual(core.createSpan(pos(n, 0), pos(n, 2)));
    m.controller.destroy();
  });

  it("Shift+End stops before the ¶ at (P, len); Shift+Right then selects exactly the ¶ (N, 0)", () => {
    const { m, p, n } = twoParagraphs();
    caretAt(m, p, 1);
    key(m, "End", { shiftKey: true });
    expect(m.get().selection).toEqual(core.createSpan(pos(p, 1), pos(p, 2)));
    caretAt(m, p, 2);
    key(m, "ArrowRight", { shiftKey: true });
    expect(m.get().selection).toEqual(core.createSpan(pos(p, 2), pos(n, 0)));
    m.controller.destroy();
  });
});

describe("print — selection ¶ extension", () => {
  it("a covered ¶ paints one extension rect from the caret x of (P, len), two spaces wide; an uncovered ¶ paints none", () => {
    const { m, p, n } = twoParagraphs();
    const selFills = (): Fill[] => fills(m).filter((f) => f.fillStyle !== "" && f.h > 0 && f.w > 0 && f.fillStyle.startsWith("rgba"));
    fills(m).length = 0;
    m.dispatch({ type: "SET_SELECTION", selection: core.createSpan(pos(p, 1), pos(n, 1)) });
    const covered = selFills();
    const a = lastGlyph(glyphs(m), "A");
    if (a === undefined) throw new Error("glyph");
    const endOfP = a.x + 2 * 8; // the caret x of (P, len)
    // The first line's selection runs from "b" to the caret of (P, len) + the extension.
    expect(covered.some((f) => f.x === a.x + 8 && f.x + f.w === endOfP + 16)).toBe(true);
    fills(m).length = 0; // drop the earlier paints
    m.dispatch({ type: "SET_SELECTION", selection: core.createSpan(pos(p, 1), pos(p, 2)) });
    expect(selFills().length).toBeGreaterThan(0);
    expect(selFills().some((f) => f.x + f.w > endOfP)).toBe(false);
    m.controller.destroy();
  });
});

describe("print — markers are never caret stops (core caretAfterMarkers)", () => {
  /** A heading "Title" (bookmarked by a cross-reference in the paragraph after it). */
  function bookmarked(): { m: ReturnType<typeof mount>; t: core.BlockId } {
    const m = mount("");
    m.dispatch({ type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } });
    m.dispatch({ type: "INSERT_TEXT", text: "Title" });
    m.dispatch({ type: "SPLIT_NODE" });
    const host = m.get().selection.focus.blockId;
    m.dispatch({ type: "SET_BLOCK_TYPE", blockType: "paragraph" });
    const [t] = paragraphs(m.get().state);
    if (t === undefined || t === host) throw new Error("target");
    m.dispatch({ type: "INSERT_CROSS_REFERENCE", targetId: t, refMode: "text" });
    // [start] "Title" [end]: 7 units.
    expect(core.resolveBlock(m.get().state, t)?.block.inlineContent?.items.map((i) => i.kind)).toEqual(["embed", "text", "embed"]);
    return { m, t };
  }

  it("a click right before the bookmarked word puts the caret after the start marker; typing lands inside", () => {
    const { m, t } = bookmarked();
    // The heading's "T" (topmost; the field in the paragraph below repeats "Title").
    const g = glyphs(m).filter((x) => x.text === "T").sort((p, q) => p.y - q.y)[0];
    if (g === undefined) throw new Error("glyph");
    click(m, g.x - 4, g.y + 4); // left of the line start: the raw hit is (T, 0), before the start marker
    expect(m.get().selection.focus).toEqual(pos(t, 1));
    m.dispatch({ type: "INSERT_TEXT", text: "X" });
    const items = core.resolveBlock(m.get().state, t)?.block.inlineContent?.items ?? [];
    expect(items.map((i) => (i.kind === "text" ? i.text : i.kind))).toEqual(["embed", "XTitle", "embed"]);
    m.controller.destroy();
  });

  it("one Arrow press crosses one character and never stops between a marker and a character", () => {
    const { m, t } = bookmarked();
    caretAt(m, t, 7); // after "Title" and its end marker
    key(m, "ArrowLeft");
    expect(m.get().selection.focus).toEqual(pos(t, 5));
    key(m, "ArrowRight");
    expect(m.get().selection.focus).toEqual(pos(t, 7));
    caretAt(m, t, 2);
    key(m, "ArrowLeft");
    expect(m.get().selection.focus).toEqual(pos(t, 1));
    key(m, "ArrowRight", { shiftKey: true });
    expect(m.get().selection.focus).toEqual(pos(t, 2));
    m.controller.destroy();
  });

  it("Home / End / Shift+Home / Shift+End land past the line's markers", () => {
    const { m, t } = bookmarked();
    caretAt(m, t, 3);
    key(m, "Home"); // the line start (T, 0) is before the start marker
    expect(m.get().selection).toEqual(core.createSpan(pos(t, 1), pos(t, 1)));
    key(m, "End");
    expect(m.get().selection).toEqual(core.createSpan(pos(t, 7), pos(t, 7)));
    caretAt(m, t, 3);
    key(m, "Home", { shiftKey: true });
    expect(m.get().selection).toEqual(core.createSpan(pos(t, 3), pos(t, 1)));
    caretAt(m, t, 3);
    key(m, "End", { shiftKey: true });
    expect(m.get().selection).toEqual(core.createSpan(pos(t, 3), pos(t, 7)));
    m.controller.destroy();
  });
});

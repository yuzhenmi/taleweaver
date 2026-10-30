/**
 * Range selections touching OBJECT blocks (rule / image / table — core
 * `isObjectBlock`) on the PRINT backend, driven through the REAL controller
 * (mouse / clipboard → dispatch → real reducer → controller.update) and a spy
 * canvas: a covered object is highlighted whole (its box), a drag from text into
 * a table cell selects the whole table (core lifts the endpoint), a drag onto an
 * image ends on it, copy works, and the a11y mirror's DOM range covers the
 * object's element. Fresh document per case.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as core from "@taleweaver/core";
import { createEditorController, type EditorController } from "./index";

const SELECTION_FILL = "rgba(59, 130, 246, 0.3)";

interface Fill { x: number; y: number; w: number; h: number; fillStyle: string }

const fillsOf = new WeakMap<HTMLCanvasElement, Fill[]>();
let originalGetContext: PropertyDescriptor | undefined;

beforeEach(() => {
  originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: function (this: HTMLCanvasElement) {
      const fills: Fill[] = [];
      fillsOf.set(this, fills);
      const noop = () => {};
      return {
        canvas: this, font: "", fillStyle: "", strokeStyle: "", textBaseline: "alphabetic",
        lineWidth: 1, globalAlpha: 1, lineJoin: "miter",
        fillRect(this: { fillStyle: string }, x: number, y: number, w: number, h: number) {
          fills.push({ x, y, w, h, fillStyle: this.fillStyle });
        },
        measureText: (t: string) => ({ width: t.length * 8 }),
        fillText: noop, clearRect: noop, moveTo: noop, lineTo: noop, stroke: noop, drawImage: noop, setTransform: noop,
        save: noop, restore: noop, scale: noop, beginPath: noop, closePath: noop, arc: noop, rect: noop,
        clip: noop, fill: noop, strokeRect: noop, setLineDash: noop,
      };
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  if (originalGetContext !== undefined) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
  document.body.innerHTML = "";
});

/** A live `"abcd" | object | ""` editor (the controller dispatches into the real reducer). */
function mount(object: core.EditorAction) {
  const cfg: core.EditorConfig = {
    componentRegistry: core.createDefaultComponentRegistry(),
    attrRegistry: core.createDefaultAttrRegistry(),
    containerWidth: 600,
  };
  let editor = core.reduceEditor(core.reduceEditor(core.createInitialEditorState(cfg), { type: "INSERT_TEXT", text: "abcd" }), object);
  const container = document.createElement("div");
  document.body.appendChild(container);
  let controller: EditorController | null = null;
  const dispatch = (a: core.EditorAction): void => {
    editor = core.reduceEditor(editor, a);
    controller?.update(editor);
  };
  controller = createEditorController(container, { measurer: core.createMockMeasurer(8, 16), dispatch, accessibilityMirror: true });
  controller.update(editor);
  const st = editor.state;
  const first = core.firstLeafBlock(st, st.rootId);
  const section = first === null ? null : core.getBlock(st, first)?.parentId ?? null;
  const ids: core.BlockId[] = [];
  for (let id = section === null ? null : core.getBlock(st, section)?.firstChildId ?? null; id !== null; id = core.getBlock(st, id)?.nextSiblingId ?? null) {
    ids.push(id);
  }
  const [text, obj, after] = ids;
  if (text === undefined || obj === undefined || after === undefined) throw new Error("expected \"abcd\" | object | \"\"");
  const canvas = container.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no canvas");
  /** The selection tint rects of the LAST paint. */
  const selectionFills = (): Array<Omit<Fill, "fillStyle">> => {
    const fills = fillsOf.get(canvas) ?? [];
    return fills.filter((f) => f.fillStyle === SELECTION_FILL).map(({ x, y, w, h }) => ({ x, y, w, h }));
  };
  return { container, controller, get: () => editor, dispatch, text, obj, after, selectionFills };
}

type Mounted = ReturnType<typeof mount>;
const at = core.createPosition;

function pointAt(m: Mounted, pos: core.Position): { clientX: number; clientY: number } {
  const r = m.controller.getCaretRect(pos);
  if (r === null) throw new Error("no caret rect");
  return { clientX: r.left + 1, clientY: r.top + r.height / 2 };
}

function drag(m: Mounted, from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }): void {
  m.container.dispatchEvent(new MouseEvent("mousedown", { ...from, detail: 1, bubbles: true }));
  document.dispatchEvent(new MouseEvent("mousemove", { ...to, bubbles: true }));
  document.dispatchEvent(new MouseEvent("mouseup", { ...to, bubbles: true }));
}

// "bcd" (x 8, 3 glyphs) on line 1; the object box sits below at y 24, full width.
const BCD = { x: 8, y: 0, w: 24, h: 16 };

describe("print — range selections over object blocks through the controller", () => {
  it("a range ending on a rule paints the text and the rule; copy and the a11y mirror cover it", () => {
    const m = mount({ type: "INSERT_HORIZONTAL_LINE" });
    m.dispatch({ type: "SET_SELECTION", selection: core.createSpan(at(m.text, 1), at(m.obj, 0)) });
    expect(m.selectionFills()).toEqual([BCD, { x: 0, y: 24, w: 600, h: 16 }]);
    // Copy reads the object range without throwing.
    const store = new Map<string, string>();
    const e = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "clipboardData", { value: { setData: (k: string, v: string) => store.set(k, v), getData: () => "" } });
    m.container.querySelector("textarea")?.dispatchEvent(e);
    expect(store.get("text/plain")).toBe("bcd");
    // The mirror's DOM range ends right after the rule's element.
    const hr = m.container.querySelector("[data-taleweaver-a11y-mirror] hr");
    const sel = window.getSelection();
    if (hr === null || sel === null || sel.rangeCount === 0) throw new Error("expected a mirror selection");
    expect(sel.getRangeAt(0).comparePoint(hr, 0)).toBe(0);
    expect(sel.focusNode).toBe(hr.parentNode);
    m.controller.destroy();
  });

  it("a drag from text into a table cell selects and paints the whole table", () => {
    const m = mount({ type: "INSERT_TABLE", rows: 1, cols: 1 });
    const cell = core.firstLeafBlock(m.get().state, m.obj);
    if (cell === null) throw new Error("no cell paragraph");
    drag(m, pointAt(m, at(m.text, 1)), pointAt(m, at(cell, 0)));
    expect(m.get().selection).toEqual(core.createSpan(at(m.text, 1), at(m.obj, 0)));
    expect(m.selectionFills()).toEqual([BCD, { x: 0, y: 24, w: 600, h: 32 }]);
    m.controller.destroy();
  });

  it("a drag from text onto an image ends on it and paints it", () => {
    const m = mount({ type: "INSERT_IMAGE", src: "x.png", width: 50, height: 40 });
    drag(m, pointAt(m, at(m.text, 1)), { clientX: 20, clientY: 40 });
    expect(m.get().selection).toEqual(core.createSpan(at(m.text, 1), at(m.obj, 0)));
    expect(m.selectionFills()).toEqual([BCD, { x: 0, y: 24, w: 600, h: 40 }]);
    m.controller.destroy();
  });

  it("Shift+Arrow covers a table in one step and steps off it; a plain arrow collapses past it; back in, the original caret anchors", () => {
    const m = mount({ type: "INSERT_TABLE", rows: 1, cols: 1 });
    const cell = core.firstLeafBlock(m.get().state, m.obj);
    if (cell === null) throw new Error("no cell paragraph");
    const textarea = m.container.querySelector("textarea");
    if (textarea === null) throw new Error("no textarea");
    const key = (k: string, shiftKey = false) => textarea.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true }));
    const sel = (a: core.Position, f: core.Position) => core.createSpan(a, f);

    m.dispatch({ type: "SET_SELECTION", selection: sel(at(m.text, 4), at(m.text, 4)) });
    key("ArrowDown", true);
    expect(m.get().selection).toEqual(sel(at(m.text, 4), at(m.obj, 0)));
    key("ArrowDown", true);
    expect(m.get().selection).toEqual(sel(at(m.text, 4), at(m.after, 0)));
    key("ArrowUp", true);
    expect(m.get().selection).toEqual(sel(at(m.text, 4), at(m.obj, 0)));
    key("ArrowLeft", true);
    expect(m.get().selection).toEqual(sel(at(m.text, 4), at(m.text, 4)));
    key("ArrowRight", true);
    expect(m.get().selection).toEqual(sel(at(m.text, 4), at(m.obj, 0)));
    key("ArrowRight");
    expect(m.get().selection).toEqual(sel(at(m.after, 0), at(m.after, 0)));

    // From a caret in the cell: out of the table lifts the anchor; back in restores it.
    m.dispatch({ type: "SET_SELECTION", selection: sel(at(cell, 0), at(cell, 0)) });
    key("ArrowDown", true);
    expect(m.get().selection).toEqual(sel(at(m.obj, 0), at(m.after, 0)));
    key("ArrowLeft", true);
    expect(m.get().selection.anchor).toEqual(at(cell, 0));
    expect(m.get().selection.focus.blockId).toBe(cell);
    m.controller.destroy();
  });
});

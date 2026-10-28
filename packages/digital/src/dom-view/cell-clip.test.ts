/**
 * The ¶ glyph / selected-¶ indicator inside a table cell is clipped at the cell's border
 * box. jsdom has no layout: ResizeObserver, rects and the
 * computed writing mode are stubbed.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createInitialEditorState,
  reduceEditor,
  createPosition,
  createSpan,
  getBlock,
  type BlockId,
  type State,
} from "@taleweaver/core";
import { createDigitalController } from "../editor-digital/digital-controller";
import { clipGlyph } from "./cell-clip";
import { endAnchor } from "./render-to-dom";

const rect = (left: number, top: number, width: number, height: number): DOMRect => new DOMRect(left, top, width, height);

/** A `<td>` holding a block with an end anchor; the anchor / cell rects and the glyph's writing mode stubbed. */
function cellGlyph(anchorRect: DOMRect, cellRect: DOMRect, writingMode: string, direction: string): HTMLElement {
  const td = document.createElement("td");
  const block = document.createElement("div");
  const anchor = endAnchor(document, "tw-break-mark", "tw-break-mark-glyph", "¶", "");
  block.appendChild(anchor);
  td.appendChild(block);
  document.body.replaceChildren(td);
  anchor.getBoundingClientRect = () => anchorRect;
  td.getBoundingClientRect = () => cellRect;
  const glyph = anchor.firstElementChild;
  if (!(glyph instanceof HTMLElement)) throw new Error("glyph");
  glyph.style.setProperty("writing-mode", writingMode);
  glyph.style.setProperty("direction", direction);
  clipGlyph(anchor, window);
  return glyph;
}

describe("cell clip formula: max-inline-size = max(0, cell inline end − anchor inline start)", () => {
  it("LTR: rightwards to the cell's right edge", () => {
    const g = cellGlyph(rect(180, 10, 0, 16), rect(0, 0, 200, 40), "horizontal-tb", "ltr");
    expect(g.style.getPropertyValue("max-inline-size")).toBe("20px");
    expect(g.style.getPropertyValue("overflow")).toBe("clip");
  });
  it("RTL: leftwards to the cell's left edge", () => {
    const g = cellGlyph(rect(14, 10, 0, 16), rect(8, 0, 200, 40), "horizontal-tb", "rtl");
    expect(g.style.getPropertyValue("max-inline-size")).toBe("6px");
  });
  it("vertical-rl: downwards to the cell's bottom edge; never negative", () => {
    expect(cellGlyph(rect(50, 70, 16, 0), rect(0, 0, 100, 90), "vertical-rl", "ltr").style.getPropertyValue("max-inline-size")).toBe("20px");
    expect(cellGlyph(rect(50, 95, 16, 0), rect(0, 0, 100, 90), "vertical-rl", "ltr").style.getPropertyValue("max-inline-size")).toBe("0px");
  });
  it("vertical-rl + RTL: upwards to the cell's top edge; never negative", () => {
    expect(cellGlyph(rect(50, 30, 16, 0), rect(0, 10, 100, 90), "vertical-rl", "rtl").style.getPropertyValue("max-inline-size")).toBe("20px");
    expect(cellGlyph(rect(50, 5, 16, 0), rect(0, 10, 100, 90), "vertical-rl", "rtl").style.getPropertyValue("max-inline-size")).toBe("0px");
  });
});

/** A minimal ResizeObserver stub recording observe / unobserve, with a manual `fire`. */
class FakeRO {
  static last: FakeRO | null = null;
  observed: Element[] = [];
  observes = 0;
  constructor(readonly cb: (entries: { target: Element }[]) => void) {
    FakeRO.last = this;
  }
  observe(el: Element, options?: { box?: string }): void {
    expect(options?.box).toBe("border-box");
    this.observes++;
    if (!this.observed.includes(el)) this.observed.push(el);
  }
  unobserve(el: Element): void {
    this.observed = this.observed.filter((e) => e !== el);
  }
  disconnect(): void {
    this.observed = [];
  }
  fire(): void {
    this.cb(this.observed.map((target) => ({ target })));
  }
}

describe("cell clip triggers (ResizeObserver on blocks hosting a glyph in a <td>, fonts loadingdone)", () => {
  const RO0 = Object.getOwnPropertyDescriptor(window, "ResizeObserver");
  afterEach(() => {
    if (RO0 === undefined) Reflect.deleteProperty(window, "ResizeObserver");
    else Object.defineProperty(window, "ResizeObserver", RO0);
    FakeRO.last = null;
  });

  function tableDoc(): { state: State; c1: BlockId; c2: BlockId; after: BlockId } {
    const config = { componentRegistry: createDefaultComponentRegistry(), attrRegistry: createDefaultAttrRegistry(), containerWidth: 800 };
    let e = createInitialEditorState(config);
    e = reduceEditor(e, { type: "INSERT_TABLE", rows: 1, cols: 2 }, config);
    const leaves: BlockId[] = [];
    const walk = (id: BlockId | null): void => {
      for (let cur = id; cur !== null; ) {
        const b = getBlock(e.state, cur);
        if (b === null) return;
        if (b.inlineContent !== null) leaves.push(b.id);
        else walk(b.firstChildId);
        cur = b.nextSiblingId;
      }
    };
    walk(getBlock(e.state, e.state.rootId)?.firstChildId ?? null);
    const c1 = leaves.find((id) => getBlock(e.state, id)?.parentId !== null && getBlock(e.state, getBlock(e.state, id)?.parentId ?? id)?.type === "table-cell");
    const c2 = c1 === undefined ? undefined : leaves[leaves.indexOf(c1) + 1];
    const after = leaves[leaves.length - 1];
    if (c1 === undefined || c2 === undefined || after === undefined) throw new Error("setup");
    return { state: e.state, c1, c2, after };
  }

  it("a selected ¶ in a cell is observed and measured; a stale element is dropped; a font load re-observes; destroy disconnects", () => {
    Object.defineProperty(window, "ResizeObserver", { value: FakeRO, configurable: true, writable: true });
    const fonts = new EventTarget();
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
    try {
      const { state, c1, c2 } = tableDoc();
      const container = document.createElement("div");
      document.body.replaceChildren(container);
      const controller = createDigitalController({
        container,
        componentRegistry: createDefaultComponentRegistry(),
        attrRegistry: createDefaultAttrRegistry(),
        doc: document,
        initialState: state,
      });
      const ro = FakeRO.last;
      if (ro === null) throw new Error("no observer");
      expect(ro.observed).toEqual([]); // no glyph in a cell yet
      controller.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(c1, 0), createPosition(c2, 0)) });
      const el = container.querySelector(`[data-block-id="${c1}"]`);
      if (!(el instanceof HTMLElement)) throw new Error("cell paragraph");
      expect(ro.observed).toEqual([el]);
      const anchor = el.querySelector(".tw-selected-mark");
      if (!(anchor instanceof HTMLElement)) throw new Error("no indicator");
      const td = el.closest("td");
      if (td === null) throw new Error("td");
      anchor.getBoundingClientRect = () => rect(95, 0, 0, 16);
      td.getBoundingClientRect = () => rect(0, 0, 100, 20);
      ro.fire(); // the initial callback
      expect(anchor.firstElementChild instanceof HTMLElement ? anchor.firstElementChild.style.getPropertyValue("max-inline-size") : null).toBe("5px");
      const observes = ro.observes;
      fonts.dispatchEvent(new Event("loadingdone"));
      expect(ro.observes).toBe(observes + 1);
      // A re-render replaces the element: the new one is observed, the stale one dropped on its callback.
      controller.setDecorations([{ kind: "block", id: "b", blockId: c1, class: "x" }]);
      const fresh = container.querySelector(`[data-block-id="${c1}"]`);
      expect(fresh).not.toBe(el);
      expect(ro.observed).toContain(fresh);
      ro.fire();
      expect(ro.observed).toEqual([fresh]);
      controller.destroy();
      expect(ro.observed).toEqual([]);
    } finally {
      Reflect.deleteProperty(document, "fonts");
    }
  });
});

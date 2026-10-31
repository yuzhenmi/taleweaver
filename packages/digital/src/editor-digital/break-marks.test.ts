/**
 * Paragraph marks (¶) in the digital view. A tracked ¶ (change tracking) — a paragraph
 * mark, or a section-end item drawn as Word's "Section Break" label — is a list-marker
 * style generated END anchor (zero size, non-editable, aria-hidden) after its own
 * paragraph's content. It is invisible to the selection
 * bridge, maps a click to (P, len), receives suggestion highlights / styles / pointer
 * events and appears in `suggestionRects`. Every ¶ a selection covers is drawn selected
 *, incrementally. Suggestions are made through the real editor reducer.
 */
import { describe, it, expect } from "vitest";
import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createPosition,
  createSpan,
  createInitialEditorState,
  reduceEditor,
  getBlock,
  getSuggestions,
  resetPerfTrace,
  setPerfTraceEnabled,
  report,
  type BlockId,
  type EditorAction,
  type EditorState,
  type State,
} from "@taleweaver/core";
import { createDigitalController, type DecorationPointerEvent } from "./digital-controller";
import { createDigitalSelectionBridge } from "./digital-selection-bridge";

const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();
const base = { componentRegistry, attrRegistry, containerWidth: 800 };
const alice = { ...base, suggestingAuthor: "alice", now: () => 1 };

const caret = (b: BlockId, o: number): EditorAction => ({ type: "SET_SELECTION", selection: createSpan(createPosition(b, o), createPosition(b, o)) });
const select = (a: BlockId, ao: number, f: BlockId, fo: number): EditorAction => ({
  type: "SET_SELECTION",
  selection: createSpan(createPosition(a, ao), createPosition(f, fo)),
});

function leaves(s: State): BlockId[] {
  const out: BlockId[] = [];
  const walk = (start: BlockId | null): void => {
    for (let cur = start; cur !== null; ) {
      const b = getBlock(s, cur);
      if (b === null) return;
      if (b.inlineContent !== null) out.push(b.id);
      else walk(b.firstChildId);
      cur = b.nextSiblingId;
    }
  };
  walk(getBlock(s, s.rootId)?.firstChildId ?? null);
  return out;
}

/** Direct-mode paragraphs `texts` (one per Enter). */
function paras(texts: readonly string[]): EditorState {
  let e = createInitialEditorState(base);
  texts.forEach((t, i) => {
    if (i > 0) e = reduceEditor(e, { type: "SPLIT_NODE" });
    if (t !== "") e = reduceEditor(e, { type: "INSERT_TEXT", text: t });
  });
  return e;
}

function mount(state: State, onDecorationPointer?: (e: DecorationPointerEvent) => void) {
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  const controller = createDigitalController({
    container,
    componentRegistry,
    attrRegistry,
    doc: document,
    initialState: state,
    ...(onDecorationPointer !== undefined ? { onDecorationPointer } : {}),
  });
  // A standalone bridge over the same DOM, reading the controller's state (caret affinity).
  const bridge = createDigitalSelectionBridge(container, window, undefined, () => controller.editorState.document);
  const el = (b: BlockId): HTMLElement => {
    const e = container.querySelector(`[data-block-id="${b}"]`);
    if (!(e instanceof HTMLElement)) throw new Error(`no element for ${b}`);
    return e;
  };
  // The paragraphs whose ¶ is drawn selected, in document order.
  const selected = (): string[] =>
    Array.from(container.querySelectorAll(".tw-selected")).map((n) => `¶:${n.closest("[data-block-id]")?.getAttribute("data-block-id") ?? ""}`);
  return { controller, container, bridge, el, selected };
}

/** "Anna" | "Rosa" with a pending join (alice's Backspace at the start of "Rosa"). */
function joined(): { state: State; l: BlockId; r: BlockId } {
  const e0 = paras(["Anna", "Rosa"]);
  const [l, r] = leaves(e0.document);
  if (l === undefined || r === undefined) throw new Error("setup");
  const e = reduceEditor(reduceEditor({ ...e0, config: alice }, caret(r, 0)), { type: "DELETE_BACKWARD" });
  return { state: e.document, l, r };
}

/** "Ax" | "B"; alice's section break at (B, 0) — an empty paragraph H ends the first section (Word). */
function sectioned(): { state: State; h: BlockId; b: BlockId } {
  const e0 = paras(["Ax", "B"]);
  const [, b] = leaves(e0.document);
  if (b === undefined) throw new Error("setup");
  const e = reduceEditor(reduceEditor({ ...e0, config: alice }, caret(b, 0)), { type: "SECTION_BREAK" });
  const [, h, b2] = leaves(e.document);
  if (h === undefined || b2 !== b) throw new Error("setup: expected Ax | H | B");
  return { state: e.document, h, b };
}

describe("digital boundary ¶ marks", () => {
  it("an empty block keeps its filler <br> with the mark present; the anchor precedes it after a re-render; the filler check ignores it", () => {
    const e0 = paras(["Hello"]);
    const [h] = leaves(e0.document);
    if (h === undefined) throw new Error("setup");
    const e = reduceEditor(reduceEditor({ ...e0, config: alice }, caret(h, 0)), { type: "SPLIT_NODE" }); // Enter at 0: the first block empties
    const [n] = leaves(e.document);
    if (n === undefined) throw new Error("setup");
    const { controller, el, bridge } = mount(e.document);
    const kids = (): string[] =>
      Array.from(el(n).childNodes).map((c) => (c instanceof HTMLElement ? (c.hasAttribute("data-tw-generated") ? "mark" : c.tagName) : "#text"));
    expect(kids()).toEqual(["mark", "BR"]);
    const glyph = el(n).querySelector(".tw-break-mark-glyph");
    expect(glyph?.textContent).toBe("¶");
    expect(glyph?.getAttribute("style")).toContain("position: absolute");
    expect(glyph?.getAttribute("style")).toContain("white-space: nowrap");
    expect(el(n).querySelector(".tw-break-mark")?.getAttribute("aria-hidden")).toBe("true");
    // Re-render the block (type into it, then undo) — the anchor still precedes the filler.
    controller.dispatch(caret(n, 0));
    controller.dispatch({ type: "INSERT_TEXT", text: "x" });
    controller.dispatch({ type: "UNDO" });
    expect(kids()).toEqual(["mark", "BR"]);
    // The empty block's caret sits before the filler (the anchor is not content).
    expect(bridge.domToPosition(el(n), el(n).childNodes.length)).toEqual(createPosition(n, 0));
    // A side=-1 widget at (N, 0) goes before the end anchor, and the caret sits between
    // them: the lead count skips the generated anchor (after the widget, before the ¶ —
    // IME composes before the mark).
    controller.setDecorations([{ kind: "widget", id: "w", at: createPosition(n, 0), side: -1, text: "W" }]);
    const order = (): string[] =>
      Array.from(el(n).childNodes).map((c) =>
        c instanceof HTMLElement ? (c.hasAttribute("data-tw-widget") ? "widget" : c.hasAttribute("data-tw-generated") ? "mark" : c.tagName) : "#text",
      );
    expect(order()).toEqual(["widget", "mark", "BR"]);
    expect(bridge.pointAt(createPosition(n, 0))).toEqual({ node: el(n), offset: 1 });
  });

  it("no start anchor exists: only the block BEFORE the step carries a ¶", () => {
    const { state, l, r } = joined();
    const { el } = mount(state);
    expect(el(l).querySelectorAll("[data-tw-generated]")).toHaveLength(1);
    expect(el(r).querySelector("[data-tw-generated]")).toBeNull();
    expect(el(l).querySelector("[data-tw-break-side]")).toBeNull();
  });

  it("host widgets at (E, len) are inserted BEFORE the ¶ anchor (the ¶ follows every widget)", () => {
    const { state, l } = joined();
    const { controller, el } = mount(state);
    controller.setDecorations([
      { kind: "widget", id: "w1", at: createPosition(l, 4), side: 1, text: "Z" },
      { kind: "widget", id: "w0", at: createPosition(l, 4), side: -1, text: "Y" },
    ]);
    const order = Array.from(el(l).querySelectorAll("[data-tw-widget], [data-tw-generated]")).map((n) =>
      n.hasAttribute("data-tw-widget") ? `w${n.getAttribute("data-tw-widget") ?? ""}` : "mark",
    );
    expect(order).toEqual(["w-1", "w1", "mark"]);
    const tail = el(l).lastChild;
    expect(tail instanceof HTMLElement && tail.hasAttribute("data-tw-generated")).toBe(true);
  });

  it("the glyph is excluded from offsets; a click on it maps to (N, len); IME at (N, len) composes before it", () => {
    const { state, l } = joined();
    const { el, bridge } = mount(state);
    const anchor = el(l).querySelector("[data-tw-generated]");
    expect(anchor?.getAttribute("data-tw-suggestion-id")).toBe(getSuggestions(state)[0]?.id);
    const glyphText = anchor?.firstElementChild?.firstChild ?? null;
    if (glyphText === null) throw new Error("no glyph");
    expect(bridge.domToPosition(glyphText, 0)).toEqual(createPosition(l, 4));
    expect(bridge.domToPosition(el(l), el(l).childNodes.length)).toEqual(createPosition(l, 4));
    const p = bridge.pointAt(createPosition(l, 4));
    expect(p !== null && p.node instanceof Text && p.node.data === "Anna" && p.offset === 4).toBe(true);
  });

  it("after-slot normalization: a collapsed DOM caret after (or inside) the anchor is moved before it, same model position", () => {
    const { state, l } = joined();
    const { controller, el } = mount(state);
    const sel = window.getSelection();
    if (sel === null) throw new Error("no selection");
    const expectBeforeMark = (): void => {
      expect(sel.anchorNode instanceof Text ? sel.anchorNode.data : null).toBe("Anna");
      expect(sel.anchorOffset).toBe(4);
      expect(sel.isCollapsed).toBe(true);
      expect(controller.editorState.selection.focus).toEqual(createPosition(l, 4));
    };
    sel.collapse(el(l), el(l).childNodes.length); // the after-slot: past the anchor
    document.dispatchEvent(new Event("selectionchange"));
    expectBeforeMark();
    const glyphText = el(l).querySelector(".tw-break-mark-glyph")?.firstChild ?? null;
    if (glyphText === null) throw new Error("no glyph");
    sel.collapse(glyphText, 1); // a click inside the glyph
    document.dispatchEvent(new Event("selectionchange"));
    expectBeforeMark();
  });

  it("suggestion highlights and host group styles reach the glyph; suggestionRects = text rects + the glyph once, no empty slices", () => {
    const { state, l } = joined();
    const id = getSuggestions(state)[0]?.id;
    if (id === undefined) throw new Error("no suggestion");
    const { controller, el } = mount(state);
    controller.setSuggestionHighlights([{ suggestionId: id, active: true }]);
    expect(el(l).querySelector(".tw-break-mark-glyph .tw-suggestion")).not.toBeNull();
    controller.clearSuggestionHighlights();
    controller.setSuggestionStyles(() => ({ class: "by-host" }));
    const glyph = el(l).querySelector(".tw-break-mark-glyph");
    expect(glyph?.querySelector(".by-host")).not.toBeNull();
    if (!(glyph instanceof HTMLElement)) throw new Error("glyph");
    const rect = new DOMRect(10, 20, 7, 16);
    glyph.getBoundingClientRect = () => rect;
    // The range's own rects: a zero-width caret / anchor rect, the glyph (inside the range,
    // twice), the empty slice at (R, 0) — only the glyph is reported, once.
    const createRange = document.createRange.bind(document);
    document.createRange = () => {
      const r = createRange();
      r.getClientRects = () => [new DOMRect(40, 20, 0, 16), rect, new DOMRect(10, 20, 7, 16), new DOMRect(0, 40, 0, 16)] as unknown as DOMRectList;
      return r;
    };
    try {
      expect(controller.suggestionRects(id)).toEqual([rect]);
    } finally {
      document.createRange = createRange;
    }
  });

  it("a host underline style composes with the join strike; the glyph reports decoration-pointer events", () => {
    const { state, l } = joined();
    const id = getSuggestions(state)[0]?.id;
    if (id === undefined) throw new Error("no suggestion");
    const events: DecorationPointerEvent[] = [];
    const { controller, el } = mount(state, (e) => events.push(e));
    controller.setSuggestionStyles(() => ({ style: { underline: { style: "wavy", color: "red" } } }));
    const glyph = el(l).querySelector(".tw-break-mark-glyph");
    if (!(glyph instanceof HTMLElement)) throw new Error("glyph");
    expect(glyph.style.getPropertyValue("text-decoration-line")).toBe("line-through");
    const styled = glyph.querySelector("[data-tw-deco]");
    if (!(styled instanceof HTMLElement)) throw new Error("no decoration wrapper in the glyph");
    expect(styled.style.getPropertyValue("text-decoration-line")).toBe("underline");
    styled.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(events.map((e) => e.type)).toEqual(["enter"]);
  });
});

describe("digital section-kind ¶", () => {
  it("a tracked section-end ¶ draws Word's \"Section Break\" label after the content of the paragraph ending the section; no separate band element", () => {
    const { state, h, b } = sectioned();
    const { container, controller, el, bridge } = mount(state);
    expect(container.querySelector(".tw-section-band")).toBeNull();
    const anchor = el(h).querySelector(":scope > .tw-break-mark");
    if (!(anchor instanceof HTMLElement)) throw new Error("no section-kind ¶");
    expect(anchor.getAttribute("data-tw-break-kind")).toBe("section-insert");
    expect(anchor.getAttribute("aria-hidden")).toBe("true");
    expect(anchor.textContent).toBe("Section Break");
    const glyph = anchor.firstElementChild;
    expect(glyph instanceof HTMLElement ? glyph.style.getPropertyValue("text-decoration-line") : null).toBe("underline");
    expect(el(b).querySelector("[data-tw-generated]")).toBeNull();
    // Not a caret stop: a click on the label is (H, len).
    const text = glyph?.firstChild ?? null;
    if (text === null) throw new Error("no label text");
    expect(bridge.domToPosition(text, 0)).toEqual(createPosition(h, 0));
    // Rejecting the break removes the label with its paragraph's re-render.
    const id = getSuggestions(controller.editorState.document)[0]?.id;
    if (id === undefined) throw new Error("no suggestion");
    controller.dispatch({ type: "REJECT_SUGGESTION", id });
    expect(container.querySelector(".tw-break-mark")).toBeNull();
  });
});

describe("digital selected ¶", () => {
  const trace = <T>(fn: () => T): { result: T; touched: number } => {
    resetPerfTrace();
    setPerfTraceEnabled(true);
    try {
      const result = fn();
      return { result, touched: report().entries.find((e) => e.label === "digital.selectedParagraph")?.count ?? 0 };
    } finally {
      setPerfTraceEnabled(false);
    }
  };

  it("every ¶ the selection covers (start ≤ (P, len), end ≥ (N, 0)) gets an indicator after P's content; none for a collapsed or one-paragraph selection", () => {
    const e = paras(["Anna", "", "Rosa", "Bee"]);
    const [a, empty, r, bee] = leaves(e.document);
    if (a === undefined || empty === undefined || r === undefined || bee === undefined) throw new Error("setup");
    const { controller, el, selected, bridge } = mount(e.document);
    controller.dispatch(select(a, 1, r, 0));
    expect(selected()).toEqual([`¶:${a}`, `¶:${empty}`]);
    // Generated, offsetless, after the content; in the empty paragraph before the filler.
    const mark = el(a).lastChild;
    expect(mark instanceof HTMLElement && mark.hasAttribute("data-tw-generated") && mark.getAttribute("aria-hidden") === "true").toBe(true);
    expect(Array.from(el(empty).childNodes).map((n) => (n instanceof HTMLElement ? n.tagName : "#text"))).toEqual(["SPAN", "BR"]);
    expect(bridge.domToPosition(el(a), el(a).childNodes.length)).toEqual(createPosition(a, 4));
    expect(bridge.pointAt(createPosition(empty, 0))).toEqual({ node: el(empty), offset: 0 });
    controller.dispatch(select(r, 0, a, 1)); // backwards: same coverage
    expect(selected()).toEqual([`¶:${a}`, `¶:${empty}`]);
    controller.dispatch(select(a, 4, empty, 0)); // exactly ¶A
    expect(selected()).toEqual([`¶:${a}`]);
    controller.dispatch(select(a, 0, a, 4)); // inside A, up to (A, len): ¶A is not covered
    expect(selected()).toEqual([]);
    controller.dispatch(select(r, 0, bee, 3));
    expect(selected()).toEqual([`¶:${r}`]);
    controller.dispatch(caret(a, 4));
    expect(selected()).toEqual([]);
    expect(el(r).querySelector("[data-tw-generated]")).toBeNull();
  });

  it("a tracked ¶ glyph is highlighted instead of a second indicator; a re-rendered covered block keeps its indicator", () => {
    const { state, l, r } = joined();
    const { controller, el, selected } = mount(state);
    controller.dispatch(select(l, 0, r, 1));
    expect(selected()).toEqual([`¶:${l}`]);
    expect(el(l).querySelectorAll("[data-tw-generated]")).toHaveLength(1);
    const glyph = el(l).querySelector(".tw-break-mark-glyph");
    expect(glyph instanceof HTMLElement ? glyph.style.getPropertyValue("background-color").toLowerCase() : null).toBe("highlight");
    // A decoration change re-renders L: its glyph is highlighted again.
    const before = el(l);
    controller.setDecorations([{ kind: "inline", id: "d", from: createPosition(l, 0), to: createPosition(l, 2), class: "x" }]);
    expect(el(l)).not.toBe(before);
    expect(selected()).toEqual([`¶:${l}`]);
  });

  it("incremental: extending a selection by one paragraph touches one ¶, however large the selection; a far click clears in O(selection)", () => {
    const e = paras(Array.from({ length: 60 }, (_, i) => `p${i}`));
    const ids = leaves(e.document);
    const at = (i: number): BlockId => {
      const id = ids[i];
      if (id === undefined) throw new Error("setup");
      return id;
    };
    const { controller, selected } = mount(e.document);
    expect(trace(() => controller.dispatch(select(at(0), 0, at(50), 0))).touched).toBe(50);
    expect(trace(() => controller.dispatch(select(at(0), 0, at(51), 0))).touched).toBe(1);
    expect(trace(() => controller.dispatch(select(at(0), 0, at(50), 1))).touched).toBe(1);
    expect(selected()).toHaveLength(50);
    expect(trace(() => controller.dispatch(select(at(1), 0, at(50), 1))).touched).toBe(1); // the anchor side
    expect(trace(() => controller.dispatch(select(at(50), 1, at(1), 0))).touched).toBe(0); // reversed: same set
    expect(trace(() => controller.dispatch(caret(at(59), 0))).touched).toBe(49);
    expect(selected()).toEqual([]);
    expect(trace(() => controller.dispatch(caret(at(3), 0))).touched).toBe(0);
  });
});

describe("digital caret affinity (markers are never caret stops)", () => {
  it("a DOM caret right before a bookmark's start marker maps to the position after it; typing there lands inside the bookmark", () => {
    const e0 = paras(["Title", ""]);
    const [t, host] = leaves(e0.document);
    if (t === undefined || host === undefined) throw new Error("setup");
    const e = reduceEditor(reduceEditor(e0, caret(host, 0)), { type: "INSERT_CROSS_REFERENCE", targetId: t, refMode: "text" });
    // [start] "Title" [end]
    expect(getBlock(e.document, t)?.inlineContent?.items.map((i) => i.kind)).toEqual(["embed", "text", "embed"]);
    const { controller, el, bridge } = mount(e.document);
    expect(bridge.domToPosition(el(t), 0)).toEqual(createPosition(t, 1));
    window.getSelection()?.collapse(el(t), 0);
    document.dispatchEvent(new Event("selectionchange"));
    expect(controller.editorState.selection.focus).toEqual(createPosition(t, 1));
    controller.dispatch({ type: "INSERT_TEXT", text: "X" });
    const items = getBlock(controller.editorState.document, t)?.inlineContent?.items ?? [];
    expect(items.map((i) => (i.kind === "text" ? i.text : i.kind))).toEqual(["embed", "XTitle", "embed"]);
  });

  it("native arrows never dead-stop at a marker or a generated END anchor: the DOM caret is moved past them first", () => {
    const e0 = paras(["Title", "after"]);
    const [t, host] = leaves(e0.document);
    if (t === undefined || host === undefined) throw new Error("setup");
    const e = reduceEditor(reduceEditor(e0, caret(host, 0)), { type: "INSERT_CROSS_REFERENCE", targetId: t, refMode: "text" });
    const { controller, el, bridge, container } = mount(e.document);
    const sel = window.getSelection();
    if (sel === null) throw new Error("selection");
    const key = (k: string, shiftKey = false): void => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true }));
    };
    const focusAt = (b: BlockId, o: number): void => {
      const p = bridge.pointAt(createPosition(b, o));
      expect([sel.focusNode, sel.focusOffset]).toEqual([p?.node, p?.offset]);
    };
    const domCaret = (node: Node, offset: number): void => {
      sel.collapse(node, offset);
      document.dispatchEvent(new Event("selectionchange"));
    };
    // ArrowRight from a DOM caret before the start marker (where a browser ArrowLeft from
    // (T, 1) leaves it; the model stands after the marker and does not re-place it).
    controller.dispatch(caret(t, 1));
    domCaret(el(t), 0);
    expect(controller.editorState.selection.focus).toEqual(createPosition(t, 1));
    key("ArrowRight");
    focusAt(t, 1);
    // ArrowLeft / Shift+ArrowLeft after the start marker: the DOM caret goes before it.
    controller.dispatch(caret(t, 1));
    key("ArrowLeft");
    focusAt(t, 0);
    controller.dispatch(caret(t, 1));
    key("ArrowLeft", true);
    focusAt(t, 0);
    expect(sel.anchorNode === sel.focusNode && sel.anchorOffset === sel.focusOffset).toBe(false);
    // A plain arrow over a range collapses it (the browser's move): no hop.
    controller.dispatch(select(t, 4, t, 1));
    key("ArrowLeft");
    expect(sel.isCollapsed).toBe(false);
    // ArrowRight at the ¶ end with the end marker after the DOM caret: past the marker.
    const text = el(t).querySelector("span:not([data-inline-embed])")?.firstChild;
    if (!(text instanceof Text)) throw new Error("text");
    controller.dispatch(caret(t, 7));
    domCaret(text, text.length);
    expect(controller.editorState.selection.focus).toEqual(createPosition(t, 7));
    key("ArrowRight");
    focusAt(t, 7);
    // A block-axis key never hops (horizontal: Up / Down).
    controller.dispatch(caret(t, 1));
    domCaret(el(t), 0);
    key("ArrowDown");
    expect([sel.focusNode, sel.focusOffset]).toEqual([el(t), 0]);
    // vertical-rl: the inline-axis keys are Up / Down (ArrowDown forward); Left / Right are block-axis.
    el(t).style.writingMode = "vertical-rl"; // on the focus element: jsdom does not inherit it
    key("ArrowLeft");
    expect([sel.focusNode, sel.focusOffset]).toEqual([el(t), 0]);
    key("ArrowDown");
    focusAt(t, 1);
    controller.dispatch(caret(t, 1));
    key("ArrowUp");
    focusAt(t, 0);
    el(t).style.writingMode = "";
    // direction: rtl reverses the inline-axis keys: ArrowLeft runs forward (past the start
    // marker from before it, past the end marker at the ¶ end), ArrowRight backward.
    el(t).style.direction = "rtl";
    controller.dispatch(caret(t, 1));
    domCaret(el(t), 0);
    key("ArrowLeft");
    focusAt(t, 1);
    controller.dispatch(caret(t, 1));
    key("ArrowRight");
    focusAt(t, 0);
    const run = text.parentElement;
    if (run === null) throw new Error("run");
    run.style.direction = "rtl"; // the text's own element is the focus element there
    controller.dispatch(caret(t, 7));
    domCaret(text, text.length);
    key("ArrowLeft");
    focusAt(t, 7);
    run.style.direction = "";
    // vertical-rl + rtl: ArrowUp runs forward, ArrowDown backward.
    el(t).style.writingMode = "vertical-rl";
    controller.dispatch(caret(t, 1));
    domCaret(el(t), 0);
    key("ArrowUp");
    focusAt(t, 1);
    controller.dispatch(caret(t, 1));
    key("ArrowDown");
    focusAt(t, 0);
    el(t).style.writingMode = "";
    el(t).style.direction = "";
    controller.destroy();
    // A tracked ¶ (a generated END anchor) after the content: ArrowRight goes past it.
    const j = joined();
    const m = mount(j.state);
    m.controller.dispatch(caret(j.l, 4));
    m.container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    const mark = m.el(j.l).querySelector(":scope > .tw-break-mark");
    if (mark === null) throw new Error("mark");
    const pastEnd = [m.el(j.l), Array.prototype.indexOf.call(m.el(j.l).childNodes, mark) + 1];
    expect([sel.focusNode, sel.focusOffset]).toEqual(pastEnd);
    // In rtl, ArrowLeft goes past it (direction on the focus element: jsdom does not inherit it).
    m.controller.dispatch(caret(j.l, 4));
    const focusEl = sel.focusNode?.parentElement;
    if (focusEl == null) throw new Error("focus element");
    focusEl.style.direction = "rtl";
    m.container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect([sel.focusNode, sel.focusOffset]).toEqual(pastEnd);
    m.controller.destroy();
  });
});

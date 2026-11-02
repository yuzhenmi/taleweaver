/**
 * Anchors, versions and collaboration on the PRINT backend through the REAL controller:
 * anchors follow textarea typing / undo; a peer's update (separate Y.Doc,
 * Y.applyUpdate) reaches the host as APPLY_FOREIGN_CHANGE, rebases the selection and
 * moves anchors.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as Y from "yjs";
import * as core from "@taleweaver/core";
import { createEditorController, type EditorController } from "./index";
import { createDefaultComponentRegistry } from "@taleweaver/core";

const TEST_RESOLVER = createDefaultComponentRegistry();

let originalGetContext: PropertyDescriptor | undefined;

beforeEach(() => {
  originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: function (this: HTMLCanvasElement) {
      const noop = () => {};
      return {
        canvas: this, font: "", fillStyle: "", strokeStyle: "", textBaseline: "alphabetic", lineWidth: 1,
        globalAlpha: 1, lineJoin: "miter", measureText: (t: string) => ({ width: t.length * 8 }),
        fillRect: noop, fillText: noop, clearRect: noop, moveTo: noop, lineTo: noop, stroke: noop, drawImage: noop,
        setTransform: noop, save: noop, restore: noop, scale: noop, beginPath: noop, closePath: noop, arc: noop,
        rect: noop, clip: noop, fill: noop, strokeRect: noop, setLineDash: noop,
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

const cfg: core.EditorConfig = {
  componentRegistry: core.createDefaultComponentRegistry(),
  attrRegistry: core.createDefaultAttrRegistry(),
  containerWidth: 600,
};

/** A host loop: the controller dispatches into the real reducer, the host updates it. */
function mount(
  editor: core.Editor,
  remoteChanges?: "observe" | "ignore",
  accessibilityMirror = false,
): {
  textarea: HTMLTextAreaElement;
  controller: EditorController;
  get: () => core.Editor;
  actions: core.EditorAction[];
  container: HTMLElement;
  setEditor: (e: core.Editor) => void;
} {
  let current = editor;
  const actions: core.EditorAction[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  // Every action that reaches an editor shown (the controller's own and the peers' it applies).
  const record = (e: core.Editor): void => {
    e.subscribe(({ action }) => actions.push(action));
  };
  record(current);
  const controller = createEditorController(container, {
    measurer: core.createMockMeasurer(8, 16),
    editor: current,
    ...(remoteChanges !== undefined ? { remoteChanges } : {}),
    ...(accessibilityMirror ? { accessibilityMirror } : {}),
  });
  const textarea = container.querySelector("textarea");
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("no textarea");
  const setEditor = (e: core.Editor): void => {
    record(e);
    current = e;
    controller.setEditor(e);
  };
  return { textarea, controller, get: () => current, actions, container, setEditor };
}

const textOf = (e: core.Editor, id: core.BlockId): string =>
  (core.getBlock(e.document, id)?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "")).join("");
const caretAt = (id: core.BlockId, o: number): core.EditorAction => ({
  type: "SET_SELECTION",
  selection: core.createSpan(core.createPosition(id, o), core.createPosition(id, o)),
});
function type(textarea: HTMLTextAreaElement, text: string): void {
  for (const ch of text) {
    textarea.value = ch;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

describe("print — anchors and versions", () => {
  it("an anchor follows typing and undo; mapPosition / createAnchor({ basedOn }) map from an older version", () => {
    const seeded = core.createEditor(cfg);
    seeded.dispatch({ type: "INSERT_TEXT", text: "hello world" });
    const m = mount(seeded);
    const id = m.get().selection.focus.blockId;
    const v0 = m.controller.version;
    if (v0 === null) throw new Error("no version");
    const anchor = m.controller.createAnchor(core.createPosition(id, 6), core.createPosition(id, 11));
    m.controller.runCommand((_e, dispatch) => (dispatch?.(caretAt(id, 0)), true));
    type(m.textarea, ">> ");
    expect(anchor === null ? null : [anchor.from.offset, anchor.to.offset]).toEqual([9, 14]);
    expect(m.controller.mapPosition(core.createPosition(id, 6), v0)).toEqual({ position: core.createPosition(id, 9), deleted: false });
    m.textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(anchor === null ? null : [anchor.from.offset, anchor.to.offset]).toEqual([6, 11]);
    const late = m.controller.createAnchor(core.createPosition(id, 0), core.createPosition(id, 5), { basedOn: v0 });
    expect(late === null ? null : [late.from.offset, late.to.offset]).toEqual([0, 5]);
  });

  it("a dispatch from a subscriber that runs before the controller's is laid out after it, each change in turn", () => {
    const seeded = core.createEditor(cfg);
    seeded.dispatch({ type: "INSERT_TEXT", text: "ab" });
    seeded.dispatch({ type: "SPLIT_NODE" });
    seeded.dispatch({ type: "INSERT_TEXT", text: "cd" });
    const b = seeded.selection.focus.blockId;
    const a = core.getBlock(seeded.document, b)?.prevSiblingId;
    if (a == null) throw new Error("setup");
    let pending = true;
    seeded.subscribe(({ action }) => {
      // Typing in the second paragraph deletes the first paragraph's "a" — a different block.
      if (action.type !== "INSERT_TEXT" || !pending) return;
      pending = false;
      seeded.dispatch({ type: "DELETE_RANGE", span: core.createSpan(core.createPosition(a, 0), core.createPosition(a, 1)) });
    });
    const m = mount(seeded);
    type(m.textarea, "X");
    // The second paragraph is laid out with the typed "X": its end is three 8px glyphs in.
    const start = m.controller.getCaretRect(core.createPosition(b, 0));
    const end = m.controller.getCaretRect(core.createPosition(b, 3));
    expect([textOf(m.get(), a), textOf(m.get(), b)]).toEqual(["b", "cdX"]);
    expect(start !== null && end !== null ? end.left - start.left : null).toBe(24);
  });
});

describe("print — collaboration", () => {
  it("a peer's update reaches the host as APPLY_FOREIGN_CHANGE: text, rebased caret, anchors", () => {
    let peerA = core.createEditor(cfg);
    peerA.dispatch({ type: "INSERT_TEXT", text: "hello world" });
    const docA = core.getYDoc(peerA.document);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const documentB = core.createDocument({ resolver: TEST_RESOLVER, rootId: peerA.document.rootId, doc: docB });
    const m = mount(core.createEditor(cfg, { document: documentB }));
    docA.on("update", (u: Uint8Array) => Y.applyUpdate(docB, u, "provider"));
    const id = peerA.selection.focus.blockId;
    m.controller.runCommand((_e, dispatch) => (dispatch?.(caretAt(id, 5)), true));
    const anchor = m.controller.createAnchor(core.createPosition(id, 6), core.createPosition(id, 11));
    peerA.dispatch(caretAt(id, 0));
    peerA.dispatch({ type: "INSERT_TEXT", text: "Oh, " });
    expect(textOf(m.get(), id)).toBe("Oh, hello world");
    expect(m.get().selection.focus).toEqual(core.createPosition(id, 9));
    expect(anchor === null ? null : [anchor.from.offset, anchor.to.offset]).toEqual([10, 15]);
    expect(m.controller.getCaretRect(m.get().selection.focus)?.left).toBe(9 * 8);
    // A peer deleting the anchored word: the anchor reports it.
    peerA.dispatch({ type: "SET_SELECTION", selection: core.createSpan(core.createPosition(id, 9), core.createPosition(id, 15)) });
    peerA.dispatch({ type: "DELETE_BACKWARD" });
    expect(textOf(m.get(), id)).toBe("Oh, hello");
    expect(anchor?.deleted).toBe(true);
    // Local typing + undo stay local.
    type(m.textarea, "!");
    expect(textOf(m.get(), id)).toBe("Oh, hello!");
    m.textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(textOf(m.get(), id)).toBe("Oh, hello");
  });
});

/** Peer A (driven through the reducer) and a replica Document over a second, synced Y.Doc. */
function peerPair(text = "hello world") {
  let peerA = core.createEditor(cfg);
    peerA.dispatch({ type: "INSERT_TEXT", text });
  const docA = core.getYDoc(peerA.document);
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  docA.on("update", (u: Uint8Array) => Y.applyUpdate(docB, u, "provider"));
  const documentB = core.createDocument({ resolver: TEST_RESOLVER, rootId: peerA.document.rootId, doc: docB });
  const id = peerA.selection.focus.blockId;
  return {
    id,
    editorB: () => core.createEditor(cfg, { document: documentB }),
    type: (t: string) => {
      peerA.dispatch({ type: "INSERT_TEXT", text: t });
    },
  };
}
const foreign = (actions: core.EditorAction[]) => actions.filter((a) => a.type === "APPLY_FOREIGN_CHANGE").length;

describe("print — remote-change subscription lifetime", () => {
  it("local transactions dispatch nothing; after destroy() a peer update dispatches nothing, and the editor (the host's) still undoes", () => {
    const pair = peerPair();
    const editor = pair.editorB();
    const m = mount(editor);
    type(m.textarea, "!");
    expect(foreign(m.actions)).toBe(0);
    pair.type("A");
    expect(foreign(m.actions)).toBe(1);
    m.controller.destroy();
    pair.type("B");
    expect(foreign(m.actions)).toBe(1);
    const typed = editor.document;
    editor.dispatch({ type: "UNDO" });
    expect(editor.document).not.toBe(typed);
  });

  it("after the host swaps documents, only the NEW document's peer updates are dispatched", () => {
    const oldPair = peerPair("old");
    const newPair = peerPair("new");
    const m = mount(oldPair.editorB());
    m.setEditor(newPair.editorB());
    oldPair.type("x");
    expect(foreign(m.actions)).toBe(0);
    newPair.type("y");
    expect(foreign(m.actions)).toBe(1);
  });

  it("with two controllers on one document, only the observing one dispatches peer changes", () => {
    const pair = peerPair();
    const editor = pair.editorB();
    const owner = mount(editor);
    const other = mount(editor, "ignore");
    pair.type("A");
    // Both record every action the shared editor receives: the peer change arrived ONCE.
    expect(foreign(owner.actions)).toBe(1);
    expect(foreign(other.actions)).toBe(1);
    // ...dispatched by the observing controller: without it, the other dispatches none.
    owner.controller.destroy();
    pair.type("B");
    expect(foreign(other.actions)).toBe(1);
  });

  it("a peer change during IME composition leaves the textarea (the IME's buffer) untouched", () => {
    const pair = peerPair();
    const m = mount(pair.editorB());
    m.textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    m.textarea.value = "か"; // the IME's in-progress text
    const setRange = vi.spyOn(m.textarea, "setSelectionRange");
    pair.type("A");
    expect(foreign(m.actions)).toBe(1);
    expect(m.textarea.value).toBe("か");
    expect(setRange).not.toHaveBeenCalled();
    m.textarea.dispatchEvent(new CompositionEvent("compositionend", { data: "か", bubbles: true }));
    expect(textOf(m.get(), pair.id)).toBe("かhello worldA");
  });
});

describe("print — accessibility mirror under a peer change mid-composition", () => {
  function setup() {
    const pair = peerPair();
    const m = mount(pair.editorB(), undefined, true);
    const mirror = m.container.querySelector("[data-taleweaver-a11y-mirror]");
    if (!(mirror instanceof HTMLElement)) throw new Error("no mirror");
    m.controller.runCommand((_e, dispatch) => (dispatch?.(caretAt(pair.id, 5)), true));
    return { pair, m, mirror };
  }

  it("the mirror DOM / selection are not rewritten while composing; a cancelled composition then shows the peer's text", () => {
    const { pair, m, mirror } = setup();
    mirror.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const before = mirror.innerHTML;
    const sel = window.getSelection();
    if (sel === null) throw new Error("no selection");
    const writes = [vi.spyOn(sel, "setBaseAndExtent"), vi.spyOn(sel, "collapse"), vi.spyOn(sel, "addRange")];
    pair.type("A");
    expect(foreign(m.actions)).toBe(1);
    expect(textOf(m.get(), pair.id)).toBe("hello worldA");
    expect(mirror.innerHTML).toBe(before);
    expect(writes.every((w) => w.mock.calls.length === 0)).toBe(true);
    mirror.dispatchEvent(new CompositionEvent("compositionend", { data: "", bubbles: true }));
    expect(mirror.textContent).toContain("hello worldA");
    writes.forEach((w) => w.mockRestore());
    m.controller.destroy();
  });

  it("a committed composition lands at the caret rebased through the peer change", () => {
    const { pair, m, mirror } = setup();
    mirror.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    pair.type("A");
    mirror.dispatchEvent(new CompositionEvent("compositionend", { data: "か", bubbles: true }));
    expect(textOf(m.get(), pair.id)).toBe("helloか worldA");
    expect(mirror.textContent).toContain("helloか worldA");
    m.controller.destroy();
  });
});

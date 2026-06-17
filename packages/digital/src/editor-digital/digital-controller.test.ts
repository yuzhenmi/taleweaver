import { describe, it, expect } from "vitest";
import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  type ComponentRegistry,
  type AttrRegistry,
} from "@taleweaver/core";
import { asBlockId, createPosition, createSpan, getBlock } from "@taleweaver/core";
import { createDigitalController, type DigitalController } from "./digital-controller";
import { createDigitalSelectionBridge } from "./digital-selection-bridge";

function makeController(): {
  controller: DigitalController;
  container: HTMLElement;
  componentRegistry: ComponentRegistry;
  attrRegistry: AttrRegistry;
} {
  const componentRegistry = createDefaultComponentRegistry();
  const attrRegistry = createDefaultAttrRegistry();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const controller = createDigitalController({
    container,
    componentRegistry,
    attrRegistry,
    containerWidth: 800,
    doc: document,
  });
  return { controller, container, componentRegistry, attrRegistry };
}

/**
 * The stamped DOM wraps the document ROOT (itself a `data-block-id` container block) around the
 * leaf paragraph blocks. A bare `querySelector("[data-block-id]")` would return the root container
 * (whose text the engine refuses to `extractText` / select — "is a container, not a leaf"). The
 * tests below operate on the LEAF paragraph, identified as a `[data-block-id]` element with no
 * descendant `[data-block-id]` (matching the blockId the editor's selection actually uses).
 */
function leafBlock(container: HTMLElement): HTMLElement {
  const all = Array.from(container.querySelectorAll("[data-block-id]")).filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
  for (const el of all) {
    if (el.querySelector("[data-block-id]") === null) return el;
  }
  throw new Error("no leaf block found");
}

function leafBlockId(container: HTMLElement): string {
  const id = leafBlock(container).getAttribute("data-block-id");
  if (id === null) throw new Error("leaf block has no id");
  return id;
}

/** The leaf `[data-block-id]` elements in document order. */
function leafBlocks(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll("[data-block-id]")).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.querySelector("[data-block-id]") === null,
  );
}

/** The textContent of each leaf `[data-block-id]` block in document order. */
function leafTexts(container: HTMLElement): string[] {
  return leafBlocks(container).map((el) => el.textContent ?? "");
}

/** The `data-block-id` of the leaf block at `index` in document order. */
function leafIdAt(container: HTMLElement, index: number): string {
  const el = leafBlocks(container)[index];
  const id = el?.getAttribute("data-block-id");
  if (id === null || id === undefined) throw new Error(`no leaf block at index ${index}`);
  return id;
}

describe("DigitalController — construct + dispatch (2e)", () => {
  it("mounts contenteditable and renders the initial document", () => {
    const { controller, container } = makeController();
    // jsdom reflects `contentEditable` as the IDL property, not the attribute.
    expect(container.contentEditable).toBe("true");
    // The initial empty document renders at least the root block element.
    expect(container.querySelectorAll("[data-block-id]").length).toBeGreaterThanOrEqual(1);
    controller.destroy();
  });

  it("dispatch(INSERT_TEXT) updates editorState and the DOM", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "hello" });
    expect(container.textContent).toContain("hello");
    // editorState getter reflects the new state: the caret advanced to the end of "hello".
    expect(controller.editorState.selection.focus.offset).toBe(5);
    controller.destroy();
  });

  it("destroy() unwires listeners and resets contenteditable=false", () => {
    const { controller, container } = makeController();
    controller.destroy();
    expect(container.contentEditable).toBe("false");
  });

  it("SPLIT_NODE mid-document inserts the new paragraph into the DOM (sibling whose parent is not dirty)", () => {
    const { controller, container } = makeController();
    // Build two paragraphs: "AB" then "CD".
    controller.dispatch({ type: "INSERT_TEXT", text: "AB" });
    controller.dispatch({ type: "SPLIT_NODE" }); // caret at end → splits the LAST block (parent dirty)
    controller.dispatch({ type: "INSERT_TEXT", text: "CD" });
    expect(leafTexts(container)).toEqual(["AB", "CD"]);

    // Put the caret in the FIRST paragraph (a NON-last block) and split it.
    const firstId = leafBlockId(container);
    controller.dispatch({
      type: "SET_SELECTION",
      selection: createSpan(createPosition(asBlockId(firstId), 1), createPosition(asBlockId(firstId), 1)),
    });
    controller.dispatch({ type: "SPLIT_NODE" }); // splits a non-last block → parent NOT dirty

    // The state has three paragraphs "A" / "B" / "CD"; the DOM must reflect all three.
    expect(leafTexts(container)).toEqual(["A", "B", "CD"]);
    controller.destroy();
  });

  it("renders an EMPTY line visibly (filler <br>) and lands the caret in it after Enter (user bug)", () => {
    const { controller, container } = makeController();
    // The initial empty document's only paragraph is a blank line: it must carry the filler <br>
    // (an empty <div> gets no line box → would be invisible & un-clickable).
    const first = leafBlock(container);
    expect(first.querySelector("br[data-tw-empty-line]")).not.toBeNull();

    // Pressing Enter on the empty line splits it into TWO blank lines; BOTH must be visible…
    controller.dispatch({ type: "SPLIT_NODE" });
    const blocks = leafBlocks(container);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.querySelector("br[data-tw-empty-line]") !== null)).toBe(true);

    // …and the caret must resolve INTO the new (second) blank line at offset 0 — verified through
    // the real selection bridge (the model selection round-trips to a DOM point inside that block).
    const secondId = leafIdAt(container, 1);
    expect(controller.editorState.selection.focus).toEqual(createPosition(asBlockId(secondId), 0));
    const bridge = createDigitalSelectionBridge(container, window);
    bridge.positionToDom(controller.editorState.selection);
    const focusNode = window.getSelection()?.focusNode ?? null;
    // The DOM caret sits inside the second blank block (its element, or a node it contains).
    expect(focusNode !== null && blocks[1]?.contains(focusNode)).toBe(true);
    controller.destroy();
  });

  it("PASTE of multi-line text mid-document inserts a RUN of new siblings in order (parent not dirty)", () => {
    const { controller, container } = makeController();
    // Two paragraphs "hello" / "world".
    controller.dispatch({ type: "INSERT_TEXT", text: "hello" });
    controller.dispatch({ type: "SPLIT_NODE" });
    controller.dispatch({ type: "INSERT_TEXT", text: "world" });
    expect(leafTexts(container)).toEqual(["hello", "world"]);

    // Caret at the END of the FIRST paragraph, then paste three lines. The first line appends to
    // "hello"; the rest become NEW middle paragraphs between "hello…" and "world" (none last → the
    // parent is not dirtied), exercising a run of consecutive new-sibling inserts.
    const firstId = leafIdAt(container, 0);
    controller.dispatch({
      type: "SET_SELECTION",
      selection: createSpan(createPosition(asBlockId(firstId), 5), createPosition(asBlockId(firstId), 5)),
    });
    controller.dispatch({ type: "PASTE", text: "A\nB\nC" });

    // All blocks present AND in document order (a mis-ordered insert would shuffle B/C).
    expect(leafTexts(container)).toEqual(["helloA", "B", "C", "world"]);
    controller.destroy();
  });

  it("DELETE_RANGE spanning interior blocks detaches the removed elements (parent stays clean)", () => {
    const { controller, container } = makeController();
    // Four paragraphs "A" / "B" / "C" / "D".
    controller.dispatch({ type: "INSERT_TEXT", text: "A" });
    controller.dispatch({ type: "SPLIT_NODE" });
    controller.dispatch({ type: "INSERT_TEXT", text: "B" });
    controller.dispatch({ type: "SPLIT_NODE" });
    controller.dispatch({ type: "INSERT_TEXT", text: "C" });
    controller.dispatch({ type: "SPLIT_NODE" });
    controller.dispatch({ type: "INSERT_TEXT", text: "D" });
    expect(leafTexts(container)).toEqual(["A", "B", "C", "D"]);

    // Select from END of "A" to START of "C": deletes all of "B" and collapses "C" into "A" → "AC".
    // Crucially "D" stays last and "A" stays first, so the parent's first/last child are unchanged
    // (parent NOT dirty) — the removed blocks "B"/"C" reach the DOM-detach path, not parent-replace.
    const aId = leafIdAt(container, 0);
    const cId = leafIdAt(container, 2);
    controller.dispatch({
      type: "SET_SELECTION",
      selection: createSpan(createPosition(asBlockId(aId), 1), createPosition(asBlockId(cId), 0)),
    });
    controller.dispatch({ type: "DELETE_RANGE", span: controller.editorState.selection });

    expect(leafTexts(container)).toEqual(["AC", "D"]);
    controller.destroy();
  });

  it("INSERT_TABLE mid-document renders the table subtree into the DOM and keeps the doc intact", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "before" });
    controller.dispatch({ type: "SPLIT_NODE" });
    controller.dispatch({ type: "INSERT_TEXT", text: "after" });
    // Caret at the END of "before" (a non-last paragraph), insert a 2x2 table there.
    const firstId = leafIdAt(container, 0);
    controller.dispatch({
      type: "SET_SELECTION",
      selection: createSpan(createPosition(asBlockId(firstId), 6), createPosition(asBlockId(firstId), 6)),
    });
    controller.dispatch({ type: "INSERT_TABLE", rows: 2, cols: 2 });

    // A new table container subtree (table → rows → cells) reached the DOM, and the surrounding
    // paragraphs survive (a desynced reconcile would drop the table or the "after" paragraph).
    expect(container.querySelectorAll("table").length).toBe(1);
    expect(container.querySelectorAll("tr").length).toBe(2);
    expect(container.querySelectorAll("td").length).toBe(4);
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("after");
    controller.destroy();
  });

  it("DELETE_BACKWARD merging a NON-last block removes its element from the DOM (parent not dirty)", () => {
    const { controller, container } = makeController();
    // Build three paragraphs "A" / "B" / "C".
    controller.dispatch({ type: "INSERT_TEXT", text: "A" });
    controller.dispatch({ type: "SPLIT_NODE" });
    controller.dispatch({ type: "INSERT_TEXT", text: "B" });
    controller.dispatch({ type: "SPLIT_NODE" });
    controller.dispatch({ type: "INSERT_TEXT", text: "C" });
    expect(leafTexts(container)).toEqual(["A", "B", "C"]);

    // Caret at the START of the MIDDLE paragraph "B", then Backspace → merges "B" into "A".
    const middleId = leafIdAt(container, 1);
    controller.dispatch({
      type: "SET_SELECTION",
      selection: createSpan(createPosition(asBlockId(middleId), 0), createPosition(asBlockId(middleId), 0)),
    });
    controller.dispatch({ type: "DELETE_BACKWARD" }); // removes the middle block (not last → parent not dirty)

    // "B" merged into "A"; the middle element must be gone, not orphaned in the DOM.
    expect(leafTexts(container)).toEqual(["AB", "C"]);
    controller.destroy();
  });
});

/**
 * jsdom does NOT define `ClipboardEvent` or `DataTransfer` (constructing either THROWS).
 * Build a plain `Event` and attach a `clipboardData` stub via `Object.defineProperty`
 * UNCONDITIONALLY (no "try ClipboardEvent, fallback" branch, no cast).
 */
interface ClipboardDataStub {
  setData(format: string, data: string): void;
  getData(format: string): string;
}

function makeClipboardData(seed?: Record<string, string>): {
  data: ClipboardDataStub;
  store: Map<string, string>;
} {
  const store = new Map<string, string>(seed ? Object.entries(seed) : []);
  const data: ClipboardDataStub = {
    setData(format, value) {
      store.set(format, value);
    },
    getData(format) {
      return store.get(format) ?? "";
    },
  };
  return { data, store };
}

function makeClipboardEvent(
  type: "copy" | "cut" | "paste",
  clipboardData: ClipboardDataStub,
): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "clipboardData", { value: clipboardData, configurable: true });
  return e;
}

describe("DigitalController — onChange notification", () => {
  it("fires onChange with the new editorState after a programmatic dispatch", () => {
    const componentRegistry = createDefaultComponentRegistry();
    const attrRegistry = createDefaultAttrRegistry();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const states: import("@taleweaver/core").EditorState[] = [];
    const controller = createDigitalController({
      container,
      componentRegistry,
      attrRegistry,
      doc: document,
      onChange: (s) => states.push(s),
    });
    controller.dispatch({ type: "INSERT_TEXT", text: "hi" });
    // onChange fired, and the LAST state it received is the controller's current state.
    expect(states.length).toBeGreaterThanOrEqual(1);
    expect(states[states.length - 1]).toBe(controller.editorState);
    controller.destroy();
  });

  it("fires onChange for an input-driven dispatch (cut → DELETE_RANGE)", () => {
    const componentRegistry = createDefaultComponentRegistry();
    const attrRegistry = createDefaultAttrRegistry();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let calls = 0;
    const controller = createDigitalController({
      container,
      componentRegistry,
      attrRegistry,
      doc: document,
      onChange: () => calls++,
    });
    controller.dispatch({ type: "INSERT_TEXT", text: "hello" });
    const id = leafBlockId(container);
    controller.dispatch({
      type: "SET_SELECTION",
      selection: createSpan(createPosition(asBlockId(id), 0), createPosition(asBlockId(id), 5)),
    });
    const callsBeforeCut = calls;
    const { data } = makeClipboardData();
    container.dispatchEvent(makeClipboardEvent("cut", data)); // dispatches DELETE_RANGE internally
    expect(calls).toBeGreaterThan(callsBeforeCut);
    controller.destroy();
  });

  it("omitting onChange is a no-op (dispatch does not throw)", () => {
    const { controller } = makeController(); // makeController passes no onChange
    expect(() => controller.dispatch({ type: "INSERT_TEXT", text: "x" })).not.toThrow();
    controller.destroy();
  });
});

describe("DigitalController — selectionchange idempotency guard (F2)", () => {
  it("does not re-dispatch when the DOM selection equals the current editor selection", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "abc" });
    const before = controller.editorState;
    // Mirror the editor's collapsed caret (offset 3) into the live DOM via the bridge
    // (which resolves a mappable DOM point through the run-wrapper), then fire selectionchange.
    const bridge = createDigitalSelectionBridge(container, window);
    bridge.positionToDom(controller.editorState.selection);
    document.dispatchEvent(new Event("selectionchange"));
    // ref-equality: a guarded no-op leaves the SAME editorState object.
    expect(controller.editorState).toBe(before);
    controller.destroy();
  });

  it("does not re-dispatch for a flipped-direction selection (selectionsEqual ignores direction)", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "abc" });
    // Settle the editor on a forward whole-run span.
    const id = leafBlockId(container);
    const fwd = createSpan(createPosition(asBlockId(id), 0), createPosition(asBlockId(id), 3));
    controller.dispatch({ type: "SET_SELECTION", selection: fwd });
    const before = controller.editorState;
    // Now mirror the REVERSED span into the DOM (anchor 3 → focus 0) and fire selectionchange.
    const reversed = createSpan(createPosition(asBlockId(id), 3), createPosition(asBlockId(id), 0));
    const bridge = createDigitalSelectionBridge(container, window);
    bridge.positionToDom(reversed);
    document.dispatchEvent(new Event("selectionchange"));
    // selectionsEqual treats the flipped span as equal → no re-dispatch.
    expect(controller.editorState).toBe(before);
    controller.destroy();
  });
});

/** A `beforeinput` InputEvent with `getTargetRanges`/`dataTransfer` patched on (jsdom lacks both). */
function makeBeforeInput(
  inputType: string,
  init: { data?: string | null; dataTransfer?: ClipboardDataStub | null } = {},
): InputEvent {
  const e = new InputEvent("beforeinput", {
    inputType,
    data: init.data === undefined ? null : init.data,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(e, "getTargetRanges", { value: () => [], configurable: true });
  Object.defineProperty(e, "dataTransfer", {
    value: init.dataTransfer === undefined ? null : init.dataTransfer,
    configurable: true,
  });
  return e;
}

describe("DigitalController — input correctness (audit Slice A)", () => {
  it("paste inserts the text exactly once — beforeinput(insertFromPaste) does NOT re-dispatch (C1)", () => {
    const { controller, container } = makeController();
    const { data } = makeClipboardData({ "text/plain": "PASTEME" });
    // The browser fires `paste` (ClipboardEvent) AND a follow-on `beforeinput(insertFromPaste)`.
    container.dispatchEvent(makeClipboardEvent("paste", data));
    const afterPaste = controller.editorState;
    const bi = makeBeforeInput("insertFromPaste", { dataTransfer: data });
    container.dispatchEvent(bi);
    // The paste handler is the single source: beforeinput suppresses native mutation (preventDefault)
    // but does not dispatch a second PASTE.
    expect(bi.defaultPrevented).toBe(true);
    expect(controller.editorState).toBe(afterPaste);
    expect(container.textContent?.match(/PASTEME/g)?.length ?? 0).toBe(1);
    controller.destroy();
  });

  it("unrecognized inputType falls through to native handling — no preventDefault, no dispatch (C2)", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "abc" });
    const before = controller.editorState;
    // `insertTranspose` maps to null; the controller must NOT cancel the browser's default.
    const bi = makeBeforeInput("insertTranspose");
    container.dispatchEvent(bi);
    expect(bi.defaultPrevented).toBe(false);
    expect(controller.editorState).toBe(before);
    controller.destroy();
  });

  it("a recognized inputType still preventDefaults and dispatches (C2 regression guard)", () => {
    const { controller, container } = makeController();
    const before = controller.editorState;
    const bi = makeBeforeInput("insertText", { data: "z" });
    container.dispatchEvent(bi);
    expect(bi.defaultPrevented).toBe(true);
    expect(controller.editorState).not.toBe(before);
    expect(container.textContent).toContain("z");
    controller.destroy();
  });

  it("compositionend with null data dispatches nothing (D1)", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "abc" });
    const before = controller.editorState;
    const e = new CompositionEvent("compositionend", { bubbles: true });
    Object.defineProperty(e, "data", { value: null, configurable: true });
    container.dispatchEvent(e);
    expect(controller.editorState).toBe(before);
    controller.destroy();
  });

  it("compositionend with committed text dispatches INSERT_TEXT (D1 regression guard)", () => {
    const { controller, container } = makeController();
    const before = controller.editorState;
    const e = new CompositionEvent("compositionend", { data: "あ", bubbles: true });
    container.dispatchEvent(e);
    expect(controller.editorState).not.toBe(before);
    expect(container.textContent).toContain("あ");
    controller.destroy();
  });
});

describe("DigitalController — Tab routing is context-sensitive (audit I5)", () => {
  it("Tab in a list-item nests the list (LIST_INDENT) — listLevel→1, caret offset unchanged", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "item" }); // caret at offset 4
    controller.dispatch({ type: "TOGGLE_LIST", listType: "unordered" });
    const focusId = controller.editorState.selection.focus.blockId;
    expect(getBlock(controller.editorState.state, focusId)?.type).toBe("list-item");
    // A fresh top-level list-item carries no `listLevel` attr (level 0).
    expect(getBlock(controller.editorState.state, focusId)?.attrs.listLevel).toBeUndefined();
    const offsetBefore = controller.editorState.selection.focus.offset;

    const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    container.dispatchEvent(e);
    // LIST_INDENT (not INSERT_TAB) was dispatched: the list nests to level 1 and the caret offset
    // is unchanged. INSERT_TAB would instead leave listLevel undefined and advance the caret by 1.
    expect(e.defaultPrevented).toBe(true);
    expect(getBlock(controller.editorState.state, focusId)?.attrs.listLevel).toBe(1);
    expect(controller.editorState.selection.focus.offset).toBe(offsetBefore);
    controller.destroy();
  });

  it("Tab in a plain paragraph inserts a tab (INSERT_TAB) — caret offset advances by 1", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "ab" }); // caret at offset 2
    const offsetBefore = controller.editorState.selection.focus.offset;

    const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    container.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(controller.editorState.selection.focus.offset).toBe(offsetBefore + 1);
    controller.destroy();
  });
});

describe("DigitalController — copy/cut (F5)", () => {
  it("copy writes the extractText output of the selection to the clipboard", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "hello" });
    const id = leafBlockId(container);
    const span = createSpan(createPosition(asBlockId(id), 0), createPosition(asBlockId(id), 5));
    controller.dispatch({ type: "SET_SELECTION", selection: span });

    const { data, store } = makeClipboardData();
    container.dispatchEvent(makeClipboardEvent("copy", data));
    expect(store.get("text/plain")).toBe("hello");
    controller.destroy();
  });

  it("cut copies the selection then deletes it", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "hello" });
    const id = leafBlockId(container);
    const span = createSpan(createPosition(asBlockId(id), 0), createPosition(asBlockId(id), 5));
    controller.dispatch({ type: "SET_SELECTION", selection: span });

    const { data, store } = makeClipboardData();
    container.dispatchEvent(makeClipboardEvent("cut", data));
    // Clipboard captured the text...
    expect(store.get("text/plain")).toBe("hello");
    // ...and the selection was deleted from the document.
    expect(container.textContent).not.toContain("hello");
    controller.destroy();
  });
});

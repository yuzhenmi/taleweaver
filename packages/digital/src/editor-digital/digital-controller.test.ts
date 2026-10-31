import * as Y from "yjs";
import { describe, it, expect, vi } from "vitest";
import * as core from "@taleweaver/core";
import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  type ComponentRegistry,
  type AttrRegistry,
} from "@taleweaver/core";
import { asBlockId, createPosition, createSpan, getBlock, TALEWEAVER_CLIP_MIME } from "@taleweaver/core";

// Wrap `reduceEditor` as a spy so paste tests can assert the exact action payload
// forwarded into the reducer.  All other core exports are left as real implementations.
vi.mock("@taleweaver/core", async () => {
  const actual = await vi.importActual<typeof core>("@taleweaver/core");
  return {
    ...actual,
    reduceEditor: vi.fn(actual.reduceEditor),
  };
});
import { createDigitalController, type DigitalController } from "./digital-controller";
import { createDigitalSelectionBridge } from "./digital-selection-bridge";

const TEST_RESOLVER = createDefaultComponentRegistry();

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

  it("Shift+Enter (beforeinput insertLineBreak) is a soft break inside the paragraph; Enter splits", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "ab" });
    const block = controller.editorState.selection.focus.blockId;
    container.dispatchEvent(makeBeforeInput("insertLineBreak"));
    // A break ending the paragraph gets a filler <br> so its (empty) next line shows; the
    // caret at (block, 3) sits between the two.
    const el = container.querySelector(`[data-block-id="${block}"]`);
    const kids = Array.from(el?.childNodes ?? []).map((n) => (n instanceof HTMLElement ? `${n.tagName}${n.hasAttribute("data-tw-empty-line") ? ":filler" : ""}` : "#text"));
    expect(kids).toEqual(["SPAN", "BR", "BR:filler"]);
    const sel = window.getSelection();
    expect(sel?.focusNode).toBe(el);
    expect(sel?.focusOffset).toBe(2);
    controller.dispatch({ type: "INSERT_TEXT", text: "c" });
    expect(controller.editorState.selection.focus).toEqual(createPosition(block, 4)); // ab + break + c: one paragraph
    expect(container.querySelectorAll("[data-block-id] br:not([data-tw-empty-line])")).toHaveLength(1);
    container.dispatchEvent(makeBeforeInput("insertParagraph"));
    expect(controller.editorState.selection.focus.offset).toBe(0); // Enter: a new paragraph
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
    expect(getBlock(controller.editorState.document, focusId)?.type).toBe("list-item");
    // A fresh top-level list-item carries no `listLevel` attr (level 0).
    expect(getBlock(controller.editorState.document, focusId)?.attrs.listLevel).toBeUndefined();
    const offsetBefore = controller.editorState.selection.focus.offset;

    const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    container.dispatchEvent(e);
    // LIST_INDENT (not INSERT_TAB) was dispatched: the list nests to level 1 and the caret offset
    // is unchanged. INSERT_TAB would instead leave listLevel undefined and advance the caret by 1.
    expect(e.defaultPrevented).toBe(true);
    expect(getBlock(controller.editorState.document, focusId)?.attrs.listLevel).toBe(1);
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

  it("copy writes text/html and the lossless clip (rich clipboard — T12)", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "hello" });
    const id = leafBlockId(container);
    const span = createSpan(createPosition(asBlockId(id), 0), createPosition(asBlockId(id), 5));
    controller.dispatch({ type: "SET_SELECTION", selection: span });

    const { data, store } = makeClipboardData();
    container.dispatchEvent(makeClipboardEvent("copy", data));

    // text/plain survives unchanged
    expect(store.get("text/plain")).toBe("hello");
    // text/html must be a non-empty HTML string
    const html = store.get("text/html") ?? "";
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("<");
    // lossless clip must be a non-empty base64 string
    const clip = store.get(TALEWEAVER_CLIP_MIME) ?? "";
    expect(clip.length).toBeGreaterThan(0);
    controller.destroy();
  });

  it("cut writes all three clipboard flavors then dispatches DELETE_RANGE (T12)", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "hello" });
    const id = leafBlockId(container);
    const span = createSpan(createPosition(asBlockId(id), 0), createPosition(asBlockId(id), 5));
    controller.dispatch({ type: "SET_SELECTION", selection: span });

    const { data, store } = makeClipboardData();
    container.dispatchEvent(makeClipboardEvent("cut", data));

    expect(store.get("text/plain")).toBe("hello");
    const html = store.get("text/html") ?? "";
    expect(html.length).toBeGreaterThan(0);
    const clip = store.get(TALEWEAVER_CLIP_MIME) ?? "";
    expect(clip.length).toBeGreaterThan(0);
    // Cut must also delete the selection
    expect(container.textContent).not.toContain("hello");
    controller.destroy();
  });
});

describe("DigitalController — paste rich clipboard (T12)", () => {
  it("paste dispatches PASTE carrying text, html, and clip when all three flavors are present", () => {
    const { controller, container } = makeController();
    // Insert some text first so there is state to paste into
    controller.dispatch({ type: "INSERT_TEXT", text: "before" });

    // Reset the spy call log so earlier dispatches (INSERT_TEXT above) don't interfere.
    vi.mocked(core.reduceEditor).mockClear();

    // Provide all three clipboard flavors
    const { data } = makeClipboardData({
      "text/plain": "plain text",
      "text/html": "<p>html text</p>",
      [TALEWEAVER_CLIP_MIME]: "SOME_CLIP_DATA",
    });
    container.dispatchEvent(makeClipboardEvent("paste", data));

    // The reducer must have been called with the exact PASTE payload — proving all
    // three flavors were forwarded, not silently dropped.
    const calls = vi.mocked(core.reduceEditor).mock.calls;
    const pasteCall = calls.find(([, action]) => action.type === "PASTE");
    expect(pasteCall).toBeDefined();
    const pasteAction = pasteCall![1];
    expect(pasteAction).toMatchObject({
      type: "PASTE",
      text: "plain text",
      html: "<p>html text</p>",
      clip: "SOME_CLIP_DATA",
    });
    // Absent flavors must NOT be present as keys.
    expect("extra" in pasteAction).toBe(false);
    controller.destroy();
  });

  it("paste dispatches PASTE with only text when html and clip are absent (T12 — partial flavors)", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "start" });

    const { data } = makeClipboardData({ "text/plain": "world" });
    const before = controller.editorState;
    container.dispatchEvent(makeClipboardEvent("paste", data));
    expect(controller.editorState).not.toBe(before);
    // The pasted text appears in the document
    expect(container.textContent).toContain("world");
    controller.destroy();
  });

  it("paste with only html and clip (no text/plain) still dispatches PASTE (T12 — non-empty subset)", () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "base" });

    // html only — clip is a realistic base64; we don't need it to decode
    // successfully here; we just need the dispatch to happen with html set.
    const { data } = makeClipboardData({
      "text/html": "<p>rich</p>",
    });
    const before = controller.editorState;
    container.dispatchEvent(makeClipboardEvent("paste", data));
    // State changes (html paste decoded by htmlParser + core)
    expect(controller.editorState).not.toBe(before);
    controller.destroy();
  });
});

describe("DigitalController — paste-without-formatting (T13)", () => {
  it("Cmd/Ctrl+Shift+V dispatches PASTE with text only (no html/clip)", async () => {
    const { controller, container } = makeController();
    controller.dispatch({ type: "INSERT_TEXT", text: "before" });

    // Reset the spy so earlier dispatches don't interfere
    vi.mocked(core.reduceEditor).mockClear();

    // Stub navigator.clipboard.readText to resolve with "hello"
    const readText = vi.fn().mockResolvedValue("hello");
    Object.defineProperty(navigator, "clipboard", {
      value: { readText },
      configurable: true,
    });

    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "v",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    // Flush the microtask queue so the readText promise resolves
    await Promise.resolve();

    const calls = vi.mocked(core.reduceEditor).mock.calls;
    const pasteCall = calls.find(([, action]) => action.type === "PASTE");
    expect(pasteCall).toBeDefined();
    const pasteAction = pasteCall![1];
    expect(pasteAction).toMatchObject({ type: "PASTE", text: "hello" });
    // Must NOT carry html or clip keys
    expect("html" in pasteAction).toBe(false);
    expect("clip" in pasteAction).toBe(false);

    controller.destroy();
  });

  it("is a graceful no-op when readText rejects (permission denied)", async () => {
    const { controller, container } = makeController();
    vi.mocked(core.reduceEditor).mockClear();

    const readText = vi.fn().mockRejectedValue(new DOMException("NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", {
      value: { readText },
      configurable: true,
    });

    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "V",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Flush the readText().catch() microtask before asserting no dispatch.
    await Promise.resolve();

    const calls = vi.mocked(core.reduceEditor).mock.calls;
    expect(calls.find(([, action]) => action.type === "PASTE")).toBeUndefined();

    controller.destroy();
  });
});

describe("DigitalController — inline marks + typing attributes", () => {
  function makeMarkController(): { controller: DigitalController; container: HTMLElement; id: ReturnType<typeof asBlockId> } {
    const attrRegistry = createDefaultAttrRegistry();
    core.registerMark(attrRegistry, "mention", {
      atomic: true,
      toStyle: () => ({ backgroundColor: "#e8f0fe" }),
      toDom: (value) => ({
        class: "mention",
        attributes: { "data-ref": String((value as { ref?: unknown }).ref), onclick: "x", "data-tw-x": "y" },
      }),
    });
    core.registerMark(attrRegistry, "secret", { copy: "drop" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const controller = createDigitalController({
      container,
      componentRegistry: createDefaultComponentRegistry(),
      attrRegistry,
      containerWidth: 800,
      doc: document,
    });
    controller.dispatch({ type: "INSERT_TEXT", text: "Hi Anna and Bob" });
    const id = asBlockId(leafBlockId(container));
    controller.dispatch({
      type: "SET_MARK",
      key: "mention",
      value: { ref: "a" },
      span: createSpan(createPosition(id, 3), createPosition(id, 7)),
    });
    return { controller, container, id };
  }

  const caretAt = (id: ReturnType<typeof asBlockId>, o: number) => createSpan(createPosition(id, o), createPosition(id, o));

  it("typing (beforeinput) and an IME commit inside a bold word are bold", () => {
    const { controller, container, id } = makeMarkController();
    controller.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(id, 12), createPosition(id, 15)) });
    controller.dispatch({ type: "TOGGLE_STYLE", style: "bold" });
    controller.dispatch({ type: "SET_SELECTION", selection: caretAt(id, 13) });
    container.dispatchEvent(makeBeforeInput("insertText", { data: "X" }));
    container.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    container.dispatchEvent(new CompositionEvent("compositionend", { data: "日", bubbles: true }));
    const items = getBlock(controller.editorState.document, id)?.inlineContent?.items ?? [];
    const last = items[items.length - 1];
    expect(last?.kind === "text" ? [last.text, last.attrs] : null).toEqual(["BX日ob", { bold: true }]);
    expect(leafBlock(container).querySelector("strong")?.textContent).toBe("BX日ob");
    controller.destroy();
  });

  it("renders the mark's toDom class / attributes on the run (reserved / handler names filtered)", () => {
    const { controller, container } = makeMarkController();
    const el = leafBlock(container).querySelector(".mention");
    expect(el?.textContent).toBe("Anna");
    expect(el?.getAttribute("data-ref")).toBe("a");
    expect(el?.hasAttribute("onclick")).toBe(false);
    expect(el?.hasAttribute("data-tw-x")).toBe(false);
    controller.destroy();
  });

  it("a DOM caret placed inside the mention (selectionchange) snaps to its nearest edge, in the model and the DOM", () => {
    const { controller, container, id } = makeMarkController();
    const bridge = createDigitalSelectionBridge(container, window);
    bridge.positionToDom(caretAt(id, 4));
    document.dispatchEvent(new Event("selectionchange"));
    expect(controller.editorState.selection.focus.offset).toBe(3);
    expect(bridge.readDomSelection()?.focus.offset).toBe(3);
    controller.dispatch({ type: "SET_SELECTION", selection: caretAt(id, 7) });
    container.dispatchEvent(makeBeforeInput("deleteContentBackward"));
    expect(leafBlock(container).textContent).toBe("Hi  and Bob");
    controller.destroy();
  });

  // The DOM selection the browser produces (drag / double-click / Shift+Arrow / Arrow),
  // delivered through selectionchange exactly as a real gesture would be.
  function domSelect(container: HTMLElement, id: ReturnType<typeof asBlockId>, a: number, f: number): void {
    createDigitalSelectionBridge(container, window).positionToDom(createSpan(createPosition(id, a), createPosition(id, f)));
    document.dispatchEvent(new Event("selectionchange"));
  }
  const offsets = (c: DigitalController) => [c.editorState.selection.anchor.offset, c.editorState.selection.focus.offset];

  it.each([
    [4, 13, [3, 13]],
    [6, 13, [3, 13]],
    [4, 1, [7, 1]],
    [6, 1, [7, 1]],
  ])("a drag from %i (inside the mention) to %i selects the whole mention", (from, to, expected) => {
    const { controller, container, id } = makeMarkController();
    domSelect(container, id, from, from); // mousedown
    domSelect(container, id, from, to); // drag
    expect(offsets(controller)).toEqual(expected);
    controller.destroy();
  });

  it("double-click (native word selection) inside the mention selects all of it", () => {
    const { controller, container, id } = makeMarkController();
    controller.dispatch({ type: "SET_SELECTION", selection: caretAt(id, 1) });
    domSelect(container, id, 4, 6); // a partial word inside the mention
    expect(offsets(controller)).toEqual([3, 7]);
    controller.destroy();
  });

  it("Shift+Arrow and Arrow from an edge cross the mention as one unit; forward Delete removes it", () => {
    const { controller, container, id } = makeMarkController();
    controller.dispatch({ type: "SET_SELECTION", selection: caretAt(id, 3) });
    domSelect(container, id, 3, 4); // Shift+ArrowRight
    expect(offsets(controller)).toEqual([3, 7]);
    controller.dispatch({ type: "SET_SELECTION", selection: caretAt(id, 7) });
    domSelect(container, id, 6, 6); // ArrowLeft from the end
    expect(offsets(controller)).toEqual([3, 3]);
    container.dispatchEvent(makeBeforeInput("deleteContentForward"));
    expect(leafBlock(container).textContent).toBe("Hi  and Bob");
    controller.destroy();
  });

  it("Ctrl+B (the non-Mac primary modifier alone) at a collapsed caret bolds the next typed text", () => {
    const { controller, container, id } = makeMarkController();
    controller.dispatch({ type: "SET_SELECTION", selection: caretAt(id, 15) });
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true }));
    container.dispatchEvent(makeBeforeInput("insertText", { data: "!" }));
    const items = getBlock(controller.editorState.document, id)?.inlineContent?.items ?? [];
    expect(items.at(-1)?.attrs).toEqual({ bold: true });
    controller.destroy();
  });

  it("copy strips copy:\"drop\" marks from the clip and keeps the others", () => {
    const { controller, container, id } = makeMarkController();
    controller.dispatch({ type: "SET_MARK", key: "secret", value: true, span: createSpan(createPosition(id, 0), createPosition(id, 15)) });
    controller.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(id, 0), createPosition(id, 15)) });
    const { data, store } = makeClipboardData();
    container.dispatchEvent(makeClipboardEvent("copy", data));
    const frag = core.decodeFragmentClip(store.get(TALEWEAVER_CLIP_MIME) ?? "", TEST_RESOLVER, createDefaultAttrRegistry());
    if (frag === null) throw new Error("no clip");
    expect(core.getMarkRanges(frag, "mention").map((r) => r.value)).toEqual([{ ref: "a" }]);
    expect(core.getMarkRanges(frag, "secret")).toEqual([]);
    controller.destroy();
  });
});

describe("DigitalController — host extensions", () => {
  const insertMention: core.Command = (editor, dispatch) => {
    if (dispatch === undefined) return true;
    const at = editor.selection.focus;
    dispatch(core.replaceRangeWithMarkedText({ from: at, to: at }, "Anna", { key: "mention", value: { ref: "p1" } }, " "));
    return true;
  };
  const pickTrigger: core.Command = (editor, dispatch) => {
    const t = editor.activeTrigger;
    if (t === undefined) return false;
    dispatch?.(core.replaceRangeWithMarkedText(t, "Anna", { key: "mention", value: { ref: "p1" } }, " "));
    return true;
  };
  const extensions: core.EditorExtensions = {
    commands: { insertMention },
    keymap: { "Mod-Shift-m": "insertMention", "Mod-b": null, Enter: pickTrigger },
    inputRules: [{ pattern: /--$/, replace: "—" }],
    triggers: [{ id: "mention", text: "@" }],
  };

  function mountExt(): { controller: DigitalController; container: HTMLElement } {
    const attrRegistry = createDefaultAttrRegistry();
    core.registerMark(attrRegistry, "mention", { atomic: true });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const controller = createDigitalController({
      container,
      componentRegistry: createDefaultComponentRegistry(),
      attrRegistry,
      containerWidth: 800,
      doc: document,
      extensions,
    });
    return { controller, container };
  }
  const typeKeys = (container: HTMLElement, text: string) => {
    for (const ch of text) container.dispatchEvent(makeBeforeInput("insertText", { data: ch }));
  };
  const keydown = (container: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    container.dispatchEvent(e);
    return e;
  };
  const text = (c: DigitalController) =>
    (getBlock(c.editorState.document, c.editorState.selection.focus.blockId)?.inlineContent?.items ?? [])
      .map((i) => (i.kind === "text" ? i.text : ""))
      .join("");

  it("a host binding (Mod = Ctrl off-Mac) runs its command as one undo step; Mod-b unbound; runCommand", () => {
    const { controller, container } = mountExt();
    typeKeys(container, "Hi ");
    expect(keydown(container, "M", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(text(controller)).toBe("Hi Anna ");
    expect(leafBlock(container).textContent).toBe("Hi Anna ");
    keydown(container, "z", { ctrlKey: true });
    expect(text(controller)).toBe("Hi ");
    expect(keydown(container, "b", { ctrlKey: true }).defaultPrevented).toBe(true);
    typeKeys(container, "x");
    const items = getBlock(controller.editorState.document, controller.editorState.selection.focus.blockId)?.inlineContent?.items ?? [];
    expect(items.every((i) => i.attrs.bold === undefined)).toBe(true);
    expect(controller.runCommand("insertMention")).toBe(true);
    expect(text(controller)).toBe("Hi xAnna ");
    controller.destroy();
  });

  it("typing -- autoformats; Ctrl+Z reverts only the autoformat", () => {
    const { controller, container } = mountExt();
    typeKeys(container, "a--");
    expect(text(controller)).toBe("a—");
    keydown(container, "z", { ctrlKey: true });
    expect(text(controller)).toBe("a--");
    controller.destroy();
  });

  it("@ opens a trigger tracking the query; Escape ends it; Enter picks through the keymap", () => {
    const { controller, container } = mountExt();
    typeKeys(container, "Hi @an");
    expect(controller.editorState.activeTrigger).toMatchObject({ id: "mention", query: "an" });
    keydown(container, "Escape");
    expect(controller.editorState.activeTrigger).toBeUndefined();
    typeKeys(container, " @a");
    expect(keydown(container, "Enter").defaultPrevented).toBe(true);
    expect(text(controller)).toBe("Hi @an Anna ");
    expect(controller.editorState.activeTrigger).toBeUndefined();
    controller.destroy();
  });

  it("while composing, keys go to the IME and nothing triggers; the commit does", () => {
    const { controller, container } = mountExt();
    container.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    container.dispatchEvent(makeBeforeInput("insertCompositionText", { data: "@" }));
    expect(keydown(container, "Enter", { isComposing: true }).defaultPrevented).toBe(false);
    expect(controller.editorState.activeTrigger).toBeUndefined();
    container.dispatchEvent(new CompositionEvent("compositionend", { data: "@あ", bubbles: true }));
    expect(controller.editorState.activeTrigger).toMatchObject({ query: "あ" });
    controller.destroy();
  });
});

describe("DigitalController — keyboard edge cases (host extensions)", () => {
  const insertMention: core.Command = (editor, dispatch) => {
    if (dispatch === undefined) return true;
    const at = editor.selection.focus;
    dispatch(core.replaceRangeWithMarkedText({ from: at, to: at }, "Anna", { key: "mention", value: { ref: "p1" } }, " "));
    return true;
  };
  const extensions: core.EditorExtensions = { keymap: { "Mod-Shift-m": insertMention }, triggers: [{ id: "mention", text: "@" }] };
  function mount(ext: core.EditorExtensions = extensions): { controller: DigitalController; container: HTMLElement } {
    const attrRegistry = createDefaultAttrRegistry();
    core.registerMark(attrRegistry, "mention", { atomic: true });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const controller = createDigitalController({
      container,
      componentRegistry: createDefaultComponentRegistry(),
      attrRegistry,
      containerWidth: 800,
      doc: document,
      extensions: ext,
    });
    return { controller, container };
  }
  const keydown = (container: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    container.dispatchEvent(e);
    return e;
  };
  const typeKeys = (container: HTMLElement, text: string) => {
    for (const ch of text) container.dispatchEvent(makeBeforeInput("insertText", { data: ch }));
  };
  const text = (c: DigitalController) =>
    (getBlock(c.editorState.document, c.editorState.selection.focus.blockId)?.inlineContent?.items ?? [])
      .map((i) => (i.kind === "text" ? i.text : ""))
      .join("");

  it("a malformed keymap fails when the controller is created", () => {
    expect(() => mount({ keymap: { "Hyper-x": null } })).toThrow(/unknown modifier/);
  });

  it("Escape is claimed only when it dismisses something (a trigger); otherwise it propagates", () => {
    const { controller, container } = mount();
    typeKeys(container, "Hi ");
    expect(keydown(container, "Escape").defaultPrevented).toBe(false);
    typeKeys(container, "@a");
    expect(keydown(container, "Escape", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(controller.editorState.activeTrigger).toBeUndefined();
    controller.destroy();
  });

  it("on an Apple platform Cmd is Mod (Ctrl is not)", () => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", configurable: true });
    try {
      const { controller, container } = mount();
      keydown(container, "M", { ctrlKey: true, shiftKey: true });
      expect(text(controller)).toBe("");
      keydown(container, "M", { metaKey: true, shiftKey: true });
      expect(text(controller)).toBe("Anna ");
      controller.destroy();
    } finally {
      Reflect.deleteProperty(navigator, "userAgent"); // back to jsdom's prototype getter
    }
  });

  it("AltGr (Ctrl+Alt) producing @ is not swallowed and its input opens the trigger; a dead key too", () => {
    const { controller, container } = mount();
    expect(keydown(container, "@", { ctrlKey: true, altKey: true, code: "KeyQ" }).defaultPrevented).toBe(false);
    typeKeys(container, "@");
    expect(controller.editorState.activeTrigger).toMatchObject({ query: "" });
    keydown(container, "Escape");
    expect(keydown(container, "Dead", { code: "BracketLeft" }).defaultPrevented).toBe(false);
    typeKeys(container, " @é");
    expect(controller.editorState.activeTrigger).toMatchObject({ query: "é" });
    controller.destroy();
  });

  it("AltGr text (Polish AltGr+L = Ctrl+Alt, key ł) is typed, not taken by a Mod-Alt-l binding", () => {
    let ran = 0;
    const { controller, container } = mount({ keymap: { "Mod-Alt-l": () => (ran++, true) } });
    expect(keydown(container, "ł", { ctrlKey: true, altKey: true, code: "KeyL", modifierAltGraph: true }).defaultPrevented).toBe(false);
    typeKeys(container, "ł");
    expect(text(controller)).toBe("ł");
    keydown(container, "l", { ctrlKey: true, altKey: true, code: "KeyL" }); // a real Ctrl+Alt+L
    expect(ran).toBe(1);
    controller.destroy();
  });

  it("an auto-repeating host binding re-runs its command", () => {
    const { controller, container } = mount();
    keydown(container, "M", { ctrlKey: true, shiftKey: true });
    keydown(container, "M", { ctrlKey: true, shiftKey: true, repeat: true });
    expect(text(controller)).toBe("Anna Anna ");
    controller.destroy();
  });
});

describe("DigitalController — anchors, versions and collaboration", () => {
  function mountWith(initialState?: core.State): { controller: DigitalController; container: HTMLElement } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const controller = createDigitalController({
      container,
      componentRegistry: createDefaultComponentRegistry(),
      attrRegistry: createDefaultAttrRegistry(),
      containerWidth: 800,
      doc: document,
      ...(initialState !== undefined ? { initialState } : {}),
    });
    return { controller, container };
  }
  const typeKeys = (container: HTMLElement, text: string) => {
    for (const ch of text) container.dispatchEvent(makeBeforeInput("insertText", { data: ch }));
  };
  const caretAt = (id: core.BlockId, o: number) => createSpan(createPosition(id, o), createPosition(id, o));

  it("an anchor follows typing, undo and redo; mapPosition maps from an older version", () => {
    const { controller, container } = mountWith();
    typeKeys(container, "hello world");
    const id = asBlockId(leafBlockId(container));
    const v0 = controller.version;
    const anchor = controller.createAnchor(createPosition(id, 6), createPosition(id, 11));
    if (anchor === null) throw new Error("no anchor");
    controller.dispatch({ type: "SET_SELECTION", selection: caretAt(id, 0) });
    typeKeys(container, ">> ");
    expect([anchor.from.offset, anchor.to.offset]).toEqual([9, 14]);
    expect(controller.mapPosition(createPosition(id, 6), v0)).toEqual({ position: createPosition(id, 9), deleted: false });
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    expect([anchor.from.offset, anchor.to.offset]).toEqual([6, 11]);
    // An anchor created against the old version lands at its mapped place.
    typeKeys(container, "!!");
    const late = controller.createAnchor(createPosition(id, 6), createPosition(id, 11), { basedOn: v0 });
    expect(late === null ? null : [late.from.offset, late.to.offset, late.changed]).toEqual([8, 13, false]);
    controller.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(id, 8), createPosition(id, 13)) });
    controller.dispatch({ type: "DELETE_BACKWARD" });
    expect(late?.deleted).toBe(true);
    controller.destroy();
  });

  it("a peer's update (separate Y.Doc, Y.applyUpdate) is applied: DOM, selection rebased, anchors moved", () => {
    const cfg = { componentRegistry: createDefaultComponentRegistry(), attrRegistry: createDefaultAttrRegistry(), containerWidth: 800 };
    let peerA = core.reduceEditor(core.createInitialEditorState(cfg), { type: "INSERT_TEXT", text: "hello world" });
    const docA = core.getYDoc(peerA.document);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const { controller, container } = mountWith(core.createState({ resolver: TEST_RESOLVER, rootId: peerA.document.rootId, doc: docB }));
    docA.on("update", (u: Uint8Array) => Y.applyUpdate(docB, u, "provider"));
    const id = peerA.selection.focus.blockId;
    controller.dispatch({ type: "SET_SELECTION", selection: caretAt(id, 5) });
    const anchor = controller.createAnchor(createPosition(id, 6), createPosition(id, 11));
    peerA = core.reduceEditor(peerA, { type: "SET_SELECTION", selection: caretAt(id, 0) });
    peerA = core.reduceEditor(peerA, { type: "INSERT_TEXT", text: "Oh, " });
    expect(leafBlock(container).textContent).toBe("Oh, hello world");
    expect(controller.editorState.selection.focus).toEqual(createPosition(id, 9));
    expect(anchor === null ? null : [anchor.from.offset, anchor.to.offset]).toEqual([10, 15]);
    // The local user keeps typing at the rebased caret; undo stays local.
    typeKeys(container, "_");
    expect(leafBlock(container).textContent).toBe("Oh, hello_ world");
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(leafBlock(container).textContent).toBe("Oh, hello world");
    controller.destroy();
  });
});

describe("DigitalController — remote changes: lifetime, ownership, IME", () => {
  const cfg = { componentRegistry: createDefaultComponentRegistry(), attrRegistry: createDefaultAttrRegistry(), containerWidth: 800 };
  function peerPair() {
    let peerA = core.reduceEditor(core.createInitialEditorState(cfg), { type: "INSERT_TEXT", text: "hello world" });
    const docA = core.getYDoc(peerA.document);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    docA.on("update", (u: Uint8Array) => Y.applyUpdate(docB, u, "provider"));
    const stateB = core.createState({ resolver: TEST_RESOLVER, rootId: peerA.document.rootId, doc: docB });
    return {
      stateB,
      type: (t: string) => {
        peerA = core.reduceEditor(peerA, { type: "INSERT_TEXT", text: t });
      },
    };
  }
  function mountOn(state: core.State, remoteChanges?: "observe" | "ignore") {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const seen: core.EditorAction[] = [];
    const reduce = vi.mocked(core.reduceEditor);
    const controller = createDigitalController({
      container,
      componentRegistry: createDefaultComponentRegistry(),
      attrRegistry: createDefaultAttrRegistry(),
      containerWidth: 800,
      doc: document,
      initialState: state,
      ...(remoteChanges !== undefined ? { remoteChanges } : {}),
      onChange: () => {
        const last = reduce.mock.calls.at(-1)?.[1];
        if (last !== undefined) seen.push(last);
      },
    });
    return { controller, container, foreign: () => seen.filter((a) => a.type === "APPLY_FOREIGN_CHANGE").length };
  }

  it("local edits dispatch no foreign change; after destroy() a peer update is ignored", () => {
    const pair = peerPair();
    const m = mountOn(pair.stateB);
    m.container.dispatchEvent(makeBeforeInput("insertText", { data: "!" }));
    expect(m.foreign()).toBe(0);
    pair.type("A");
    expect(m.foreign()).toBe(1);
    m.controller.destroy();
    pair.type("B");
    expect(m.foreign()).toBe(1);
  });

  it("with two controllers on one document, only the observing one applies peer changes", () => {
    const pair = peerPair();
    const owner = mountOn(pair.stateB);
    const other = mountOn(pair.stateB, "ignore");
    pair.type("A");
    expect(owner.foreign()).toBe(1);
    expect(other.foreign()).toBe(0);
    owner.controller.destroy();
    other.controller.destroy();
  });

  it("a peer change during IME composition never writes the DOM selection; compositionend re-projects it", () => {
    const pair = peerPair();
    const m = mountOn(pair.stateB);
    m.container.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const sel = window.getSelection();
    if (sel === null) throw new Error("no selection");
    const writes = [vi.spyOn(sel, "setBaseAndExtent"), vi.spyOn(sel, "collapse"), vi.spyOn(sel, "addRange")];
    pair.type("A");
    expect(m.foreign()).toBe(1);
    expect(writes.every((w) => w.mock.calls.length === 0)).toBe(true);
    const cancelled = new CompositionEvent("compositionend", { bubbles: true });
    Object.defineProperty(cancelled, "data", { value: null, configurable: true });
    m.container.dispatchEvent(cancelled);
    expect(writes.some((w) => w.mock.calls.length > 0)).toBe(true);
    writes.forEach((w) => w.mockRestore());
    m.controller.destroy();
  });
});

describe("DigitalController — host proposals (suggestion groups)", async () => {
  function mountWithText(text: string) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const controller = createDigitalController({
      container,
      componentRegistry: createDefaultComponentRegistry(),
      attrRegistry: createDefaultAttrRegistry(),
      containerWidth: 800,
      doc: document,
    });
    controller.dispatch({ type: "INSERT_TEXT", text });
    return { controller, container, id: asBlockId(leafBlockId(container)) };
  }
  const ctrlZ = (container: HTMLElement) =>
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));

  const ctrlShiftZ = (container: HTMLElement) =>
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  const styledText = (container: HTMLElement): string =>
    Array.from(leafBlock(container).querySelectorAll(".by-assistant")).map((el) => el.textContent).join("|");

  it("propose() lands one group without moving the caret, with live per-source styling through accept / reject / undo / redo", async () => {
    const { controller, container, id } = mountWithText("The  quick fox");
    controller.setSuggestionStyles((g) => (g.metadata?.source === "assistant" ? { class: "by-assistant" } : null));
    const groupId = core.newSuggestionGroupId();
    const result = await controller.propose({
      groupId,
      author: "assistant",
      metadata: { source: "assistant" },
      edits: [
        { kind: "replace", from: createPosition(id, 3), to: createPosition(id, 4), text: "" },
        { kind: "replace", from: createPosition(id, 5), to: createPosition(id, 10), text: "swift" },
      ],
    });
    expect(result).toEqual({ ok: true });
    expect(controller.editorState.lastProposal).toMatchObject({ groupId, outcome: "applied" });
    // The caret stays after "fox" — only rebased past the 5 inserted (pending) characters.
    expect(controller.editorState.selection.focus).toEqual(createPosition(id, 19));
    expect(core.getSuggestionGroups(controller.editorState.document).map((g) => g.id)).toEqual([groupId]);
    // Built-in suggestion visuals: inserted text underlined, deleted struck; host styling on top.
    expect(leafBlock(container).querySelector("u")?.textContent).toBe("swift");
    expect(leafBlock(container).querySelectorAll("s").length).toBeGreaterThan(0);
    const styled = styledText(container);
    expect(styled.replaceAll("|", "")).toBe(" swiftquick");
    controller.dispatch({ type: "ACCEPT_SUGGESTION_GROUP", groupId });
    expect(leafBlock(container).textContent).toBe("The swift fox");
    expect(styledText(container)).toBe("");
    ctrlZ(container);
    expect(core.getSuggestionGroups(controller.editorState.document).map((g) => g.id)).toEqual([groupId]);
    expect(styledText(container)).toBe(styled);
    ctrlShiftZ(container);
    expect(leafBlock(container).textContent).toBe("The swift fox");
    ctrlZ(container);
    controller.dispatch({ type: "REJECT_SUGGESTION_GROUP", groupId });
    expect(leafBlock(container).textContent).toBe("The  quick fox");
    expect(styledText(container)).toBe("");
    ctrlZ(container);
    expect(core.getSuggestionGroups(controller.editorState.document).map((g) => g.id)).toEqual([groupId]);
    expect(styledText(container)).toBe(styled);
    ctrlShiftZ(container);
    expect(leafBlock(container).textContent).toBe("The  quick fox");
    expect(core.getSuggestions(controller.editorState.document)).toHaveLength(0);
    controller.setSuggestionStyles(null);
    controller.destroy();
  });

  it("a proposal inside the just-typed run is NOT in the user's undo stack: Ctrl+Z undoes the typing, the proposal stays", async () => {
    const { controller, container, id } = mountWithText("jumps over");
    controller.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(id, 0), createPosition(id, 0)) });
    controller.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(id, 10), createPosition(id, 10)) });
    container.dispatchEvent(makeBeforeInput("insertText", { data: "!" }));
    const groupId = core.newSuggestionGroupId();
    const result = await controller.propose({
      groupId,
      author: "assistant",
      edits: [{ kind: "replace", from: createPosition(id, 5), to: createPosition(id, 5), text: " high" }],
    });
    expect(result).toEqual({ ok: true });
    expect(leafBlock(container).textContent).toBe("jumps high over!");
    ctrlZ(container); // the user's own last edit: the typed "!"
    expect(leafBlock(container).textContent).toBe("jumps high over");
    expect(core.getSuggestionGroups(controller.editorState.document).map((g) => g.id)).toEqual([groupId]);
    ctrlShiftZ(container);
    expect(leafBlock(container).textContent).toBe("jumps high over!");
    expect(core.getSuggestionGroups(controller.editorState.document).map((g) => g.id)).toEqual([groupId]);
    controller.destroy();
  });

  it("a PROPOSE nested inside propose() (from onChange) does not hide the outer verdict; each gets its own", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const box: { started: boolean; nested?: Promise<core.ProposeResult> } = { started: false };
    const controller = createDigitalController({
      container,
      componentRegistry: createDefaultComponentRegistry(),
      attrRegistry: createDefaultAttrRegistry(),
      containerWidth: 800,
      doc: document,
      onChange: (state) => {
        if (box.started || state.lastProposal === undefined) return;
        box.started = true;
        box.nested = controller.propose({
          groupId: core.newSuggestionGroupId(),
          author: "b",
          edits: [{ kind: "replace", from: createPosition(id, 0), to: createPosition(id, 2), text: "x" }], // overlaps the outer one
        });
      },
    });
    controller.dispatch({ type: "INSERT_TEXT", text: "hello world" });
    const id = asBlockId(leafBlockId(container));
    const outer = await controller.propose({
      groupId: core.newSuggestionGroupId(),
      author: "a",
      edits: [{ kind: "replace", from: createPosition(id, 0), to: createPosition(id, 5), text: "howdy" }],
    });
    expect(outer).toEqual({ ok: true });
    if (box.nested === undefined) throw new Error("nested propose did not run");
    const inner = await box.nested;
    expect(inner.ok === false && inner.reason === "rejected" ? inner.problem.kind : null).toBe("conflict");
    controller.destroy();
  });

  it("propose() after destroy is rejected without touching the document", async () => {
    const { controller, id } = mountWithText("abc");
    const before = controller.editorState.document;
    controller.destroy();
    const result = await controller.propose({
      groupId: core.newSuggestionGroupId(),
      author: "a",
      edits: [{ kind: "replace", from: createPosition(id, 0), to: createPosition(id, 1), text: "x" }],
    });
    expect(result).toEqual({ ok: false, reason: "rejected", problem: { kind: "invalid", message: "controller destroyed" } });
    expect(controller.editorState.document).toBe(before);
  });

  it("a proposal based on an older version lands mapped; one whose range was edited is stale; overlaps are rejected", async () => {
    const { controller, container, id } = mountWithText("hello world");
    const v0 = controller.version;
    const proposal = (from: number, to: number, text: string): core.Proposal => ({
      groupId: core.newSuggestionGroupId(),
      author: "assistant",
      edits: [{ kind: "replace", from: createPosition(id, from), to: createPosition(id, to), text }],
    });
    controller.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(id, 0), createPosition(id, 0)) });
    container.dispatchEvent(makeBeforeInput("insertText", { data: ">" }));
    expect(await controller.propose(proposal(6, 11, "there"), { basedOn: v0 })).toEqual({ ok: true }); // edit BEFORE the range
    controller.dispatch({ type: "ACCEPT_ALL_SUGGESTIONS" });
    expect(leafBlock(container).textContent).toBe(">hello there");
    const v1 = controller.version;
    controller.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(id, 3), createPosition(id, 3)) });
    container.dispatchEvent(makeBeforeInput("insertText", { data: "Z" }));
    expect(await controller.propose(proposal(1, 6, "howdy"), { basedOn: v1 })).toEqual({ ok: false, reason: "stale" });
    expect((await controller.propose(proposal(1, 4, "x"))).ok).toBe(true);
    const clash = await controller.propose(proposal(2, 3, "y"));
    expect(clash.ok === false && clash.reason === "rejected" ? clash.problem.kind : null).toBe("conflict");
    controller.destroy();
  });
});

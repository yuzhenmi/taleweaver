import { describe, it, expect } from "vitest";
import type { AccessibilityNode, BlockId, Selection as EngineSelection } from "@taleweaver/core";
import { createDomMirrorHost } from "./dom-mirror-host";

const bid = (s: string): BlockId => s as BlockId;

function para(id: string, text: string): AccessibilityNode {
  return {
    role: "paragraph",
    sourceBlockId: bid(id),
    children: [],
    text: [{ text, sourceOffsetStart: 0, sourceOffsetEnd: text.length }],
  };
}
function docTree(...children: AccessibilityNode[]): AccessibilityNode {
  return { role: "document", sourceBlockId: null, children };
}

describe("dom-mirror-host lifecycle", () => {
  it("mounts a focusable, AT-visible (not aria-hidden) mirror into the container", () => {
    const container = document.createElement("div");
    const host = createDomMirrorHost({ container, doc: document });
    expect(container.contains(host.element)).toBe(true);
    expect(host.element.getAttribute("data-taleweaver-a11y-mirror")).toBe("true");
    expect(host.element.getAttribute("aria-hidden")).toBeNull();
    expect(host.element.getAttribute("contenteditable")).toBe("true");
    expect(host.element.getAttribute("role")).toBe("textbox");
    expect(host.element.tabIndex).toBe(0);
    host.destroy();
  });

  it("syncTree rebuilds the mirror DOM from the tree", () => {
    const container = document.createElement("div");
    const host = createDomMirrorHost({ container, doc: document });
    host.syncTree(docTree(para("p1", "Hello")));
    expect(host.element.querySelector('[data-block-id="p1"]')?.textContent).toBe("Hello");
    host.syncTree(docTree(para("p1", "Goodbye")));
    expect(host.element.querySelector('[data-block-id="p1"]')?.textContent).toBe("Goodbye");
    expect(host.element.querySelectorAll('[data-block-id="p1"]').length).toBe(1);
    host.destroy();
  });

  it("focus() moves DOM focus to the mirror", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const host = createDomMirrorHost({ container, doc: document });
    host.focus();
    expect(document.activeElement).toBe(host.element);
    host.destroy();
    container.remove();
  });

  it("destroy() removes the mirror from the container", () => {
    const container = document.createElement("div");
    const host = createDomMirrorHost({ container, doc: document });
    host.destroy();
    expect(container.querySelector('[data-taleweaver-a11y-mirror]')).toBeNull();
  });

  it("syncSelection places the engine selection into the browser Selection", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const host = createDomMirrorHost({ container, doc: document });
    host.syncTree(docTree(para("p1", "Hello")));
    const sel: EngineSelection = {
      anchor: { blockId: bid("p1"), offset: 1 },
      focus: { blockId: bid("p1"), offset: 4 },
    };
    host.syncSelection(sel);
    const browser = window.getSelection();
    expect(browser?.toString()).toBe("ell");
    host.destroy();
    container.remove();
  });

  it("fires onSelectionChange with the mapped span when selectionchange lands in the mirror", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const spans: Array<{ anchor: unknown; focus: unknown }> = [];
    const host = createDomMirrorHost({
      container, doc: document,
      onSelectionChange: (span) => { spans.push(span); },
    });
    host.syncTree(docTree(para("p1", "Hello")));
    host.syncSelection({
      anchor: { blockId: bid("p1"), offset: 1 },
      focus: { blockId: bid("p1"), offset: 4 },
    });
    document.dispatchEvent(new Event("selectionchange"));
    expect(spans).toEqual([{
      anchor: { blockId: bid("p1"), offset: 1 },
      focus: { blockId: bid("p1"), offset: 4 },
    }]);
    host.destroy();
    container.remove();
  });

  it("stops firing onSelectionChange after destroy() (listener removed)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let fired = 0;
    const host = createDomMirrorHost({
      container, doc: document,
      onSelectionChange: () => { fired++; },
    });
    host.syncTree(docTree(para("p1", "Hello")));
    host.syncSelection({
      anchor: { blockId: bid("p1"), offset: 1 },
      focus: { blockId: bid("p1"), offset: 1 },
    });
    // Reset AFTER syncSelection: a synchronous pre-destroy fire is irrelevant — we only
    // assert the listener is gone AFTER destroy.
    fired = 0;
    host.destroy();
    document.dispatchEvent(new Event("selectionchange"));
    expect(fired).toBe(0);
    container.remove();
  });

  it("forwards keydown to onKeyDown", () => {
    const container = document.createElement("div");
    const keys: string[] = [];
    const host = createDomMirrorHost({
      container, doc: document, onKeyDown: (e) => keys.push(e.key),
    });
    host.element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(keys).toEqual(["ArrowLeft"]);
    host.destroy();
  });

  it("preventDefaults insertText beforeinput and forwards the text to onInsertText", () => {
    const container = document.createElement("div");
    const inserts: string[] = [];
    const host = createDomMirrorHost({
      container, doc: document, onInsertText: (t) => inserts.push(t),
    });
    const ev = new InputEvent("beforeinput", {
      inputType: "insertText", data: "x", bubbles: true, cancelable: true,
    });
    host.element.dispatchEvent(ev);
    expect(inserts).toEqual(["x"]);
    expect(ev.defaultPrevented).toBe(true);
    host.destroy();
  });

  it("routes compositionend text and suppresses the trailing beforeinput insertCompositionText", () => {
    const container = document.createElement("div");
    const inserts: string[] = [];
    let composing = 0;
    const host = createDomMirrorHost({
      container, doc: document,
      onInsertText: (t) => inserts.push(t),
      onCompositionStart: () => { composing++; },
      onCompositionEnd: (t) => inserts.push(t),
    });
    host.element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const during = new InputEvent("beforeinput", {
      inputType: "insertCompositionText", data: "あ", bubbles: true, cancelable: true,
    });
    host.element.dispatchEvent(during);
    host.element.dispatchEvent(new CompositionEvent("compositionend", { data: "あ", bubbles: true }));
    expect(composing).toBe(1);
    expect(inserts).toEqual(["あ"]);
    host.destroy();
  });

  it("forwards copy/cut/paste", () => {
    const container = document.createElement("div");
    const events: string[] = [];
    const host = createDomMirrorHost({
      container, doc: document,
      onCopy: () => events.push("copy"),
      onCut: () => events.push("cut"),
      onPaste: () => events.push("paste"),
    });
    // jsdom does not provide a `ClipboardEvent` global, so dispatch plain Events of
    // the clipboard types — the matching listeners still fire (this test only checks
    // the handler is wired, never reads e.clipboardData). Matches the repo's existing
    // clipboard-event test convention (editor-controller.test.ts).
    host.element.dispatchEvent(new Event("copy", { bubbles: true }));
    host.element.dispatchEvent(new Event("cut", { bubbles: true }));
    host.element.dispatchEvent(new Event("paste", { bubbles: true }));
    expect(events).toEqual(["copy", "cut", "paste"]);
    host.destroy();
  });

  it("forwards focus/blur to the callbacks", () => {
    const container = document.createElement("div");
    const seq: string[] = [];
    const host = createDomMirrorHost({
      container, doc: document,
      onFocus: () => seq.push("focus"),
      onBlur: () => seq.push("blur"),
    });
    host.element.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
    host.element.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    expect(seq).toEqual(["focus", "blur"]);
    host.destroy();
  });

  it("syncTree incrementally reconciles — unchanged block keeps its DOM element across paints", () => {
    const container = document.createElement("div");
    const host = createDomMirrorHost({ container, doc: document });
    host.syncTree(docTree(para("p1", "Hello"), para("p2", "World")));
    const el1 = host.element.querySelector('[data-block-id="p1"]');
    const el2 = host.element.querySelector('[data-block-id="p2"]');
    host.syncTree(docTree(para("p1", "Hellp"), para("p2", "World"))); // only p1 changed
    expect(host.element.querySelector('[data-block-id="p1"]')).toBe(el1); // same element reused
    expect(host.element.querySelector('[data-block-id="p2"]')).toBe(el2);
    expect(host.element.querySelector('[data-block-id="p1"]')?.textContent).toBe("Hellp");
    host.destroy();
  });

  it("resets its own isComposing on blur so a later insertText is not suppressed", () => {
    const container = document.createElement("div");
    const inserts: string[] = [];
    const host = createDomMirrorHost({
      container, doc: document, onInsertText: (t) => inserts.push(t),
    });
    host.element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    host.element.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    host.element.dispatchEvent(new InputEvent("beforeinput", {
      inputType: "insertText", data: "z", bubbles: true, cancelable: true,
    }));
    expect(inserts).toEqual(["z"]);
    host.destroy();
  });

  it("re-syncs a reused field run's text when the resolved page-count changes (2→3)", () => {
    const container = document.createElement("div");
    const host = createDomMirrorHost({ container, doc: document });
    const tree: AccessibilityNode = docTree({
      role: "paragraph",
      sourceBlockId: bid("b"),
      children: [],
      text: [
        { text: "Page ", sourceOffsetStart: 0, sourceOffsetEnd: 5 },
        { text: "", sourceOffsetStart: 5, sourceOffsetEnd: 6, fieldKind: "page-count", fieldKey: "b/inline/1" },
      ],
    });
    host.syncTree(tree, new Map([["b/inline/1", "2"]]));
    const paraEl = host.element.querySelector('[data-block-id="b"]');
    const fieldEl = host.element.querySelector('[data-offset-start="5"]');
    expect(fieldEl?.textContent).toBe("2");
    host.syncTree(tree, new Map([["b/inline/1", "3"]]));
    // The reused field-run node now shows the new value.
    expect(host.element.querySelector('[data-offset-start="5"]')?.textContent).toBe("3");
    // The paragraph element is REUSED across syncs (not rebuilt) — this is the
    // AT-focus-stability behavior upstream page-field resolution is designed to preserve.
    expect(host.element.querySelector('[data-block-id="b"]')).toBe(paraEl);
    host.destroy();
  });

  it("leaves a page-field run as its placeholder when no resolvedFields are supplied (page-number / default-off path)", () => {
    const container = document.createElement("div");
    const host = createDomMirrorHost({ container, doc: document });
    const tree: AccessibilityNode = docTree({
      role: "paragraph",
      sourceBlockId: bid("b"),
      children: [],
      text: [
        { text: "Page ", sourceOffsetStart: 0, sourceOffsetEnd: 5 },
        { text: "", sourceOffsetStart: 5, sourceOffsetEnd: 6, fieldKind: "page-count", fieldKey: "b/inline/1" },
      ],
    });
    // No resolvedFields argument: the field run keeps its "" placeholder (no substitution).
    host.syncTree(tree);
    expect(host.element.querySelector('[data-offset-start="5"]')?.textContent).toBe("");
    // An empty map is likewise a no-substitute path.
    host.syncTree(tree, new Map());
    expect(host.element.querySelector('[data-offset-start="5"]')?.textContent).toBe("");
    host.destroy();
  });

  it("syncTree is a no-op while isComposing (IME safety), then reconciles after compositionend", () => {
    const container = document.createElement("div");
    const host = createDomMirrorHost({ container, doc: document });
    host.syncTree(docTree(para("p1", "Hello")));
    const before = host.element.innerHTML;
    // enter composition (the host sets its own isComposing on compositionstart)
    host.element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    host.syncTree(docTree(para("p1", "Hello world"))); // arrives mid-composition
    expect(host.element.innerHTML).toBe(before); // no-op: mirror unchanged during composition
    // end composition → next syncTree reconciles to committed state
    host.element.dispatchEvent(new CompositionEvent("compositionend", { data: "x", bubbles: true }));
    host.syncTree(docTree(para("p1", "Hello world")));
    expect(host.element.querySelector('[data-block-id="p1"]')?.textContent).toBe("Hello world");
    host.destroy();
  });
});

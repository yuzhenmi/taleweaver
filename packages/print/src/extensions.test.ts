/**
 * Host extensions on the PRINT backend through the REAL controller: host keymap
 * before the defaults (override, unbind, Mod), commands as one undo step, input rules on
 * textarea typing, triggers incl. Escape and IME deferral, `runCommand`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as core from "@taleweaver/core";
import { createEditorController, type EditorController } from "./index";

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

/** A command inserting a fixed mention at the caret (two engine steps → one transaction). */
const insertMention: core.Command = (editor, dispatch) => {
  if (dispatch === undefined) return true;
  const at = editor.selection.focus;
  dispatch(core.replaceRangeWithMarkedText({ from: at, to: at }, "Anna", { key: "mention", value: { ref: "p1" } }, " "));
  return true;
};

/** Enter while a trigger is open picks "Anna" for it; otherwise falls through to the default. */
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

function mount(text = "", ext: core.EditorExtensions = extensions): {
  textarea: HTMLTextAreaElement;
  controller: EditorController;
  get: () => core.EditorState;
} {
  const attrRegistry = core.createDefaultAttrRegistry();
  core.registerMark(attrRegistry, "mention", { atomic: true });
  const cfg: core.EditorConfig = { componentRegistry: core.createDefaultComponentRegistry(), attrRegistry, containerWidth: 600, extensions: ext };
  let editor = core.createInitialEditorState(cfg);
  if (text !== "") editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text });
  const container = document.createElement("div");
  document.body.appendChild(container);
  let controller: EditorController | null = null;
  controller = createEditorController(container, {
    measurer: core.createMockMeasurer(8, 16),
    dispatch: (a) => {
      editor = core.reduceEditor(editor, a);
      controller?.update(editor);
    },
  });
  controller.update(editor);
  const textarea = container.querySelector("textarea");
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("no textarea");
  return { textarea, controller, get: () => editor };
}

const textOf = (e: core.EditorState): string =>
  (core.getBlock(e.document, e.selection.focus.blockId)?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "")).join("");

function type(textarea: HTMLTextAreaElement, text: string): void {
  for (const ch of text) {
    textarea.value = ch;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

const key = (textarea: HTMLTextAreaElement, k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  textarea.dispatchEvent(e);
  return e;
};

describe("print — host keymap", () => {
  it("a host binding (Mod = Ctrl off-Mac) runs its command as ONE undo step", () => {
    const m = mount("Hi ");
    const e = key(m.textarea, "M", { ctrlKey: true, shiftKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(textOf(m.get())).toBe("Hi Anna ");
    expect(core.getMarkRanges(m.get().document, "mention").map((r) => [r.from.offset, r.to.offset])).toEqual([[3, 7]]);
    key(m.textarea, "z", { ctrlKey: true });
    expect(textOf(m.get())).toBe("Hi ");
    // Cmd is not Mod off-Mac.
    key(m.textarea, "M", { metaKey: true, shiftKey: true });
    expect(textOf(m.get())).toBe("Hi ");
  });

  it("an unbound default (Mod-b → null) does nothing; a declining command falls through to the default", () => {
    const m = mount("ab");
    const e = key(m.textarea, "b", { ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    type(m.textarea, "c");
    expect(m.get().document).toBeDefined();
    const items = core.getBlock(m.get().document, m.get().selection.focus.blockId)?.inlineContent?.items ?? [];
    expect(items.map((i) => i.attrs)).toEqual([{}]); // not bold
    key(m.textarea, "Enter"); // no trigger open → pickTrigger declines → default SPLIT_NODE
    expect(textOf(m.get())).toBe("");
  });

  it("runCommand runs a registered command by name", () => {
    const m = mount();
    expect(m.controller.runCommand("insertMention")).toBe(true);
    expect(textOf(m.get())).toBe("Anna ");
    expect(m.controller.runCommand("nope")).toBe(false);
  });
});

describe("print — input rules and triggers", () => {
  it("typing -- autoformats to an em dash; Ctrl+Z reverts only the autoformat", () => {
    const m = mount();
    type(m.textarea, "a--");
    expect(textOf(m.get())).toBe("a—");
    key(m.textarea, "z", { ctrlKey: true });
    expect(textOf(m.get())).toBe("a--");
  });

  it("typing @ opens a trigger that follows the query; Escape ends it; Enter picks via the host keymap", () => {
    const m = mount("Hi ");
    type(m.textarea, "@an");
    expect(m.get().activeTrigger).toMatchObject({ id: "mention", query: "an" });
    key(m.textarea, "Escape");
    expect(m.get().activeTrigger).toBeUndefined();
    type(m.textarea, " @a");
    expect(m.get().activeTrigger?.query).toBe("a");
    key(m.textarea, "Enter");
    expect(textOf(m.get())).toBe("Hi @an Anna ");
    expect(m.get().activeTrigger).toBeUndefined();
    key(m.textarea, "z", { ctrlKey: true });
    expect(textOf(m.get())).toBe("Hi @an @a");
  });

  it("during IME composition nothing triggers; the commit does", () => {
    const m = mount();
    m.textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    type(m.textarea, "@"); // composing: the textarea input is ignored
    key(m.textarea, "Enter", { isComposing: true }); // IME owns Enter
    expect(m.get().activeTrigger).toBeUndefined();
    expect(textOf(m.get())).toBe("");
    m.textarea.dispatchEvent(new CompositionEvent("compositionend", { data: "@あ", bubbles: true }));
    expect(m.get().activeTrigger).toMatchObject({ query: "あ" });
  });
});

describe("print — keyboard edge cases", () => {
  it("a malformed keymap fails when the controller is created", () => {
    expect(() => mount("", { keymap: { "Hyper-x": null } })).toThrow(/unknown modifier/);
  });

  it("Escape is claimed only when it dismisses something (a trigger); otherwise it propagates", () => {
    const m = mount("Hi ");
    expect(key(m.textarea, "Escape").defaultPrevented).toBe(false);
    type(m.textarea, "@a");
    expect(key(m.textarea, "Escape", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(m.get().activeTrigger).toBeUndefined();
  });

  it("on an Apple platform Cmd is Mod (Ctrl is not)", () => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", configurable: true });
    try {
      const m = mount("Hi ");
      key(m.textarea, "M", { ctrlKey: true, shiftKey: true });
      expect(textOf(m.get())).toBe("Hi ");
      key(m.textarea, "M", { metaKey: true, shiftKey: true });
      expect(textOf(m.get())).toBe("Hi Anna ");
    } finally {
      Reflect.deleteProperty(navigator, "userAgent"); // back to jsdom's prototype getter
    }
  });

  it("AltGr (Ctrl+Alt) producing @ is not swallowed and its input opens the trigger; a dead key too", () => {
    const m = mount("Hi ");
    expect(key(m.textarea, "@", { ctrlKey: true, altKey: true, code: "KeyQ" }).defaultPrevented).toBe(false);
    type(m.textarea, "@");
    expect(m.get().activeTrigger).toMatchObject({ query: "" });
    key(m.textarea, "Escape");
    expect(key(m.textarea, "Dead", { code: "BracketLeft" }).defaultPrevented).toBe(false);
    type(m.textarea, " @é");
    expect(m.get().activeTrigger).toMatchObject({ query: "é" });
  });

  it("AltGr text (Polish AltGr+L = Ctrl+Alt, key ł) is typed, not taken by a Mod-Alt-l binding", () => {
    let ran = 0;
    const m = mount("", { keymap: { "Mod-Alt-l": () => (ran++, true) } });
    expect(key(m.textarea, "ł", { ctrlKey: true, altKey: true, code: "KeyL", modifierAltGraph: true }).defaultPrevented).toBe(false);
    type(m.textarea, "ł");
    expect(textOf(m.get())).toBe("ł");
    key(m.textarea, "l", { ctrlKey: true, altKey: true, code: "KeyL" }); // a real Ctrl+Alt+L
    expect(ran).toBe(1);
  });

  it("an auto-repeating host binding re-runs its command", () => {
    const m = mount("");
    key(m.textarea, "M", { ctrlKey: true, shiftKey: true });
    key(m.textarea, "M", { ctrlKey: true, shiftKey: true, repeat: true });
    expect(textOf(m.get())).toBe("Anna Anna ");
  });
});

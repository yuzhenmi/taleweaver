import { describe, it, expect } from "vitest";
import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createPosition,
  createSpan,
  getBlock,
  findMatches,
  getSuggestions,
  reduceEditor,
  createInitialEditorState,
  type BlockId,
  type CommentId,
  type Decoration,
  type EditorAction,
} from "@taleweaver/core";
import { createDigitalController, type DecorationPointerEvent } from "./digital-controller";
import { renderDocumentToDom } from "../dom-view/render-to-dom";

function setup(decorations?: readonly Decoration[], onDecorationPointer?: (e: DecorationPointerEvent) => void) {
  const componentRegistry = createDefaultComponentRegistry();
  const attrRegistry = createDefaultAttrRegistry();
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  const controller = createDigitalController({
    container,
    componentRegistry,
    attrRegistry,
    doc: document,
    ...(decorations !== undefined ? { decorations } : {}),
    ...(onDecorationPointer !== undefined ? { onDecorationPointer } : {}),
  });
  return { controller, container, componentRegistry, attrRegistry };
}

function leaves(controller: ReturnType<typeof setup>["controller"]): BlockId[] {
  const state = controller.editorState.document;
  const out: BlockId[] = [];
  const walk = (id: BlockId | null): void => {
    for (let cur = id; cur !== null; ) {
      const b = getBlock(state, cur);
      if (b === null) return;
      if (b.inlineContent !== null) out.push(b.id);
      else walk(b.firstChildId);
      cur = b.nextSiblingId;
    }
  };
  walk(getBlock(state, state.rootId)?.firstChildId ?? null);
  return out;
}

function caret(blockId: BlockId, offset: number): EditorAction {
  const p = createPosition(blockId, offset);
  return { type: "SET_SELECTION", selection: createSpan(p, p) };
}

/** "Anna met Rosa" / "in Berlin" */
function twoParas() {
  const env = setup();
  env.controller.dispatch({ type: "INSERT_TEXT", text: "Anna met Rosa" });
  env.controller.dispatch({ type: "SPLIT_NODE" });
  env.controller.dispatch({ type: "INSERT_TEXT", text: "in Berlin" });
  const [p1, p2] = leaves(env.controller);
  if (p1 === undefined || p2 === undefined) throw new Error("setup");
  return { ...env, p1, p2 };
}

const blockEl = (container: HTMLElement, id: BlockId): HTMLElement => {
  const el = container.querySelector(`[data-block-id="${id}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no element for ${id}`);
  return el;
};
function expectMatchesFullRender(env: ReturnType<typeof setup>): void {
  const expected = renderDocumentToDom(env.controller.editorState.document, env.componentRegistry, env.attrRegistry, document, {
    stampBlockIds: true,
    decorations: env.controller.decorations,
  });
  expect(env.container.innerHTML).toBe(expected.outerHTML);
}

const decoText = (container: HTMLElement, id: string): string =>
  Array.from(container.querySelectorAll(`[data-tw-deco="${id}"]`))
    .map((e) => e.textContent ?? "")
    .join("");

describe("digital decorations", () => {
  it("draws inline, widget and block decorations without changing offsets", () => {
    const { controller, container, p1, p2 } = twoParas();
    controller.setDecorations([
      { kind: "inline", id: "anna", from: createPosition(p1, 0), to: createPosition(p1, 4), class: "mention", style: { underline: { style: "wavy", color: "red" } }, attributes: { "data-ref": "r1", onclick: "x", "data-block-id": "evil" } },
      { kind: "widget", id: "ghost", at: createPosition(p2, 9), text: " and beyond" },
      { kind: "block", id: "flag", blockId: p2, class: "flagged" },
    ]);
    const span = container.querySelector('[data-tw-deco="anna"]');
    expect(span?.textContent).toBe("Anna");
    expect(span?.classList.contains("mention")).toBe(true);
    expect(span?.getAttribute("data-ref")).toBe("r1");
    expect(span?.hasAttribute("onclick")).toBe(false); // reserved / handler attributes are dropped
    expect(span?.getAttribute("style")).toContain("text-decoration-style: wavy");
    expect(blockEl(container, p2).classList.contains("flagged")).toBe(true);
    const widget = container.querySelector('[data-tw-widget][data-tw-deco="ghost"]');
    expect(widget?.textContent).toBe(" and beyond");
    expect(widget?.getAttribute("contenteditable")).toBe("false");

    // The caret at the end of p2 lands BEFORE the widget, and typing goes into the document only.
    controller.dispatch(caret(p2, 9));
    controller.dispatch({ type: "INSERT_TEXT", text: "!" });
    const p2Block = getBlock(controller.editorState.document, p2);
    const text = p2Block?.inlineContent?.items.map((i) => (i.kind === "text" ? i.text : "")).join("");
    expect(text).toBe("in Berlin!");
    // The widget (side 1 at the old end) stays after the typed text? No — typing AT its
    // position with side 1 moves it after the insertion.
    expect(controller.decorations.decorations.find((d) => d.id === "ghost")).toMatchObject({ at: { offset: 10 } });
  });

  it("keeps ranges attached through edits and re-renders only affected blocks", () => {
    const { controller, container, p1, p2 } = twoParas();
    controller.setDecorations([
      { kind: "inline", id: "rosa", from: createPosition(p1, 9), to: createPosition(p1, 13) },
      { kind: "inline", id: "berlin", from: createPosition(p2, 3), to: createPosition(p2, 9) },
    ]);
    const p2El = blockEl(container, p2);
    controller.dispatch(caret(p1, 0));
    controller.dispatch({ type: "INSERT_TEXT", text: "Then " });
    expect(decoText(container, "rosa")).toBe("Rosa");
    expect(blockEl(container, p2)).toBe(p2El); // untouched block's DOM kept by reference

    // Replacing the set with an equal one re-draws nothing.
    const p1El = blockEl(container, p1);
    controller.setDecorations([
      { kind: "inline", id: "rosa", from: createPosition(p1, 14), to: createPosition(p1, 18) },
      { kind: "inline", id: "berlin", from: createPosition(p2, 3), to: createPosition(p2, 9) },
    ]);
    expect(blockEl(container, p1)).toBe(p1El);

    // Deleting the decorated text removes the decoration.
    controller.dispatch({ type: "DELETE_RANGE", span: createSpan(createPosition(p2, 2), createPosition(p2, 9)) });
    expect(controller.decorations.decorations.map((d) => d.id)).toEqual(["rosa"]);
    expect(container.querySelector('[data-tw-deco="berlin"]')).toBeNull();
  });

  it("never rebuilds the block under an active IME composition; draws after it ends", () => {
    const { controller, container, p1 } = twoParas();
    const el = blockEl(container, p1);
    const text = el.querySelector("span")?.firstChild ?? el;
    window.getSelection()?.setBaseAndExtent(text, 1, text, 1);
    container.dispatchEvent(new CompositionEvent("compositionstart"));
    controller.setDecorations([{ kind: "inline", id: "anna", from: createPosition(p1, 0), to: createPosition(p1, 4) }]);
    expect(blockEl(container, p1)).toBe(el); // composition DOM untouched
    container.dispatchEvent(new CompositionEvent("compositionend", { data: "" }));
    expect(decoText(container, "anna")).toBe("Anna");
  });

  it("widgets are never copied", () => {
    const { controller, container, p1, p2 } = twoParas();
    controller.setDecorations([{ kind: "widget", id: "ghost", at: createPosition(p1, 4), text: "GHOST" }]);
    controller.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(p1, 0), createPosition(p2, 2)) });
    const data = new Map<string, string>();
    const event = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: { setData: (k: string, v: string) => data.set(k, v) } });
    container.dispatchEvent(event);
    expect(data.get("text/plain")).toBe("Anna met Rosa\nin");
    expect(data.get("text/html") ?? "").not.toContain("GHOST");
  });

  it("orders widgets by side, keeps them outside inline wrappers, and puts the caret between", () => {
    const { controller, container, p1 } = twoParas();
    controller.setDecorations([
      { kind: "inline", id: "anna", from: createPosition(p1, 0), to: createPosition(p1, 4), style: { backgroundColor: "red" } },
      { kind: "widget", id: "after", at: createPosition(p1, 4), text: "A" },
      { kind: "widget", id: "before", at: createPosition(p1, 4), side: -1, text: "B" },
    ]);
    const widgets = Array.from(container.querySelectorAll("[data-tw-widget]")).map((w) => w.getAttribute("data-tw-deco"));
    expect(widgets).toEqual(["before", "after"]);
    for (const w of Array.from(container.querySelectorAll("[data-tw-widget]"))) {
      expect(w.closest('[data-tw-deco="anna"]:not([data-tw-widget])')).toBeNull();
    }
    controller.dispatch(caret(p1, 4));
    const sel = window.getSelection();
    const range = sel?.getRangeAt(0);
    const probe = document.createElement("i");
    range?.insertNode(probe);
    // The caret sits after the side=-1 widget and before the side=1 widget.
    expect(probe.previousSibling instanceof HTMLElement && probe.previousSibling.getAttribute("data-tw-deco")).toBe("before");
    expect(probe.nextSibling instanceof HTMLElement && probe.nextSibling.getAttribute("data-tw-deco")).toBe("after");
    probe.remove();
  });

  it("ArrowRight hops the DOM caret over a widget so no keypress is dead", () => {
    const { controller, container, p1 } = twoParas();
    controller.setDecorations([{ kind: "widget", id: "w", at: createPosition(p1, 4), text: "W" }]);
    controller.dispatch(caret(p1, 4));
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    const sel = window.getSelection();
    const widget = container.querySelector("[data-tw-widget]");
    expect(sel?.focusNode).toBe(widget?.parentNode);
    expect(sel?.focusOffset).toBe(Array.prototype.indexOf.call(widget?.parentNode?.childNodes ?? [], widget) + 1);
  });

  it("refuses unsafe host attributes and style injection without breaking rendering", () => {
    const { controller, container, p1 } = twoParas();
    expect(() =>
      controller.setDecorations([
        {
          kind: "inline",
          id: "x",
          from: createPosition(p1, 0),
          to: createPosition(p1, 4),
          attributes: { "bad name": "1", "data-ok": "1" },
          style: { backgroundColor: "red; display: none" },
        },
      ]),
    ).not.toThrow();
    const span = container.querySelector('[data-tw-deco="x"]');
    expect(span?.getAttribute("data-ok")).toBe("1");
    expect(span?.getAttribute("style") ?? "").not.toContain("display");
  });

  it("draws block decorations on images and drops them with their block", () => {
    const env = twoParas();
    env.controller.dispatch(caret(env.p2, 9));
    env.controller.dispatch({ type: "INSERT_IMAGE", src: "data:image/png;base64,AA==", width: 10, height: 10 });
    const img = env.container.querySelector("img[data-block-id]");
    const imgId = img?.getAttribute("data-block-id");
    if (imgId == null) throw new Error("no image block");
    env.controller.setDecorations([
      { kind: "block", id: "fig", blockId: imgId as BlockId, class: "flagged" },
      { kind: "block", id: "p2", blockId: env.p2, class: "flagged" },
    ]);
    expect(env.container.querySelector("img")?.classList.contains("flagged")).toBe(true);
    env.controller.dispatch({ type: "DELETE_RANGE", span: createSpan(createPosition(env.p1, 13), createPosition(env.p2, 9)) });
    expect(env.controller.decorations.decorations.map((d) => d.id)).not.toContain("p2");
    expectMatchesFullRender(env);
  });

  it("comment and suggestion highlights follow edits", () => {
    const env = twoParas();
    const { controller, container, p1 } = env;
    controller.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(p1, 0), createPosition(p1, 4)) });
    controller.dispatch({ type: "ADD_COMMENT", id: "c1" as CommentId, author: "a", body: "b", createdAt: 1 });
    controller.setCommentHighlights([{ commentId: "c1" as CommentId, active: true }]);
    expect(decoText(container, "tw-comment:c1")).toBe("Anna");
    controller.dispatch(caret(p1, 0));
    controller.dispatch({ type: "INSERT_TEXT", text: "So " });
    // A marker is never a caret stop: the caret at (p1, 0) stands after the comment's
    // start marker, so typing there lands inside the comment (Word).
    expect(decoText(container, "tw-comment:c1")).toBe("So Anna");
    expect(container.querySelectorAll(".tw-comment-active").length).toBeGreaterThan(0);
    controller.clearCommentHighlights();
    expect(container.querySelectorAll(".tw-comment").length).toBe(0);
  });

  it("find / replace session: from the caret, live through edits, replace", () => {
    const { controller, container, p1, p2 } = twoParas();
    controller.dispatch(caret(p1, 6));
    // "n": Anna ×2 (before the caret), "in", "Berlin" → the first at/after the caret is #2.
    expect(controller.findStart("n")).toEqual({ total: 4, activeIndex: 2 });
    expect(container.querySelectorAll(".tw-find-active").length).toBe(1);
    expect(controller.findNext().activeIndex).toBe(3);
    controller.dispatch(caret(p2, 0));
    controller.dispatch({ type: "INSERT_TEXT", text: "n" });
    expect(controller.findStatus().total).toBe(5); // re-found after the edit
    controller.replaceAll("m");
    expect(controller.findStatus().total).toBe(0);
    expect(container.querySelectorAll(".tw-find").length).toBe(0);
    controller.findClose();
    expect(controller.findStatus()).toEqual({ total: 0, activeIndex: -1 });
  });

  it("decorations computed against an older State are mapped onto the current one", () => {
    const { controller, container, p1 } = twoParas();
    const basedOn = controller.editorState.document; // host snapshots, computes asynchronously…
    controller.dispatch(caret(p1, 0));
    controller.dispatch({ type: "INSERT_TEXT", text: "So " }); // …while the user types
    controller.setDecorations([{ kind: "inline", id: "rosa", from: createPosition(p1, 9), to: createPosition(p1, 13) }], basedOn);
    expect(decoText(container, "rosa")).toBe("Rosa"); // not "o Ro" (the raw offsets now)
  });

  it("built-in find and comment highlights draw through the same layer", () => {
    const { controller, container } = twoParas();
    const matches = findMatches(controller.editorState.document, "e");
    controller.setFindHighlights(matches, 1);
    expect(container.querySelectorAll(".tw-find").length).toBe(matches.length);
    expect(container.querySelectorAll(".tw-find-active").length).toBe(1);
    controller.clearFindHighlights();
    expect(container.querySelectorAll(".tw-find").length).toBe(0);
  });

  it("reports pointer enter / leave / click with the live decoration and rects", () => {
    const events: DecorationPointerEvent[] = [];
    const env = setup(undefined, (e) => events.push(e));
    env.controller.dispatch({ type: "INSERT_TEXT", text: "Anna" });
    const [p] = leaves(env.controller);
    if (p === undefined) throw new Error("setup");
    env.controller.setDecorations([{ kind: "inline", id: "anna", from: createPosition(p, 0), to: createPosition(p, 4), data: { refId: "r1" } }]);
    const span = env.container.querySelector('[data-tw-deco="anna"]');
    span?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    span?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    env.container.dispatchEvent(new MouseEvent("mouseleave"));
    expect(events.map((e) => e.type)).toEqual(["enter", "click", "leave"]);
    expect(events[0]?.decoration.data).toEqual({ refId: "r1" });
    expect(events[0]?.rects.length).toBeGreaterThan(0);

    // Removing a hovered decoration reports `leave` with its last-known snapshot.
    events.length = 0;
    env.container.querySelector('[data-tw-deco="anna"]')?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    env.controller.setDecorations([]);
    expect(events.map((e) => [e.type, e.decoration.id])).toEqual([["enter", "anna"], ["leave", "anna"]]);

    // Block decorations and widgets report too.
    events.length = 0;
    env.controller.setDecorations([
      { kind: "block", id: "blk", blockId: p },
      { kind: "widget", id: "wid", at: createPosition(p, 4), text: "W" },
    ]);
    env.container.querySelector("[data-tw-widget]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(events.map((e) => e.decoration.id).sort()).toEqual(["blk", "wid"]);
  });

  it("structural changes that hit the composed block are deferred, then fully applied", () => {
    const env = twoParas();
    const { controller, container, p1, p2 } = env;
    const text = blockEl(container, p2).querySelector("span")?.firstChild ?? blockEl(container, p2);
    window.getSelection()?.setBaseAndExtent(text, 1, text, 1);
    container.dispatchEvent(new CompositionEvent("compositionstart"));
    // A host edit removes the composed paragraph (merges it into p1).
    controller.dispatch({ type: "DELETE_RANGE", span: createSpan(createPosition(p1, 13), createPosition(p2, 0)) });
    expect(container.contains(text)).toBe(true); // composition DOM untouched
    container.dispatchEvent(new CompositionEvent("compositionend", { data: "" }));
    expectMatchesFullRender(env);
    const merged = p2; // a merge's survivor is the right paragraph R

    // A list run restructured around the composed item.
    controller.dispatch({ type: "SELECT_ALL" });
    controller.dispatch({ type: "TOGGLE_LIST", listType: "unordered" });
    controller.dispatch(caret(merged, 0));
    controller.dispatch({ type: "SPLIT_NODE" });
    const items = Array.from(container.querySelectorAll("li"));
    const composedText = items[1]?.querySelector("span")?.firstChild ?? items[1];
    if (composedText == null) throw new Error("setup");
    window.getSelection()?.setBaseAndExtent(composedText, 0, composedText, 0);
    container.dispatchEvent(new CompositionEvent("compositionstart"));
    controller.dispatch(caret(merged, 0));
    controller.dispatch({ type: "TOGGLE_LIST", listType: "unordered" }); // first item leaves the list
    container.dispatchEvent(new CompositionEvent("compositionend", { data: "" }));
    expectMatchesFullRender(env);
  });

  it.each([7, 42, 1234])("incremental DOM always equals a full re-render (randomized edits + decorations, seed %i)", (initialSeed) => {
    const env = setup();
    const { controller, container, componentRegistry, attrRegistry } = env;
    let seed = initialSeed;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const actions: Array<() => EditorAction> = [
      () => ({ type: "INSERT_TEXT", text: ["a", "Anna ", "xy", " "][rand(4)] ?? "a" }),
      () => ({ type: "SPLIT_NODE" }),
      () => ({ type: "DELETE_BACKWARD" }),
      () => ({ type: "TOGGLE_LIST", listType: rand(2) === 0 ? "ordered" : "unordered" }),
      () => ({ type: "LIST_INDENT" }),
      () => ({ type: "LIST_OUTDENT" }),
      () => ({ type: "UNDO" }),
      () => ({ type: "REDO" }),
      () => ({ type: "TOGGLE_STYLE", style: "bold" }),
      () => ({ type: "INSERT_TABLE", rows: 2, cols: 2 }),
      () => ({ type: "INSERT_HORIZONTAL_LINE" }),
      () => ({ type: "SET_BLOCK_TYPE", blockType: rand(2) === 0 ? "heading" : "paragraph", properties: { level: 2 } }),
      () => ({ type: "PASTE", text: "one\ntwo\nthree" }),
      () => ({ type: "DELETE_FORWARD" }),
      () => ({ type: "SECTION_BREAK" }),
      () => ({ type: "INSERT_IMAGE", src: "data:image/png;base64,AA==", width: 4, height: 4 }),
    ];
    for (let i = 0; i < 250; i++) {
      const ids = leaves(controller);
      const target = ids[rand(ids.length)];
      if (target !== undefined && rand(3) === 0) {
        const block = getBlock(controller.editorState.document, target);
        const len = (block?.inlineContent?.items ?? []).reduce((n, it) => n + (it.kind === "text" ? it.text.length : 1), 0);
        controller.dispatch(caret(target, rand(len + 1)));
      }
      const make = actions[rand(actions.length)];
      if (make !== undefined) controller.dispatch(make());
      if (i % 10 === 0) {
        const decos: Decoration[] = leaves(controller).flatMap((id, k) => {
          const block = getBlock(controller.editorState.document, id);
          const len = (block?.inlineContent?.items ?? []).reduce((n, it) => n + (it.kind === "text" ? it.text.length : 1), 0);
          const out: Decoration[] = [];
          if (len >= 2) out.push({ kind: "inline", id: `d${k}`, from: createPosition(id, 0), to: createPosition(id, 2), class: "c" });
          if (k % 2 === 0) out.push({ kind: "widget", id: `w${k}`, at: createPosition(id, len), text: "…" });
          if (k % 3 === 0) out.push({ kind: "widget", id: `v${k}`, at: createPosition(id, Math.min(1, len)), side: -1, text: "‹" });
          if (k % 4 === 1) out.push({ kind: "block", id: `b${k}`, blockId: id, class: "flag" });
          return out;
        });
        controller.setDecorations(decos);
      }
      const expected = renderDocumentToDom(controller.editorState.document, componentRegistry, attrRegistry, document, {
        stampBlockIds: true,
        decorations: controller.decorations,
      });
      const got = container.innerHTML;
      const want = expected.outerHTML;
      if (got !== want) {
        let k = 0;
        while (k < got.length && got[k] === want[k]) k++;
        expect(got.slice(Math.max(0, k - 200), k + 300), `after step ${i}`).toBe(want.slice(Math.max(0, k - 200), k + 300));
      }
    }
  }, 30_000);
});

describe("digital — stacked formatting suggestions", () => {
  it("renders the composite preview + both highlights; accept / undo of one keeps the other", () => {
    const componentRegistry = createDefaultComponentRegistry();
    const attrRegistry = createDefaultAttrRegistry();
    const base = { componentRegistry, attrRegistry, containerWidth: 800 };
    const alice = { ...base, suggestingAuthor: "alice", now: () => 1 };
    const bob = { ...base, suggestingAuthor: "bob", now: () => 2 };
    let editor = reduceEditor(createInitialEditorState(base), { type: "INSERT_TEXT", text: "abcdefgh" });
    const p = editor.selection.focus.blockId;
    const select = (a: number, b: number): EditorAction => ({ type: "SET_SELECTION", selection: createSpan(createPosition(p, a), createPosition(p, b)) });
    editor = reduceEditor(reduceEditor({ ...editor, config: alice }, select(0, 4)), { type: "TOGGLE_STYLE", style: "bold" });
    editor = reduceEditor(reduceEditor({ ...editor, config: bob }, select(2, 6)), { type: "TOGGLE_STYLE", style: "italic" });
    const ids = getSuggestions(editor.document).map((s) => s.id);
    const [a, b] = ids;
    if (a === undefined || b === undefined) throw new Error("expected two suggestions");

    const container = document.createElement("div");
    document.body.replaceChildren(container);
    const controller = createDigitalController({ container, componentRegistry, attrRegistry, doc: document, initialState: editor.document });
    controller.setSuggestionHighlights(ids.map((suggestionId) => ({ suggestionId, active: false })));
    /** [text, font-weight, font-style, color] of the styled text-run spans. */
    const looks = (): string[][] =>
      Array.from(container.querySelectorAll<HTMLElement>("span"))
        .filter((e) => e.style.whiteSpace !== "" && (e.textContent ?? "") !== "")
        .map((e) => [e.textContent ?? "", e.style.fontWeight, e.style.fontStyle, e.style.color]);
    const merged = (): string[][] => {
      const out: string[][] = [];
      for (const l of looks()) {
        const last = out[out.length - 1];
        if (last !== undefined && last.slice(1).join() === l.slice(1).join()) last[0] = `${last[0] ?? ""}${l[0] ?? ""}`;
        else out.push([...l]);
      }
      return out;
    };
    // Composite preview; the overlap is tinted by the newest suggestion's author.
    const before = merged();
    const aliceTint = before[0]?.[3] ?? "";
    const bobTint = before[2]?.[3] ?? "";
    expect(aliceTint).not.toBe("");
    expect(bobTint).not.toBe(aliceTint);
    expect(before).toEqual([
      ["ab", "bold", "", aliceTint],
      ["cd", "bold", "italic", bobTint],
      ["ef", "", "italic", bobTint],
      ["gh", "", "", ""],
    ]);
    expect(decoText(container, `tw-suggestion:${a}`)).toBe("abcd");
    expect(decoText(container, `tw-suggestion:${b}`)).toBe("cdef");

    controller.dispatch({ type: "ACCEPT_SUGGESTION", id: b });
    expect(merged()).toEqual([
      ["ab", "bold", "", aliceTint],
      ["cd", "bold", "italic", aliceTint],
      ["ef", "", "italic", ""],
      ["gh", "", "", ""],
    ]);
    expect(decoText(container, `tw-suggestion:${a}`)).toBe("abcd");
    expect(decoText(container, `tw-suggestion:${b}`)).toBe("");

    controller.dispatch({ type: "UNDO" });
    expect(decoText(container, `tw-suggestion:${b}`)).toBe("cdef");
    expect(merged()).toEqual(before);
    controller.destroy();
  });

  it("an embed-only formatting suggestion (a tab) is highlighted and previews on the embed", () => {
    const componentRegistry = createDefaultComponentRegistry();
    const attrRegistry = createDefaultAttrRegistry();
    const base = { componentRegistry, attrRegistry, containerWidth: 800 };
    const alice = { ...base, suggestingAuthor: "alice" };
    let editor = reduceEditor(createInitialEditorState(base), { type: "INSERT_TEXT", text: "ab" });
    editor = reduceEditor(editor, { type: "INSERT_TAB" });
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "cd" });
    const p = editor.selection.focus.blockId;
    editor = reduceEditor({ ...editor, config: alice }, { type: "SET_SELECTION", selection: createSpan(createPosition(p, 2), createPosition(p, 3)) });
    editor = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" });
    const [only] = getSuggestions(editor.document);
    if (only === undefined) throw new Error("expected a suggestion");

    const container = document.createElement("div");
    document.body.replaceChildren(container);
    const controller = createDigitalController({ container, componentRegistry, attrRegistry, doc: document, initialState: editor.document });
    controller.setSuggestionHighlights([{ suggestionId: only.id, active: false }]);
    const deco = container.querySelector<HTMLElement>(`[data-tw-deco="tw-suggestion:${only.id}"]`);
    expect(deco).not.toBeNull();
    // The band wraps exactly the tab, which previews the proposal with the author indicator.
    expect(deco?.textContent).toBe("");
    const tab = deco?.querySelector<HTMLElement>("[data-inline-embed]");
    expect([tab?.style.fontWeight, tab?.style.textDecorationLine]).toEqual(["bold", "underline"]);
    controller.destroy();
  });
});

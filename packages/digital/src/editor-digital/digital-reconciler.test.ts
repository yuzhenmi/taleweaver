import { describe, it, expect } from "vitest";
import {
  createEditor,
  type Editor,
  type EditorConfig, createDefaultComponentRegistry, createDefaultAttrRegistry, asBlockId, createPosition, createSpan, setBlockAttrs, paragraphComponent, createElementBox, getBlock } from "@taleweaver/core";
import { createDigitalReconciler } from "./digital-reconciler";

function makeEditor(): { editor: Editor; config: EditorConfig } {
  const componentRegistry = createDefaultComponentRegistry();
  const attrRegistry = createDefaultAttrRegistry();
  const config: EditorConfig = { componentRegistry, attrRegistry, containerWidth: 800 };
  return { editor: createEditor(config), config };
}

function type(editor: Editor, text: string): Editor {
  let cur = editor;
  for (const ch of text) cur.dispatch({ type: "INSERT_TEXT", text: ch });
  return cur;
}

/**
 * The stamped DOM nests the document ROOT (itself a `data-block-id` block) around the
 * paragraph blocks (verified against the engine: the `"document"` container renders to a
 * `<div data-block-id>` wrapping its children). So a bare
 * `container.querySelectorAll("[data-block-id]")` would also count the root. The
 * structural/incremental assertions below are about the BODY's paragraph blocks, so we
 * select the block elements INSIDE the root (excluding the root itself).
 */
function paraBlocks(container: HTMLElement): HTMLElement[] {
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) return [];
  return Array.from(root.querySelectorAll("[data-block-id]")).filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
}

describe("DigitalReconciler.mount (2c)", () => {
  it("full-renders the document and indexes block elements by data-block-id", () => {
    const { editor, config } = makeEditor();
    const typed = type(editor, "hi");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const r = createDigitalReconciler(config.componentRegistry, config.attrRegistry, document);
    r.mount(container, typed);
    const stamped = container.querySelectorAll("[data-block-id]");
    expect(stamped.length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain("hi");
  });
});

describe("DigitalReconciler.reconcile — incremental keying (2c)", () => {
  it("replaces the dirty block's element and leaves untouched blocks' elements by reference", () => {
    const { editor, config } = makeEditor();
    // Two paragraphs: "aa" <Enter> "bb".
    let st = type(editor, "aa");
    st.dispatch({ type: "SPLIT_NODE" });
    st = type(st, "bb");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const r = createDigitalReconciler(config.componentRegistry, config.attrRegistry, document);
    r.mount(container, st);

    const blocksBefore = paraBlocks(container);
    expect(blocksBefore.length).toBe(2);
    const firstElBefore = blocksBefore[0];
    const secondElBefore = blocksBefore[1];

    // Edit ONLY the second paragraph (append "c").
    st.dispatch({ type: "INSERT_TEXT", text: "c" });
    expect(st.lastDirtyIds).not.toBeNull();
    r.reconcile(st, st, false);

    const blocksAfter = paraBlocks(container);
    // First paragraph element is the SAME reference (untouched).
    expect(blocksAfter[0]).toBe(firstElBefore);
    // Second paragraph element was REPLACED (different reference) and shows "bbc".
    expect(blocksAfter[1]).not.toBe(secondElBefore);
    expect(blocksAfter[1]?.textContent).toContain("bbc");
  });

  it("replaces BOTH sibling blocks when both are independently dirty (no ancestor over-skip)", () => {
    // hasDirtyBlockAncestor must NOT skip a dirty block just because OTHER blocks are dirty —
    // only when a dirty block is its ANCESTOR. Two sibling paragraphs are not ancestors of each
    // other, so a cross-paragraph format toggle (which dirties both, leaving the root untouched)
    // must replace BOTH standalone. A regression that walked the whole dirty set instead of the
    // ancestor chain would wrongly skip the second sibling.
    const { editor, config } = makeEditor();
    let st = type(editor, "aa");
    st.dispatch({ type: "SPLIT_NODE" });
    st = type(st, "bb");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const r = createDigitalReconciler(config.componentRegistry, config.attrRegistry, document);
    r.mount(container, st);

    const blocksBefore = paraBlocks(container);
    expect(blocksBefore.length).toBe(2);
    const firstElBefore = blocksBefore[0];
    const secondElBefore = blocksBefore[1];
    const id1 = firstElBefore?.getAttribute("data-block-id");
    const id2 = secondElBefore?.getAttribute("data-block-id");
    if (id1 === null || id1 === undefined || id2 === null || id2 === undefined) {
      throw new Error("sibling block ids");
    }
    const rootId = container.firstElementChild?.getAttribute("data-block-id") ?? null;

    // Select across BOTH paragraphs and toggle bold — dirties both blocks, not the root.
    const span = createSpan(createPosition(asBlockId(id1), 0), createPosition(asBlockId(id2), 1));
    st.dispatch({ type: "SET_SELECTION", selection: span });
    st.dispatch({ type: "TOGGLE_STYLE", style: "bold" });
    expect(st.lastDirtyIds).not.toBeNull();
    expect(st.lastDirtyIds?.has(asBlockId(id1))).toBe(true);
    expect(st.lastDirtyIds?.has(asBlockId(id2))).toBe(true);
    // The root must NOT be dirty, so each sibling goes through the standalone replace path
    // (the case hasDirtyBlockAncestor governs), not a root parent-replace.
    if (rootId !== null) expect(st.lastDirtyIds?.has(asBlockId(rootId))).toBe(false);

    r.reconcile(st, st, false);

    const blocksAfter = paraBlocks(container);
    expect(blocksAfter.length).toBe(2);
    // BOTH sibling elements were replaced (neither was skipped).
    expect(blocksAfter[0]).not.toBe(firstElBefore);
    expect(blocksAfter[1]).not.toBe(secondElBefore);
    expect(blocksAfter[0]?.textContent).toContain("aa");
    expect(blocksAfter[1]?.textContent).toContain("bb");
  });

  it("skips the actively-composed block while isComposing (IME guard)", () => {
    const { editor, config } = makeEditor();
    const st = type(editor, "aa");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const r = createDigitalReconciler(config.componentRegistry, config.attrRegistry, document);
    r.mount(container, st);
    // Target the PARAGRAPH block (the leaf that an INSERT_TEXT actually dirties), not the root.
    const blocks = paraBlocks(container);
    const blockEl = blocks[0];
    if (!(blockEl instanceof HTMLElement)) throw new Error("block");
    // Put the browser focus inside that block, then reconcile with isComposing=true.
    const sel = window.getSelection();
    const textNode = blockEl.firstChild ?? blockEl;
    sel?.setBaseAndExtent(textNode, 0, textNode, 0);
    st.dispatch({ type: "INSERT_TEXT", text: "x" });
    // The composed paragraph IS in the dirty set; without the guard it would be replaced.
    const blockId = blockEl.getAttribute("data-block-id");
    if (blockId === null) throw new Error("block id");
    expect(st.lastDirtyIds?.has(asBlockId(blockId))).toBe(true);
    r.reconcile(st, st, true);
    // The composed block's element is NOT replaced (same reference) despite being dirty.
    expect(paraBlocks(container)[0]).toBe(blockEl);
    // Sanity: WITHOUT the IME guard the same dirty block WOULD be replaced.
    r.reconcile(st, st, false);
    expect(paraBlocks(container)[0]).not.toBe(blockEl);
  });
});

describe("DigitalReconciler.reconcile — structural deltas (F3)", () => {
  it("an INSERT (Enter splitting a paragraph) adds the new block's DOM via the parent-replace", () => {
    const { editor, config } = makeEditor();
    const st = type(editor, "aabb");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const r = createDigitalReconciler(config.componentRegistry, config.attrRegistry, document);
    r.mount(container, st);
    expect(paraBlocks(container).length).toBe(1);

    // Place caret mid-paragraph and split (Enter). This inserts a new block; its PARENT is dirty.
    st.dispatch({ type: "SPLIT_NODE" });
    r.reconcile(st, st, false);
    expect(paraBlocks(container).length).toBe(2);
  });

  it("an UNDO that REMOVES a block drops its DOM via the parent-replace", () => {
    const { editor, config } = makeEditor();
    let st = type(editor, "aa");
    st.dispatch({ type: "SPLIT_NODE" }); // now 2 blocks
    st = type(st, "bb");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const r = createDigitalReconciler(config.componentRegistry, config.attrRegistry, document);
    r.mount(container, st);
    expect(paraBlocks(container).length).toBe(2);

    // Undo the "bb" typing then undo the split → back to 1 block. Undo carries a real dirty set (F3).
    st.dispatch({ type: "UNDO" }); // undo bb
    r.reconcile(st, st, false);
    const afterFirstUndo = paraBlocks(container).length;
    st.dispatch({ type: "UNDO" }); // undo split → merge
    r.reconcile(st, st, false);
    expect(paraBlocks(container).length).toBeLessThanOrEqual(afterFirstUndo);
    expect(paraBlocks(container).length).toBe(1);
  });
});

describe("DigitalReconciler.reconcile — selection-only no-op (full-rebuild path)", () => {
  it("a SET_SELECTION (null dirty, same state) repositions DOM selection WITHOUT rebuilding the DOM", () => {
    const { editor, config } = makeEditor();
    const st = type(editor, "hi");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const r = createDigitalReconciler(config.componentRegistry, config.attrRegistry, document);
    r.mount(container, st);

    const rootBefore = container.firstElementChild;
    const childCountBefore = container.childNodes.length;
    const blockEl = paraBlocks(container)[0];
    const blockId = blockEl?.getAttribute("data-block-id");
    if (blockId === null || blockId === undefined) throw new Error("block id");

    // Move the caret only: SET_SELECTION yields a null dirty set with the state object unchanged.
    const caret = createPosition(asBlockId(blockId), 1);
    const prev = st.snapshot();
    st.dispatch({ type: "SET_SELECTION", selection: createSpan(caret, caret) });
    expect(st.lastDirtyIds).toBeNull();
    expect(st.document).toBe(prev.document);

    // Clear the live selection so we can prove positionToDom re-establishes it.
    window.getSelection()?.removeAllRanges();
    r.reconcile(prev, st, false);

    // No DOM rebuild: the root element and child set are the SAME references as before.
    expect(container.firstElementChild).toBe(rootBefore);
    expect(container.childNodes.length).toBe(childCountBefore);
    // positionToDom ran: a selection range was re-established inside the container.
    const sel = window.getSelection();
    expect(sel !== null && sel.rangeCount > 0).toBe(true);
    if (sel !== null && sel.focusNode !== null) {
      expect(container.contains(sel.focusNode)).toBe(true);
    }
  });
});

describe("DigitalReconciler.reconcile — host-hidden blocks", () => {
  it("a block a host component un-hides appears (the in-place fast path never skips a missing element)", () => {
    const { config } = makeEditor();
    // Host component: a paragraph with `attrs.hidden` renders display:none.
    const base = paragraphComponent;
    const render: typeof base.render = (view, ctx, inline) =>
      view.attrs.hidden === true ? createElementBox(view.id, { display: "none" }, []) : base.render(view, ctx, inline);
    config.componentRegistry.register({ ...base, render });
    let st = type(createEditor(config), "ab");
    st.dispatch({ type: "SPLIT_NODE" });
    st = type(st, "cd");
    const root = getBlock(st.document, st.document.rootId);
    const second = getBlock(st.document, root?.lastChildId ?? st.document.rootId)?.lastChildId; // root → final section → paragraphs
    if (second == null) throw new Error("setup");
    const hide = setBlockAttrs(st.document, second, { hidden: true });
    const hidden = { selection: st.selection, document: hide.document, lastDirtyIds: hide.dirtyIds };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const r = createDigitalReconciler(config.componentRegistry, config.attrRegistry, document);
    r.mount(container, hidden);
    expect(container.querySelector(`[data-block-id="${second}"]`)).toBeNull();
    const show = setBlockAttrs(hidden.document, second, { hidden: false });
    r.reconcile(hidden, { ...hidden, document: show.document, lastDirtyIds: show.dirtyIds }, false);
    expect(container.querySelector(`[data-block-id="${second}"]`)?.textContent).toBe("cd");
  });
});

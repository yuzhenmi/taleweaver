import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  asBlockId,
  createPosition,
  createSpan,
  type EditorState,
  type EditorConfig,
} from "@taleweaver/core";
import { createDigitalReconciler } from "./digital-reconciler";

function makeEditor(): { editor: EditorState; config: EditorConfig } {
  const componentRegistry = createDefaultComponentRegistry();
  const attrRegistry = createDefaultAttrRegistry();
  const config: EditorConfig = { componentRegistry, attrRegistry, containerWidth: 800 };
  return { editor: createInitialEditorState(config), config };
}

function type(editor: EditorState, config: EditorConfig, text: string): EditorState {
  let cur = editor;
  for (const ch of text) cur = reduceEditor(cur, { type: "INSERT_TEXT", text: ch }, config);
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
    const typed = type(editor, config, "hi");
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
    let st = type(editor, config, "aa");
    st = reduceEditor(st, { type: "SPLIT_NODE" }, config);
    st = type(st, config, "bb");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const r = createDigitalReconciler(config.componentRegistry, config.attrRegistry, document);
    r.mount(container, st);

    const blocksBefore = paraBlocks(container);
    expect(blocksBefore.length).toBe(2);
    const firstElBefore = blocksBefore[0];
    const secondElBefore = blocksBefore[1];

    // Edit ONLY the second paragraph (append "c").
    const next = reduceEditor(st, { type: "INSERT_TEXT", text: "c" }, config);
    expect(next.lastDirtyIds).not.toBeNull();
    r.reconcile(st, next, false);

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
    let st = type(editor, config, "aa");
    st = reduceEditor(st, { type: "SPLIT_NODE" }, config);
    st = type(st, config, "bb");
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
    const selected = reduceEditor(st, { type: "SET_SELECTION", selection: span }, config);
    const next = reduceEditor(selected, { type: "TOGGLE_STYLE", style: "bold" }, config);
    expect(next.lastDirtyIds).not.toBeNull();
    expect(next.lastDirtyIds?.has(asBlockId(id1))).toBe(true);
    expect(next.lastDirtyIds?.has(asBlockId(id2))).toBe(true);
    // The root must NOT be dirty, so each sibling goes through the standalone replace path
    // (the case hasDirtyBlockAncestor governs), not a root parent-replace.
    if (rootId !== null) expect(next.lastDirtyIds?.has(asBlockId(rootId))).toBe(false);

    r.reconcile(selected, next, false);

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
    const st = type(editor, config, "aa");
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
    const next = reduceEditor(st, { type: "INSERT_TEXT", text: "x" }, config);
    // The composed paragraph IS in the dirty set; without the guard it would be replaced.
    const blockId = blockEl.getAttribute("data-block-id");
    if (blockId === null) throw new Error("block id");
    expect(next.lastDirtyIds?.has(asBlockId(blockId))).toBe(true);
    r.reconcile(st, next, true);
    // The composed block's element is NOT replaced (same reference) despite being dirty.
    expect(paraBlocks(container)[0]).toBe(blockEl);
    // Sanity: WITHOUT the IME guard the same dirty block WOULD be replaced.
    r.reconcile(st, next, false);
    expect(paraBlocks(container)[0]).not.toBe(blockEl);
  });
});

describe("DigitalReconciler.reconcile — structural deltas (F3)", () => {
  it("an INSERT (Enter splitting a paragraph) adds the new block's DOM via the parent-replace", () => {
    const { editor, config } = makeEditor();
    const st = type(editor, config, "aabb");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const r = createDigitalReconciler(config.componentRegistry, config.attrRegistry, document);
    r.mount(container, st);
    expect(paraBlocks(container).length).toBe(1);

    // Place caret mid-paragraph and split (Enter). This inserts a new block; its PARENT is dirty.
    const next = reduceEditor(st, { type: "SPLIT_NODE" }, config);
    r.reconcile(st, next, false);
    expect(paraBlocks(container).length).toBe(2);
  });

  it("an UNDO that REMOVES a block drops its DOM via the parent-replace", () => {
    const { editor, config } = makeEditor();
    let st = type(editor, config, "aa");
    st = reduceEditor(st, { type: "SPLIT_NODE" }, config); // now 2 blocks
    st = type(st, config, "bb");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const r = createDigitalReconciler(config.componentRegistry, config.attrRegistry, document);
    r.mount(container, st);
    expect(paraBlocks(container).length).toBe(2);

    // Undo the "bb" typing then undo the split → back to 1 block. Undo carries a real dirty set (F3).
    const undone = reduceEditor(st, { type: "UNDO" }, config); // undo bb
    r.reconcile(st, undone, false);
    const afterFirstUndo = paraBlocks(container).length;
    const undone2 = reduceEditor(undone, { type: "UNDO" }, config); // undo split → merge
    r.reconcile(undone, undone2, false);
    expect(paraBlocks(container).length).toBeLessThanOrEqual(afterFirstUndo);
    expect(paraBlocks(container).length).toBe(1);
  });
});

describe("DigitalReconciler.reconcile — selection-only no-op (full-rebuild path)", () => {
  it("a SET_SELECTION (null dirty, same state) repositions DOM selection WITHOUT rebuilding the DOM", () => {
    const { editor, config } = makeEditor();
    const st = type(editor, config, "hi");
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
    const next = reduceEditor(st, { type: "SET_SELECTION", selection: createSpan(caret, caret) }, config);
    expect(next.lastDirtyIds).toBeNull();
    expect(next.state).toBe(st.state);

    // Clear the live selection so we can prove positionToDom re-establishes it.
    window.getSelection()?.removeAllRanges();
    r.reconcile(st, next, false);

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

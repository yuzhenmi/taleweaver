import * as Y from "yjs";
import { describe, it, expect } from "vitest";
import {
  buildDocumentFromTree,
  createTestAllocator,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createEditorStateFromDocument,
  createPosition,
  createDocument,
  createSpan,
  getBlock,
  getYDoc,
  reduceEditor,
  type BlockId,
  type ContainerBlockNode,
  report,
  resetPerfTrace,
  setPerfTraceEnabled,
} from "@taleweaver/core";
import { createDigitalController } from "../editor-digital/digital-controller";

/**
 * Selected-¶ indicator gate: Shift+Down 50 times from a 1-page selection and from a
 * 100-page selection of the same ~100-page document (1,000 × 50-word paragraphs). Each step
 * goes through the real path — the DOM selection is extended one paragraph and
 * `selectionchange` fires — and must touch ONE ¶ indicator and walk a constant number of
 * blocks, the same at both sizes (deterministic: `digital.selectedParagraph` /
 * `digital.selectedParagraphWalk` counts from the perf trace; no DOM block is re-rendered). Median ms per step is logged, not asserted (jsdom on a loaded machine is
 * noisy).
 */
const STEPS = 50;

function chapter(paragraphs: number): ContainerBlockNode {
  const words = "the quick brown fox jumps over a lazy dog while Anna watches".split(" ");
  return {
    type: "document",
    children: Array.from({ length: paragraphs }, (_, p) => ({
      type: "paragraph",
      inlineContent: { items: [{ kind: "text" as const, text: Array.from({ length: 50 }, (_, w) => words[(p + w) % words.length]).join(" "), attrs: {} }] },
    })),
  };
}

const caret = (id: BlockId, o: number) => createSpan(createPosition(id, o), createPosition(id, o));
const countOf = (label: string): number => report().entries.find((e) => e.label === label)?.count ?? 0;

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Select paragraphs [0, from) and Shift+Down `STEPS` times; per-step touches / renders / ms. */
function shiftDown(from: number): { touched: number[]; walked: number[]; rendered: number; medianMs: number; selected: number } {
  const container = globalThis.document.createElement("div");
  globalThis.document.body.replaceChildren(container);
  const controller = createDigitalController({
    container,
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    initialDocument: buildDocumentFromTree(chapter(1000), {}, createTestAllocator(), createDefaultComponentRegistry()),
    doc: globalThis.document,
  });
  const document = controller.editorState.document;
  // The root's children are sections: the body is the final section.
  const body = getBlock(document, getBlock(document, document.rootId)?.lastChildId ?? document.rootId);
  const ids: BlockId[] = [];
  for (let id = body?.firstChildId ?? null; id !== null; id = getBlock(document, id)?.nextSiblingId ?? null) ids.push(id);
  const at = (i: number): BlockId => {
    const id = ids[i];
    if (id === undefined) throw new Error("setup");
    return id;
  };
  controller.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(at(0), 0), createPosition(at(from), 0)) });
  const text = (i: number): Text => {
    const t = container.querySelector(`[data-block-id="${at(i)}"]`)?.querySelector("span")?.firstChild;
    if (!(t instanceof Text)) throw new Error("text");
    return t;
  };
  const sel = window.getSelection();
  if (sel === null) throw new Error("no selection");
  const touched: number[] = [];
  const walked: number[] = [];
  const samples: number[] = [];
  let rendered = 0;
  for (let step = 1; step <= STEPS; step++) {
    const anchorText = text(0);
    const focusText = text(from + step); // (the harness's DOM lookups stay outside the timing)
    resetPerfTrace();
    setPerfTraceEnabled(true);
    const t = performance.now();
    try {
      sel.setBaseAndExtent(anchorText, 0, focusText, 0); // Shift+Down: the focus moves one paragraph
      globalThis.document.dispatchEvent(new Event("selectionchange"));
    } finally {
      samples.push(performance.now() - t);
      setPerfTraceEnabled(false);
    }
    touched.push(countOf("digital.selectedParagraph"));
    walked.push(countOf("digital.selectedParagraphWalk"));
    rendered += countOf("digital.renderBlock");
  }
  expect(controller.editorState.selection.focus).toEqual(createPosition(at(from + STEPS), 0));
  const selected = container.querySelectorAll(".tw-selected").length;
  controller.destroy();
  return { touched, walked, rendered, medianMs: median(samples), selected };
}

describe("digital selected-¶ latency (Shift+Down, 1-page vs 100-page selection)", () => {
  it("touches one ¶ per step at both sizes", () => {
    const small = shiftDown(10);
    const large = shiftDown(900);
    console.log(`Shift+Down median ${small.medianMs.toFixed(2)}ms (1-page selection) vs ${large.medianMs.toFixed(2)}ms (100-page selection)`);
    expect(small.touched).toEqual(Array.from({ length: STEPS }, () => 1));
    expect(large.touched).toEqual(small.touched);
    // The model walk is the changed blocks too, never the selection.
    expect(Math.max(...small.walked)).toBeLessThanOrEqual(4);
    expect(large.walked).toEqual(small.walked);
    expect(small.rendered).toBe(0);
    expect(large.rendered).toBe(0);
    expect(small.selected).toBe(10 + STEPS);
    expect(large.selected).toBe(900 + STEPS);
  }, 120_000);
});

describe("digital selected-¶ under a peer's edit", () => {
  it("a remote keystroke while a 900-paragraph selection is held walks a constant number of blocks", () => {
    const cfg = { componentRegistry: createDefaultComponentRegistry(), attrRegistry: createDefaultAttrRegistry(), containerWidth: 800 };
    const documentA = buildDocumentFromTree(chapter(1000), {}, createTestAllocator(), createDefaultComponentRegistry());
    const body = getBlock(documentA, getBlock(documentA, documentA.rootId)?.lastChildId ?? documentA.rootId);
    const ids: BlockId[] = [];
    for (let id = body?.firstChildId ?? null; id !== null; id = getBlock(documentA, id)?.nextSiblingId ?? null) ids.push(id);
    const at = (i: number): BlockId => {
      const id = ids[i];
      if (id === undefined) throw new Error("setup");
      return id;
    };
    let peer = createEditorStateFromDocument(documentA, caret(at(450), 3), cfg);
    const docA = getYDoc(documentA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    docA.on("update", (u: Uint8Array) => Y.applyUpdate(docB, u, "provider"));
    const container = document.createElement("div");
    document.body.replaceChildren(container);
    const controller = createDigitalController({
      container,
      componentRegistry: createDefaultComponentRegistry(),
      attrRegistry: createDefaultAttrRegistry(),
      initialDocument: createDocument({ resolver: createDefaultComponentRegistry(), rootId: documentA.rootId, doc: docB }),
      doc: document,
    });
    controller.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(at(0), 0), createPosition(at(900), 0)) });
    const walks: number[] = [];
    for (const [i, text] of [[450, "x"], [0, "y"], [900, "z"], [950, "w"]] as const) {
      peer = reduceEditor(peer, { type: "SET_SELECTION", selection: caret(at(i), 3) });
      resetPerfTrace();
      setPerfTraceEnabled(true);
      try {
        peer = reduceEditor(peer, { type: "INSERT_TEXT", text });
      } finally {
        setPerfTraceEnabled(false);
      }
      walks.push(countOf("digital.selectedParagraphWalk"));
    }
    // A peer's Enter inside the selection: the new ¶ is selected, without a selection walk.
    peer = reduceEditor(peer, { type: "SET_SELECTION", selection: caret(at(300), 3) });
    resetPerfTrace();
    setPerfTraceEnabled(true);
    try {
      peer = reduceEditor(peer, { type: "SPLIT_NODE" });
    } finally {
      setPerfTraceEnabled(false);
    }
    walks.push(countOf("digital.selectedParagraphWalk"));
    expect(container.querySelectorAll(".tw-selected").length).toBe(901);
    // The peer removes the anchor's paragraph (merging it into the next): the anchor maps
    // to the survivor, without a selection walk.
    peer = reduceEditor(peer, { type: "SET_SELECTION", selection: createSpan(createPosition(at(0), 0), createPosition(at(1), 0)) });
    resetPerfTrace();
    setPerfTraceEnabled(true);
    try {
      peer = reduceEditor(peer, { type: "DELETE_BACKWARD" });
    } finally {
      setPerfTraceEnabled(false);
    }
    walks.push(countOf("digital.selectedParagraphWalk"));
    expect(getBlock(controller.editorState.document, at(0))).toBeNull();
    expect(controller.editorState.selection.anchor.blockId).toBe(at(1));
    console.log(`selected-¶ walk per remote change, 900-paragraph selection: ${walks.join(", ")}`);
    expect(container.textContent).toContain("x");
    expect(Math.max(...walks)).toBeLessThanOrEqual(8);
    expect(container.querySelectorAll(".tw-selected").length).toBe(900);
    controller.destroy();
  }, 120_000);
});

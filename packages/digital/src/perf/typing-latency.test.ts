import { describe, it, expect } from "vitest";
import {
  buildDocumentFromTree,
  createTestAllocator,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createPosition,
  createSpan,
  getBlock,
  type BlockId,
  type ContainerBlockNode,
  type Decoration,
  type CommentId,
} from "@taleweaver/core";
import { createDigitalController, type DigitalController } from "../editor-digital/digital-controller";

/**
 * Typing-latency budget: a 20,000-word chapter (400 × 50-word paragraphs) with
 * 1,000 inline decorations. Budget: median keystroke dispatch ≤ 16 ms and a one-decoration
 * update ≤ 16 ms under jsdom (a real browser is several times faster). Guards against any
 * regression back to whole-document re-rendering.
 */
const BUDGET_MS = 16;

function chapter(paragraphs = 400): ContainerBlockNode {
  const words = "the quick brown fox jumps over a lazy dog while Anna watches".split(" ");
  const children = Array.from({ length: paragraphs }, (_, p) => ({
    type: "paragraph",
    inlineContent: {
      items: [{ kind: "text" as const, text: Array.from({ length: 50 }, (_, w) => words[(p + w) % words.length]).join(" "), attrs: {} }],
    },
  }));
  return { type: "document", children };
}

function paragraphIds(controller: DigitalController): BlockId[] {
  const state = controller.editorState.state;
  const out: BlockId[] = [];
  for (let id = getBlock(state, state.rootId)?.firstChildId ?? null; id !== null; id = getBlock(state, id)?.nextSiblingId ?? null) out.push(id);
  return out;
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

describe("digital typing latency (20k words, 1,000 decorations)", () => {
  it("stays within budget for keystrokes and decoration updates", () => {
    const container = document.createElement("div");
    document.body.replaceChildren(container);
    const controller = createDigitalController({
      container,
      componentRegistry: createDefaultComponentRegistry(),
      attrRegistry: createDefaultAttrRegistry(),
      initialState: buildDocumentFromTree(chapter(), {}, createTestAllocator()),
      doc: document,
    });
    const ids = paragraphIds(controller);
    const decorations: Decoration[] = [];
    ids.forEach((id, p) => {
      for (const start of [4, 40, 120].slice(0, p % 2 === 0 ? 3 : 2)) {
        decorations.push({ kind: "inline", id: `e${p}:${start}`, from: createPosition(id, start), to: createPosition(id, start + 5), class: "mention" });
      }
    });
    expect(decorations.length).toBe(1000);
    controller.setDecorations(decorations);
    const target = ids[200];
    if (target === undefined) throw new Error("setup");
    const caret = createPosition(target, 10);
    controller.dispatch({ type: "SET_SELECTION", selection: createSpan(caret, caret) });

    const typing: number[] = [];
    for (let i = 0; i < 60; i++) {
      const t = performance.now();
      controller.dispatch({ type: "INSERT_TEXT", text: "x" });
      typing.push(performance.now() - t);
    }
    const updates: number[] = [];
    for (let i = 0; i < 30; i++) {
      const next = decorations.map((d, k) => (k === 500 ? { ...d, class: `mention v${i}` } : d));
      const t = performance.now();
      controller.setDecorations(next);
      updates.push(performance.now() - t);
    }
    console.log(`typing median ${median(typing).toFixed(2)}ms; decoration update median ${median(updates).toFixed(2)}ms`);
    expect(median(typing)).toBeLessThan(BUDGET_MS);
    expect(median(updates)).toBeLessThan(BUDGET_MS);
    expect(controller.decorations.decorations.length).toBe(1000);
    controller.destroy();
  });

  it("stays within budget on a ~100-page document with comment highlights shown", () => {
    const container = document.createElement("div");
    document.body.replaceChildren(container);
    const controller = createDigitalController({
      container,
      componentRegistry: createDefaultComponentRegistry(),
      attrRegistry: createDefaultAttrRegistry(),
      initialState: buildDocumentFromTree(chapter(1000), {}, createTestAllocator()),
      doc: document,
    });
    const ids = paragraphIds(controller);
    const first = ids[0];
    const target = ids[500];
    if (first === undefined || target === undefined) throw new Error("setup");
    controller.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(first, 0), createPosition(first, 9)) });
    controller.dispatch({ type: "ADD_COMMENT", id: "c" as CommentId, author: "a", body: "b", createdAt: 1 });
    controller.setCommentHighlights([{ commentId: "c" as CommentId, active: false }]);
    controller.setDecorations(ids.slice(0, 1000).map((id, k) => ({ kind: "inline", id: `d${k}`, from: createPosition(id, 4), to: createPosition(id, 9) })));
    const caret = createPosition(target, 10);
    controller.dispatch({ type: "SET_SELECTION", selection: createSpan(caret, caret) });
    const typing: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t = performance.now();
      controller.dispatch({ type: "INSERT_TEXT", text: "x" });
      typing.push(performance.now() - t);
    }
    console.log(`100-page typing median ${median(typing).toFixed(2)}ms`);
    expect(median(typing)).toBeLessThan(BUDGET_MS);
    controller.destroy();
  });
});

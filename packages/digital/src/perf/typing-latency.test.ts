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
  report,
  resetPerfTrace,
  setPerfTraceEnabled,
} from "@taleweaver/core";
import { createDigitalController, type DigitalController } from "../editor-digital/digital-controller";

const TEST_RESOLVER = createDefaultComponentRegistry();

/**
 * Typing-latency gate (digital backend): a 20,000-word chapter (400 × 50-word paragraphs)
 * with 1,000 inline decorations, and a ~100-page document with comment highlights.
 *
 * The REAL gate is deterministic — per-operation counts from the perf trace, independent
 * of machine load:
 *  - per keystroke: `render.blockBody` ≤ 10 (the edited block; a whole-document
 *    re-render is 400+), `digital.renderBlock` ≤ 5 (DOM for the edited block only),
 *    `decorations.mapped` ≤ 10 (the edited block's decorations; all = 1,000);
 *  - per one-decoration `setDecorations`: `digital.renderBlock` ≤ 3 (only the block whose
 *    decoration changed is redrawn) and no core render.
 * Wall-clock checks are COARSE backstops only (jsdom on a shared, loaded machine is
 * noisy): median keystroke / decoration update ≤ 100 ms (measured a few ms; a
 * whole-document re-render costs far more).
 */
const BACKSTOP_MS = 100;
const PER_KEYSTROKE = { blocksRendered: 10, domBlocks: 5, decorationsMapped: 10 };
const DOM_BLOCKS_PER_UPDATE = 3;

const countOf = (label: string): number => report().entries.find((e) => e.label === label)?.count ?? 0;

/** Run `fn` `times` times with the perf trace on; per-run counts of the gate's labels. */
function counted(times: number, fn: (i: number) => void): { samples: number[]; blocksRendered: number; domBlocks: number; decorationsMapped: number } {
  const samples: number[] = [];
  resetPerfTrace();
  setPerfTraceEnabled(true);
  try {
    for (let i = 0; i < times; i++) {
      const t = performance.now();
      fn(i);
      samples.push(performance.now() - t);
    }
  } finally {
    setPerfTraceEnabled(false);
  }
  return {
    samples,
    blocksRendered: countOf("render.blockBody") / times,
    domBlocks: countOf("digital.renderBlock") / times,
    decorationsMapped: countOf("decorations.mapped") / times,
  };
}

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
  const document = controller.editorState.document;
  const out: BlockId[] = [];
  // The root's children are sections: a break-less document's body is its final section.
  const body = getBlock(document, getBlock(document, document.rootId)?.lastChildId ?? document.rootId);
  for (let id = body?.firstChildId ?? null; id !== null; id = getBlock(document, id)?.nextSiblingId ?? null) out.push(id);
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
      initialDocument: buildDocumentFromTree(chapter(), {}, createTestAllocator(), TEST_RESOLVER),
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

    const typing = counted(60, () => controller.dispatch({ type: "INSERT_TEXT", text: "x" }));
    const updates = counted(30, (i) =>
      controller.setDecorations(decorations.map((d, k) => (k === 500 ? { ...d, class: `mention v${i}` } : d))),
    );
    console.log(
      `typing median ${median(typing.samples).toFixed(2)}ms ${JSON.stringify({ ...typing, samples: undefined })}; ` +
        `decoration update median ${median(updates.samples).toFixed(2)}ms ${JSON.stringify({ ...updates, samples: undefined })}`,
    );
    // Liveness first: a renamed / silent trace label must not pass a budget vacuously.
    expect(typing.decorationsMapped).toBeGreaterThan(0);
    expect(typing.blocksRendered).toBeGreaterThan(0);
    expect(typing.blocksRendered).toBeLessThanOrEqual(PER_KEYSTROKE.blocksRendered);
    expect(typing.domBlocks).toBeGreaterThan(0);
    expect(typing.domBlocks).toBeLessThanOrEqual(PER_KEYSTROKE.domBlocks);
    expect(typing.decorationsMapped).toBeLessThanOrEqual(PER_KEYSTROKE.decorationsMapped);
    expect(updates.domBlocks).toBeGreaterThan(0);
    expect(updates.domBlocks).toBeLessThanOrEqual(DOM_BLOCKS_PER_UPDATE);
    expect(updates.blocksRendered).toBe(0); // `render.blockBody` is proven live by the keystroke run above
    expect(median(typing.samples)).toBeLessThan(BACKSTOP_MS);
    expect(median(updates.samples)).toBeLessThan(BACKSTOP_MS);
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
      initialDocument: buildDocumentFromTree(chapter(1000), {}, createTestAllocator(), TEST_RESOLVER),
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
    const typing = counted(40, () => controller.dispatch({ type: "INSERT_TEXT", text: "x" }));
    console.log(`100-page typing median ${median(typing.samples).toFixed(2)}ms ${JSON.stringify({ ...typing, samples: undefined })}`);
    expect(typing.blocksRendered).toBeGreaterThan(0);
    expect(typing.blocksRendered).toBeLessThanOrEqual(PER_KEYSTROKE.blocksRendered);
    expect(typing.domBlocks).toBeGreaterThan(0);
    expect(typing.domBlocks).toBeLessThanOrEqual(PER_KEYSTROKE.domBlocks);
    expect(typing.decorationsMapped).toBeGreaterThan(0);
    expect(typing.decorationsMapped).toBeLessThanOrEqual(PER_KEYSTROKE.decorationsMapped);
    expect(median(typing.samples)).toBeLessThan(BACKSTOP_MS);
    controller.destroy();
  });
});

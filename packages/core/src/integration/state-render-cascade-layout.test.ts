/**
 * Integration: state → render → cascade → layout pipeline end-to-end.
 *
 * Pre-R-C, every existing integration test started from a hand-built
 * RenderNode tree (`createElementBox` / `createTextBox` directly),
 * skipping the new render module entirely. The render audit's C3 finding
 * flagged this gap — there was no test confirming that `render()`'s
 * output is valid input for `cascadePass` + `layoutTree`.
 *
 * This file exercises the full pipeline starting from a Y.Doc-backed
 * State that contains a realistic mix of block kinds and inline content:
 *
 *   document
 *   ├── paragraph: "hello world"
 *   ├── heading: "title"
 *   ├── list (container)
 *   │   ├── list-item: "first"
 *   │   └── list-item: "second"
 *   ├── image (atomic leaf, no width/height → auto sizing)
 *   └── paragraph: "" (empty — strut sentinel territory)
 *
 * Each test asserts the pipeline produces a valid LayoutBox tree
 * without throwing. Content-correctness checks confirm specific
 * payloads survive end-to-end.
 */
import { describe, it, expect } from "vitest";
import { buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";
import { render } from "../render/render";
import { cascadePass } from "../cascade";
import { layoutTree } from "../layout/dispatch";
import { resolvePositionedTree } from "../layout/positioned-tree";
import { createMockShaper } from "../layout/mock-shaper";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import {
  createInitialEditorState,
  reduceEditor,
  getBlock,
  createPosition,
  createSpan,
  type EditorConfig,
} from "../index";
import type { LayoutBox } from "../layout/layout-node";
import type { RenderNode } from "../render/render-node";

const shaper = createMockShaper(8, 16);
const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();

function buildRealisticDoc() {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "p1",
        lastChildId: "p2",
      }),
      buildBlock({
        id: "p1",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "h",
        inlineContent: inlineContent([text("hello world")]),
      }),
      buildBlock({
        id: "h",
        type: "heading",
        parentId: "doc",
        prevSiblingId: "p1",
        nextSiblingId: "list",
        attrs: { headingLevel: 1 },
        inlineContent: inlineContent([text("title")]),
      }),
      buildBlock({
        id: "list",
        type: "list",
        parentId: "doc",
        prevSiblingId: "h",
        nextSiblingId: "img",
        firstChildId: "li1",
        lastChildId: "li2",
      }),
      buildBlock({
        id: "li1",
        type: "list-item",
        parentId: "list",
        nextSiblingId: "li2",
        inlineContent: inlineContent([text("first")]),
      }),
      buildBlock({
        id: "li2",
        type: "list-item",
        parentId: "list",
        prevSiblingId: "li1",
        inlineContent: inlineContent([text("second")]),
      }),
      buildBlock({
        id: "img",
        type: "image",
        parentId: "doc",
        prevSiblingId: "list",
        nextSiblingId: "p2",
        attrs: { src: "/x.png" },
      }),
      buildBlock({
        id: "p2",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "img",
        inlineContent: inlineContent([]),
      }),
    ],
  });
}

function collectText(box: LayoutBox): string {
  if (box.type === "text-run") return box.text;
  if ("children" in box) {
    return box.children.map(collectText).join("");
  }
  return "";
}

describe("Integration: state → render → cascade → layout (R-C)", () => {
  it("pipes a realistic doc through render() → cascadePass → layoutTree without throwing", () => {
    const state = buildRealisticDoc();
    expect(() => {
      const renderOutput = render(state, componentRegistry, attrRegistry);
      const cascaded = cascadePass(renderOutput.root);
      layoutTree(cascaded, 800, shaper);
    }).not.toThrow();
  });

  it("layout output preserves the inline text content from state", () => {
    const state = buildRealisticDoc();
    const renderOutput = render(state, componentRegistry, attrRegistry);
    const layout = resolvePositionedTree(layoutTree(renderOutput.root, 800, shaper));
    const collected = collectText(layout);
    // Each leaf block's inline text must reach the layout tree as TextRunBoxes.
    expect(collected).toContain("hello world");
    expect(collected).toContain("title");
    expect(collected).toContain("first");
    expect(collected).toContain("second");
  });

  it("cascadePass fills computedStyle into render nodes that render() left undefined (A1)", () => {
    // R-B's A1 fix removed the pre-fill of `computedStyle` on inline
    // RenderNodes. The pipeline contract is that cascadePass fills the
    // field in before layout reads it. Pre-cascade, inline TextBoxes
    // have `computedStyle === undefined`; post-cascade, every RenderNode
    // in the tree carries it.
    const state = buildRealisticDoc();
    const renderOutput = render(state, componentRegistry, attrRegistry);

    // Pre-cascade: walk the tree, find any TextBox, confirm
    // computedStyle is undefined (A1's contract).
    function findFirstText(node: RenderNode): RenderNode | null {
      if (node.type === "text") return node;
      for (const child of node.children) {
        const found = findFirstText(child);
        if (found !== null) return found;
      }
      return null;
    }
    const preCascadeText = findFirstText(renderOutput.root);
    expect(preCascadeText).not.toBeNull();
    expect(preCascadeText?.computedStyle).toBeUndefined();

    // Post-cascade: cascadePass must fill every node's computedStyle.
    const cascaded = cascadePass(renderOutput.root);
    expect(cascaded.computedStyle).toBeDefined();
    const postCascadeText = findFirstText(cascaded);
    expect(postCascadeText?.computedStyle).toBeDefined();
  });

  it("atomic-leaf image lays out without inline-bearing strut leakage (A5)", () => {
    // R-B's A5 ensures atomic leaves receive [] from render() instead of
    // a strut sentinel. The layout pass for the image block must
    // therefore NOT contain a phantom empty text-run child for the
    // strut. Find the image's LayoutBox by key and confirm its
    // descendants contain no empty-string TextRunBox attributable to
    // a leaked strut sentinel.
    const state = buildRealisticDoc();
    const renderOutput = render(state, componentRegistry, attrRegistry);
    const layout = resolvePositionedTree(layoutTree(renderOutput.root, 800, shaper));

    function findEmptyStrutTextRuns(box: LayoutBox, fromImg: boolean): number {
      if (box.type === "text-run" && fromImg && box.text === "") return 1;
      if ("children" in box) {
        const nowFromImg = fromImg || box.key === "img";
        return box.children.reduce<number>(
          (acc, child) => acc + findEmptyStrutTextRuns(child, nowFromImg),
          0,
        );
      }
      return 0;
    }
    expect(findEmptyStrutTextRuns(layout, false)).toBe(0);
  });

  it("empty paragraph produces a strut line via the inline-bearing-leaf path", () => {
    // R-B's A5 keeps the strut sentinel for inline-bearing leaves. An
    // empty paragraph (p2) must still produce a visible empty line in
    // the layout tree (so the cursor has a vertical slot to sit on).
    const state = buildRealisticDoc();
    const renderOutput = render(state, componentRegistry, attrRegistry);
    const layout = resolvePositionedTree(layoutTree(renderOutput.root, 800, shaper));

    function findBlock(box: LayoutBox, key: string): LayoutBox | null {
      if (box.key === key) return box;
      if ("children" in box) {
        for (const child of box.children) {
          const found = findBlock(child, key);
          if (found !== null) return found;
        }
      }
      return null;
    }
    const p2 = findBlock(layout, "p2");
    expect(p2).not.toBeNull();
    // p2 should still have non-zero block-size (line-height of one strut line)
    // — the IFC must have produced at least one line box. `blockSize` lives on
    // the LayoutBox itself, not under `usedStyle`.
    if (p2 !== null) {
      expect(p2.blockSize).toBeGreaterThan(0);
    }
  });

  it("SET_TEXT_COLOR threads color attr → colorInterpreter → ComputedStyle.color end-to-end", () => {
    // End-to-end: dispatch SET_TEXT_COLOR over a selection, then run the
    // full render() → cascadePass pipeline and confirm the cascaded
    // ComputedStyle.color on the affected text node is the dispatched
    // value (the canvas renderer reads exactly this as the glyph
    // fillStyle).
    const config: EditorConfig = {
      measurer: shaper,
      componentRegistry,
      attrRegistry,
      containerWidth: 800,
    };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "color me" }, config);
    const pId = (() => {
      const root = getBlock(editor.state, editor.state.rootId);
      if (root === null || root.firstChildId === null) throw new Error("no para");
      return root.firstChildId;
    })();
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(pId, 0), createPosition(pId, 8)),
      },
      config,
    );
    editor = reduceEditor(editor, { type: "SET_TEXT_COLOR", color: "#ff0000" }, config);

    const renderOutput = render(editor.state, componentRegistry, attrRegistry);
    const cascaded = cascadePass(renderOutput.root);

    function findFirstText(node: RenderNode): RenderNode | null {
      if (node.type === "text") return node;
      for (const child of node.children) {
        const found = findFirstText(child);
        if (found !== null) return found;
      }
      return null;
    }
    const textNode = findFirstText(cascaded);
    expect(textNode).not.toBeNull();
    expect(textNode?.computedStyle?.color).toBe("#ff0000");
  });
});

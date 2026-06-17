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
import { buildBlock, buildState, inlineContent, text } from "@taleweaver/core";
import { render } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import {
  createInitialEditorState,
  reduceEditor,
  getBlock,
  createPosition,
  createSpan,
  type EditorConfig,
} from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";
import type { RenderNode } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";

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
        nextSiblingId: "li1",
        attrs: { headingLevel: 1 },
        inlineContent: inlineContent([text("title")]),
      }),
      // Flat list model: list-items are direct children of the document,
      // carrying listId/listLevel attrs — no wrapping `list` container.
      buildBlock({
        id: "li1",
        type: "list-item",
        parentId: "doc",
        prevSiblingId: "h",
        nextSiblingId: "li2",
        attrs: { listId: "L1", listLevel: 0 },
        inlineContent: inlineContent([text("first")]),
      }),
      buildBlock({
        id: "li2",
        type: "list-item",
        parentId: "doc",
        prevSiblingId: "li1",
        nextSiblingId: "img",
        attrs: { listId: "L1", listLevel: 0 },
        inlineContent: inlineContent([text("second")]),
      }),
      buildBlock({
        id: "img",
        type: "image",
        parentId: "doc",
        prevSiblingId: "li2",
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
  it("editor body default `overflow-wrap: break-word`: a long unbreakable word breaks to fit (OW.S3)", () => {
    // Google-Docs parity: a long unbreakable string in the BODY (no explicit
    // overflowWrap) breaks to fit the page rather than running off it. The
    // `document` component sets `overflowWrap: "break-word"` (slice 3); it cascades
    // to the paragraph's text (slice 1) and the IFC breaks it (slice 2). This
    // exercises the WHOLE pipeline end-to-end with NO per-block override.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([text("aaaaaaaaaa")]) }), // 10 × 8px = 80px
      ],
    });
    const renderOutput = render(state, componentRegistry, attrRegistry);
    // In a 40px column the 80px word must break (→ ≥2 lines). Without the body
    // default it would overflow on a single line.
    const layout = positionTreeForTest(layoutTree(renderOutput.root, 40, shaper));
    function countLines(box: LayoutBox): number {
      let n = box.type === "line" ? 1 : 0;
      if ("children" in box) for (const c of box.children) n += countLines(c);
      return n;
    }
    expect(countLines(layout)).toBeGreaterThanOrEqual(2);
  });

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
    const layout = positionTreeForTest(layoutTree(renderOutput.root, 800, shaper));
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
    const layout = positionTreeForTest(layoutTree(renderOutput.root, 800, shaper));

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
    const layout = positionTreeForTest(layoutTree(renderOutput.root, 800, shaper));

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

    // Highlight (text background color): dispatch SET_HIGHLIGHT over the same
    // selection and confirm backgroundColorInterpreter threads it to
    // ComputedStyle.backgroundColor (the canvas renderer's text-run branch
    // paints exactly this behind the glyphs).
    editor = reduceEditor(editor, { type: "SET_HIGHLIGHT", color: "#ffff00" }, config);
    const cascadedHl = cascadePass(
      render(editor.state, componentRegistry, attrRegistry).root,
    );
    const hlNode = findFirstText(cascadedHl);
    expect(hlNode?.computedStyle?.backgroundColor).toBe("#ffff00");
  });

  it("SET_FONT_SIZE threads fontSize → cascade AND grows the line's layout height (real reflow)", () => {
    // End-to-end reflow proof: dispatch SET_FONT_SIZE over a selection,
    // confirm BOTH that the cascaded ComputedStyle.fontSize is the
    // dispatched value AND that the containing paragraph box grew taller.
    // The IFC measures each run via shaper.shape() at its own cs.fontSize
    // and sets the line height to the MAX of its runs' block sizes — so a
    // larger fontSize MUST increase the line's layout height. This test
    // uses a fontSize-SCALING shaper (ascent/descent proportional to
    // style.fontSize) so the height assertion is a genuine
    // layout-measurement proof: if fontSize weren't threaded from state →
    // cascade → shaper.shape(), the run metrics wouldn't change and the
    // height assertion would fail. (The default mock shaper returns fixed
    // metrics, which would mask the threading — hence the scaling shaper.)
    const scalingShaper: TextShaper = {
      shape(text, style, baseDirection) {
        const base = shaper.shape(text, style, baseDirection);
        const scale = style.fontSize / INITIAL_COMPUTED_STYLE.fontSize;
        return {
          ...base,
          ascent: base.ascent * scale,
          descent: base.descent * scale,
          lineGap: base.lineGap * scale,
        };
      },
      measureFontMetrics(style) {
        const base = shaper.measureFontMetrics(style);
        const scale = style.fontSize / INITIAL_COMPUTED_STYLE.fontSize;
        return {
          ascent: base.ascent * scale,
          descent: base.descent * scale,
          lineGap: base.lineGap * scale,
          capHeight: base.capHeight * scale,
          xHeight: base.xHeight * scale,
        };
      },
    };
    const config: EditorConfig = {
      componentRegistry,
      attrRegistry,
      containerWidth: 800,
    };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "size me" }, config);
    const pId = (() => {
      const root = getBlock(editor.state, editor.state.rootId);
      if (root === null || root.firstChildId === null) throw new Error("no para");
      return root.firstChildId;
    })();
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(pId, 0), createPosition(pId, 7)),
      },
      config,
    );

    function findFirstText(node: RenderNode): RenderNode | null {
      if (node.type === "text") return node;
      for (const child of node.children) {
        const found = findFirstText(child);
        if (found !== null) return found;
      }
      return null;
    }

    // Find the paragraph's LayoutBox (carries blockSize = its content height).
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

    function paragraphHeight(state: typeof editor.state): number {
      const layout = positionTreeForTest(
        layoutTree(render(state, componentRegistry, attrRegistry).root, 800, scalingShaper),
      );
      const p = findBlock(layout, pId);
      if (p === null) throw new Error("no paragraph box");
      return p.blockSize;
    }

    const heightBefore = paragraphHeight(editor.state);

    editor = reduceEditor(editor, { type: "SET_FONT_SIZE", size: 32 }, config);

    // Cascade: the affected text node carries the dispatched fontSize.
    const cascaded = cascadePass(
      render(editor.state, componentRegistry, attrRegistry).root,
    );
    const textNode = findFirstText(cascaded);
    expect(textNode).not.toBeNull();
    expect(textNode?.computedStyle?.fontSize).toBe(32);

    // Layout reflow: the line/paragraph grew taller because the IFC
    // measured the run at the larger fontSize.
    const heightAfter = paragraphHeight(editor.state);
    expect(heightAfter).toBeGreaterThan(heightBefore);
  });

  it("SET_LINE_SPACING threads lineHeight → cascade AND grows the line's layout height (real reflow)", () => {
    // End-to-end reflow proof for line spacing (Google Docs' 1.0/1.15/1.5/2.0
    // control). Dispatch SET_LINE_SPACING over a paragraph selection, then
    // confirm BOTH that the cascaded ComputedStyle.lineHeight is the dispatched
    // unitless ratio AND that the paragraph box grew taller.
    //
    // The IFC sets each line box's block size to the MAX of its runs'
    // measured heights (`measurer.measureHeight` → `shaper.measureFontMetrics`,
    // which returns ascent + descent + lineGap). The lineGap is where the CSS
    // half-leading lives: a unitless `line-height: R` produces a total line box
    // of `R × fontSize`, so lineGap = R×fontSize − ascent − descent. A larger R
    // MUST therefore increase the line box. The DEFAULT mock shaper takes a
    // FIXED lineHeight constructor arg and IGNORES `style.lineHeight` — so this
    // test uses a lineHeight-HONORING shaper (the exact pattern the SET_FONT_SIZE
    // test uses for fontSize) that computes lineGap from `style.lineHeight`,
    // mirroring the production canvas-shaper. If lineHeight weren't threaded
    // state → cascade → shaper.measureFontMetrics(), the run metrics wouldn't
    // change and the height assertion below would FAIL.
    const spacingShaper: TextShaper = {
      shape(text, style, baseDirection) {
        const base = shaper.shape(text, style, baseDirection);
        const ratio = typeof style.lineHeight === "number" ? style.lineHeight : 1;
        const target = ratio * style.fontSize;
        const lineGap = Math.max(0, target - base.ascent - base.descent);
        return { ...base, lineGap };
      },
      measureFontMetrics(style) {
        const base = shaper.measureFontMetrics(style);
        const ratio = typeof style.lineHeight === "number" ? style.lineHeight : 1;
        const target = ratio * style.fontSize;
        const lineGap = Math.max(0, target - base.ascent - base.descent);
        return { ...base, lineGap };
      },
    };
    const config: EditorConfig = {
      componentRegistry,
      attrRegistry,
      containerWidth: 800,
    };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "space me" }, config);
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

    function findFirstText(node: RenderNode): RenderNode | null {
      if (node.type === "text") return node;
      for (const child of node.children) {
        const found = findFirstText(child);
        if (found !== null) return found;
      }
      return null;
    }

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

    function paragraphHeight(state: typeof editor.state): number {
      const layout = positionTreeForTest(
        layoutTree(render(state, componentRegistry, attrRegistry).root, 800, spacingShaper),
      );
      const p = findBlock(layout, pId);
      if (p === null) throw new Error("no paragraph box");
      return p.blockSize;
    }

    // Baseline: default line spacing (no lineHeight attr → INITIAL ratio 1.2).
    expect(getBlock(editor.state, pId)?.attrs.lineHeight).toBeUndefined();
    const heightBefore = paragraphHeight(editor.state);

    editor = reduceEditor(editor, { type: "SET_LINE_SPACING", spacing: 2 }, config);

    // Cascade: the affected text node's ComputedStyle carries the dispatched
    // unitless ratio (inherits down to the run from the block attr).
    const cascaded = cascadePass(
      render(editor.state, componentRegistry, attrRegistry).root,
    );
    const textNode = findFirstText(cascaded);
    expect(textNode).not.toBeNull();
    expect(textNode?.computedStyle?.lineHeight).toBe(2);
    // The resolved used px line-height is ratio × fontSize = 2 × 16 = 32.
    expect(2 * (textNode?.computedStyle?.fontSize ?? 0)).toBe(32);

    // Layout reflow: the line/paragraph grew taller because the IFC measured
    // the run with the larger half-leading derived from lineHeight.
    const heightAfter = paragraphHeight(editor.state);
    expect(heightAfter).toBeGreaterThan(heightBefore);
  });

  it("INDENT threads marginInlineStart → component style → BFC insets the paragraph box and narrows it", () => {
    // End-to-end indent proof: dispatch INDENT over a paragraph selection, then
    // confirm the paragraph's LAYOUT box moved inline by one INDENT_STEP (48px)
    // AND its content box narrowed by the same amount. This proves the attr
    // reaches layout through the full pipeline (state → render component
    // synthesizes marginInlineStart onto the ElementBox style → BFC in-flow
    // margin handling). If the margin didn't reach layout the box would sit at
    // the same x with the same width and BOTH assertions below would FAIL.
    const config: EditorConfig = {
      componentRegistry,
      attrRegistry,
      containerWidth: 800,
    };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "indent me" }, config);
    const pId = (() => {
      const root = getBlock(editor.state, editor.state.rootId);
      if (root === null || root.firstChildId === null) throw new Error("no para");
      return root.firstChildId;
    })();
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(pId, 0), createPosition(pId, 9)),
      },
      config,
    );

    function findBlockBox(box: LayoutBox, key: string): LayoutBox | null {
      if (box.key === key) return box;
      if ("children" in box) {
        for (const child of box.children) {
          const found = findBlockBox(child, key);
          if (found !== null) return found;
        }
      }
      return null;
    }

    function paragraphBox(state: typeof editor.state): LayoutBox {
      const layout = positionTreeForTest(
        layoutTree(render(state, componentRegistry, attrRegistry).root, 800, shaper),
      );
      const p = findBlockBox(layout, pId);
      if (p === null) throw new Error("no paragraph box");
      return p;
    }

    // Baseline: no marginInlineStart attr → paragraph sits at the container edge.
    expect(getBlock(editor.state, pId)?.attrs.marginInlineStart).toBeUndefined();
    const before = paragraphBox(editor.state);

    editor = reduceEditor(editor, { type: "INDENT" }, config);

    // State: the attr landed.
    expect(getBlock(editor.state, pId)?.attrs.marginInlineStart).toBe(48);

    // Layout: the box moved inline by exactly 48px and its content box narrowed
    // by 48px (the BFC inset + width reduction for an in-flow inline margin).
    const after = paragraphBox(editor.state);
    expect(after.x).toBe(before.x + 48);
    expect(after.inlineSize).toBe(before.inlineSize - 48);
  });

  it("SET_PARAGRAPH_SPACING (space after) threads marginBlockEnd → BFC → grows the gap to the next paragraph (real reflow, accounting for margin collapse)", () => {
    // End-to-end paragraph-spacing proof: a doc with TWO stacked paragraphs.
    // Dispatch SET_PARAGRAPH_SPACING (edge "after", value 60) on the FIRST
    // paragraph, then confirm the SECOND paragraph's layout y-offset increased
    // and the gap between para1's bottom and para2's top reflects the larger
    // margin. If the margin didn't reach layout, para2 would sit at the same y
    // and BOTH assertions would FAIL.
    //
    // CSS margins COLLAPSE (CSS 2.1 §8.3.1, applied by the BFC in bfc.ts): the
    // realized gap between adjacent siblings is max(prevMarginBlockEnd,
    // nextMarginBlockStart), NOT their sum. The paragraph component's default
    // `marginBlockEnd` is 0.5em → 8px at the 16px mock font. We pick 60 (well
    // above 8) so the collapsed result (max(60, 0) for para1.after vs
    // para2.before=0) visibly grows from the 8px default and the assertion is
    // unambiguous.
    const config: EditorConfig = {
      componentRegistry,
      attrRegistry,
      containerWidth: 800,
    };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "first" }, config);
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "second" }, config);

    const [p1Id, p2Id] = (() => {
      const root = getBlock(editor.state, editor.state.rootId);
      if (root === null || root.firstChildId === null) throw new Error("no para");
      const first = root.firstChildId;
      const firstBlock = getBlock(editor.state, first);
      if (firstBlock === null || firstBlock.nextSiblingId === null) {
        throw new Error("no second para");
      }
      return [first, firstBlock.nextSiblingId];
    })();

    function findBlockBox(box: LayoutBox, key: string): LayoutBox | null {
      if (box.key === key) return box;
      if ("children" in box) {
        for (const child of box.children) {
          const found = findBlockBox(child, key);
          if (found !== null) return found;
        }
      }
      return null;
    }

    function paraBox(state: typeof editor.state, key: string): LayoutBox {
      const layout = positionTreeForTest(
        layoutTree(render(state, componentRegistry, attrRegistry).root, 800, shaper),
      );
      const box = findBlockBox(layout, key);
      if (box === null) throw new Error(`no box for ${key}`);
      return box;
    }

    // Baseline: no marginBlockEnd attr → the default 0.5em (8px) collapsed gap.
    expect(getBlock(editor.state, p1Id)?.attrs.marginBlockEnd).toBeUndefined();
    const p1Before = paraBox(editor.state, p1Id);
    const p2Before = paraBox(editor.state, p2Id);
    const gapBefore = p2Before.y - (p1Before.y + p1Before.blockSize);

    // Put the caret in the FIRST paragraph (typing "second" left it collapsed in
    // p2). The handler spaces the focus block, so select p1.
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(p1Id, 0), createPosition(p1Id, 0)),
      },
      config,
    );

    // Set space-after on the FIRST paragraph to 60px.
    editor = reduceEditor(
      editor,
      { type: "SET_PARAGRAPH_SPACING", edge: "after", value: 60 },
      config,
    );

    // State: the attr landed.
    expect(getBlock(editor.state, p1Id)?.attrs.marginBlockEnd).toBe(60);

    // Layout: the second paragraph moved DOWN, and the gap grew to exactly the
    // 60px margin (collapse: max(60, para2.before=0) = 60), not the 8px default.
    const p1After = paraBox(editor.state, p1Id);
    const p2After = paraBox(editor.state, p2Id);
    const gapAfter = p2After.y - (p1After.y + p1After.blockSize);

    expect(p2After.y).toBeGreaterThan(p2Before.y);
    expect(gapBefore).toBeCloseTo(8, 5);
    expect(gapAfter).toBeCloseTo(60, 5);
  });

  it("SET_FONT_FAMILY threads fontFamily → fontFamilyInterpreter → ComputedStyle.fontFamily", () => {
    const config: EditorConfig = {
      componentRegistry,
      attrRegistry,
      containerWidth: 800,
    };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "font me" }, config);
    const pId = (() => {
      const root = getBlock(editor.state, editor.state.rootId);
      if (root === null || root.firstChildId === null) throw new Error("no para");
      return root.firstChildId;
    })();
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(pId, 0), createPosition(pId, 7)),
      },
      config,
    );
    editor = reduceEditor(
      editor,
      { type: "SET_FONT_FAMILY", family: "Courier New" },
      config,
    );

    const cascaded = cascadePass(
      render(editor.state, componentRegistry, attrRegistry).root,
    );

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
    expect(textNode?.computedStyle?.fontFamily).toBe("Courier New");
  });
});

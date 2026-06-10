/**
 * Change-tracking slice 1.3 — the two break-suggestion embeds
 * (`block-join-suggestion` / `block-split-suggestion`) render as ZERO-WIDTH
 * inline-block atoms (one IFC token, 0px, no glyph), preserving the offset↔box
 * 1:1 invariant (#407). Mirror of `render-comment-markers.test.ts`. (The visible
 * struck/added pilcrow is slice 5; slice 1 only locks the offset invariant.)
 */
import { describe, it, expect } from "vitest";
import { render } from "./render";
import type { RenderNode, ElementBox, TextBox } from "./render-node";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
  embed,
} from "../test-utils/state-builders";
import { asBlockId } from "../state";
import type { BlockId } from "../state";
import {
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
} from "../state";
import { extractText } from "../state/extract-text";
import { builtinEmbedSerializer } from "../state/extract-text";
import { createPosition, createSpan } from "../state/block-position";
import { layoutTree } from "../layout/dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "../layout/mock-shaper";
import { getLineIndex } from "../cursor/line-flatten";

const reg = createDefaultComponentRegistry();
const attrReg = createDefaultAttrRegistry();

/** Collect every render-node's text content (TextBoxes) into one string. */
function allText(root: RenderNode): string {
  const parts: string[] = [];
  function walk(node: RenderNode): void {
    if (node.type === "text") {
      parts.push((node as TextBox).text);
      return;
    }
    for (const child of (node as ElementBox).children) walk(child);
  }
  walk(root);
  return parts.join("");
}

/** Collect every element box in the tree carrying the given embedType metadata. */
function embedBoxesOf(root: RenderNode, embedType: string): ElementBox[] {
  const found: ElementBox[] = [];
  function walk(node: RenderNode): void {
    if (node.type !== "element") return;
    const el = node as ElementBox;
    if (el.metadata?.embedType === embedType) found.push(el);
    for (const child of el.children) walk(child);
  }
  walk(root);
  return found;
}

describe("render — break-suggestion embeds are zero-width inline-block atoms", () => {
  for (const embedType of [
    BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
    BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  ]) {
    it(`emits one zero-width inline-block atom for ${embedType} (no glyph, no U+FFFC)`, () => {
      const state = buildState({
        rootId: asBlockId("doc"),
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
          buildBlock({
            id: "p",
            type: "paragraph",
            parentId: "doc",
            inlineContent: inlineContent([
              text("hello "),
              embed(embedType, { suggestionId: "s1" }),
              text("world"),
            ]),
          }),
        ],
      });

      const out = render(state, reg, attrReg);
      const boxes = embedBoxesOf(out.root, embedType);
      expect(boxes).toHaveLength(1);
      for (const box of boxes) {
        expect(box.style.display).toBe("inline-block");
        expect(box.style.inlineSize).toBe(0);
        expect(box.children).toHaveLength(0);
      }
      // No glyph leaks (no U+FFFC); visible text is exactly the surrounding text.
      expect(allText(out.root)).toBe("hello world");
      expect(allText(out.root)).not.toContain("￼");
    });
  }
});

describe("render — break-suggestion embeds preserve the offset↔box 1:1 IFC invariant (#407)", () => {
  const CHAR_W = 8;
  const LINE_H = 16;
  const widePage = {
    pageInlineSize: 800,
    pageBlockSize: 1000,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 20,
  };

  it("line.inlineOffsetEnd covers all text chars + the break embed ('hello ' + join + 'world' === 12)", () => {
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("hello "),
            embed(BLOCK_JOIN_SUGGESTION_EMBED_TYPE, { suggestionId: "s1" }),
            text("world"),
          ]),
        }),
      ],
    });

    const root = render(state, reg, attrReg).root;
    const shaper = createMockShaper(CHAR_W, LINE_H);
    const layout = positionTreeForTest(
      layoutTree(root, widePage.pageInlineSize, shaper, widePage),
    );
    const lines = getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
    expect(lines).toHaveLength(1);
    const line = lines[0].line;

    // State-model length: "hello " (6) + break embed (1) + "world" (5) = 12. If
    // the embed skipped emission, this would be 11 (short by 1) → cursor/hit-test
    // corruption for every offset ≥ 6.
    const stateLength = "hello ".length + 1 + "world".length;
    expect(stateLength).toBe(12);
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe(stateLength);
  });
});

describe("extractText — break-suggestion embeds serialize to empty string", () => {
  it("builtinEmbedSerializer returns '' for both break-suggestion embed types", () => {
    expect(
      builtinEmbedSerializer({
        kind: "embed",
        embedType: BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
        attrs: {},
        properties: {},
      }),
    ).toBe("");
    expect(
      builtinEmbedSerializer({
        kind: "embed",
        embedType: BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
        attrs: {},
        properties: {},
      }),
    ).toBe("");
  });

  it("extractText excludes the break embed (no U+FFFC) under builtinEmbedSerializer", () => {
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("hello "),
            embed(BLOCK_SPLIT_SUGGESTION_EMBED_TYPE, { suggestionId: "s1" }),
            text("world"),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 12));
    const out = extractText(state, span, builtinEmbedSerializer);
    expect(out).toBe("hello world");
    expect(out).not.toContain("￼");
  });
});

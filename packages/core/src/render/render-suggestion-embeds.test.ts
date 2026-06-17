/**
 * Change-tracking — the two break-suggestion embeds (`block-join-suggestion` /
 * `block-split-suggestion`) render as VISIBLE pilcrow (¶) inline-block atoms
 * (slice 5b): ONE IFC token wrapping a single ¶ glyph, preserving the offset↔box
 * 1:1 invariant (#407). The per-author color + struck/added decoration of the
 * glyph is covered by `render-suggestion-visuals.test.ts`; this file locks the
 * render() INTEGRATION shape with surrounding text — exactly one atom, the ¶
 * between the neighbours, no U+FFFC leak — plus the offset invariant and the
 * extractText serialization (which still drops the embed to "").
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
import { layoutTree } from "@taleweaver/print";
import { positionTreeForTest } from "@taleweaver/print";
import { createMockShaper } from "../layout/mock-shaper";
import { getLineIndex } from "@taleweaver/print";

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

describe("render — break-suggestion embeds are visible pilcrow inline-block atoms", () => {
  for (const embedType of [
    BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
    BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  ]) {
    it(`emits one inline-block ¶ atom for ${embedType} between the surrounding text (no U+FFFC)`, () => {
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
        // ONE inline-block atom (offset↔box 1:1) wrapping exactly the ¶ glyph.
        expect(box.style.display).toBe("inline-block");
        expect(box.children).toHaveLength(1);
        const glyph = box.children[0];
        if (glyph === undefined) throw new Error("expected one glyph child");
        expect(glyph.type).toBe("text");
        expect((glyph as TextBox).text).toBe("¶");
      }
      // The ¶ sits between the neighbours; no U+FFFC placeholder leaks.
      expect(allText(out.root)).toBe("hello ¶world");
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
    const lineEntry = lines[0];
    if (lineEntry === undefined) throw new Error("expected one line for block p");
    const line = lineEntry.line;

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

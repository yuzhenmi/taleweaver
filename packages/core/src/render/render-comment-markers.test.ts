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
import { COMMENT_START_EMBED_TYPE, COMMENT_END_EMBED_TYPE } from "../state";
import { layoutTree } from "@taleweaver/print";
import { positionTreeForTest } from "@taleweaver/print";
import { createMockShaper } from "../layout/mock-shaper";
import { getLineIndex } from "@taleweaver/print";

const reg = createDefaultComponentRegistry();
const attrReg = createDefaultAttrRegistry();

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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

describe("render — comment-range markers are zero-width inline-block atoms", () => {
  it("emits one zero-width inline-block atom per marker (no glyph, no U+FFFC)", () => {
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
            embed(COMMENT_START_EMBED_TYPE, { commentId: "c1" }),
            text("world"),
            embed(COMMENT_END_EMBED_TYPE, { commentId: "c1" }),
          ]),
        }),
      ],
    });

    const out = render(state, reg, attrReg);

    // Each marker emits EXACTLY ONE box, stamped with its embedType. Emitting
    // one atomic box (not zero) is load-bearing: the IFC drives its per-line
    // offset cursor off the token stream, so one box = one cursor stop = the
    // 1:1 `offset↔box` invariant (#407). Skipping emission would short the
    // line's inlineOffsetEnd and corrupt cursor/hit-test after the marker.
    const startBoxes = embedBoxesOf(out.root, COMMENT_START_EMBED_TYPE);
    const endBoxes = embedBoxesOf(out.root, COMMENT_END_EMBED_TYPE);
    expect(startBoxes).toHaveLength(1);
    expect(endBoxes).toHaveLength(1);

    // The atom is an INVISIBLE inline-block: inline-block display, 0 inline
    // size, and NO children (no glyph). This is what makes it render nothing
    // visible while still contributing one IFC token.
    for (const box of [...startBoxes, ...endBoxes]) {
      expect(box.style.display).toBe("inline-block");
      expect(box.style.inlineSize).toBe(0);
      expect(box.children).toHaveLength(0);
    }

    // Markers contribute NO text/glyph: the visible text is exactly the
    // surrounding text, with no U+FFFC placeholder leaking in.
    expect(allText(out.root)).toBe("hello world");
    expect(allText(out.root)).not.toContain("￼");
  });

  it("a block containing ONLY comment markers contributes no visible glyph", () => {
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            embed(COMMENT_START_EMBED_TYPE, { commentId: "c1" }),
            embed(COMMENT_END_EMBED_TYPE, { commentId: "c1" }),
          ]),
        }),
      ],
    });

    const out = render(state, reg, attrReg);
    // Both markers still emit their atom boxes (offset-bearing), but render no
    // visible glyph — the empty-paragraph strut sentinel is NOT needed because
    // the markers themselves trigger IFC dispatch.
    expect(embedBoxesOf(out.root, COMMENT_START_EMBED_TYPE)).toHaveLength(1);
    expect(embedBoxesOf(out.root, COMMENT_END_EMBED_TYPE)).toHaveLength(1);
    // No visible glyph content.
    expect(allText(out.root)).toBe("");
  });
});

describe("render — comment markers preserve the offset↔box 1:1 IFC invariant (#407)", () => {
  // The LOAD-BEARING regression test: this is what would have caught the
  // skip-emission bug. Each comment marker is a state-model embed = 1 offset
  // unit, and the IFC's per-line offset cursor (`inlineOffsetEnd`) is driven by
  // SUMMING emitted tokens' source lengths. If a marker emits NO token, the
  // line's `inlineOffsetEnd` falls SHORT by the marker count → cursor/hit-test
  // resolve wrong positions for every offset after a marker on the line. A pure
  // structural test (no box / no U+FFFC) does NOT catch this — only an
  // offset/geometry assertion through the real IFC does (principle 8).
  const reg2 = createDefaultComponentRegistry();
  const attrReg2 = createDefaultAttrRegistry();
  // Wide page so the whole paragraph stays on one line; 8px/char mock shaper.
  const CHAR_W = 8;
  const LINE_H = 16;
  const widePage = {
    pageInlineSize: 800,
    pageBlockSize: 1000,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 20,
  };

  it("line.inlineOffsetEnd covers all text chars + markers ('hello ' + start + 'world' + end)", () => {
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
            embed(COMMENT_START_EMBED_TYPE, { commentId: "c1" }),
            text("world"),
            embed(COMMENT_END_EMBED_TYPE, { commentId: "c1" }),
          ]),
        }),
      ],
    });

    const root = render(state, reg2, attrReg2).root;
    const shaper = createMockShaper(CHAR_W, LINE_H);
    const layout = positionTreeForTest(
      layoutTree(root, widePage.pageInlineSize, shaper, widePage),
    );

    const lines = getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
    expect(lines).toHaveLength(1);
    const line = nth(lines, 0, "line").line;

    // State-model length: "hello " (6) + comment-start (1) + "world" (5) +
    // comment-end (1) = 13. The line's offsets must span [0, 13] — the markers
    // each contribute exactly 1, exactly like every other embed. If a marker
    // skipped emission, this would be 11 (short by 2), corrupting cursor math
    // for every offset ≥ 6.
    const stateLength = "hello ".length + 1 + "world".length + 1;
    expect(stateLength).toBe(13);
    expect(line.inlineOffsetStart).toBe(0);
    expect(line.inlineOffsetEnd).toBe(stateLength);
  });
});

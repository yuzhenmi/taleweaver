import { describe, it, expect } from "vitest";
import { render } from "@taleweaver/core";
import type { RenderNode, ElementBox } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { buildState } from "@taleweaver/core";
import { buildBlock, inlineContent, text, embed } from "@taleweaver/core";
import { asBlockId, INLINE_IMAGE_EMBED_TYPE } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { layoutBlock } from "../layout/bfc";
import { makeRootContext } from "../layout/layout-context";
import type { LayoutBox, InlineBlockBox } from "../layout/layout-box";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";

const reg = createDefaultComponentRegistry();
const attrReg = createDefaultAttrRegistry();
const shaper = createMockShaper(8, 16);

/**
 * Locate the single inline-image element box in a render tree (by its
 * `metadata.embedType`). The inline image renders (Option B) as an OUTER
 * `display:inline-block` ElementBox (carrying `metadata.replacedInline: true`
 * so the T2 replaced-baseline rule fires) wrapping ONE INNER `display:block`
 * ElementBox carrying `metadata.image {src,width,height}` + explicit dims — so
 * the existing block-image paint runs for free via `paintContainerChildren`.
 */
function findInlineImage(root: RenderNode): ElementBox | null {
  let found: ElementBox | null = null;
  function walk(node: RenderNode): void {
    if (node.type !== "element") return;
    if (node.metadata?.embedType === INLINE_IMAGE_EMBED_TYPE) found = node;
    for (const child of node.children) walk(child);
  }
  walk(root);
  return found;
}

function buildInlineImageState() {
  return buildState({
    rootId: asBlockId("doc"),
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([
          text("x"),
          embed(INLINE_IMAGE_EMBED_TYPE, {
            src: "logo.png",
            width: 40,
            height: 30,
            alt: "a",
          }),
        ]),
      }),
    ],
  });
}

describe("render — inline-image embed (Option B inline-block atom)", () => {
  it("renders the inline image as an OUTER inline-block (replacedInline) wrapping an INNER block carrying metadata.image", () => {
    const state = buildInlineImageState();
    const out = render(state, reg, attrReg);
    const outer = findInlineImage(out.root);
    expect(outer).not.toBeNull();
    if (outer === null) throw new Error("expected inline-image element box");

    // OUTER: a single-token inline-block atom (one IFC token = the state model's
    // 1-unit EmbedItem offset, #407), flagged replacedInline so the T2
    // bottom-edge baseline rule fires.
    expect(outer.style.display).toBe("inline-block");
    expect(outer.metadata?.replacedInline).toBe(true);

    // INNER: exactly one childless block ElementBox with the image metadata +
    // explicit dims. Reusing the block-image render means paintContainerChildren
    // recursion reaches the existing block-image paint for free.
    expect(outer.children).toHaveLength(1);
    const inner = outer.children[0];
    if (inner === undefined || inner.type !== "element") {
      throw new Error("expected one inner element child");
    }
    expect(inner.style.display).toBe("block");
    expect(inner.style.blockSize).toBe(30);
    expect(inner.style.inlineSize).toBe(40);
    expect(inner.children).toHaveLength(0);
    // The exact metadata.image shape components/image.ts stamps: { src, width, height, alt }.
    expect(inner.metadata?.image).toEqual({ src: "logo.png", width: 40, height: 30, alt: "a" });
  });

  it("threads alt from the inline-image embed properties onto the inner block (P-3)", () => {
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("x"),
            embed(INLINE_IMAGE_EMBED_TYPE, {
              src: "logo.png",
              width: 40,
              height: 30,
              alt: "inline cat",
            }),
          ]),
        }),
      ],
    });
    const out = render(state, reg, attrReg);
    const outer = findInlineImage(out.root);
    if (outer === null) throw new Error("expected inline-image element box");
    const inner = outer.children[0];
    if (inner === undefined || inner.type !== "element") {
      throw new Error("expected one inner element child");
    }
    expect(inner.metadata?.image?.alt).toBe("inline cat");
  });

  it("lays out the inline image so its bottom edge sits on the text baseline (T2 replaced rule)", () => {
    const state = buildInlineImageState();
    const out = render(state, reg, attrReg);
    const cascaded = cascadePass(out.root);
    if (cascaded.type !== "element") throw new Error("cascaded root is not an element");
    // The render root is the document; descend to the paragraph block, which is
    // the inline-content-bearing BFC whose IFC produces the line + inline-block.
    const r = layoutBlock(
      cascaded,
      0,
      0,
      makeRootContext(INITIAL_COMPUTED_STYLE, 500),
      shaper,
      undefined,
    );
    if (r.box === null) throw new Error("layoutBlock returned null box");

    // Walk the typed LayoutBox tree to the inline-block box (the OUTER image
    // atom) and its enclosing line. Every variant carries the geometry fields
    // off `LayoutBoxBase`; `isReplaced` is `InlineBlockBox`-only, so we capture
    // the inline-block node itself (no structural cast).
    let imageBox: InlineBlockBox | null = null;
    let lineBlockSize = 0;
    function walk(box: LayoutBox): void {
      if (box.type === "line") lineBlockSize = box.blockSize;
      if (box.type === "inline-block") imageBox = box;
      if ("children" in box) {
        for (const child of box.children) walk(child);
      }
    }
    walk(r.box);

    if (imageBox === null) throw new Error("inline-block image box not found in layout");
    const ib: InlineBlockBox = imageBox;

    // The OUTER inline-block carries the image's explicit dims.
    expect(ib.blockSize).toBe(30);
    expect(ib.inlineSize).toBe(40);
    // The replaced flag survived render→cascade→layout (metadata.replacedInline
    // → IFC inlineBlock.isReplaced).
    expect(ib.isReplaced).toBe(true);
    // T2 replaced-baseline rule: bottom edge on the text baseline
    // (lineBlockSize*0.8) → blockOffset = lineBlockSize*0.8 − blockSize.
    expect(ib.blockOffset).toBe(lineBlockSize * 0.8 - ib.blockSize);
    expect(ib.blockOffset).toBe(ib.y);
  });
});

import { describe, it, expect } from "vitest";
import { imageComponent } from "./image";
import type { LeafBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
import type { ComputedStyle } from "../styles";
import type { ReadonlyAttrs } from "../state/attrs";

function leafView(attrs: ReadonlyAttrs = {}): LeafBlockView {
  return {
    id: "img1" as BlockId,
    type: "image",
    attrs: Object.freeze(attrs),
    computedStyle: {} as ComputedStyle,
    kind: "leaf",
    inlineContent: { items: [] },
  };
}

function stubCtx(): RenderContext {
  return { state: {} as State, getView: () => { throw new Error("stub"); }, getEmbedContent: () => { throw new Error("stub"); } };
}

describe("imageComponent (new)", () => {
  it("has type 'image' and kind 'leaf'", () => {
    expect(imageComponent.type).toBe("image");
    expect(imageComponent.kind).toBe("leaf");
  });

  it("renders block-level ElementBox with intrinsic sizing from attrs", () => {
    const node = imageComponent.render(leafView({ src: "/a.png", width: 300, height: 200 }), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.display).toBe("block");
    expect(el.style.inlineSize).toBe(300);
    expect(el.style.blockSize).toBe(200);
    expect(el.children).toHaveLength(0);
  });

  it("attaches image metadata", () => {
    const node = imageComponent.render(leafView({ src: "/a.png", width: 300, height: 200 }), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.metadata).toEqual({ image: { src: "/a.png", width: 300, height: 200 } });
  });

  it("ignores any inlineRenderNodes the renderer might pass", () => {
    // Image's inlineContent.items is empty by convention; even if a stray
    // inline RenderNode is passed, the component must not include it.
    const node = imageComponent.render(
      leafView({ src: "/a.png", width: 1, height: 1 }),
      stubCtx(),
      [{ type: "text", key: "x", style: {}, text: "ignored" }],
    );
    expect((node as ElementBox).children).toHaveLength(0);
  });
});

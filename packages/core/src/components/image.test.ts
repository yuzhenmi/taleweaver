import { describe, it, expect } from "vitest";
import { imageComponent } from "./image";
import type { LeafBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId, State, ReadonlyAttrs } from "../state";
import type { ComputedStyle } from "../styles";

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
  return { state: {} as State, footnoteNumber: () => undefined };
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

  // A6: a fresh image insert (no `width`/`height` attrs) must size
  // intrinsically (`auto`), not collapse to a 0×0 invisible box.
  it("falls back to 'auto' inlineSize/blockSize when width/height attrs are missing", () => {
    const node = imageComponent.render(leafView({ src: "/a.png" }), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.inlineSize).toBe("auto");
    expect(el.style.blockSize).toBe("auto");
  });

  it("preserves explicit numeric width/height attrs", () => {
    const node = imageComponent.render(
      leafView({ src: "/a.png", width: 120, height: 80 }),
      stubCtx(),
      [],
    );
    const el = node as ElementBox;
    expect(el.style.inlineSize).toBe(120);
    expect(el.style.blockSize).toBe(80);
  });

  it("falls back to 0 when attr is present but non-numeric", () => {
    // "specified but garbage" remains distinct from "missing" — present
    // garbage still resolves to 0, not auto. Documents the contract.
    const node = imageComponent.render(
      leafView({ src: "/a.png", width: "garbage", height: null }),
      stubCtx(),
      [],
    );
    const el = node as ElementBox;
    expect(el.style.inlineSize).toBe(0);
    expect(el.style.blockSize).toBe(0);
  });
});

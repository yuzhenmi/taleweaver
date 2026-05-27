import { describe, it, expect } from "vitest";
import { listItemComponent } from "./list-item";
import type { LeafBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId, State, ReadonlyAttrs } from "../state";
import type { ComputedStyle } from "../styles";

function leafView(attrs: ReadonlyAttrs = {}): LeafBlockView {
  return {
    id: "li1" as BlockId,
    type: "list-item",
    attrs: Object.freeze(attrs),
    computedStyle: {} as ComputedStyle,
    kind: "leaf",
    inlineContent: { items: [] },
  };
}

function stubCtx(): RenderContext {
  return { state: {} as State, getView: () => { throw new Error("stub"); }, getEmbedContent: () => { throw new Error("stub"); } };
}

describe("listItemComponent (new)", () => {
  it("has type 'list-item' and kind 'leaf'", () => {
    expect(listItemComponent.type).toBe("list-item");
    expect(listItemComponent.kind).toBe("leaf");
  });

  it("renders display: list-item", () => {
    const node = listItemComponent.render(leafView(), stubCtx(), []);
    expect((node as ElementBox).style.display).toBe("list-item");
  });

  it("passes inline render nodes through", () => {
    const child: ElementBox = { type: "element", key: "t1", style: {}, children: [] };
    const el = listItemComponent.render(leafView(), stubCtx(), [child]) as ElementBox;
    expect(el.children).toEqual([child]);
  });

  it("forwards a valid textAlign attr onto the ElementBox style", () => {
    const el = listItemComponent.render(
      leafView({ textAlign: "justify" }),
      stubCtx(),
      [],
    ) as ElementBox;
    expect(el.style.textAlign).toBe("justify");
  });

  it("does NOT forward an invalid textAlign attr", () => {
    const el = listItemComponent.render(
      leafView({ textAlign: "bogus" }),
      stubCtx(),
      [],
    ) as ElementBox;
    expect(el.style.textAlign).toBeUndefined();
  });

  it("does NOT set textAlign when the attr is absent", () => {
    const el = listItemComponent.render(leafView(), stubCtx(), []) as ElementBox;
    expect("textAlign" in el.style).toBe(false);
  });
});

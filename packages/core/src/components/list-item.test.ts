import { describe, it, expect } from "vitest";
import { listItemComponent } from "./list-item";
import type { LeafBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
import type { ComputedStyle } from "../styles";

function leafView(): LeafBlockView {
  return {
    id: "li1" as BlockId,
    type: "list-item",
    attrs: Object.freeze({}),
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
});

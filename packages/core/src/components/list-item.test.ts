import { describe, it, expect } from "vitest";
import { listItemComponent } from "./list-item";
import type { ContainerBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
import type { ComputedStyle } from "../styles";

function containerView(): ContainerBlockView {
  return {
    id: "li1" as BlockId,
    type: "list-item",
    attrs: Object.freeze({}),
    computedStyle: {} as ComputedStyle,
    kind: "container",
  };
}

function stubCtx(): RenderContext {
  return { state: {} as State, getView: () => { throw new Error("stub"); }, getEmbedContent: () => { throw new Error("stub"); } };
}

describe("listItemComponent (new)", () => {
  it("has type 'list-item' and kind 'container'", () => {
    expect(listItemComponent.type).toBe("list-item");
    expect(listItemComponent.kind).toBe("container");
  });

  it("renders display: list-item", () => {
    const node = listItemComponent.render(containerView(), stubCtx(), []);
    expect((node as ElementBox).style.display).toBe("list-item");
  });

  it("passes children through", () => {
    const child: ElementBox = { type: "element", key: "p1", style: {}, children: [] };
    const el = listItemComponent.render(containerView(), stubCtx(), [child]) as ElementBox;
    expect(el.children).toEqual([child]);
  });
});

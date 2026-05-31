import { describe, it, expect } from "vitest";
import { listComponent } from "./list";
import type { ContainerBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId, State, ReadonlyAttrs } from "../state";
import type { ComputedStyle } from "../styles";

function containerView(attrs: ReadonlyAttrs = {}): ContainerBlockView {
  return {
    id: "l1" as BlockId,
    type: "list",
    attrs: Object.freeze(attrs),
    computedStyle: {} as ComputedStyle,
    kind: "container",
  };
}

function stubCtx(): RenderContext {
  return { state: {} as State, footnoteNumber: () => undefined };
}

describe("listComponent (new)", () => {
  it("has type 'list' and kind 'container'", () => {
    expect(listComponent.type).toBe("list");
    expect(listComponent.kind).toBe("container");
  });

  it("renders display: block with paddingInlineStart for the marker gutter", () => {
    const node = listComponent.render(containerView(), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.display).toBe("block");
    expect(el.style.paddingInlineStart).toBe(30);
  });

  it("sets listStyleType: 'decimal' for ordered lists", () => {
    const node = listComponent.render(containerView({ listType: "ordered" }), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.listStyleType).toBe("decimal");
  });

  it("sets listStyleType: 'disc' for unordered (default) lists", () => {
    const node = listComponent.render(containerView({ listType: "unordered" }), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.listStyleType).toBe("disc");
  });

  it("defaults to 'disc' when attrs.listType is absent or unknown", () => {
    const node = listComponent.render(containerView({}), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.listStyleType).toBe("disc");
  });
});

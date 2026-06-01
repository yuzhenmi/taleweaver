import { describe, it, expect } from "vitest";
import { tableRowComponent } from "./table-row";
import type { ContainerBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId, State } from "../state";
import type { ComputedStyle } from "../styles";

function containerView(): ContainerBlockView {
  return {
    id: "tr1" as BlockId,
    type: "table-row",
    attrs: Object.freeze({}),
    computedStyle: {} as ComputedStyle,
    kind: "container",
  };
}

function stubCtx(): RenderContext {
  return {
    state: {} as State,
    footnoteNumber: () => undefined,
  };
}

describe("tableRowComponent (new)", () => {
  it("has type 'table-row' and kind 'container'", () => {
    expect(tableRowComponent.type).toBe("table-row");
    expect(tableRowComponent.kind).toBe("container");
  });

  it("renders display: table-row", () => {
    expect((tableRowComponent.render(containerView(), stubCtx(), []) as ElementBox).style.display).toBe("table-row");
  });

  it("passes children through", () => {
    const child: ElementBox = { type: "element", key: "td1", style: {}, children: [] };
    const el = tableRowComponent.render(containerView(), stubCtx(), [child]) as ElementBox;
    expect(el.children).toEqual([child]);
  });
});

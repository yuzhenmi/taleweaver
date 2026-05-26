import { describe, it, expect } from "vitest";
import { tableComponent } from "./table";
import type { ContainerBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId, State, ReadonlyAttrs } from "../state";
import type { ComputedStyle } from "../styles";

function containerView(attrs: ReadonlyAttrs = {}): ContainerBlockView {
  return {
    id: "t1" as BlockId,
    type: "table",
    attrs: Object.freeze(attrs),
    computedStyle: {} as ComputedStyle,
    kind: "container",
  };
}

function stubCtx(): RenderContext {
  return { state: {} as State, getView: () => { throw new Error("stub"); }, getEmbedContent: () => { throw new Error("stub"); } };
}

describe("tableComponent (new)", () => {
  it("has type 'table' and kind 'container'", () => {
    expect(tableComponent.type).toBe("table");
    expect(tableComponent.kind).toBe("container");
  });

  it("renders display: table", () => {
    expect((tableComponent.render(containerView(), stubCtx(), []) as ElementBox).style.display).toBe("table");
  });

  it("passes columnWidths attr into metadata when present", () => {
    const node = tableComponent.render(containerView({ columnWidths: [0.5, 0.3, 0.2] }), stubCtx(), []);
    expect((node as ElementBox).metadata).toEqual({ columnWidths: [0.5, 0.3, 0.2] });
  });

  it("omits metadata when columnWidths is absent", () => {
    const node = tableComponent.render(containerView({}), stubCtx(), []);
    expect((node as ElementBox).metadata).toBeUndefined();
  });
});

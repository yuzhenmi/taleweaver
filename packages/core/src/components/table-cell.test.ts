import { describe, it, expect } from "vitest";
import { tableCellComponent } from "./table-cell";
import type { ContainerBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId, State } from "../state";
import type { ComputedStyle } from "../styles";

function containerView(): ContainerBlockView {
  return {
    id: "td1" as BlockId,
    type: "table-cell",
    attrs: Object.freeze({}),
    computedStyle: {} as ComputedStyle,
    kind: "container",
  };
}

function stubCtx(): RenderContext {
  return {
    state: {} as State,
    getView: () => { throw new Error("stub"); },
    getEmbedContent: () => { throw new Error("stub"); },
    footnoteNumber: () => undefined,
  };
}

describe("tableCellComponent (new)", () => {
  it("has type 'table-cell' and kind 'container'", () => {
    expect(tableCellComponent.type).toBe("table-cell");
    expect(tableCellComponent.kind).toBe("container");
  });

  it("renders display: table-cell with hardcoded 1px solid #dadce0 borders", () => {
    const el = tableCellComponent.render(containerView(), stubCtx(), []) as ElementBox;
    expect(el.style.display).toBe("table-cell");
    expect(el.style.borderBlockStartWidth).toBe(1);
    expect(el.style.borderInlineEndWidth).toBe(1);
    expect(el.style.borderBlockStartStyle).toBe("solid");
    expect(el.style.borderBlockEndColor).toBe("#dadce0");
  });

  it("applies hardcoded 4/8 px padding", () => {
    const el = tableCellComponent.render(containerView(), stubCtx(), []) as ElementBox;
    expect(el.style.paddingBlockStart).toBe(4);
    expect(el.style.paddingBlockEnd).toBe(4);
    expect(el.style.paddingInlineStart).toBe(8);
    expect(el.style.paddingInlineEnd).toBe(8);
  });
});

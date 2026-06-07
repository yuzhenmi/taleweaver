import { describe, it, expect } from "vitest";
import { tableCellComponent } from "./table-cell";
import type { ContainerBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId, State } from "../state";
import type { ComputedStyle } from "../styles";

function containerView(attrs: Record<string, unknown> = {}): ContainerBlockView {
  return {
    id: "td1" as BlockId,
    type: "table-cell",
    attrs: Object.freeze(attrs),
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

  it("stamps rowSpan/colSpan from attrs into metadata (#P8.S1)", () => {
    const el = tableCellComponent.render(
      containerView({ rowSpan: 2, colSpan: 3 }),
      stubCtx(),
      [],
    ) as ElementBox;
    expect(el.metadata?.rowSpan).toBe(2);
    expect(el.metadata?.colSpan).toBe(3);
  });

  it("drops a non-integer span and the absent/invalid dimension", () => {
    const el = tableCellComponent.render(
      containerView({ rowSpan: 2.9, colSpan: 0 }),
      stubCtx(),
      [],
    ) as ElementBox;
    // 2.9 is not an integer → not a real span (the shared `spanValue` predicate
    // requires a finite integer > 1, so the component, the table-editing context
    // resolver, and layout's clampSpan all agree). 0 is invalid → not stamped.
    expect(el.metadata).toBeUndefined();
  });

  it("drops negative + non-number spans (open-schema attrs)", () => {
    const el = tableCellComponent.render(
      containerView({ rowSpan: -1, colSpan: "3" }),
      stubCtx(),
      [],
    ) as ElementBox;
    expect(el.metadata).toBeUndefined();
  });

  it("carries NO metadata for a plain 1×1 cell (byte-identical to pre-P8)", () => {
    const el = tableCellComponent.render(containerView(), stubCtx(), []) as ElementBox;
    expect(el.metadata).toBeUndefined();
  });

  it("treats an explicit rowSpan:1/colSpan:1 (identity) as 1×1 — no metadata stamped", () => {
    const el = tableCellComponent.render(
      containerView({ rowSpan: 1, colSpan: 1 }),
      stubCtx(),
      [],
    ) as ElementBox;
    expect(el.metadata).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { headingComponent, HEADING_FONT_SIZES } from "./heading";
import type { LeafBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId, State, ReadonlyAttrs } from "../state";
import type { ComputedStyle } from "../styles";

function leafView(attrs: ReadonlyAttrs = {}): LeafBlockView {
  return {
    id: "h1" as BlockId,
    type: "heading",
    attrs: Object.freeze(attrs),
    computedStyle: {} as ComputedStyle,
    kind: "leaf",
    inlineContent: { items: [] },
  };
}

function stubCtx(): RenderContext {
  return {
    state: {} as State,
    footnoteNumber: () => undefined,
  };
}

describe("headingComponent (new)", () => {
  it("has type 'heading' and kind 'leaf'", () => {
    expect(headingComponent.type).toBe("heading");
    expect(headingComponent.kind).toBe("leaf");
  });

  it("renders an ElementBox with bold font weight and level-derived font size", () => {
    const view = leafView({ level: 1 });
    const node = headingComponent.render(view, stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.display).toBe("block");
    expect(el.style.fontWeight).toBe("bold");
    expect(el.style.fontSize).toBe(HEADING_FONT_SIZES[1]);
  });

  it("falls back to level 1 size when attrs.level is missing", () => {
    const view = leafView({});
    const node = headingComponent.render(view, stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.fontSize).toBe(HEADING_FONT_SIZES[1]);
  });

  it("stamps headingLevel metadata from attrs.level (P-1)", () => {
    const el = headingComponent.render(leafView({ level: 3 }), stubCtx(), []) as ElementBox;
    expect(el.metadata?.headingLevel).toBe(3);
  });

  it("defaults headingLevel to 1 when attrs.level is missing (P-1)", () => {
    const el = headingComponent.render(leafView({}), stubCtx(), []) as ElementBox;
    expect(el.metadata?.headingLevel).toBe(1);
  });

  it("forwards a valid textAlign attr onto the ElementBox style", () => {
    const view = leafView({ level: 1, textAlign: "end" });
    const el = headingComponent.render(view, stubCtx(), []) as ElementBox;
    expect(el.style.textAlign).toBe("end");
  });

  it("does NOT forward an invalid textAlign attr", () => {
    const view = leafView({ level: 1, textAlign: "bogus" });
    const el = headingComponent.render(view, stubCtx(), []) as ElementBox;
    expect(el.style.textAlign).toBeUndefined();
  });

  it("does NOT set textAlign when the attr is absent", () => {
    const view = leafView({ level: 1 });
    const el = headingComponent.render(view, stubCtx(), []) as ElementBox;
    expect("textAlign" in el.style).toBe(false);
  });
});

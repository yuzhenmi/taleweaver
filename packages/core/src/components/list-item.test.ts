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
  return { state: {} as State, footnoteNumber: () => undefined };
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

  // List presentation lives on the list-item leaf itself (word-processor
  // model: list membership is a per-paragraph property, not a wrapper
  // element). Both properties must be synthesized onto the ElementBox style
  // so the BFC's marker generator reads them off the list-item's OWN
  // computed style.
  it("renders listStyleType: 'decimal' for an ordered list-item", () => {
    const el = listItemComponent.render(
      leafView({ listType: "ordered" }),
      stubCtx(),
      [],
    ) as ElementBox;
    expect(el.style.listStyleType).toBe("decimal");
  });

  it("renders listStyleType: 'disc' for an unordered list-item", () => {
    const el = listItemComponent.render(
      leafView({ listType: "unordered" }),
      stubCtx(),
      [],
    ) as ElementBox;
    expect(el.style.listStyleType).toBe("disc");
  });

  it("defaults to listStyleType: 'disc' when listType is absent/unknown", () => {
    const el = listItemComponent.render(leafView(), stubCtx(), []) as ElementBox;
    expect(el.style.listStyleType).toBe("disc");
  });

  it("sets a non-zero structural paddingInlineStart (the marker gutter / list indent)", () => {
    const el = listItemComponent.render(
      leafView({ listType: "ordered" }),
      stubCtx(),
      [],
    ) as ElementBox;
    expect(typeof el.style.paddingInlineStart).toBe("number");
    expect(el.style.paddingInlineStart as number).toBeGreaterThan(0);
  });

  it("the structural padding is always present, even for a bare list-item", () => {
    const el = listItemComponent.render(leafView(), stubCtx(), []) as ElementBox;
    expect(el.style.paddingInlineStart as number).toBeGreaterThan(0);
  });

  it("forwards a user marginInlineStart indent ON TOP OF the structural padding", () => {
    // INDENT/OUTDENT set marginInlineStart; it must compose with (not replace)
    // the base list indent. The BFC insets content by paddingInlineStart +
    // marginInlineStart, so both surviving on the style is what makes indent
    // add on top of the base list indent.
    const el = listItemComponent.render(
      leafView({ listType: "ordered", marginInlineStart: 48 }),
      stubCtx(),
      [],
    ) as ElementBox;
    expect(el.style.marginInlineStart).toBe(48);
    expect(el.style.paddingInlineStart as number).toBeGreaterThan(0);
  });
});

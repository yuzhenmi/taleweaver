import { describe, it, expect } from "vitest";
import { listItemComponent } from "./list-item";
import { paragraphComponent } from "./paragraph";
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

  // #418 — DELIBERATE inter-item spacing difference (property-lock, GREEN).
  // A user reported list-item spacing looked "reduced." Investigation: WITHIN
  // a list item, line spacing is CORRECT (same default lineHeight as a
  // paragraph). BETWEEN consecutive list items the gap is ZERO — vs 0.5em
  // between paragraphs — because the list-item component sets NO default
  // marginBlockEnd while paragraph defaults marginBlockEnd: 0.5em. The zero
  // inter-item gap is INTENTIONAL (tight, cohesive list packing — the
  // Google-Docs / word-processor convention), NOT a bug. This test locks that
  // deliberate difference so it can't silently regress. If Google-Docs parity
  // ever requires inter-item spacing, this test + the list-item default margin
  // must change together.
  describe("#418 deliberate list-item vs paragraph spacing", () => {
    function paragraphView(attrs: ReadonlyAttrs = {}): LeafBlockView {
      return {
        id: "p1" as BlockId,
        type: "paragraph",
        attrs: Object.freeze(attrs),
        computedStyle: {} as ComputedStyle,
        kind: "leaf",
        inlineContent: { items: [] },
      };
    }

    it("list-item has NO default block margins; paragraph defaults marginBlockEnd 0.5em", () => {
      const li = listItemComponent.render(leafView(), stubCtx(), []) as ElementBox;
      const p = paragraphComponent.render(paragraphView(), stubCtx(), []) as ElementBox;

      // List-item: zero default block margins → consecutive items pack tightly.
      expect("marginBlockStart" in li.style).toBe(false);
      expect("marginBlockEnd" in li.style).toBe(false);

      // Paragraph: default 0.5em marginBlockEnd → inter-paragraph spacing.
      // (16px default fontSize → 0.5em resolves to 8px downstream.)
      expect(p.style.marginBlockEnd).toEqual({ unit: "em", value: 0.5 });
    });

    it("WITHIN-item line spacing is the SAME as a paragraph (lineHeight not reduced)", () => {
      // Neither component sets a default lineHeight on its style, so both
      // inherit the identical cascaded default — a list item's own lines are
      // spaced exactly like a paragraph's. (The reported "reduced" spacing was
      // the zero INTER-item gap above, never a WITHIN-item lineHeight override.)
      const li = listItemComponent.render(leafView(), stubCtx(), []) as ElementBox;
      const p = paragraphComponent.render(paragraphView(), stubCtx(), []) as ElementBox;

      expect("lineHeight" in li.style).toBe(false);
      expect("lineHeight" in p.style).toBe(false);
      expect(li.style.lineHeight).toEqual(p.style.lineHeight);
    });
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

import { describe, it, expect } from "vitest";
import { listItemComponent } from "./list-item";
import { paragraphComponent } from "./paragraph";
import type { LeafBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId, State, ReadonlyAttrs } from "../state";
import type { CounterValue } from "../numbering/types";
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

function stubCtx(counter?: CounterValue): RenderContext {
  return {
    state: {} as State,
    footnoteNumber: () => undefined,
    counterValue: () => counter,
  };
}

describe("listItemComponent (flat Google-Docs model)", () => {
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

  // --- FLAT MODEL: indent derived from listLevel ---
  it("derives a larger paddingInlineStart for a deeper listLevel", () => {
    const box0 = listItemComponent.render(
      leafView({ listId: "L1", listLevel: 0 }),
      stubCtx(),
      [],
    ) as ElementBox;
    const box2 = listItemComponent.render(
      leafView({ listId: "L1", listLevel: 2 }),
      stubCtx(),
      [],
    ) as ElementBox;
    expect(box2.style.paddingInlineStart).not.toEqual(box0.style.paddingInlineStart);
    expect(box2.style.paddingInlineStart as number).toBeGreaterThan(
      box0.style.paddingInlineStart as number,
    );
  });

  it("sets a non-zero structural paddingInlineStart (the marker gutter / list indent)", () => {
    const el = listItemComponent.render(
      leafView({ listId: "L1", listLevel: 0 }),
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

  // --- FLAT MODEL: marker derived from render-time counterValue ---
  it("emits '<n>.' as the markerText for a numbered (decimal) counter", () => {
    const el = listItemComponent.render(
      leafView({ listId: "L1", listLevel: 0 }),
      stubCtx({ value: 3, formatted: "3" }),
      [],
    ) as ElementBox;
    expect(el.style.display).toBe("list-item");
    expect(el.style.markerText).toBe("3.");
  });

  it("emits the disc bullet glyph as-is (no dot) for a bullet counter", () => {
    // formatCounter(1, "disc") === "•" (U+2022 BULLET).
    const el = listItemComponent.render(
      leafView({ listId: "L1", listLevel: 0 }),
      stubCtx({ value: 1, formatted: "•" }),
      [],
    ) as ElementBox;
    expect(el.style.markerText).toBe("•");
  });

  it("emits the circle bullet glyph as-is (no dot)", () => {
    // formatCounter(1, "circle") === "○" (U+25CB).
    const el = listItemComponent.render(
      leafView({ listId: "L1", listLevel: 1 }),
      stubCtx({ value: 1, formatted: "○" }),
      [],
    ) as ElementBox;
    expect(el.style.markerText).toBe("○");
  });

  it("emits the square bullet glyph as-is (no dot)", () => {
    // formatCounter(1, "square") === "▪" (U+25AA).
    const el = listItemComponent.render(
      leafView({ listId: "L1", listLevel: 2 }),
      stubCtx({ value: 1, formatted: "▪" }),
      [],
    ) as ElementBox;
    expect(el.style.markerText).toBe("▪");
  });

  it("emits no markerText when counterValue is absent (pre-wiring / not numbered)", () => {
    const el = listItemComponent.render(
      leafView({ listId: "L1", listLevel: 0 }),
      stubCtx(),
      [],
    ) as ElementBox;
    expect(el.style.markerText).toBeUndefined();
  });

  it("emits no markerText when ctx has no counterValue method at all (legacy stub)", () => {
    const ctx: RenderContext = { state: {} as State, footnoteNumber: () => undefined };
    const el = listItemComponent.render(
      leafView({ listId: "L1", listLevel: 0 }),
      ctx,
      [],
    ) as ElementBox;
    expect(el.style.markerText).toBeUndefined();
  });

  // --- P-5: typed list nesting metadata for the read-only DOM viewer ---
  it("stamps list metadata (level/listId/ordered) for a bullet item (P-5)", () => {
    const el = listItemComponent.render(
      leafView({ listId: "L1", listLevel: 0 }),
      stubCtx({ value: 1, formatted: "•" }),
      [],
    ) as ElementBox;
    // A bullet carries NO ordinal (it has no displayed number).
    expect(el.metadata?.list).toEqual({ level: 0, listId: "L1", ordered: false });
  });

  it("stamps ordered:true (no numeric ordinal) for a numbered item (P-5)", () => {
    // The list metadata carries only level/listId/ordered — the displayed number lives in
    // `markerText` ("3."). The raw ordinal is NOT surfaced: no consumer reads it (digital groups
    // <ul>/<ol> from `ordered`; the HTML serializer resolves ordinals via the numbering engine;
    // the a11y dom-mirror numbers native <ol> elements). #553.
    const el = listItemComponent.render(
      leafView({ listId: "L2", listLevel: 2 }),
      stubCtx({ value: 3, formatted: "3" }),
      [],
    ) as ElementBox;
    expect(el.metadata?.list).toEqual({ level: 2, listId: "L2", ordered: true });
    expect("value" in (el.metadata?.list ?? {})).toBe(false);
  });

  it("omits list metadata when the marker is unresolved (P-5)", () => {
    const el = listItemComponent.render(
      leafView({ listId: "L3", listLevel: 0 }),
      stubCtx(),
      [],
    ) as ElementBox;
    expect(el.metadata?.list).toBeUndefined();
  });

  // #418 — DELIBERATE inter-item spacing difference (property-lock, GREEN).
  // A list-item intentionally has ZERO default block margins (tight, cohesive
  // list packing — the Google-Docs / word-processor convention), UNLIKE the
  // paragraph component which defaults marginBlockEnd: 0.5em. This test locks
  // that deliberate difference so it can't silently regress.
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

      expect("marginBlockStart" in li.style).toBe(false);
      expect("marginBlockEnd" in li.style).toBe(false);

      expect(p.style.marginBlockEnd).toEqual({ unit: "em", value: 0.5 });
    });

    it("WITHIN-item line spacing is the SAME as a paragraph (lineHeight not reduced)", () => {
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
      leafView({ listId: "L1", listLevel: 0, marginInlineStart: 48 }),
      stubCtx(),
      [],
    ) as ElementBox;
    expect(el.style.marginInlineStart).toBe(48);
    expect(el.style.paddingInlineStart as number).toBeGreaterThan(0);
  });

  it("forwards writingMode / lineHeight / paragraph-spacing attrs", () => {
    const el = listItemComponent.render(
      leafView({
        writingMode: "vertical-rl",
        lineHeight: 1.5,
        marginBlockStart: 12,
        marginBlockEnd: 0,
      }),
      stubCtx(),
      [],
    ) as ElementBox;
    expect(el.style.writingMode).toBe("vertical-rl");
    expect(el.style.lineHeight).toBe(1.5);
    expect(el.style.marginBlockStart).toBe(12);
    expect(el.style.marginBlockEnd).toBe(0);
  });
});

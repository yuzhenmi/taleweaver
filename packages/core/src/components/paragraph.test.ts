import { describe, it, expect } from "vitest";
import { paragraphComponent } from "./paragraph";
import type { LeafBlockView, RenderContext } from "../render/block-view";
import type { RenderNode, ElementBox, TextBox } from "../render/render-node";
import type { BlockId, State } from "../state";
import type { ComputedStyle } from "../styles";

function leafView(overrides: Partial<LeafBlockView> = {}): LeafBlockView {
  return {
    id: "p1" as BlockId,
    type: "paragraph",
    attrs: Object.freeze({}),
    computedStyle: {} as ComputedStyle,
    kind: "leaf",
    inlineContent: { items: [] },
    ...overrides,
  };
}

function stubCtx(): RenderContext {
  return {
    state: {} as State,
    getView: () => { throw new Error("stub"); },
    getEmbedContent: () => { throw new Error("stub"); },
  };
}

describe("paragraphComponent (new)", () => {
  it("has type 'paragraph' and kind 'leaf'", () => {
    expect(paragraphComponent.type).toBe("paragraph");
    expect(paragraphComponent.kind).toBe("leaf");
  });

  it("renders an ElementBox with display: block and marginBlockEnd default", () => {
    const view = leafView();
    const node = paragraphComponent.render(view, stubCtx(), []);
    expect(node.type).toBe("element");
    const el = node as ElementBox;
    expect(el.key).toBe(view.id);
    expect(el.style.display).toBe("block");
    expect(el.style.marginBlockEnd).toEqual({ unit: "em", value: 0.5 });
  });

  it("passes inlineRenderNodes through as children", () => {
    const inline: ReadonlyArray<RenderNode> = [
      { type: "text", key: "p1/inline/0", style: {}, text: "hello" } as TextBox,
    ];
    const view = leafView();
    const node = paragraphComponent.render(view, stubCtx(), inline);
    const el = node as ElementBox;
    expect(el.children).toHaveLength(1);
    expect((el.children[0] as TextBox).text).toBe("hello");
  });
});

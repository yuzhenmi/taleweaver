import { describe, it, expect } from "vitest";
import { horizontalLineComponent } from "./horizontal-line";
import type { LeafBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId, State } from "../state";
import type { ComputedStyle } from "../styles";

function leafView(): LeafBlockView {
  return {
    id: "hr1" as BlockId,
    type: "horizontal-line",
    attrs: Object.freeze({}),
    computedStyle: {} as ComputedStyle,
    kind: "leaf",
    inlineContent: { items: [] },
  };
}

function stubCtx(): RenderContext {
  return { state: {} as State, footnoteNumber: () => undefined };
}

describe("horizontalLineComponent (new)", () => {
  it("has type 'horizontal-line' and kind 'leaf'", () => {
    expect(horizontalLineComponent.type).toBe("horizontal-line");
    expect(horizontalLineComponent.kind).toBe("leaf");
  });

  it("renders block-level ElementBox with fixed blockSize and horizontalLine metadata", () => {
    const node = horizontalLineComponent.render(leafView(), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.display).toBe("block");
    expect(el.style.blockSize).toBe(16);
    expect(el.metadata).toEqual({ horizontalLine: true });
    expect(el.children).toHaveLength(0);
  });
});

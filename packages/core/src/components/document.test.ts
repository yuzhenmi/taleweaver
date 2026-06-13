import { describe, it, expect } from "vitest";
import { documentComponent } from "./document";
import type { ContainerBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId, State } from "../state";
import type { ComputedStyle } from "../styles";

function containerView(overrides: Partial<ContainerBlockView> = {}): ContainerBlockView {
  return {
    id: "doc" as BlockId,
    type: "document",
    attrs: Object.freeze({}),
    computedStyle: {} as ComputedStyle,
    kind: "container",
    ...overrides,
  };
}

function stubCtx(): RenderContext {
  return {
    state: {} as State,
    footnoteNumber: () => undefined,
  };
}

describe("documentComponent (new)", () => {
  it("has type 'document' and kind 'container'", () => {
    expect(documentComponent.type).toBe("document");
    expect(documentComponent.kind).toBe("container");
  });

  it("renders an ElementBox with display: block at the root", () => {
    const view = containerView();
    const node = documentComponent.render(view, stubCtx(), []);
    expect(node.type).toBe("element");
    const el = node as ElementBox;
    expect(el.key).toBe(view.id);
    expect(el.style.display).toBe("block");
    // Google-Docs body defaults: spaces preserved + wrapped, and long unbreakable
    // strings break to fit the page (overflow-wrap: break-word over CSS `normal`).
    expect(el.style.whiteSpace).toBe("break-spaces");
    expect(el.style.overflowWrap).toBe("break-word");
  });

  it("passes childRenderNodes through unchanged", () => {
    const child: ElementBox = { type: "element", key: "p1", style: {}, children: [] };
    const node = documentComponent.render(containerView(), stubCtx(), [child]);
    const el = node as ElementBox;
    expect(el.children).toHaveLength(1);
    expect(el.children[0]).toBe(child);
  });
});

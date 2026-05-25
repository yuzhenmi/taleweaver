import { describe, it, expect } from "vitest";
import { createDefaultComponentRegistry } from "./component-registry";
import { sectionComponent } from "./section";
import type { ContainerBlockView, RenderContext } from "../render/block-view";
import type { BlockView } from "../render/block-view";
import type { BlockId } from "../state/block-id";
import { INITIAL_COMPUTED_STYLE } from "../styles/property-meta";

// A fully-typed minimal ContainerBlockView fixture — no `any`/`as never`.
// sectionComponent.render only reads `view.id`, but we satisfy the whole
// interface so the test is honest about the contract.
function makeContainerView(id: string): ContainerBlockView {
  return {
    id: id as BlockId,
    type: "section",
    attrs: Object.freeze({}),
    computedStyle: INITIAL_COMPUTED_STYLE,
    kind: "container",
  } satisfies ContainerBlockView;
}

// A typed RenderContext fixture. The accessors throw — sectionComponent
// never calls them, matching the renderer's P7 stub behavior.
function makeContext(): RenderContext {
  return {
    state: {} as RenderContext["state"],
    getView: (_id: BlockId): BlockView => {
      throw new Error("getView not used by sectionComponent");
    },
    getEmbedContent: (_id: BlockId): BlockView => {
      throw new Error("getEmbedContent not used by sectionComponent");
    },
  };
}

describe("sectionComponent", () => {
  it("is registered as a container kind", () => {
    const reg = createDefaultComponentRegistry();
    expect(reg.getBlockKind("section")).toBe("container");
  });

  it("renders an ElementBox with display: contents keyed by the view id", () => {
    const node = sectionComponent.render(makeContainerView("sec1"), makeContext(), []);
    expect(node.type).toBe("element");
    if (node.type !== "element") throw new Error("expected an element box");
    expect(node.style).toEqual({ display: "contents" });
    expect(node.key).toBe("sec1");
    expect(node.children).toEqual([]);
  });
});

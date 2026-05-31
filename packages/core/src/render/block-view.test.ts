import { describe, it, expect } from "vitest";
import type {
  BlockView,
  ContainerBlockView,
  LeafBlockView,
  RenderContext,
} from "./block-view";
import type { BlockId, InlineContent, State } from "../state";
import type { ComputedStyle } from "../styles";

describe("block-view (types)", () => {
  it("ContainerBlockView has the documented shape", () => {
    const cs = {} as ComputedStyle; // tests only verify the shape compiles
    const view: ContainerBlockView = {
      id: "root" as BlockId,
      type: "document",
      attrs: Object.freeze({}),
      computedStyle: cs,
      kind: "container",
    };
    expect(view.kind).toBe("container");
    expect(view.id).toBe("root");
  });

  it("LeafBlockView has inlineContent and kind === 'leaf'", () => {
    const cs = {} as ComputedStyle;
    const content: InlineContent = Object.freeze({ items: Object.freeze([]) });
    const view: LeafBlockView = {
      id: "p1" as BlockId,
      type: "paragraph",
      attrs: Object.freeze({}),
      computedStyle: cs,
      kind: "leaf",
      inlineContent: content,
    };
    expect(view.kind).toBe("leaf");
    expect(view.inlineContent.items).toHaveLength(0);
  });

  it("BlockView is a discriminated union (kind narrows the shape)", () => {
    const cs = {} as ComputedStyle;
    const view: BlockView = {
      id: "root" as BlockId,
      type: "document",
      attrs: Object.freeze({}),
      computedStyle: cs,
      kind: "container",
    };
    if (view.kind === "container") {
      // type-narrows to ContainerBlockView; no inlineContent
      expect("inlineContent" in view).toBe(false);
    }
  });

  it("RenderContext provides state + footnoteNumber accessor", () => {
    // Declare a stub matching the contract — proves the interface shape
    // is implementable. If RenderContext loses any of these members, this
    // assignment stops compiling and the test breaks loudly.
    const stub: RenderContext = {
      state: {} as State,
      footnoteNumber: () => undefined,
    };
    expect(typeof stub.footnoteNumber).toBe("function");
    expect(stub.state).toBeDefined();
  });
});

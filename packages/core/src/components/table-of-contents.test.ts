import { describe, it, expect } from "vitest";
import { tableOfContentsComponent } from "./table-of-contents";
import { createDefaultComponentRegistry } from "./component-registry";
import type { LeafBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId, State } from "../state";
import type { ComputedStyle } from "../styles";

function leafView(): LeafBlockView {
  return {
    id: "toc1" as BlockId,
    type: "table-of-contents",
    attrs: Object.freeze({}),
    computedStyle: {} as ComputedStyle,
    kind: "leaf",
    inlineContent: { items: [] },
  };
}

function stubCtx(): RenderContext {
  return { state: {} as State, footnoteNumber: () => undefined };
}

describe("tableOfContentsComponent", () => {
  it("is an atomic leaf typed 'table-of-contents'", () => {
    expect(tableOfContentsComponent.type).toBe("table-of-contents");
    expect(tableOfContentsComponent.kind).toBe("leaf");
    expect(tableOfContentsComponent.leafShape).toBe("atomic");
  });

  it("renders a block-level placeholder ElementBox tagged with tableOfContents metadata", () => {
    const node = tableOfContentsComponent.render(leafView(), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.display).toBe("block");
    expect(el.style.blockSize).toBe(0);
    expect(el.metadata).toEqual({ tableOfContents: true });
    expect(el.children).toHaveLength(0);
  });

  it("is registered in the default component registry", () => {
    const reg = createDefaultComponentRegistry();
    expect(reg.get("table-of-contents")).toBe(tableOfContentsComponent);
    expect(reg.getBlockKind("table-of-contents")).toBe("atomic-leaf");
  });
});

import { describe, it, expect } from "vitest";
import { templateBodyComponent } from "./template-body";
import type { ContainerBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId } from "../state";
import { INITIAL_COMPUTED_STYLE } from "../styles";

/**
 * A minimal `ContainerBlockView` carrying just the field
 * `templateBodyComponent.render` reads (`id`). The other `BlockViewBase` fields
 * satisfy the type but are unused by the render fn.
 */
function bodyView(): ContainerBlockView {
  return {
    id: "tb-0" as BlockId,
    type: "template-body",
    kind: "container",
    attrs: {},
    computedStyle: INITIAL_COMPUTED_STYLE,
  };
}

/** The render fn reads NOTHING from context; `state` throws to make any use loud. */
function stubRenderContext(): RenderContext {
  return {
    get state(): never {
      throw new Error("template-body render must not read context.state");
    },
    footnoteNumber(): string | undefined {
      return undefined;
    },
  };
}

describe("templateBodyComponent", () => {
  it("renders a block with the Google-Docs body defaults (break-spaces + break-word)", () => {
    const node = templateBodyComponent.render(bodyView(), stubRenderContext(), []);
    expect(node.type).toBe("element");
    const el = node as ElementBox;
    expect(el.key).toBe("tb-0");
    expect(el.style.display).toBe("block");
    // Header/footer body matches the document body: spaces preserved + wrapped,
    // and long unbreakable strings break to fit the page (overflow-wrap: break-word
    // over the CSS `normal` initial — principle 7). template-body is a SEPARATE
    // cascade root (its content does not inherit from the document root), so it
    // needs its OWN default, like footnote-body.
    expect(el.style.whiteSpace).toBe("break-spaces");
    expect(el.style.overflowWrap).toBe("break-word");
  });

  it("passes child render nodes through unchanged", () => {
    const child: ElementBox = { type: "element", key: "p1", style: {}, children: [] };
    const node = templateBodyComponent.render(bodyView(), stubRenderContext(), [child]);
    const el = node as ElementBox;
    expect(el.children).toHaveLength(1);
    expect(el.children[0]).toBe(child);
  });
});

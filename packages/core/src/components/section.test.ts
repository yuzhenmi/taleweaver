import { describe, it, expect } from "vitest";
import { createDefaultComponentRegistry } from "./component-registry";
import { sectionComponent } from "./section";
import type { ContainerBlockView, RenderContext } from "../render/block-view";
import type { BlockId } from "../state";
import { INITIAL_COMPUTED_STYLE } from "../styles/property-meta";

// A fully-typed minimal ContainerBlockView fixture — no `any`/`as never`.
// sectionComponent.render reads `view.id` and the page-geometry `view.attrs`,
// so we satisfy the whole interface and allow callers to supply geometry attrs.
function makeContainerView(
  id: string,
  attrs: Record<string, unknown> = {},
): ContainerBlockView {
  return {
    id: id as BlockId,
    type: "section",
    attrs: Object.freeze(attrs),
    computedStyle: INITIAL_COMPUTED_STYLE,
    kind: "container",
  } satisfies ContainerBlockView;
}

// A typed RenderContext fixture. sectionComponent reads none of these.
function makeContext(): RenderContext {
  return {
    state: {} as RenderContext["state"],
    footnoteNumber: (_id: BlockId): string | undefined => undefined,
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

  it("stamps the { blockType: 'section' } metadata marker so buildSectionPlan can identify it", () => {
    const node = sectionComponent.render(makeContainerView("sec1"), makeContext(), []);
    if (node.type !== "element") throw new Error("expected an element box");
    expect(node.metadata?.blockType).toBe("section");
  });

  it("round-trips page-geometry attrs into metadata so the layout pre-pass can read them", () => {
    const node = sectionComponent.render(
      makeContainerView("sec1", {
        pageInlineSize: 700,
        pageBlockSize: 900,
        pageGap: 40,
        pageMargins: { blockStart: 50, blockEnd: 50, inlineStart: 80, inlineEnd: 80 },
        // Multi-column overrides (slice 1) ride through metadata the same way.
        columnCount: 3,
        columnGap: 24,
        columnRule: { width: 1, style: "solid", color: "#ff0000" },
      }),
      makeContext(),
      [],
    );
    if (node.type !== "element") throw new Error("expected an element box");
    expect(node.metadata?.pageInlineSize).toBe(700);
    expect(node.metadata?.pageBlockSize).toBe(900);
    expect(node.metadata?.pageGap).toBe(40);
    expect(node.metadata?.pageMargins).toEqual({
      blockStart: 50,
      blockEnd: 50,
      inlineStart: 80,
      inlineEnd: 80,
    });
    // Multi-column attrs are stamped RAW (resolved later by resolveColumnConfig).
    expect(node.metadata?.columnCount).toBe(3);
    expect(node.metadata?.columnGap).toBe(24);
    expect(node.metadata?.columnRule).toEqual({ width: 1, style: "solid", color: "#ff0000" });
    // The section marker still rides alongside the geometry attrs.
    expect(node.metadata?.blockType).toBe("section");
  });

  it("leaves geometry metadata keys undefined when the section has no overrides (transparency preserved)", () => {
    const node = sectionComponent.render(makeContainerView("sec1"), makeContext(), []);
    if (node.type !== "element") throw new Error("expected an element box");
    // display:contents transparency is unchanged; absence is fine — the
    // validator treats undefined as "no override".
    expect(node.style).toEqual({ display: "contents" });
    expect(node.metadata?.pageInlineSize).toBeUndefined();
    expect(node.metadata?.pageBlockSize).toBeUndefined();
    expect(node.metadata?.pageGap).toBeUndefined();
    expect(node.metadata?.pageMargins).toBeUndefined();
    // Column overrides absent too ⇒ resolveColumnConfig keeps the doc default.
    expect(node.metadata?.columnCount).toBeUndefined();
    expect(node.metadata?.columnGap).toBeUndefined();
    expect(node.metadata?.columnRule).toBeUndefined();
  });
});

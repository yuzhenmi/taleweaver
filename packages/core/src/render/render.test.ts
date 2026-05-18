import { describe, it, expect } from "vitest";
import { render, type RenderOutput } from "./render";
import { createComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import type {
  ContainerComponentDefinition,
  LeafComponentDefinition,
} from "../components/component-definition";
import type { RenderNode } from "./render-node";
import { createEmptyDocument } from "../state/initial-state";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";

const documentComponent: ContainerComponentDefinition = {
  type: "document",
  kind: "container",
  render: (view, _ctx, children) =>
    ({ type: "element", key: view.id, style: { display: "block" }, children } as RenderNode),
};

const paragraphComponent: LeafComponentDefinition = {
  type: "paragraph",
  kind: "leaf",
  render: (view, _ctx, inlineChildren) =>
    ({ type: "element", key: view.id, style: { display: "block" }, children: inlineChildren } as RenderNode),
};

function basicRegistry() {
  const reg = createComponentRegistry();
  reg.register(documentComponent);
  reg.register(paragraphComponent);
  return reg;
}

describe("render (new)", () => {
  it("renders an empty document", () => {
    const state = createEmptyDocument();
    const out: RenderOutput = render(state, basicRegistry(), createDefaultAttrRegistry());
    expect(out.root.type).toBe("element");
    expect((out.root as { children: ReadonlyArray<RenderNode> }).children).toHaveLength(1);
  });

  it("renders a single paragraph with text content", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    expect(out.root.type).toBe("element");
    const docChildren = (out.root as { children: ReadonlyArray<RenderNode> }).children;
    expect(docChildren).toHaveLength(1);
    const p = docChildren[0] as { children: ReadonlyArray<RenderNode> };
    expect(p.children).toHaveLength(1);
    expect((p.children[0] as { text: string }).text).toBe("hello");
  });

  it("renders inline-mixed-attrs into separate TextBoxes", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("hello"),
            text("world", { bold: true }),
          ]),
        }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    const p = ((out.root as { children: ReadonlyArray<RenderNode> }).children[0]) as { children: ReadonlyArray<RenderNode> };
    expect(p.children).toHaveLength(2);
    expect((p.children[0] as { text: string }).text).toBe("hello");
    expect((p.children[1] as { text: string }).text).toBe("world");
  });

  it("throws when an unregistered block type is encountered", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "x", lastChildId: "x" }),
        buildBlock({ id: "x", type: "unknown-block-type", parentId: "doc" }),
      ],
    });
    const reg = createComponentRegistry();
    reg.register(documentComponent);
    expect(() => render(state, reg, createDefaultAttrRegistry())).toThrow(/unknown-block-type/);
  });

  it("renders multi-paragraph document", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("two")]) }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    const docChildren = (out.root as { children: ReadonlyArray<RenderNode> }).children;
    expect(docChildren).toHaveLength(2);
  });

  it("passes computedStyle to components (cascade integration)", () => {
    // Narrowed read-only view of ComputedStyle for the assertion; the
    // production type's `fontWeight: FontWeight` (string | number) needn't
    // leak into the test.
    let observedFontWeight: unknown = undefined;
    let observedSet = false;
    const paragraphCapture: LeafComponentDefinition = {
      type: "paragraph",
      kind: "leaf",
      render: (view, _ctx, _children) => {
        observedFontWeight = view.computedStyle.fontWeight;
        observedSet = true;
        return { type: "element", key: view.id, style: {}, children: [] } as RenderNode;
      },
    };
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          attrs: { bold: true },
          inlineContent: inlineContent([text("x")]),
        }),
      ],
    });
    const reg = createComponentRegistry();
    reg.register(documentComponent);
    reg.register(paragraphCapture);
    render(state, reg, createDefaultAttrRegistry());
    expect(observedSet).toBe(true);
    expect(observedFontWeight).toBe("bold");
  });
});

import { describe, it, expect } from "vitest";
import type {
  ComponentDefinition,
  ContainerComponentDefinition,
  LeafComponentDefinition,
} from "./component-definition";
import type { RenderNode } from "../render/render-node";

describe("component-definition (new union)", () => {
  it("ContainerComponentDefinition is well-formed", () => {
    const def: ContainerComponentDefinition = {
      type: "document",
      kind: "container",
      render: (_view, _ctx, children) =>
        ({ type: "element", key: "doc", style: {}, children } as RenderNode),
    };
    expect(def.type).toBe("document");
    expect(def.kind).toBe("container");
  });

  it("LeafComponentDefinition is well-formed", () => {
    const def: LeafComponentDefinition = {
      type: "paragraph",
      kind: "leaf",
      leafShape: "inline-bearing",
      render: (_view, _ctx, inlineChildren) =>
        ({ type: "element", key: "p", style: {}, children: inlineChildren } as RenderNode),
    };
    expect(def.type).toBe("paragraph");
    expect(def.kind).toBe("leaf");
    expect(def.leafShape).toBe("inline-bearing");
  });

  it("LeafComponentDefinition supports atomic leafShape", () => {
    const def: LeafComponentDefinition = {
      type: "image",
      kind: "leaf",
      leafShape: "atomic",
      render: (_view, _ctx, inlineChildren) =>
        ({ type: "element", key: "img", style: {}, children: inlineChildren } as RenderNode),
    };
    expect(def.leafShape).toBe("atomic");
  });

  it("ComponentDefinition is a discriminated union", () => {
    const defs: ComponentDefinition[] = [];
    defs.push({
      type: "document",
      kind: "container",
      render: (_v, _c, children) => ({ type: "element", key: "x", style: {}, children } as RenderNode),
    });
    defs.push({
      type: "paragraph",
      kind: "leaf",
      leafShape: "inline-bearing",
      render: (_v, _c, children) => ({ type: "element", key: "x", style: {}, children } as RenderNode),
    });
    expect(defs).toHaveLength(2);
    expect(defs.map((d) => d.kind)).toEqual(["container", "leaf"]);
  });
});

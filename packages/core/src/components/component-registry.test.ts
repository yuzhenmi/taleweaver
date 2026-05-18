import { describe, it, expect } from "vitest";
import {
  createComponentRegistry,
  createDefaultComponentRegistry,
} from "./component-registry";
import type { ComponentDefinition } from "./component-definition";
import type { RenderNode } from "../render/render-node";

describe("component-registry (new)", () => {
  it("createComponentRegistry returns an empty registry", () => {
    const reg = createComponentRegistry();
    expect(reg.has("paragraph")).toBe(false);
    expect(reg.get("paragraph")).toBeUndefined();
  });

  it("register adds a definition; get returns it", () => {
    const reg = createComponentRegistry();
    const def: ComponentDefinition = {
      type: "paragraph",
      kind: "leaf",
      render: (_v, _c, children) =>
        ({ type: "element", key: "p", style: {}, children } as RenderNode),
    };
    reg.register(def);
    expect(reg.has("paragraph")).toBe(true);
    expect(reg.get("paragraph")).toBe(def);
  });

  it("register replaces an existing definition with the same type", () => {
    const reg = createComponentRegistry();
    const a: ComponentDefinition = {
      type: "p",
      kind: "leaf",
      render: (_v, _c, c) => ({ type: "element", key: "a", style: {}, children: c } as RenderNode),
    };
    const b: ComponentDefinition = {
      type: "p",
      kind: "leaf",
      render: (_v, _c, c) => ({ type: "element", key: "b", style: {}, children: c } as RenderNode),
    };
    reg.register(a);
    reg.register(b);
    expect(reg.get("p")).toBe(b);
  });

  it("createDefaultComponentRegistry registers all 10 built-in components", () => {
    const reg = createDefaultComponentRegistry();
    // Containers (6)
    expect(reg.has("document")).toBe(true);
    expect(reg.has("list")).toBe(true);
    expect(reg.has("list-item")).toBe(true);
    expect(reg.has("table")).toBe(true);
    expect(reg.has("table-row")).toBe(true);
    expect(reg.has("table-cell")).toBe(true);
    // Leaves (4)
    expect(reg.has("paragraph")).toBe(true);
    expect(reg.has("heading")).toBe(true);
    expect(reg.has("image")).toBe(true);
    expect(reg.has("horizontal-line")).toBe(true);
  });

  it("createDefaultComponentRegistry does NOT register text or span (master spec invariant)", () => {
    const reg = createDefaultComponentRegistry();
    expect(reg.has("text")).toBe(false);
    expect(reg.has("span")).toBe(false);
  });

  it("registered definitions have the correct kind discriminant", () => {
    const reg = createDefaultComponentRegistry();
    expect(reg.get("document")?.kind).toBe("container");
    expect(reg.get("list")?.kind).toBe("container");
    expect(reg.get("list-item")?.kind).toBe("container");
    expect(reg.get("table")?.kind).toBe("container");
    expect(reg.get("table-row")?.kind).toBe("container");
    expect(reg.get("table-cell")?.kind).toBe("container");
    expect(reg.get("paragraph")?.kind).toBe("leaf");
    expect(reg.get("heading")?.kind).toBe("leaf");
    expect(reg.get("image")?.kind).toBe("leaf");
    expect(reg.get("horizontal-line")?.kind).toBe("leaf");
  });
});

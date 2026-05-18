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

  it("createDefaultComponentRegistry returns a registry (empty until P8 populates)", () => {
    // P7 ships the factory function with no built-in components; P8
    // adds them as it migrates each one to the new union type.
    const reg = createDefaultComponentRegistry();
    expect(reg.has("paragraph")).toBe(false); // will be true after P8
    expect(reg.has("document")).toBe(false);
  });
});

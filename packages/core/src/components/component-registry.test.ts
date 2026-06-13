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
      leafShape: "inline-bearing",
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
      leafShape: "inline-bearing",
      render: (_v, _c, c) => ({ type: "element", key: "a", style: {}, children: c } as RenderNode),
    };
    const b: ComponentDefinition = {
      type: "p",
      kind: "leaf",
      leafShape: "inline-bearing",
      render: (_v, _c, c) => ({ type: "element", key: "b", style: {}, children: c } as RenderNode),
    };
    reg.register(a);
    reg.register(b);
    expect(reg.get("p")).toBe(b);
  });

  it("createDefaultComponentRegistry registers the built-in components", () => {
    const reg = createDefaultComponentRegistry();
    // Containers — note: no `list` container in the FLAT list model
    // (list-items carry listId/listLevel attrs; there is no wrapping block).
    expect(reg.has("document")).toBe(true);
    expect(reg.has("table")).toBe(true);
    expect(reg.has("table-row")).toBe(true);
    expect(reg.has("table-cell")).toBe(true);
    // Leaves
    expect(reg.has("paragraph")).toBe(true);
    expect(reg.has("heading")).toBe(true);
    expect(reg.has("list-item")).toBe(true);
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
    expect(reg.get("table")?.kind).toBe("container");
    expect(reg.get("table-row")?.kind).toBe("container");
    expect(reg.get("table-cell")?.kind).toBe("container");
    expect(reg.get("paragraph")?.kind).toBe("leaf");
    expect(reg.get("heading")?.kind).toBe("leaf");
    expect(reg.get("list-item")?.kind).toBe("leaf");
    expect(reg.get("image")?.kind).toBe("leaf");
    expect(reg.get("horizontal-line")?.kind).toBe("leaf");
  });
});

describe("component-registry — BlockKindResolver (getBlockKind)", () => {
  it("returns null for unregistered types", () => {
    const reg = createComponentRegistry();
    expect(reg.getBlockKind("paragraph")).toBeNull();
    expect(reg.getBlockKind("nope")).toBeNull();
  });

  it("returns 'container' for container components", () => {
    const reg = createDefaultComponentRegistry();
    expect(reg.getBlockKind("document")).toBe("container");
    expect(reg.getBlockKind("table")).toBe("container");
    expect(reg.getBlockKind("table-row")).toBe("container");
    expect(reg.getBlockKind("table-cell")).toBe("container");
  });

  it("returns 'inline-bearing-leaf' for inline-bearing leaf components", () => {
    const reg = createDefaultComponentRegistry();
    expect(reg.getBlockKind("paragraph")).toBe("inline-bearing-leaf");
    expect(reg.getBlockKind("heading")).toBe("inline-bearing-leaf");
    expect(reg.getBlockKind("list-item")).toBe("inline-bearing-leaf");
  });

  it("returns 'atomic-leaf' for atomic leaf components", () => {
    const reg = createDefaultComponentRegistry();
    expect(reg.getBlockKind("image")).toBe("atomic-leaf");
    expect(reg.getBlockKind("horizontal-line")).toBe("atomic-leaf");
  });

  it("derives the kind from a newly-registered third-party component", () => {
    const reg = createComponentRegistry();
    reg.register({
      type: "callout",
      kind: "leaf",
      leafShape: "inline-bearing",
      render: (_v, _c, c) =>
        ({ type: "element", key: "callout", style: {}, children: c } as RenderNode),
    });
    reg.register({
      type: "divider",
      kind: "leaf",
      leafShape: "atomic",
      render: (_v, _c, c) =>
        ({ type: "element", key: "divider", style: {}, children: c } as RenderNode),
    });
    reg.register({
      type: "section",
      kind: "container",
      render: (_v, _c, c) =>
        ({ type: "element", key: "section", style: {}, children: c } as RenderNode),
    });
    expect(reg.getBlockKind("callout")).toBe("inline-bearing-leaf");
    expect(reg.getBlockKind("divider")).toBe("atomic-leaf");
    expect(reg.getBlockKind("section")).toBe("container");
  });
});

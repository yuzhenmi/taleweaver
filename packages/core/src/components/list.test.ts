import { describe, it, expect } from "vitest";
import { listComponent } from "./list";
import { listItemComponent } from "./list-item";

describe("listComponent", () => {
  it("ordered list has decimal listStyleType and gutter padding", () => {
    const state = {
      id: "ol", type: "list", properties: { listType: "ordered" },
      style: {}, children: [],
    };
    const result = listComponent.render(state, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.style.display).toBe("block");
    expect(result.style.listStyleType).toBe("decimal");
    expect(result.style.paddingInlineStart).toBeDefined();
  });

  it("unordered list has disc listStyleType", () => {
    const state = {
      id: "ul", type: "list", properties: { listType: "unordered" },
      style: {}, children: [],
    };
    const result = listComponent.render(state, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.style.listStyleType).toBe("disc");
  });

  it("preserves user inline style overrides", () => {
    const state = {
      id: "ul", type: "list", properties: { listType: "unordered" },
      style: { listStyleType: "square" as const },
      children: [],
    };
    const result = listComponent.render(state, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.style.listStyleType).toBe("square");
  });
});

describe("listItemComponent", () => {
  it("produces display: list-item", () => {
    const state = {
      id: "li", type: "list-item", properties: {}, style: {}, children: [],
    };
    const result = listItemComponent.render(state, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.style.display).toBe("list-item");
  });

  it("passes children through", () => {
    const state = {
      id: "li", type: "list-item", properties: {}, style: {}, children: [],
    };
    const result = listItemComponent.render(state, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.children).toHaveLength(0);
  });
});

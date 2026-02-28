import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "./create-node";

describe("createNode", () => {
  it("creates a node with the given id and type", () => {
    const node = createNode("n1", "paragraph");
    expect(node.id).toBe("n1");
    expect(node.type).toBe("paragraph");
  });

  it("defaults to empty properties and children", () => {
    const node = createNode("n1", "test");
    expect(node.properties).toEqual({});
    expect(node.children).toEqual([]);
  });

  it("freezes the returned node", () => {
    const node = createNode("n1", "test");
    expect(Object.isFrozen(node)).toBe(true);
  });

  it("freezes properties", () => {
    const node = createNode("n1", "test", { key: "value" });
    expect(Object.isFrozen(node.properties)).toBe(true);
  });

  it("freezes children array", () => {
    const child = createNode("c1", "child");
    const node = createNode("n1", "parent", {}, [child]);
    expect(Object.isFrozen(node.children)).toBe(true);
  });

  it("copies properties so mutations don't affect the node", () => {
    const props = { key: "value" };
    const node = createNode("n1", "test", props);
    props.key = "changed";
    expect(node.properties.key).toBe("value");
  });

  it("copies children so mutations don't affect the node", () => {
    const child = createNode("c1", "child");
    const children = [child];
    const node = createNode("n1", "parent", {}, children);
    children.push(createNode("c2", "child"));
    expect(node.children).toHaveLength(1);
  });
});

describe("createTextNode", () => {
  it("creates a text-typed node with content property", () => {
    const node = createTextNode("t1", "hello");
    expect(node.id).toBe("t1");
    expect(node.type).toBe("text");
    expect(node.properties.content).toBe("hello");
  });

  it("works with empty content", () => {
    const node = createTextNode("t1", "");
    expect(node.properties.content).toBe("");
  });

  it("has no children", () => {
    const node = createTextNode("t1", "hi");
    expect(node.children).toHaveLength(0);
  });
});

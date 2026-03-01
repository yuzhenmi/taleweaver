import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "./create-node";

describe("StateNode", () => {
  it("creates a node with id, type, properties, and children", () => {
    const child = createNode("c1", "text", { content: "hello" });
    const parent = createNode("p1", "paragraph", {}, [child]);

    expect(parent.id).toBe("p1");
    expect(parent.type).toBe("paragraph");
    expect(parent.properties).toEqual({});
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toBe(child);
  });

  it("creates a leaf node with no children", () => {
    const leaf = createNode("l1", "text", { content: "world" });
    expect(leaf.children).toHaveLength(0);
    expect(leaf.properties).toEqual({ content: "world" });
  });

  it("creates a text node with content shorthand", () => {
    const text = createTextNode("t1", "hello");
    expect(text.type).toBe("text");
    expect(text.properties).toEqual({ content: "hello" });
    expect(text.children).toHaveLength(0);
  });

  it("builds a multi-level tree", () => {
    const t1 = createTextNode("t1", "Hello ");
    const t2 = createTextNode("t2", "world");
    const para = createNode("p1", "paragraph", {}, [t1, t2]);
    const doc = createNode("doc", "document", {}, [para]);

    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].children).toHaveLength(2);
    expect(doc.children[0].children[0].properties.content).toBe("Hello ");
    expect(doc.children[0].children[1].properties.content).toBe("world");
  });

  it("properties are read-only at the type level", () => {
    const node = createNode("n1", "paragraph", { align: "left" });
    // TypeScript prevents mutation; at runtime we verify the object is frozen
    expect(Object.isFrozen(node)).toBe(true);
    expect(Object.isFrozen(node.properties)).toBe(true);
    expect(Object.isFrozen(node.children)).toBe(true);
  });

  it("has an empty styles object by default", () => {
    const node = createNode("n1", "paragraph", {});
    expect(node.styles).toEqual({});
  });

  it("accepts styles on creation", () => {
    const node = createNode("n1", "text", { content: "hi" }, [], {
      fontWeight: "bold",
      fontStyle: "italic",
    });
    expect(node.styles.fontWeight).toBe("bold");
    expect(node.styles.fontStyle).toBe("italic");
  });

  it("styles are frozen", () => {
    const node = createNode("n1", "text", {}, [], {
      textDecoration: "underline",
    });
    expect(Object.isFrozen(node.styles)).toBe(true);
  });

  it("styles are separate from properties", () => {
    const node = createNode("n1", "span", {}, [], {
      fontWeight: "bold",
    });
    expect(node.properties).toEqual({});
    expect(node.styles.fontWeight).toBe("bold");
  });
});

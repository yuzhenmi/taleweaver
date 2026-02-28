import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "./create-node";
import {
  updateProperties,
  insertChild,
  removeChild,
  getNodeByPath,
  updateAtPath,
} from "./operations";

describe("updateProperties", () => {
  it("returns a new node with updated properties", () => {
    const node = createNode("n1", "paragraph", { align: "left" });
    const updated = updateProperties(node, { align: "center" });

    expect(updated.properties.align).toBe("center");
    expect(updated.id).toBe("n1");
    expect(updated).not.toBe(node); // new reference
  });

  it("preserves unmodified properties", () => {
    const node = createNode("n1", "paragraph", { align: "left", indent: 0 });
    const updated = updateProperties(node, { align: "center" });

    expect(updated.properties.indent).toBe(0);
    expect(updated.properties.align).toBe("center");
  });

  it("preserves children by reference (structural sharing)", () => {
    const child = createTextNode("t1", "hello");
    const node = createNode("p1", "paragraph", {}, [child]);
    const updated = updateProperties(node, { align: "right" });

    expect(updated.children[0]).toBe(child);
  });
});

describe("insertChild", () => {
  it("inserts a child at a given index", () => {
    const c1 = createTextNode("t1", "a");
    const c2 = createTextNode("t2", "b");
    const parent = createNode("p1", "paragraph", {}, [c1]);
    const updated = insertChild(parent, c2, 1);

    expect(updated.children).toHaveLength(2);
    expect(updated.children[0]).toBe(c1); // shared
    expect(updated.children[1]).toBe(c2);
    expect(updated).not.toBe(parent);
  });

  it("inserts at the beginning", () => {
    const c1 = createTextNode("t1", "a");
    const c2 = createTextNode("t2", "b");
    const parent = createNode("p1", "paragraph", {}, [c1]);
    const updated = insertChild(parent, c2, 0);

    expect(updated.children[0]).toBe(c2);
    expect(updated.children[1]).toBe(c1);
  });
});

describe("removeChild", () => {
  it("removes a child at a given index", () => {
    const c1 = createTextNode("t1", "a");
    const c2 = createTextNode("t2", "b");
    const parent = createNode("p1", "paragraph", {}, [c1, c2]);
    const updated = removeChild(parent, 0);

    expect(updated.children).toHaveLength(1);
    expect(updated.children[0]).toBe(c2); // shared
  });
});

describe("getNodeByPath", () => {
  it("returns root for empty path", () => {
    const doc = createNode("doc", "document");
    expect(getNodeByPath(doc, [])).toBe(doc);
  });

  it("navigates to a nested child", () => {
    const t1 = createTextNode("t1", "hello");
    const t2 = createTextNode("t2", "world");
    const p1 = createNode("p1", "paragraph", {}, [t1, t2]);
    const doc = createNode("doc", "document", {}, [p1]);

    expect(getNodeByPath(doc, [0])).toBe(p1);
    expect(getNodeByPath(doc, [0, 1])).toBe(t2);
  });

  it("returns undefined for invalid path", () => {
    const doc = createNode("doc", "document");
    expect(getNodeByPath(doc, [5])).toBeUndefined();
  });
});

describe("updateAtPath", () => {
  it("updates a deeply nested node with structural sharing", () => {
    const t1 = createTextNode("t1", "hello");
    const t2 = createTextNode("t2", "world");
    const p1 = createNode("p1", "paragraph", {}, [t1, t2]);
    const p2 = createNode("p2", "paragraph", {}, [createTextNode("t3", "!")]);
    const doc = createNode("doc", "document", {}, [p1, p2]);

    const newT1 = createTextNode("t1", "hi");
    const newDoc = updateAtPath(doc, [0, 0], newT1);

    // Changed path gets new references
    expect(newDoc).not.toBe(doc);
    expect(newDoc.children[0]).not.toBe(p1);
    expect(newDoc.children[0].children[0]).toBe(newT1);

    // Unchanged subtrees share identity
    expect(newDoc.children[0].children[1]).toBe(t2);
    expect(newDoc.children[1]).toBe(p2);
  });

  it("updates root for empty path", () => {
    const doc = createNode("doc", "document");
    const newDoc = createNode("doc2", "document");
    expect(updateAtPath(doc, [], newDoc)).toBe(newDoc);
  });

  it("throws on out-of-bounds path", () => {
    const doc = createNode("doc", "document");
    expect(() => updateAtPath(doc, [5], createNode("x", "x"))).toThrow(
      RangeError,
    );
  });
});

describe("bounds validation", () => {
  it("insertChild throws on negative index", () => {
    const node = createNode("n", "paragraph");
    expect(() => insertChild(node, createTextNode("t", "x"), -1)).toThrow(
      RangeError,
    );
  });

  it("insertChild throws on out-of-bounds index", () => {
    const node = createNode("n", "paragraph");
    expect(() => insertChild(node, createTextNode("t", "x"), 2)).toThrow(
      RangeError,
    );
  });

  it("removeChild throws on out-of-bounds index", () => {
    const node = createNode("n", "paragraph");
    expect(() => removeChild(node, 0)).toThrow(RangeError);
  });

  it("removeChild throws on negative index", () => {
    const c = createTextNode("t", "x");
    const node = createNode("n", "paragraph", {}, [c]);
    expect(() => removeChild(node, -1)).toThrow(RangeError);
  });
});

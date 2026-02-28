import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "./create-node";
import { findPathById } from "./find-path";

describe("findPathById", () => {
  const doc = createNode("doc", "document", {}, [
    createNode("p0", "paragraph", {}, [
      createTextNode("t0", "Hello"),
      createNode("s0", "span", {}, [createTextNode("t1", " world")]),
    ]),
    createNode("p1", "paragraph", {}, [createTextNode("t2", "Second")]),
  ]);

  it("finds the root node", () => {
    expect(findPathById(doc, "doc")).toEqual([]);
  });

  it("finds a direct child", () => {
    expect(findPathById(doc, "p0")).toEqual([0]);
    expect(findPathById(doc, "p1")).toEqual([1]);
  });

  it("finds a nested text node", () => {
    expect(findPathById(doc, "t0")).toEqual([0, 0]);
    expect(findPathById(doc, "t2")).toEqual([1, 0]);
  });

  it("finds a deeply nested node", () => {
    expect(findPathById(doc, "s0")).toEqual([0, 1]);
    expect(findPathById(doc, "t1")).toEqual([0, 1, 0]);
  });

  it("returns null for a non-existent id", () => {
    expect(findPathById(doc, "nope")).toBeNull();
  });
});

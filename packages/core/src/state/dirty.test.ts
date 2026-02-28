import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "./create-node";
import { createPosition } from "./position";
import { insertText } from "./transformations";
import { findDirtyPaths, isDirty } from "./dirty";

describe("dirty tracking", () => {
  function makeDoc() {
    const t1 = createTextNode("t1", "Hello");
    const t2 = createTextNode("t2", "world");
    const p1 = createNode("p1", "paragraph", {}, [t1, t2]);
    const p2 = createNode("p2", "paragraph", {}, [createTextNode("t3", "!")]);
    return createNode("doc", "document", {}, [p1, p2]);
  }

  it("detects dirty paths after a transformation", () => {
    const doc = makeDoc();
    const change = insertText(doc, createPosition([0, 0], 5), "!");
    const paths = findDirtyPaths(doc, change.newState);

    // Root, p1, and t1 should be dirty (their references changed)
    expect(paths).toContainEqual([]);       // root
    expect(paths).toContainEqual([0]);      // p1
    expect(paths).toContainEqual([0, 0]);   // t1
  });

  it("does not mark unchanged subtrees as dirty", () => {
    const doc = makeDoc();
    const change = insertText(doc, createPosition([0, 0], 5), "!");
    const paths = findDirtyPaths(doc, change.newState);

    // p2 and t2 should NOT be dirty
    expect(paths).not.toContainEqual([1]);      // p2 unchanged
    expect(paths).not.toContainEqual([0, 1]);   // t2 unchanged
  });

  it("isDirty returns true for changed nodes", () => {
    const doc = makeDoc();
    const change = insertText(doc, createPosition([0, 0], 5), "!");

    expect(isDirty(doc, change.newState, [])).toBe(true);
    expect(isDirty(doc, change.newState, [0])).toBe(true);
    expect(isDirty(doc, change.newState, [0, 0])).toBe(true);
  });

  it("isDirty returns false for unchanged nodes", () => {
    const doc = makeDoc();
    const change = insertText(doc, createPosition([0, 0], 5), "!");

    expect(isDirty(doc, change.newState, [1])).toBe(false);
    expect(isDirty(doc, change.newState, [0, 1])).toBe(false);
  });

  it("identical trees have no dirty paths", () => {
    const doc = makeDoc();
    expect(findDirtyPaths(doc, doc)).toEqual([]);
  });

  it("reports added children as dirty", () => {
    const t1 = createTextNode("t1", "First");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const doc1 = createNode("doc", "document", {}, [p1]);

    const t2 = createTextNode("t2", "Second");
    const p2 = createNode("p2", "paragraph", {}, [t2]);
    const doc2 = createNode("doc", "document", {}, [p1, p2]);

    const paths = findDirtyPaths(doc1, doc2);
    expect(paths).toContainEqual([]);    // root changed
    expect(paths).toContainEqual([1]);   // new child p2
  });

  it("reports removed children as dirty", () => {
    const t1 = createTextNode("t1", "First");
    const t2 = createTextNode("t2", "Second");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const p2 = createNode("p2", "paragraph", {}, [t2]);
    const doc1 = createNode("doc", "document", {}, [p1, p2]);

    const doc2 = createNode("doc", "document", {}, [p1]);

    const paths = findDirtyPaths(doc1, doc2);
    expect(paths).toContainEqual([]);    // root changed
    expect(paths).toContainEqual([1]);   // removed child p2
    // p1 is unchanged — should not be dirty
    expect(paths).not.toContainEqual([0]);
  });
});

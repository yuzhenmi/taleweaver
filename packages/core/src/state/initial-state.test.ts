import { describe, it, expect } from "vitest";
import { createEmptyDocument } from "./initial-state";

describe("createEmptyDocument", () => {
  it("creates a document with one paragraph and one text node", () => {
    const doc = createEmptyDocument();

    expect(doc.type).toBe("document");
    expect(doc.children).toHaveLength(1);

    const para = doc.children[0];
    expect(para.type).toBe("paragraph");
    expect(para.children).toHaveLength(1);

    const text = para.children[0];
    expect(text.type).toBe("text");
    expect(text.properties.content).toBe("");
  });

  it("is frozen (immutable)", () => {
    const doc = createEmptyDocument();
    expect(Object.isFrozen(doc)).toBe(true);
    expect(Object.isFrozen(doc.children[0])).toBe(true);
    expect(Object.isFrozen(doc.children[0].children[0])).toBe(true);
  });

  it("has valid IDs on all nodes", () => {
    const doc = createEmptyDocument();
    expect(doc.id).toBeTruthy();
    expect(doc.children[0].id).toBeTruthy();
    expect(doc.children[0].children[0].id).toBeTruthy();
  });
});

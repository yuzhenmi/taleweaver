import { describe, it, expect } from "vitest";
import { isOpaqueBlock, isStructuralParagraph, normalizeDocument } from "./normalize";
import { createNode, createTextNode } from "./create-node";

function para(id: string, text = ""): ReturnType<typeof createNode> {
  return createNode(id, "paragraph", {}, [createTextNode(`${id}-t`, text)]);
}

function hr(id: string): ReturnType<typeof createNode> {
  return createNode(id, "horizontal-line", {}, []);
}

function table(id: string): ReturnType<typeof createNode> {
  const text = createTextNode(`${id}-t`, "");
  const p = createNode(`${id}-p`, "paragraph", {}, [text]);
  const cell = createNode(`${id}-c`, "table-cell", {}, [p]);
  const row = createNode(`${id}-r`, "table-row", {}, [cell]);
  return createNode(id, "table", { columnWidths: [1], rowHeights: [0] }, [row]);
}

function doc(...children: ReturnType<typeof createNode>[]): ReturnType<typeof createNode> {
  return createNode("doc", "document", {}, children);
}

describe("isOpaqueBlock", () => {
  it("returns true for void blocks (no children)", () => {
    expect(isOpaqueBlock(hr("hr1"))).toBe(true);
  });

  it("returns true for image blocks", () => {
    const img = createNode("img1", "image", { src: "x" }, []);
    expect(isOpaqueBlock(img)).toBe(true);
  });

  it("returns true for tables", () => {
    expect(isOpaqueBlock(table("t1"))).toBe(true);
  });

  it("returns false for paragraphs", () => {
    expect(isOpaqueBlock(para("p1"))).toBe(false);
  });

  it("returns false for headings", () => {
    const heading = createNode("h1", "heading", { level: 1 }, [createTextNode("h1-t", "Title")]);
    expect(isOpaqueBlock(heading)).toBe(false);
  });

  it("returns false for lists", () => {
    const listItem = createNode("li1", "list-item", {}, [createTextNode("li1-t", "item")]);
    const list = createNode("l1", "list", { listType: "unordered" }, [listItem]);
    expect(isOpaqueBlock(list)).toBe(false);
  });
});

describe("isStructuralParagraph", () => {
  it("returns true for empty para between two opaque blocks", () => {
    const d = doc(hr("hr1"), para("p1"), hr("hr2"));
    expect(isStructuralParagraph(d, 1)).toBe(true);
  });

  it("returns true for empty para at doc start before opaque block", () => {
    const d = doc(para("p1"), hr("hr1"));
    expect(isStructuralParagraph(d, 0)).toBe(true);
  });

  it("returns true for empty para at doc end after opaque block", () => {
    const d = doc(hr("hr1"), para("p1"));
    expect(isStructuralParagraph(d, 1)).toBe(true);
  });

  it("returns false for non-empty paragraphs", () => {
    const d = doc(hr("hr1"), para("p1", "text"), hr("hr2"));
    expect(isStructuralParagraph(d, 1)).toBe(false);
  });

  it("returns false for empty para between regular blocks", () => {
    const d = doc(para("p1", "abc"), para("p2"), para("p3", "def"));
    expect(isStructuralParagraph(d, 1)).toBe(false);
  });

  it("returns false for non-paragraph nodes", () => {
    const d = doc(hr("hr1"), hr("hr2"));
    expect(isStructuralParagraph(d, 0)).toBe(false);
  });

  it("returns true for empty para between table and HR", () => {
    const d = doc(table("t1"), para("p1"), hr("hr1"));
    expect(isStructuralParagraph(d, 1)).toBe(true);
  });
});

describe("normalizeDocument", () => {
  it("inserts paragraph before opaque block when it is first child", () => {
    const d = doc(hr("hr1"), para("p1", "text"));
    let nextId = 0;
    const allocateId = () => `norm-${nextId++}`;
    const result = normalizeDocument(d, allocateId);

    expect(result.children).toHaveLength(3);
    expect(result.children[0].type).toBe("paragraph");
    expect(result.children[1].type).toBe("horizontal-line");
    expect(result.children[2].type).toBe("paragraph");
  });

  it("inserts paragraph between two adjacent opaque blocks", () => {
    const d = doc(para("p0", "before"), hr("hr1"), hr("hr2"), para("p1", "after"));
    let nextId = 0;
    const allocateId = () => `norm-${nextId++}`;
    const result = normalizeDocument(d, allocateId);

    expect(result.children).toHaveLength(5);
    expect(result.children[0].type).toBe("paragraph"); // "before"
    expect(result.children[1].type).toBe("horizontal-line");
    expect(result.children[2].type).toBe("paragraph"); // structural
    expect(result.children[3].type).toBe("horizontal-line");
    expect(result.children[4].type).toBe("paragraph"); // "after"
  });

  it("inserts paragraph at end if last child is opaque", () => {
    const d = doc(para("p1", "text"), hr("hr1"));
    let nextId = 0;
    const allocateId = () => `norm-${nextId++}`;
    const result = normalizeDocument(d, allocateId);

    expect(result.children).toHaveLength(3);
    expect(result.children[2].type).toBe("paragraph");
  });

  it("is a no-op when document is already valid", () => {
    const d = doc(para("p1", "abc"), para("p2", "def"));
    let nextId = 0;
    const allocateId = () => `norm-${nextId++}`;
    const result = normalizeDocument(d, allocateId);

    expect(result).toBe(d); // same reference
  });

  it("returns same reference when no changes needed", () => {
    const d = doc(para("p0"), hr("hr1"), para("p1"), hr("hr2"), para("p2"));
    let nextId = 0;
    const allocateId = () => `norm-${nextId++}`;
    const result = normalizeDocument(d, allocateId);

    expect(result).toBe(d);
  });

  it("handles single opaque block: inserts paragraphs before and after", () => {
    const d = doc(hr("hr1"));
    let nextId = 0;
    const allocateId = () => `norm-${nextId++}`;
    const result = normalizeDocument(d, allocateId);

    expect(result.children).toHaveLength(3);
    expect(result.children[0].type).toBe("paragraph");
    expect(result.children[1].type).toBe("horizontal-line");
    expect(result.children[2].type).toBe("paragraph");
  });

  it("handles table followed by HR", () => {
    const d = doc(table("t1"), hr("hr1"));
    let nextId = 0;
    const allocateId = () => `norm-${nextId++}`;
    const result = normalizeDocument(d, allocateId);

    // Should be: para, table, para, hr, para
    expect(result.children).toHaveLength(5);
    expect(result.children[0].type).toBe("paragraph");
    expect(result.children[1].type).toBe("table");
    expect(result.children[2].type).toBe("paragraph");
    expect(result.children[3].type).toBe("horizontal-line");
    expect(result.children[4].type).toBe("paragraph");
  });
});

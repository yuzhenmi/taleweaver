import { describe, it, expect } from "vitest";
import {
  createParagraph,
  createText,
  createHeading,
  createList,
  createListItem,
  createTable,
  createImage,
  createHorizontalLine,
} from "./factories";

describe("factories", () => {
  it("createText produces a text NewNode", () => {
    const n = createText("hello");
    expect(n.type).toBe("text");
    expect(n.properties).toEqual({ content: "hello" });
    expect(n.children).toEqual([]);
  });

  it("createParagraph produces a paragraph wrapping an empty text", () => {
    const n = createParagraph();
    expect(n.type).toBe("paragraph");
    expect(n.children).toHaveLength(1);
    expect(n.children[0].type).toBe("text");
  });

  it("createHeading produces a heading with level property", () => {
    const n = createHeading(2);
    expect(n.type).toBe("heading");
    expect(n.properties).toEqual({ level: 2 });
  });
});

describe("createList", () => {
  it("ordered", () => {
    const n = createList("ordered");
    expect(n.type).toBe("list");
    expect(n.properties).toEqual({ listType: "ordered" });
    expect(n.children).toHaveLength(1);
    expect(n.children[0].type).toBe("list-item");
  });
  it("unordered", () => {
    const n = createList("unordered");
    expect(n.properties).toEqual({ listType: "unordered" });
  });
});

describe("createListItem", () => {
  it("contains an empty paragraph", () => {
    const li = createListItem();
    expect(li.type).toBe("list-item");
    expect(li.children).toHaveLength(1);
    expect(li.children[0].type).toBe("paragraph");
  });
});

describe("createTable", () => {
  it("constructs rows × cols with even columnWidths", () => {
    const t = createTable(2, 3);
    expect(t.type).toBe("table");
    expect(t.properties.columnWidths).toEqual([1/3, 1/3, 1/3]);
    expect(t.children).toHaveLength(2);
    if (t.children[0].type !== "table-row") throw new Error("?");
    expect(t.children[0].children).toHaveLength(3);
    if (t.children[0].children[0].type !== "table-cell") throw new Error("?");
    expect(t.children[0].children[0].children[0].type).toBe("paragraph");
  });
});

describe("createImage", () => {
  it("carries src/width/height in properties", () => {
    const img = createImage("https://example.com/x.png", 200, 100);
    expect(img.type).toBe("image");
    expect(img.properties).toEqual({ src: "https://example.com/x.png", width: 200, height: 100 });
    expect(img.children).toEqual([]);
  });
});

describe("createHorizontalLine", () => {
  it("returns horizontal-line type", () => {
    const hr = createHorizontalLine();
    expect(hr.type).toBe("horizontal-line");
    expect(hr.children).toEqual([]);
  });
});

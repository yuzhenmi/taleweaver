import { describe, it, expect } from "vitest";
import { getTextContent, getTextContentLength, clampOffset } from "./text-utils";
import { createNode, createTextNode } from "./create-node";

describe("getTextContent", () => {
  it("returns content for text node", () => {
    const node = createTextNode("t1", "hello");
    expect(getTextContent(node)).toBe("hello");
  });

  it("returns empty string for empty text node", () => {
    const node = createTextNode("t1", "");
    expect(getTextContent(node)).toBe("");
  });

  it("returns empty string for non-text node", () => {
    const node = createNode("p1", "paragraph");
    expect(getTextContent(node)).toBe("");
  });

  it("returns empty string when content is not a string", () => {
    const node = createNode("n1", "custom", { content: 42 });
    expect(getTextContent(node)).toBe("");
  });
});

describe("getTextContentLength", () => {
  it("returns length for text node", () => {
    const node = createTextNode("t1", "hello");
    expect(getTextContentLength(node)).toBe(5);
  });

  it("returns 0 for empty text node", () => {
    const node = createTextNode("t1", "");
    expect(getTextContentLength(node)).toBe(0);
  });

  it("returns 0 for non-text node", () => {
    const node = createNode("p1", "paragraph");
    expect(getTextContentLength(node)).toBe(0);
  });
});

describe("clampOffset", () => {
  it("returns offset unchanged when within bounds", () => {
    expect(clampOffset(3, 5)).toBe(3);
  });

  it("returns contentLength when offset equals contentLength", () => {
    expect(clampOffset(5, 5)).toBe(5);
  });

  it("clamps offset to contentLength when offset exceeds it (virtual EOL)", () => {
    expect(clampOffset(6, 5)).toBe(5);
  });

  it("clamps large virtual offsets", () => {
    expect(clampOffset(100, 5)).toBe(5);
  });

  it("handles zero-length content", () => {
    expect(clampOffset(1, 0)).toBe(0);
  });

  it("returns 0 for offset 0", () => {
    expect(clampOffset(0, 5)).toBe(0);
  });
});

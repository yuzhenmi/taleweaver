import { describe, it, expect } from "vitest";
import { createParagraph, createText, createHeading } from "./factories";

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

import { describe, it, expect } from "vitest";
import type { NewNode } from "./node";

describe("NewNode", () => {
  it("is StateNode minus the id", () => {
    const n: NewNode = {
      type: "paragraph",
      properties: {},
      style: {},
      children: [{ type: "text", properties: { content: "" }, style: {}, children: [] }],
    };
    expect(n.type).toBe("paragraph");
    expect(n.children[0].type).toBe("text");
    // @ts-expect-error — id should not be allowed on NewNode
    n.id;
  });
});

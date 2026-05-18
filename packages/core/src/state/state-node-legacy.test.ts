import { describe, it, expect } from "vitest";
import type { StateNode } from "./state-node-legacy";

describe("StateNode (post-redesign)", () => {
  it("carries style: Style instead of styles: NodeStyles", () => {
    const node: StateNode = {
      id: "x",
      type: "paragraph",
      properties: {},
      style: { fontWeight: "bold" },
      children: [],
    };
    expect(node.style.fontWeight).toBe("bold");
  });
});

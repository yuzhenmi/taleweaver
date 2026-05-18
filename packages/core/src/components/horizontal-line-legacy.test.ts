import { describe, it, expect } from "vitest";
import { horizontalLineComponent } from "./horizontal-line-legacy";

describe("horizontalLineComponent", () => {
  it("produces a block with metadata.horizontalLine flag", () => {
    const state = {
      id: "hr",
      type: "horizontal-line",
      properties: {},
      style: {},
      children: [],
    };
    const result = horizontalLineComponent.render(state, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.style.display).toBe("block");
    expect(result.metadata?.horizontalLine).toBe(true);
  });

  it("has a default height", () => {
    const state = {
      id: "hr",
      type: "horizontal-line",
      properties: {},
      style: {},
      children: [],
    };
    const result = horizontalLineComponent.render(state, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.style.blockSize).toBeDefined();
  });
});

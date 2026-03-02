import { describe, it, expect } from "vitest";
import { horizontalLineComponent } from "./horizontal-line";
import { createNode } from "../state/create-node";

describe("horizontalLineComponent", () => {
  it("has type 'horizontal-line'", () => {
    expect(horizontalLineComponent.type).toBe("horizontal-line");
  });

  it("renders a block node with zero children", () => {
    const node = createNode("hr1", "horizontal-line");
    const result = horizontalLineComponent.render(node, []);
    expect(result.type).toBe("block");
    expect(result.children).toHaveLength(0);
  });

  it("sets paddingTop and paddingBottom for visual height", () => {
    const node = createNode("hr1", "horizontal-line");
    const result = horizontalLineComponent.render(node, []);
    expect(result.styles.paddingTop).toBe(12);
    expect(result.styles.paddingBottom).toBe(12);
  });

  it("sets marginTop and marginBottom", () => {
    const node = createNode("hr1", "horizontal-line");
    const result = horizontalLineComponent.render(node, []);
    expect(result.styles.marginTop).toBe(4);
    expect(result.styles.marginBottom).toBe(4);
  });

  it("sets metadata with type horizontal-line", () => {
    const node = createNode("hr1", "horizontal-line");
    const result = horizontalLineComponent.render(node, []);
    if (result.type !== "block") throw new Error("expected block");
    expect(result.metadata).toEqual({ type: "horizontal-line" });
  });

  it("uses node.id as key", () => {
    const node = createNode("hr1", "horizontal-line");
    const result = horizontalLineComponent.render(node, []);
    expect(result.key).toBe("hr1");
  });
});

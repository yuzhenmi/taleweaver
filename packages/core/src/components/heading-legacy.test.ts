import { describe, it, expect } from "vitest";
import { headingComponent } from "./heading-legacy";

describe("headingComponent", () => {
  it("renders block with bold, level-derived fontSize", () => {
    const stateNode = {
      id: "h", type: "heading",
      properties: { level: 1 }, style: {}, children: [],
    };
    const result = headingComponent.render(stateNode, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.style.display).toBe("block");
    expect(result.style.fontWeight).toBe("bold");
    expect(typeof result.style.fontSize).toBe("number");
  });

  it("level affects fontSize", () => {
    const h1 = headingComponent.render(
      { id: "h", type: "heading", properties: { level: 1 }, style: {}, children: [] }, []);
    const h6 = headingComponent.render(
      { id: "h", type: "heading", properties: { level: 6 }, style: {}, children: [] }, []);
    if (h1.type !== "element" || h6.type !== "element") throw new Error("?");
    expect(h1.style.fontSize).toBeGreaterThan(h6.style.fontSize as number);
  });
});

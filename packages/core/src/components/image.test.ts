import { describe, it, expect } from "vitest";
import { imageComponent } from "./image";

describe("imageComponent", () => {
  it("produces a block with width/height and image metadata", () => {
    const state = {
      id: "img",
      type: "image",
      properties: { src: "https://example.com/x.png", width: 100, height: 80 },
      style: {},
      children: [],
    };
    const result = imageComponent.render(state, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.style.display).toBe("block");
    expect(result.style.width).toBe(100);
    expect(result.style.height).toBe(80);
    expect(result.metadata?.image).toEqual({
      src: "https://example.com/x.png",
      width: 100,
      height: 80,
    });
  });

  it("preserves user inline style overrides", () => {
    const state = {
      id: "img", type: "image",
      properties: { src: "x.png", width: 100, height: 50 },
      style: { width: 200 },
      children: [],
    };
    const result = imageComponent.render(state, []);
    if (result.type !== "element") throw new Error("?");
    // User style spread wins over defaults
    expect(result.style.width).toBe(200);
  });
});

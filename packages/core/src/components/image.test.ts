import { describe, it, expect } from "vitest";
import { imageComponent } from "./image";
import { createNode } from "../state/create-node";

describe("imageComponent", () => {
  it("has type 'image'", () => {
    expect(imageComponent.type).toBe("image");
  });

  it("renders a block node with zero children", () => {
    const node = createNode("img1", "image", { src: "data:image/png;base64,abc", width: 200, height: 100 });
    const result = imageComponent.render(node, []);
    expect(result.type).toBe("block");
    expect(result.children).toHaveLength(0);
  });

  it("sets paddingTop to the image height", () => {
    const node = createNode("img1", "image", { src: "data:image/png;base64,abc", width: 200, height: 150 });
    const result = imageComponent.render(node, []);
    expect(result.styles.paddingTop).toBe(150);
  });

  it("sets margins", () => {
    const node = createNode("img1", "image", { src: "data:image/png;base64,abc", width: 200, height: 100 });
    const result = imageComponent.render(node, []);
    expect(result.styles.marginTop).toBe(8);
    expect(result.styles.marginBottom).toBe(8);
  });

  it("sets metadata with image properties", () => {
    const node = createNode("img1", "image", { src: "data:image/png;base64,abc", alt: "test", width: 200, height: 100 });
    const result = imageComponent.render(node, []);
    if (result.type !== "block") throw new Error("expected block");
    expect(result.metadata).toEqual({
      type: "image",
      src: "data:image/png;base64,abc",
      alt: "test",
      width: 200,
      height: 100,
    });
  });

  it("defaults height to 100 when not specified", () => {
    const node = createNode("img1", "image", { src: "data:image/png;base64,abc" });
    const result = imageComponent.render(node, []);
    expect(result.styles.paddingTop).toBe(100);
  });

  it("uses node.id as key", () => {
    const node = createNode("img1", "image", { src: "data:image/png;base64,abc" });
    const result = imageComponent.render(node, []);
    expect(result.key).toBe("img1");
  });
});

import { describe, it, expect } from "vitest";
import { documentComponent } from "./document";

describe("documentComponent", () => {
  it("renders a state node into an ElementBox with display: block", () => {
    const stateNode = {
      id: "doc",
      type: "document",
      properties: {},
      style: {},
      children: [],
    };
    const result = documentComponent.render(stateNode, []);
    expect(result.type).toBe("element");
    if (result.type !== "element") throw new Error("?");
    expect(result.style.display).toBe("block");
    expect(result.key).toBe("doc");
  });
});

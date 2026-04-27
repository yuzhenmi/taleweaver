import { describe, it, expect } from "vitest";
import { renderTree } from "./render";
import { createRegistry } from "../components/component-registry";
import { documentComponent } from "../components/document";
import { paragraphComponent } from "../components/paragraph";
import { textComponent } from "../components/text";

describe("renderTree", () => {
  it("renders a document → paragraph → text tree", () => {
    const reg = createRegistry([documentComponent, paragraphComponent, textComponent]);
    const state = {
      id: "doc", type: "document", properties: {}, style: {},
      children: [{
        id: "p", type: "paragraph", properties: {}, style: {},
        children: [{
          id: "t", type: "text", properties: { content: "hello" }, style: {}, children: [],
        }],
      }],
    };
    const result = renderTree(state, reg);
    expect(result.type).toBe("element");
    if (result.type !== "element") throw new Error("?");
    expect(result.children[0].type).toBe("element");
  });
});

import { describe, it, expect } from "vitest";
import { textComponent } from "./text";

describe("textComponent", () => {
  it("produces a TextBox with the content from properties", () => {
    const stateNode = {
      id: "t1", type: "text",
      properties: { content: "hello" }, style: {}, children: [],
    };
    const result = textComponent.render(stateNode, []);
    expect(result.type).toBe("text");
    if (result.type !== "text") throw new Error("?");
    expect(result.text).toBe("hello");
    expect(result.key).toBe("t1");
  });

  it("propagates inline style", () => {
    const stateNode = {
      id: "t1", type: "text",
      properties: { content: "x" },
      style: { fontWeight: "bold" as const },
      children: [],
    };
    const result = textComponent.render(stateNode, []);
    if (result.type !== "text") throw new Error("?");
    expect(result.style.fontWeight).toBe("bold");
  });
});

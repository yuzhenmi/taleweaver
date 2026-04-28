import { describe, it, expect } from "vitest";
import { spanComponent } from "./span";

describe("spanComponent", () => {
  it("produces an inline element with state.style merged in", () => {
    const stateNode = {
      id: "s",
      type: "span",
      properties: {},
      style: { fontWeight: "bold" as const, color: "red" },
      children: [],
    };
    const result = spanComponent.render(stateNode, []);
    expect(result.type).toBe("element");
    if (result.type !== "element") throw new Error("?");
    expect(result.style.display).toBe("inline");
    expect(result.style.fontWeight).toBe("bold");
    expect(result.style.color).toBe("red");
    expect(result.key).toBe("s");
  });

  it("passes children through", () => {
    const stateNode = {
      id: "s",
      type: "span",
      properties: {},
      style: {},
      children: [],
    };
    const result = spanComponent.render(stateNode, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.children).toHaveLength(0);
  });
});

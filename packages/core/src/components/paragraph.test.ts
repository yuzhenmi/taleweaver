import { describe, it, expect } from "vitest";
import { paragraphComponent } from "./paragraph";

describe("paragraphComponent", () => {
  it("produces a block with a small marginBlockEnd default", () => {
    const stateNode = { id: "p1", type: "paragraph", properties: {}, style: {}, children: [] };
    const result = paragraphComponent.render(stateNode, []);
    expect(result.type).toBe("element");
    if (result.type !== "element") throw new Error("?");
    expect(result.style.display).toBe("block");
    // sane default marginBlockEnd (em-relative)
    expect(result.style.marginBlockEnd).toBeDefined();
  });

  it("preserves user inline overrides", () => {
    const stateNode = {
      id: "p", type: "paragraph", properties: {},
      style: { fontWeight: "bold" as const },
      children: [],
    };
    const result = paragraphComponent.render(stateNode, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.style.fontWeight).toBe("bold");
  });
});

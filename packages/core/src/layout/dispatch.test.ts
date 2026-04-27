import { describe, it, expect } from "vitest";
import { createElementBox } from "../render/render-node-v2";
import { cascadePass } from "../cascade";
import { createMockMeasurer } from "./text-measurer";
import { layoutTree } from "./dispatch";

const measurer = createMockMeasurer(8, 16);

describe("layoutTree", () => {
  it("lays out a block at given container width", () => {
    const tree = cascadePass(
      createElementBox("root", { display: "block" }, []),
    );
    const result = layoutTree(tree, 600, measurer);
    expect(result.type).toBe("block");
    expect(result.width).toBe(600);
  });

  it("throws for unsupported display values in Plan 1 scope", () => {
    const tree = cascadePass(
      createElementBox("root", { display: "table" }, []),
    );
    expect(() => layoutTree(tree, 600, measurer)).toThrow();
  });
});

import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { cascadePass } from "../cascade";
import { createMockShaper } from "./mock-shaper";
import { layoutTree } from "./dispatch";
import { resolvePositionedTree } from "./positioned-tree";

const measurer = createMockShaper(8, 16);

describe("layoutTree", () => {
  it("lays out a block at given container width", () => {
    const tree = cascadePass(
      createElementBox("root", { display: "block" }, []),
    );
    const result = resolvePositionedTree(layoutTree(tree, 600, measurer));
    expect(result.type).toBe("block");
    expect(result.width).toBe(600);
  });

  it("throws for unsupported display values", () => {
    const tree = cascadePass(
      createElementBox("root", { display: "inline" }, []),
    );
    expect(() => layoutTree(tree, 600, measurer)).toThrow();
  });

  it("dispatches display: table at root to layoutTable", () => {
    const tree = cascadePass(
      createElementBox("t", { display: "table" }, [], { columnWidths: [1.0] }),
    );
    const result = layoutTree(tree, 600, measurer);
    expect(result.type).toBe("table");
  });

  it("BFC dispatches a table child to layoutTable", () => {
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("t", { display: "table" }, [
          createElementBox("r", { display: "table-row" }, [
            createElementBox("c", { display: "table-cell" }, [createTextBox("x", {}, "hi")]),
          ]),
        ], { columnWidths: [1.0] }),
      ]),
    );
    const result = layoutTree(tree, 600, measurer);
    if (result.type !== "block") throw new Error("expected block root");
    expect(result.children[0].type).toBe("table");
  });
});

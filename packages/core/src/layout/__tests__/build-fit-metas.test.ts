// packages/core/src/layout/__tests__/build-fit-metas.test.ts
//
// Direct unit tests for `buildBlockFitMetas`: classification (ifc / table /
// container / empty-block) and the metadata each meta carries (margins, breaks,
// total height, line / row block-sizes, listItem). The end-to-end equivalence
// to real layout is proven by `measure-pass-equivalence.test.ts`.

import { describe, it, expect } from "vitest";
import { buildBlockFitMetas } from "../build-fit-metas";
import { createMockShaper } from "../mock-shaper";
import { cascadePass } from "../../cascade";
import { createElementBox, createTextBox } from "../../render/render-node";
import type { ElementBox } from "../../render/render-node";
import type { Style } from "../../styles";

function cascade(children: readonly ElementBox[], rootStyle: Style = { display: "block" }): ElementBox {
  const root = cascadePass(createElementBox("root", rootStyle, children));
  if (root.type !== "element") throw new Error("non-element");
  return root;
}

const shaper = () => createMockShaper(8, 16);

describe("buildBlockFitMetas", () => {
  it("classifies a paragraph (inline content) as an ifc leaf with line block-sizes", () => {
    const text = createTextBox("p-t", { whiteSpace: "pre" }, "x\nx\nx");
    const p = createElementBox("p", { display: "block", whiteSpace: "pre" } as Style, [text]);
    const metas = buildBlockFitMetas(cascade([p]), shaper(), 600);
    expect(metas).toHaveLength(1);
    expect(metas[0].kind).toBe("ifc");
    expect(metas[0].lineBlockSizes).toEqual([16, 16, 16]);
    expect(metas[0].totalBlockSize).toBe(48);
    expect(metas[0].orphans).toBe(2);
    expect(metas[0].widows).toBe(2);
    expect(metas[0].lineEndsWithHyphen).toEqual([false, false, false]);
  });

  it("classifies an explicit-height empty block as a container with no children", () => {
    const spacer = createElementBox("s", { display: "block", blockSize: 80 } as Style, []);
    const metas = buildBlockFitMetas(cascade([spacer]), shaper(), 600);
    expect(metas[0].kind).toBe("block");
    expect(metas[0].children).toEqual([]);
    expect(metas[0].totalBlockSize).toBe(80);
  });

  it("classifies display:table as a table leaf with row block-sizes", () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      createElementBox(`r${i}`, { display: "table-row", blockSize: 30 } as Style, [
        createElementBox(`c${i}`, { display: "table-cell" } as Style, [createTextBox(`t${i}`, {}, "x")]),
      ]),
    );
    const table = createElementBox("tbl", { display: "table" } as Style, rows);
    const metas = buildBlockFitMetas(cascade([table]), shaper(), 600);
    expect(metas[0].kind).toBe("table");
    expect(metas[0].rowBlockSizes).toEqual([30, 30, 30]);
    expect(metas[0].totalBlockSize).toBe(90);
  });

  it("classifies a block with block children as a container and recurses", () => {
    const quote = createElementBox("q", { display: "block" } as Style, [
      createElementBox("q0", { display: "block", whiteSpace: "pre" } as Style, [createTextBox("q0t", { whiteSpace: "pre" }, "x\nx")]),
      createElementBox("q1", { display: "block", whiteSpace: "pre" } as Style, [createTextBox("q1t", { whiteSpace: "pre" }, "x")]),
    ]);
    const metas = buildBlockFitMetas(cascade([quote]), shaper(), 600);
    expect(metas[0].kind).toBe("block");
    expect(metas[0].children).toHaveLength(2);
    expect(metas[0].children?.[0].kind).toBe("ifc");
    expect(metas[0].children?.[0].lineBlockSizes).toEqual([16, 16]);
    expect(metas[0].children?.[1].lineBlockSizes).toEqual([16]);
    expect(metas[0].totalBlockSize).toBe(48); // 3 lines × 16
  });

  it("reads margins and break properties from computed style", () => {
    const b = createElementBox("b", {
      display: "block",
      blockSize: 40,
      marginBlockStart: 10,
      marginBlockEnd: 20,
      breakBefore: "page",
      breakAfter: "page",
      breakInside: "avoid",
    } as Style, []);
    const metas = buildBlockFitMetas(cascade([b]), shaper(), 600);
    expect(metas[0].marginBlockStart).toBe(10);
    expect(metas[0].marginBlockEnd).toBe(20);
    expect(metas[0].breakBefore).toBe("page");
    expect(metas[0].breakAfter).toBe("page");
    expect(metas[0].breakInsideAvoid).toBe(true);
  });

  it("flags display:list-item with listItem: true", () => {
    const li = createElementBox("li", { display: "list-item", whiteSpace: "pre" } as Style, [createTextBox("lit", { whiteSpace: "pre" }, "x")]);
    const metas = buildBlockFitMetas(cascade([li]), shaper(), 600);
    expect(metas[0].listItem).toBe(true);
  });
});

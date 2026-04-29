import { describe, it, expect } from "vitest";
import { tableComponent } from "./table";
import { tableRowComponent } from "./table-row";
import { tableCellComponent } from "./table-cell";

describe("tableComponent", () => {
  it("produces display: table with metadata.columnWidths", () => {
    const state = {
      id: "t",
      type: "table",
      properties: { columnWidths: [0.5, 0.5] },
      style: {},
      children: [],
    };
    const result = tableComponent.render(state, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.style.display).toBe("table");
    expect(result.metadata?.columnWidths).toEqual([0.5, 0.5]);
  });

  it("works without explicit columnWidths in properties", () => {
    const state = {
      id: "t", type: "table", properties: {}, style: {}, children: [],
    };
    const result = tableComponent.render(state, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.style.display).toBe("table");
    // metadata.columnWidths may be undefined when properties don't supply it
  });
});

describe("tableRowComponent", () => {
  it("produces display: table-row", () => {
    const state = {
      id: "r", type: "table-row", properties: {}, style: {}, children: [],
    };
    const result = tableRowComponent.render(state, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.style.display).toBe("table-row");
  });
});

describe("tableCellComponent", () => {
  it("produces display: table-cell with default borders", () => {
    const state = {
      id: "c", type: "table-cell", properties: {}, style: {}, children: [],
    };
    const result = tableCellComponent.render(state, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.style.display).toBe("table-cell");
    expect(result.style.borderBlockStartWidth).toBeGreaterThan(0);
    expect(result.style.borderBlockEndStyle).toBe("solid");
  });

  it("preserves user inline style overrides", () => {
    const state = {
      id: "c", type: "table-cell", properties: {},
      style: { borderBlockStartWidth: 5 }, children: [],
    };
    const result = tableCellComponent.render(state, []);
    if (result.type !== "element") throw new Error("?");
    expect(result.style.borderBlockStartWidth).toBe(5);
  });
});

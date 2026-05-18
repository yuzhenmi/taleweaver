import type { NewNode } from "../state/node";

export function createText(content: string): NewNode {
  return Object.freeze({
    type: "text",
    properties: { content },
    style: {},
    children: [],
  });
}

export function createParagraph(): NewNode {
  return Object.freeze({
    type: "paragraph",
    properties: {},
    style: {},
    children: [createText("")],
  });
}

export function createHeading(level: 1 | 2 | 3 | 4 | 5 | 6): NewNode {
  return Object.freeze({
    type: "heading",
    properties: { level },
    style: {},
    children: [createText("")],
  });
}

export function createListItem(): NewNode {
  return Object.freeze({
    type: "list-item",
    properties: {},
    style: {},
    children: [createParagraph()],
  });
}

export function createList(listType: "ordered" | "unordered"): NewNode {
  return Object.freeze({
    type: "list",
    properties: { listType },
    style: {},
    children: [createListItem()],
  });
}

export function createTable(rows: number, cols: number): NewNode {
  const columnWidths = Array(cols).fill(1 / cols);
  const tableRows: NewNode[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: NewNode[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push(Object.freeze({
        type: "table-cell",
        properties: {},
        style: {},
        children: [createParagraph()],
      }));
    }
    tableRows.push(Object.freeze({
      type: "table-row",
      properties: {},
      style: {},
      children: cells,
    }));
  }
  return Object.freeze({
    type: "table",
    properties: { columnWidths },
    style: {},
    children: tableRows,
  });
}

export function createImage(src: string, width: number, height: number): NewNode {
  return Object.freeze({
    type: "image",
    properties: { src, width, height },
    style: {},
    children: [],
  });
}

export function createHorizontalLine(): NewNode {
  return Object.freeze({
    type: "horizontal-line",
    properties: {},
    style: {},
    children: [],
  });
}

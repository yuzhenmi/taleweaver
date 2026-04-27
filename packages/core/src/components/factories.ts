import type { NewNode } from "../state/new-node";

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

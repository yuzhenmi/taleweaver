import type { StateNode } from "./state-node";

/** Get the text content string of a node, or "" if not a text node. */
export function getTextContent(node: StateNode): string {
  const content = node.properties.content;
  return typeof content === "string" ? content : "";
}

/** Get the text content length of a node, or 0 if not a text node. */
export function getTextContentLength(node: StateNode): number {
  return getTextContent(node).length;
}

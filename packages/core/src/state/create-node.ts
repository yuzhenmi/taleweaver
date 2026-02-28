import type { StateNode } from "./state-node";

/** Create an immutable state node. Children array is copied and frozen. */
export function createNode(
  id: string,
  type: string,
  properties: Record<string, unknown> = {},
  children: readonly StateNode[] = [],
): StateNode {
  const node: StateNode = {
    id,
    type,
    properties: Object.freeze({ ...properties }),
    children: Object.freeze([...children]),
  };
  return Object.freeze(node);
}

/** Shorthand for creating a text leaf node. */
export function createTextNode(id: string, content: string): StateNode {
  return createNode(id, "text", { content });
}

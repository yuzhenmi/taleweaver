import type { StateNode, NodeStyles } from "./state-node";

const EMPTY_STYLES: Readonly<NodeStyles> = Object.freeze({});

/** Create an immutable state node. Children array is copied and frozen. */
export function createNode(
  id: string,
  type: string,
  properties: Record<string, unknown> = {},
  children: readonly StateNode[] = [],
  styles: NodeStyles = {},
): StateNode {
  const node: StateNode = {
    id,
    type,
    properties: Object.freeze({ ...properties }),
    styles: Object.keys(styles).length === 0
      ? EMPTY_STYLES
      : Object.freeze({ ...styles }),
    children: Object.freeze([...children]),
  };
  return Object.freeze(node);
}

/** Shorthand for creating a text leaf node. */
export function createTextNode(id: string, content: string): StateNode {
  return createNode(id, "text", { content });
}

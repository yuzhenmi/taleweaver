import type { StateNode } from "./state-node-legacy";
import type { Style } from "../styles";

const EMPTY_STYLE: Readonly<Style> = Object.freeze({});

/** Create an immutable state node. Children array is copied and frozen. */
export function createNode(
  id: string,
  type: string,
  properties: Record<string, unknown> = {},
  children: readonly StateNode[] = [],
  style: Style = {},
): StateNode {
  const node: StateNode = {
    id,
    type,
    properties: Object.freeze({ ...properties }),
    style: Object.keys(style).length === 0
      ? EMPTY_STYLE
      : Object.freeze({ ...style }),
    children: Object.freeze([...children]),
  };
  return Object.freeze(node);
}

/** Shorthand for creating a text leaf node. */
export function createTextNode(id: string, content: string): StateNode {
  return createNode(id, "text", { content });
}

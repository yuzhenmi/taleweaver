import type { StateNode } from "./state-node";
import { createNode } from "./create-node";

/** Return a new node with merged properties (structural sharing on children). */
export function updateProperties(
  node: StateNode,
  properties: Record<string, unknown>,
): StateNode {
  return createNode(
    node.id,
    node.type,
    { ...node.properties, ...properties },
    node.children, // pass directly — createNode will copy
  );
}

/** Return a new node with a child inserted at the given index. */
export function insertChild(
  node: StateNode,
  child: StateNode,
  index: number,
): StateNode {
  if (index < 0 || index > node.children.length) {
    throw new RangeError(
      `insertChild index ${index} out of bounds for ${node.children.length} children`,
    );
  }
  const children = [...node.children];
  children.splice(index, 0, child);
  return createNode(node.id, node.type, { ...node.properties }, children);
}

/** Return a new node with the child at the given index removed. */
export function removeChild(node: StateNode, index: number): StateNode {
  if (index < 0 || index >= node.children.length) {
    throw new RangeError(
      `removeChild index ${index} out of bounds for ${node.children.length} children`,
    );
  }
  const children = [...node.children];
  children.splice(index, 1);
  return createNode(node.id, node.type, { ...node.properties }, children);
}

/** Look up a node at the given path (array of child indices). */
export function getNodeByPath(
  root: StateNode,
  path: readonly number[],
): StateNode | undefined {
  let current: StateNode | undefined = root;
  for (const index of path) {
    if (!current || index < 0 || index >= current.children.length) {
      return undefined;
    }
    current = current.children[index];
  }
  return current;
}

/** Replace the node at `path` with `newNode`, returning a new root with structural sharing. */
export function updateAtPath(
  root: StateNode,
  path: readonly number[],
  newNode: StateNode,
): StateNode {
  if (path.length === 0) return newNode;

  const index = path[0];
  if (index < 0 || index >= root.children.length) {
    throw new RangeError(
      `updateAtPath index ${index} out of bounds at path depth ${0} (node "${root.id}" has ${root.children.length} children)`,
    );
  }
  const child = root.children[index];
  const updatedChild = updateAtPath(child, path.slice(1), newNode);

  const children = [...root.children];
  children[index] = updatedChild;
  return createNode(root.id, root.type, { ...root.properties }, children);
}

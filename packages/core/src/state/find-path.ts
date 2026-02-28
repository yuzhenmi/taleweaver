import type { StateNode } from "./state-node";

/** Find the path (array of child indices) to the node with the given id. */
export function findPathById(
  root: StateNode,
  id: string,
): number[] | null {
  if (root.id === id) return [];

  for (let i = 0; i < root.children.length; i++) {
    const result = findPathById(root.children[i], id);
    if (result !== null) {
      return [i, ...result];
    }
  }

  return null;
}

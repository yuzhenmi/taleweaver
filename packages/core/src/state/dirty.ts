import type { StateNode } from "./state-node";

/**
 * Dirty tracking via identity comparison.
 *
 * Since our trees are immutable with structural sharing,
 * a node is "dirty" if its reference differs from the previous tree.
 * We don't need explicit dirty flags — we compare old vs new tree references.
 */

/** Find all paths where the node reference changed between two trees. */
export function findDirtyPaths(
  oldRoot: StateNode,
  newRoot: StateNode,
): number[][] {
  const paths: number[][] = [];
  collectDirtyPaths(oldRoot, newRoot, [], paths);
  return paths;
}

function collectDirtyPaths(
  oldNode: StateNode,
  newNode: StateNode,
  currentPath: number[],
  paths: number[][],
): void {
  if (oldNode === newNode) return; // same reference, nothing changed

  paths.push([...currentPath]);

  const minLen = Math.min(oldNode.children.length, newNode.children.length);
  for (let i = 0; i < minLen; i++) {
    collectDirtyPaths(oldNode.children[i], newNode.children[i], [...currentPath, i], paths);
  }

  // Report added children (new nodes beyond old length)
  for (let i = minLen; i < newNode.children.length; i++) {
    paths.push([...currentPath, i]);
  }

  // Report removed children (old nodes beyond new length)
  for (let i = minLen; i < oldNode.children.length; i++) {
    paths.push([...currentPath, i]);
  }
}

/** Check if a specific node at a path is dirty (reference changed). */
export function isDirty(
  oldRoot: StateNode,
  newRoot: StateNode,
  path: readonly number[],
): boolean {
  let oldNode: StateNode | undefined = oldRoot;
  let newNode: StateNode | undefined = newRoot;

  // Walk to the path in both trees
  for (const idx of path) {
    if (!oldNode || !newNode) return true;
    if (idx >= oldNode.children.length || idx >= newNode.children.length) {
      return true;
    }
    oldNode = oldNode.children[idx];
    newNode = newNode.children[idx];
  }

  return oldNode !== newNode;
}

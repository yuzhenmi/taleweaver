import type { StateNode } from "./state-node";
import type { Position, Span } from "./position";
import type { Change } from "./change";
import { createChange } from "./change";
import { normalizeSpan, comparePositions, createPosition } from "./position";
import { createNode } from "./create-node";
import { getNodeByPath, updateAtPath } from "./operations";
import { getTextContent } from "./text-utils";

/** Create a text node with updated content, preserving id and other properties. */
function withContent(node: StateNode, content: string): StateNode {
  return createNode(
    node.id,
    node.type,
    { ...node.properties, content },
    node.children,
  );
}

/** Insert text at a position. Returns a Change. */
export function insertText(
  state: StateNode,
  position: Position,
  text: string,
): Change {
  const node = getNodeByPath(state, position.path);
  if (!node) throw new Error("Invalid position path");
  if (node.type !== "text") {
    throw new Error(`Target node at path [${[...position.path]}] is not a text node (type: "${node.type}")`);
  }

  const content = getTextContent(node);
  if (position.offset < 0 || position.offset > content.length) {
    throw new RangeError(
      `insertText offset ${position.offset} out of bounds for content length ${content.length}`,
    );
  }
  const newContent =
    content.slice(0, position.offset) + text + content.slice(position.offset);
  const newNode = withContent(node, newContent);
  const newState = updateAtPath(state, position.path, newNode);

  return createChange(state, newState);
}

/** Delete text in a range within a single text node. */
function deleteSameNode(
  state: StateNode,
  start: Position,
  end: Position,
): StateNode {
  const node = getNodeByPath(state, start.path);
  if (!node) throw new Error("Invalid position path");

  const content = getTextContent(node);
  if (start.offset < 0 || end.offset > content.length) {
    throw new RangeError(
      `deleteRange offsets [${start.offset}, ${end.offset}] out of bounds for content length ${content.length}`,
    );
  }
  const newContent =
    content.slice(0, start.offset) + content.slice(end.offset);
  const newNode = withContent(node, newContent);
  return updateAtPath(state, start.path, newNode);
}

/**
 * Delete across nodes: fuse the start node's prefix with the end node's suffix,
 * removing everything in between. Trailing siblings of the end node are
 * appended to the start node's parent (the merged paragraph).
 */
function deleteCrossNode(
  state: StateNode,
  start: Position,
  end: Position,
): StateNode {
  // Find the common ancestor depth
  let commonDepth = 0;
  while (
    commonDepth < start.path.length &&
    commonDepth < end.path.length &&
    start.path[commonDepth] === end.path[commonDepth]
  ) {
    commonDepth++;
  }

  // Read everything from the original state (never from an intermediate result)
  const startNode = getNodeByPath(state, start.path)!;
  const endNode = getNodeByPath(state, end.path)!;

  // Fuse: start node prefix + end node suffix
  const startContent = getTextContent(startNode);
  const endContent = getTextContent(endNode);
  const fusedContent =
    startContent.slice(0, start.offset) + endContent.slice(end.offset);
  const fusedNode = withContent(startNode, fusedContent);

  if (commonDepth < start.path.length && commonDepth < end.path.length) {
    // Start and end diverge at commonDepth — they are in different subtrees
    const commonPath = start.path.slice(0, commonDepth);
    const startIdx = start.path[commonDepth];
    const endIdx = end.path[commonDepth];

    // 1. Build start subtree: update text node within it, then trim trailing children
    const startSubtree = getNodeByPath(state, [...commonPath, startIdx])!;
    const startSubPath = start.path.slice(commonDepth + 1);
    let trimmedStart = updateAtPath(startSubtree, startSubPath, fusedNode);
    if (startSubPath.length > 0) {
      trimmedStart = trimTrailingChildren(trimmedStart, startSubPath);
    }

    // 2. Collect trailing siblings from the end subtree that survive the deletion.
    //    These are children AFTER the end text node at each ancestor level
    //    within the end subtree.
    const endSubtree = getNodeByPath(state, [...commonPath, endIdx])!;
    const endTrailingSiblings = collectTrailingSiblings(
      endSubtree,
      end.path.slice(commonDepth + 1),
    );

    // 3. Append end's trailing siblings to the trimmed start subtree
    if (endTrailingSiblings.length > 0) {
      trimmedStart = createNode(
        trimmedStart.id,
        trimmedStart.type,
        { ...trimmedStart.properties },
        [...trimmedStart.children, ...endTrailingSiblings],
      );
    }

    // 4. Build new children for the common ancestor:
    //    keep [0..startIdx-1], then mergedStart, skip [startIdx+1..endIdx], keep [endIdx+1..]
    const commonAncestor = getNodeByPath(state, commonPath)!;
    const newChildren: StateNode[] = [];
    for (let i = 0; i < commonAncestor.children.length; i++) {
      if (i < startIdx) {
        newChildren.push(commonAncestor.children[i]);
      } else if (i === startIdx) {
        newChildren.push(trimmedStart);
      } else if (i > endIdx) {
        newChildren.push(commonAncestor.children[i]);
      }
      // skip startIdx+1..endIdx (removed)
    }

    const newAncestor = createNode(
      commonAncestor.id,
      commonAncestor.type,
      { ...commonAncestor.properties },
      newChildren,
    );
    return updateAtPath(state, commonPath, newAncestor);
  } else {
    // One path is a prefix of the other — this means one position's path is
    // an ancestor of the other, which is invalid for text node positions
    // (text nodes are always leaves and can't be ancestors of other text nodes).
    throw new Error(
      "Invalid cross-node deletion: one position path is a prefix of the other",
    );
  }
}

/**
 * Collect trailing siblings from the end subtree that survive deletion.
 * Walk the path from the end subtree root down to the end text node,
 * collecting all siblings AFTER the path index at each level.
 */
function collectTrailingSiblings(
  node: StateNode,
  subPath: readonly number[],
): StateNode[] {
  if (subPath.length === 0) return [];

  const idx = subPath[0];
  const trailingSiblingsAtThisLevel = node.children.slice(idx + 1);

  if (subPath.length === 1) {
    // Leaf level: trailing siblings of the end text node
    return trailingSiblingsAtThisLevel;
  }

  // Recurse deeper, then append siblings from this level
  const deeperSiblings = collectTrailingSiblings(
    node.children[idx],
    subPath.slice(1),
  );

  return [...deeperSiblings, ...trailingSiblingsAtThisLevel];
}

/** Remove children after the given path index at each level. */
function trimTrailingChildren(
  node: StateNode,
  subPath: readonly number[],
): StateNode {
  if (subPath.length === 0) return node;

  const idx = subPath[0];
  let child = node.children[idx];
  if (subPath.length > 1) {
    child = trimTrailingChildren(child, subPath.slice(1));
  }

  const newChildren = [...node.children.slice(0, idx), child];
  return createNode(node.id, node.type, { ...node.properties }, newChildren);
}

/** Delete text in a range. Returns a Change. */
export function deleteRange(state: StateNode, range: Span): Change {
  const normalized = normalizeSpan(range);
  const { anchor: start, focus: end } = normalized;

  if (comparePositions(start, end) === 0) {
    return createChange(state, state);
  }

  const samePath =
    start.path.length === end.path.length &&
    start.path.every((v, i) => v === end.path[i]);

  const newState = samePath
    ? deleteSameNode(state, start, end)
    : deleteCrossNode(state, start, end);

  return createChange(state, newState);
}

/** Replace a range with new text. Returns a Change. */
export function replaceRange(
  state: StateNode,
  range: Span,
  text: string,
): Change {
  const deleteChange = deleteRange(state, range);
  const normalized = normalizeSpan(range);

  const insertPos = createPosition(
    [...normalized.anchor.path],
    normalized.anchor.offset,
  );

  const insertChange = insertText(deleteChange.newState, insertPos, text);
  return createChange(state, insertChange.newState);
}

/**
 * Split a node at a position, splitting all ancestors up to (but not including)
 * the node at `splitDepth`. This allows splitting at any tree depth.
 *
 * `splitDepth` is the depth of the ancestor to split *into* — the split creates
 * a new sibling of the node at `path[splitDepth]`. Defaults to the grandparent
 * of the text node (depth = path.length - 2), which handles the common case of
 * splitting a paragraph.
 */
export function splitNode(
  state: StateNode,
  position: Position,
  newNodeId: string,
  splitDepth?: number,
): Change {
  const textNode = getNodeByPath(state, position.path);
  if (!textNode) {
    throw new Error("Invalid position path for splitNode");
  }
  if (textNode.type !== "text") {
    throw new Error(
      `splitNode target must be a text node, got "${textNode.type}"`,
    );
  }

  const depth = splitDepth ?? position.path.length - 2;
  if (depth < 0 || depth >= position.path.length) {
    throw new Error(
      `Invalid splitDepth ${depth} for path of length ${position.path.length}`,
    );
  }
  const content = getTextContent(textNode);
  if (position.offset < 0 || position.offset > content.length) {
    throw new RangeError(
      `splitNode offset ${position.offset} out of bounds for content length ${content.length}`,
    );
  }

  const beforeContent = content.slice(0, position.offset);
  const afterContent = content.slice(position.offset);

  // Build the "before" and "after" trees from the text node up to splitDepth.
  // At the text node level:
  const beforeLeaf = withContent(textNode, beforeContent);
  const afterLeaf = createNode(
    newNodeId + "-text",
    textNode.type,
    { ...textNode.properties, content: afterContent },
  );

  // Walk up from the text node to the split level, building before/after subtrees.
  // At each level, "before" keeps children [0..idx] (with updated child at idx),
  // and "after" gets a new node with children [afterChild, ...children after idx].
  let beforeChild: StateNode = beforeLeaf;
  let afterChild: StateNode = afterLeaf;

  for (let d = position.path.length - 1; d > depth; d--) {
    const parentPath = position.path.slice(0, d);
    const parent = getNodeByPath(state, parentPath)!;
    const childIdx = position.path[d];

    // Before parent: children [0..childIdx-1] + beforeChild
    const beforeParent = createNode(
      parent.id,
      parent.type,
      { ...parent.properties },
      [...parent.children.slice(0, childIdx), beforeChild],
    );

    // After parent: afterChild + children [childIdx+1..]
    const afterParent = createNode(
      newNodeId + "-" + d,
      parent.type,
      { ...parent.properties },
      [afterChild, ...parent.children.slice(childIdx + 1)],
    );

    beforeChild = beforeParent;
    afterChild = afterParent;
  }

  // Now insert beforeChild and afterChild into the split-level parent
  const splitParentPath = position.path.slice(0, depth);
  const splitParent = getNodeByPath(state, splitParentPath)!;
  const splitIdx = position.path[depth];

  const newChildren = [
    ...splitParent.children.slice(0, splitIdx),
    beforeChild,
    afterChild,
    ...splitParent.children.slice(splitIdx + 1),
  ];

  const newSplitParent = createNode(
    splitParent.id,
    splitParent.type,
    { ...splitParent.properties },
    newChildren,
  );

  const result = updateAtPath(state, splitParentPath, newSplitParent);
  return createChange(state, result);
}

import type { StateNode } from "./state-node";
import type { Span, Position } from "./position";
import type { Change } from "./change";
import { createChange } from "./change";
import { normalizeSpan, comparePositions, createPosition } from "./position";
import { createNode } from "./create-node";
import { getNodeByPath, updateAtPath } from "./operations";
import { getTextContent, getTextContentLength } from "./text-utils";

type StyleProperty = "fontWeight" | "fontStyle" | "textDecoration";
type StyleValue = string;

const STYLE_DEFAULTS: Record<StyleProperty, StyleValue> = {
  fontWeight: "bold",
  fontStyle: "italic",
  textDecoration: "underline",
};

/**
 * Check if all text in a span already has the given style property.
 */
export function isFullyStyled(
  state: StateNode,
  span: Span,
  property: StyleProperty,
): boolean {
  const normalized = normalizeSpan(span);
  if (comparePositions(normalized.anchor, normalized.focus) === 0) return false;

  const textNodes = collectTextNodesInSpan(state, normalized);
  return textNodes.every(({ node, path }) => {
    return hasStyleProperty(node, property) ||
      findStyleSpanAncestor(state, path, property) !== null;
  });
}

/**
 * Apply an inline style to a span. Wraps text in span nodes with the style property.
 * Splits text nodes at selection boundaries if needed.
 */
export function applyInlineStyle(
  state: StateNode,
  span: Span,
  property: StyleProperty,
  newNodeIdBase: string,
): Change {
  const normalized = normalizeSpan(span);
  if (comparePositions(normalized.anchor, normalized.focus) === 0) {
    return createChange(state, state);
  }

  const value = STYLE_DEFAULTS[property];
  let currentState = state;
  let idCounter = 0;

  // Collect text nodes in the span (from original state for path computation)
  const textEntries = collectTextNodesInSpan(state, normalized);

  // Track modified parent paths for deferred normalization
  const modifiedParentPaths: number[][] = [];

  // Process each text node that doesn't already have the style
  // Work backwards to avoid path invalidation from splice operations
  for (let i = textEntries.length - 1; i >= 0; i--) {
    const entry = textEntries[i];
    if (hasStyleProperty(entry.node, property)) continue;

    const { node, path, startOffset, endOffset } = entry;
    const content = getTextContent(node);
    const start = startOffset;
    const end = endOffset;

    // Get current node at this path (may have shifted due to earlier operations)
    const currentNode = getNodeByPath(currentState, path);
    if (!currentNode) continue;

    const parentPath = path.slice(0, -1);
    const childIdx = path[path.length - 1];
    const parent = getNodeByPath(currentState, parentPath);
    if (!parent) continue;

    const newChildren: StateNode[] = [...parent.children];
    const replacements: StateNode[] = [];

    // Split into [before | styled | after]
    if (start > 0) {
      const beforeText = createNode(
        `${newNodeIdBase}-pre-${idCounter++}`,
        "text",
        { ...currentNode.properties, content: content.slice(0, start) },
      );
      replacements.push(beforeText);
    }

    const styledText = createNode(
      `${newNodeIdBase}-st-${idCounter++}`,
      "text",
      { ...currentNode.properties, content: content.slice(start, end) },
    );
    const styledSpan = createNode(
      `${newNodeIdBase}-span-${idCounter++}`,
      "span",
      { [property]: value },
      [styledText],
    );
    replacements.push(styledSpan);

    if (end < content.length) {
      const afterText = createNode(
        `${newNodeIdBase}-post-${idCounter++}`,
        "text",
        { ...currentNode.properties, content: content.slice(end) },
      );
      replacements.push(afterText);
    }

    newChildren.splice(childIdx, 1, ...replacements);
    const newParent = createNode(
      parent.id,
      parent.type,
      { ...parent.properties },
      newChildren,
    );
    currentState = updateAtPath(currentState, parentPath, newParent);

    const key = parentPath.join(",");
    if (!modifiedParentPaths.some(p => p.join(",") === key)) {
      modifiedParentPaths.push([...parentPath]);
    }
  }

  // Normalize modified parents after all splices are complete (deepest first)
  currentState = normalizeModifiedParents(currentState, modifiedParentPaths);

  return createChange(state, currentState);
}

/**
 * Remove an inline style from a span. Removes the style property from span nodes
 * and unwraps if no properties remain. Splits spans when the selection only
 * partially covers the span's text content.
 */
export function removeInlineStyle(
  state: StateNode,
  span: Span,
  property: StyleProperty,
  newNodeIdBase: string,
): Change {
  const normalized = normalizeSpan(span);
  if (comparePositions(normalized.anchor, normalized.focus) === 0) {
    return createChange(state, state);
  }

  let currentState = state;
  let idCounter = 0;
  const textEntries = collectTextNodesInSpan(state, normalized);

  // Group text entries by their styled span ancestor
  const spanGroups = new Map<string, { spanPath: number[]; entries: TextEntry[] }>();
  for (const entry of textEntries) {
    const spanInfo = findStyleSpanAncestor(state, entry.path, property);
    if (!spanInfo) continue;
    const key = spanInfo.spanPath.join(",");
    if (!spanGroups.has(key)) {
      spanGroups.set(key, { spanPath: spanInfo.spanPath, entries: [] });
    }
    spanGroups.get(key)!.entries.push(entry);
  }

  // Process each span group, sorted in reverse document order to avoid path invalidation
  const groups = [...spanGroups.values()].sort((a, b) => {
    for (let i = 0; i < Math.min(a.spanPath.length, b.spanPath.length); i++) {
      if (a.spanPath[i] !== b.spanPath[i]) return b.spanPath[i] - a.spanPath[i];
    }
    return b.spanPath.length - a.spanPath.length;
  });

  // Track modified parent paths for deferred normalization
  const modifiedParentPaths: number[][] = [];

  for (const group of groups) {
    const { spanPath, entries } = group;
    const spanNode = getNodeByPath(currentState, spanPath);
    if (!spanNode) continue;

    const spanTotalLen = totalTextLength(spanNode);
    const selectedLen = entries.reduce((sum, e) => sum + (e.endOffset - e.startOffset), 0);
    const isFullyCovered = selectedLen >= spanTotalLen;

    const newProps = { ...spanNode.properties };
    delete newProps[property];
    const hasOtherStyles = Object.keys(newProps).length > 0;

    const spanParentPath = spanPath.slice(0, -1);
    const spanIdx = spanPath[spanPath.length - 1];
    const spanParent = getNodeByPath(currentState, spanParentPath);
    if (!spanParent) continue;

    const newChildren = [...spanParent.children];

    if (isFullyCovered) {
      // Fully covered: original behavior
      if (hasOtherStyles) {
        const updatedSpan = createNode(spanNode.id, spanNode.type, newProps, spanNode.children);
        newChildren[spanIdx] = updatedSpan;
      } else {
        newChildren.splice(spanIdx, 1, ...spanNode.children);
      }
    } else {
      // Partially covered: split the span
      const firstEntry = entries[0];
      const lastEntry = entries[entries.length - 1];
      const selStart = computeFlatOffset(spanNode, firstEntry.path.slice(spanPath.length), firstEntry.startOffset);
      const selEnd = computeFlatOffset(spanNode, lastEntry.path.slice(spanPath.length), lastEntry.endOffset);

      const counter = { value: idCounter };
      const [beforeChildren, rest] = splitChildrenAtOffset(spanNode.children, selStart, newNodeIdBase, counter);
      const [middleChildren, afterChildren] = splitChildrenAtOffset(rest, selEnd - selStart, newNodeIdBase, counter);
      idCounter = counter.value;

      const replacements: StateNode[] = [];

      // Before: keep in original span (with all styles)
      if (beforeChildren.length > 0) {
        replacements.push(createNode(
          `${newNodeIdBase}-bspan-${idCounter++}`,
          "span",
          { ...spanNode.properties },
          beforeChildren,
        ));
      }

      // Middle: remove the target style
      if (hasOtherStyles) {
        // Keep span with remaining styles
        replacements.push(createNode(
          `${newNodeIdBase}-mspan-${idCounter++}`,
          "span",
          newProps,
          middleChildren,
        ));
      } else {
        // No other styles: unwrap children directly
        replacements.push(...middleChildren);
      }

      // After: keep in original span (with all styles)
      if (afterChildren.length > 0) {
        replacements.push(createNode(
          `${newNodeIdBase}-aspan-${idCounter++}`,
          "span",
          { ...spanNode.properties },
          afterChildren,
        ));
      }

      newChildren.splice(spanIdx, 1, ...replacements);
    }

    const newParent = createNode(
      spanParent.id,
      spanParent.type,
      { ...spanParent.properties },
      newChildren,
    );
    currentState = updateAtPath(currentState, spanParentPath, newParent);

    const key = spanParentPath.join(",");
    if (!modifiedParentPaths.some(p => p.join(",") === key)) {
      modifiedParentPaths.push([...spanParentPath]);
    }
  }

  // Normalize modified parents after all modifications are complete (deepest first)
  currentState = normalizeModifiedParents(currentState, modifiedParentPaths);

  return createChange(state, currentState);
}

/**
 * Remap a position from an old state tree to a new state tree.
 * Assumes the text content within each paragraph is unchanged
 * (only tree structure changed, e.g. from formatting operations).
 */
export function remapPosition(
  oldState: StateNode,
  newState: StateNode,
  pos: Position,
): Position {
  if (pos.path.length === 0) return pos;

  const paraIdx = pos.path[0];
  const oldPara = oldState.children[paraIdx];
  const newPara = newState.children[paraIdx];

  if (!oldPara || !newPara) return pos;

  // Convert to flat character offset within the paragraph
  const pathInPara = pos.path.slice(1);
  const flatOffset = computeFlatOffset(oldPara, pathInPara, pos.offset);

  // Resolve back in the new paragraph
  return resolveFlatOffset(newPara, [paraIdx], flatOffset);
}

// --- Helpers ---

interface TextEntry {
  node: StateNode;
  path: number[];
  startOffset: number;
  endOffset: number;
}

/** Collect all text nodes that overlap with the given span. */
function collectTextNodesInSpan(
  state: StateNode,
  span: Span,
): TextEntry[] {
  const entries: TextEntry[] = [];
  const start = span.anchor;
  const end = span.focus;

  collectTextNodesRecursive(state, [], start, end, entries);
  return entries;
}

function collectTextNodesRecursive(
  node: StateNode,
  path: number[],
  start: Position,
  end: Position,
  entries: TextEntry[],
): void {
  if (node.type === "text") {
    const pos = createPosition(path, 0);
    const endPos = createPosition(path, getTextContentLength(node));

    // Check if this text node overlaps with the span
    if (comparePositions(endPos, start) <= 0) return; // entirely before
    if (comparePositions(pos, end) >= 0) return; // entirely after

    const contentLen = getTextContentLength(node);
    const samePath = (a: readonly number[], b: readonly number[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);

    const effectiveStart = samePath(path, [...start.path]) ? start.offset : 0;
    const effectiveEnd = samePath(path, [...end.path]) ? end.offset : contentLen;

    entries.push({
      node,
      path: [...path],
      startOffset: effectiveStart,
      endOffset: effectiveEnd,
    });
    return;
  }

  for (let i = 0; i < node.children.length; i++) {
    collectTextNodesRecursive(node.children[i], [...path, i], start, end, entries);
  }
}

/** Check if a node or any of its ancestors has the given style property. */
function hasStyleProperty(node: StateNode, property: StyleProperty): boolean {
  return node.properties[property] !== undefined;
}

/** Walk up from a text node to find ancestor span with given style. */
function findStyleSpanAncestor(
  state: StateNode,
  textPath: number[],
  property: StyleProperty,
): { spanPath: number[] } | null {
  // Check each ancestor from the text node upward
  for (let depth = textPath.length - 1; depth >= 0; depth--) {
    const ancestorPath = textPath.slice(0, depth);
    const ancestor = getNodeByPath(state, ancestorPath);
    if (ancestor && ancestor.type === "span" && ancestor.properties[property] !== undefined) {
      return { spanPath: ancestorPath };
    }
  }
  return null;
}

/** Get total text content length of a subtree. */
function totalTextLength(node: StateNode): number {
  if (node.type === "text") return getTextContentLength(node);
  let len = 0;
  for (const child of node.children) {
    len += totalTextLength(child);
  }
  return len;
}

/** Compute flat character offset from a relative path within a node. */
function computeFlatOffset(
  node: StateNode,
  relativePath: readonly number[],
  offset: number,
): number {
  if (relativePath.length === 0) return offset;

  let flat = 0;
  const childIdx = relativePath[0];
  for (let i = 0; i < childIdx; i++) {
    flat += totalTextLength(node.children[i]);
  }
  flat += computeFlatOffset(node.children[childIdx], relativePath.slice(1), offset);
  return flat;
}

/** Resolve a flat character offset back to a Position within a subtree. */
function resolveFlatOffset(
  node: StateNode,
  basePath: number[],
  flatOffset: number,
): Position {
  if (node.type === "text") {
    return createPosition(basePath, Math.min(flatOffset, getTextContentLength(node)));
  }

  let remaining = flatOffset;
  for (let i = 0; i < node.children.length; i++) {
    const childLen = totalTextLength(node.children[i]);
    if (remaining <= childLen) {
      return resolveFlatOffset(node.children[i], [...basePath, i], remaining);
    }
    remaining -= childLen;
  }

  // Past the end — place at end of last child
  if (node.children.length > 0) {
    const lastIdx = node.children.length - 1;
    return resolveFlatOffset(
      node.children[lastIdx],
      [...basePath, lastIdx],
      totalTextLength(node.children[lastIdx]),
    );
  }
  return createPosition(basePath, 0);
}

/**
 * Normalize children of all modified parents. Processes deepest paths first
 * so that inner normalization doesn't invalidate outer paths.
 */
function normalizeModifiedParents(
  state: StateNode,
  parentPaths: number[][],
): StateNode {
  let currentState = state;
  // Sort deepest first so inner normalization completes before outer
  const sorted = [...parentPaths].sort((a, b) => b.length - a.length);
  for (const pp of sorted) {
    const parent = getNodeByPath(currentState, pp);
    if (!parent) continue;
    const normalized = normalizeChildren(parent.children);
    const newParent = createNode(
      parent.id, parent.type, { ...parent.properties }, normalized,
    );
    currentState = updateAtPath(currentState, pp, newParent);
  }
  return currentState;
}

/**
 * Normalize a children array by merging adjacent compatible nodes:
 * - Adjacent text nodes (same non-content properties) → concatenate content
 * - Adjacent spans with identical properties → merge children, then recurse
 */
function normalizeChildren(children: readonly StateNode[]): StateNode[] {
  if (children.length <= 1) return [...children];

  const result: StateNode[] = [children[0]];

  for (let i = 1; i < children.length; i++) {
    const prev = result[result.length - 1];
    const curr = children[i];

    if (canMergeNodes(prev, curr)) {
      result[result.length - 1] = mergeNodes(prev, curr);
    } else {
      result.push(curr);
    }
  }

  return result;
}

/** Check if two adjacent nodes can be merged. */
function canMergeNodes(a: StateNode, b: StateNode): boolean {
  if (a.type !== b.type) return false;

  if (a.type === "text") {
    // Text nodes: merge if all non-content properties match
    return propsEqualExcept(a.properties, b.properties, "content");
  }

  if (a.type === "span") {
    // Spans: merge if all properties are identical
    return propsEqual(a.properties, b.properties);
  }

  return false;
}

/** Merge two compatible nodes into one. */
function mergeNodes(a: StateNode, b: StateNode): StateNode {
  if (a.type === "text") {
    return createNode(a.id, "text", {
      ...a.properties,
      content: getTextContent(a) + getTextContent(b),
    });
  }

  // Span: merge children, then normalize recursively
  const merged = normalizeChildren([...a.children, ...b.children]);
  return createNode(a.id, a.type, { ...a.properties }, merged);
}

/** Check if two property objects are shallowly equal. */
function propsEqual(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => b[k] === a[k]);
}

/** Check if two property objects are equal, ignoring one key. */
function propsEqualExcept(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
  except: string,
): boolean {
  const keysA = Object.keys(a).filter((k) => k !== except);
  const keysB = Object.keys(b).filter((k) => k !== except);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => b[k] === a[k]);
}

/**
 * Split a list of children at a flat character offset.
 * Returns [children before offset, children at/after offset].
 * Text nodes at the boundary are split into two.
 */
function splitChildrenAtOffset(
  children: readonly StateNode[],
  offset: number,
  idBase: string,
  counter: { value: number },
): [StateNode[], StateNode[]] {
  if (offset <= 0) return [[], [...children]];

  const left: StateNode[] = [];
  const right: StateNode[] = [];
  let remaining = offset;
  let splitDone = false;

  for (const child of children) {
    if (splitDone) {
      right.push(child);
      continue;
    }

    const childLen = totalTextLength(child);

    if (remaining >= childLen) {
      left.push(child);
      remaining -= childLen;
      if (remaining === 0) splitDone = true;
      continue;
    }

    // Need to split this child at `remaining` offset
    if (child.type === "text") {
      const content = getTextContent(child);
      left.push(createNode(
        `${idBase}-sl${counter.value++}`,
        "text",
        { ...child.properties, content: content.slice(0, remaining) },
      ));
      right.push(createNode(
        `${idBase}-sr${counter.value++}`,
        "text",
        { ...child.properties, content: content.slice(remaining) },
      ));
    } else {
      // Recursively split the child's children
      const [childLeft, childRight] = splitChildrenAtOffset(
        child.children, remaining, idBase, counter,
      );
      if (childLeft.length > 0) {
        left.push(createNode(
          `${idBase}-sl${counter.value++}`, child.type, { ...child.properties }, childLeft,
        ));
      }
      if (childRight.length > 0) {
        right.push(createNode(
          `${idBase}-sr${counter.value++}`, child.type, { ...child.properties }, childRight,
        ));
      }
    }
    splitDone = true;
  }

  return [left, right];
}

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

  // Process each text node that doesn't already have the style
  // Work backwards to avoid path invalidation
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
  }

  return createChange(state, currentState);
}

/**
 * Remove an inline style from a span. Removes the style property from span nodes
 * and unwraps if no properties remain.
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
  const textEntries = collectTextNodesInSpan(state, normalized);

  // Track already-processed span paths to avoid duplicates
  const processedSpans = new Set<string>();

  // Work backwards
  for (let i = textEntries.length - 1; i >= 0; i--) {
    const entry = textEntries[i];

    // Find the ancestor span that provides this style (check text node AND ancestors)
    const spanAncestorInfo = findStyleSpanAncestor(currentState, entry.path, property);
    if (!spanAncestorInfo) continue;

    const spanKey = spanAncestorInfo.spanPath.join(",");
    if (processedSpans.has(spanKey)) continue;
    processedSpans.add(spanKey);

    const { spanPath } = spanAncestorInfo;
    const spanNode = getNodeByPath(currentState, spanPath);
    if (!spanNode) continue;

    // Remove the property from the span
    const newProps = { ...spanNode.properties };
    delete newProps[property];

    // Check if span has other meaningful properties
    const hasOtherStyles = Object.keys(newProps).length > 0;

    const spanParentPath = spanPath.slice(0, -1);
    const spanIdx = spanPath[spanPath.length - 1];
    const spanParent = getNodeByPath(currentState, spanParentPath);
    if (!spanParent) continue;

    const newChildren = [...spanParent.children];

    if (hasOtherStyles) {
      // Keep span, just remove the property
      const updatedSpan = createNode(
        spanNode.id,
        spanNode.type,
        newProps,
        spanNode.children,
      );
      newChildren[spanIdx] = updatedSpan;
    } else {
      // Unwrap: replace span with its children
      newChildren.splice(spanIdx, 1, ...spanNode.children);
    }

    const newParent = createNode(
      spanParent.id,
      spanParent.type,
      { ...spanParent.properties },
      newChildren,
    );
    currentState = updateAtPath(currentState, spanParentPath, newParent);
  }

  return createChange(state, currentState);
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

import type { StateNode, NodeStyles } from "./state-node";
import type { Span, Position } from "./position";
import type { Change } from "./change";
import { createChange } from "./change";
import { normalizeSpan, comparePositions, createPosition, pathsEqual } from "./position";
import { createNode } from "./create-node";
import { getNodeByPath, updateAtPath } from "./operations";
import { getTextContent, getTextContentLength } from "./text-utils";

/**
 * Style values to apply. Use `undefined` to remove a property.
 * Example: `{ fontWeight: "bold", fontStyle: undefined }`
 */
type InlineStyles = { [K in keyof NodeStyles]?: NodeStyles[K] | undefined };

/**
 * Query whether all text in a range has a uniform value for a style property.
 * Returns the value if uniform, undefined if mixed or unset.
 */
export function getStyleInRange(
  state: StateNode,
  span: Span,
  property: keyof NodeStyles,
): NodeStyles[keyof NodeStyles] | undefined {
  const normalized = normalizeSpan(span);
  if (comparePositions(normalized.anchor, normalized.focus) === 0) return undefined;

  const textNodes = collectTextNodesInSpan(state, normalized);
  if (textNodes.length === 0) return undefined;

  let uniformValue: NodeStyles[keyof NodeStyles] | undefined = undefined;
  for (let i = 0; i < textNodes.length; i++) {
    const { node, path } = textNodes[i];
    // Check node itself, then ancestor spans
    let value: NodeStyles[keyof NodeStyles] | undefined = node.styles[property];
    if (value === undefined) {
      const ancestor = findStyleSpanAncestor(state, path, property);
      if (ancestor) {
        const ancestorNode = getNodeByPath(state, ancestor.spanPath);
        if (ancestorNode) value = ancestorNode.styles[property];
      }
    }
    if (value === undefined) return undefined;
    if (i === 0) {
      uniformValue = value;
    } else if (value !== uniformValue) {
      return undefined;
    }
  }
  return uniformValue;
}

/**
 * Apply inline styles to a span. Sets or removes style properties on text
 * within the range. Use `undefined` values to remove properties.
 *
 * Examples:
 *   applyInlineStyle(state, span, { fontWeight: "bold" }, idBase)       // set
 *   applyInlineStyle(state, span, { fontWeight: undefined }, idBase)    // remove
 *   applyInlineStyle(state, span, { fontWeight: "bold", fontStyle: undefined }, idBase) // both
 */
export function applyInlineStyle(
  state: StateNode,
  span: Span,
  styles: InlineStyles,
  newNodeIdBase: string,
): Change {
  const normalized = normalizeSpan(span);
  if (comparePositions(normalized.anchor, normalized.focus) === 0) {
    return createChange(state, state);
  }

  let currentState = state;
  let idCounter = 0;

  const keys = Object.keys(styles) as (keyof NodeStyles)[];
  for (const key of keys) {
    const desiredValue = styles[key];
    const result = processProperty(
      currentState, normalized, key, desiredValue, newNodeIdBase, idCounter,
    );
    currentState = result.state;
    idCounter = result.idCounter;

    // If tree changed and there are more keys, remap the span
    // (not needed here because we reuse the same normalized span —
    //  processProperty only changes structure, not text content,
    //  so the normalized span's flat offsets remain valid)
  }

  return createChange(state, currentState);
}

/**
 * Process a single style property across the span.
 */
function processProperty(
  state: StateNode,
  span: Span,
  key: keyof NodeStyles,
  desiredValue: NodeStyles[keyof NodeStyles] | undefined,
  idBase: string,
  idCounter: number,
): { state: StateNode; idCounter: number } {
  let currentState = state;
  const textEntries = collectTextNodesInSpan(state, span);

  // Partition text entries into those with an ancestor span for this key
  // and those without (unstyled)
  const spanGroups = new Map<string, { spanPath: number[]; entries: TextEntry[] }>();
  const unstyledEntries: TextEntry[] = [];

  for (const entry of textEntries) {
    // Check if the effective value already matches the desired value
    const effectiveValue = getEffectiveStyleValue(state, entry, key);
    if (effectiveValue === desiredValue) continue; // already correct, skip

    const spanInfo = findStyleSpanAncestor(state, entry.path, key);
    if (spanInfo) {
      const pathKey = spanInfo.spanPath.join(",");
      if (!spanGroups.has(pathKey)) {
        spanGroups.set(pathKey, { spanPath: spanInfo.spanPath, entries: [] });
      }
      spanGroups.get(pathKey)!.entries.push(entry);
    } else {
      unstyledEntries.push(entry);
    }
  }

  const modifiedParentPaths: number[][] = [];

  // --- Process ancestor span groups (reverse doc order to avoid path invalidation) ---
  const groups = [...spanGroups.values()].sort((a, b) => {
    for (let i = 0; i < Math.min(a.spanPath.length, b.spanPath.length); i++) {
      if (a.spanPath[i] !== b.spanPath[i]) return b.spanPath[i] - a.spanPath[i];
    }
    return b.spanPath.length - a.spanPath.length;
  });

  for (const group of groups) {
    const { spanPath, entries } = group;
    const spanNode = getNodeByPath(currentState, spanPath);
    if (!spanNode) continue;

    const spanTotalLen = totalTextLength(spanNode);
    const selectedLen = entries.reduce((sum, e) => sum + (e.endOffset - e.startOffset), 0);
    const isFullyCovered = selectedLen >= spanTotalLen;

    // Compute new styles for the span
    const newStyles: Record<string, unknown> = { ...spanNode.styles };
    if (desiredValue !== undefined) {
      newStyles[key] = desiredValue;
    } else {
      delete newStyles[key];
    }
    const hasStyles = Object.keys(newStyles).length > 0;

    const spanParentPath = spanPath.slice(0, -1);
    const spanIdx = spanPath[spanPath.length - 1];
    const spanParent = getNodeByPath(currentState, spanParentPath);
    if (!spanParent) continue;

    const newChildren = [...spanParent.children];

    if (isFullyCovered) {
      if (hasStyles) {
        const updatedSpan = createNode(spanNode.id, spanNode.type, {}, spanNode.children, newStyles as NodeStyles);
        newChildren[spanIdx] = updatedSpan;
      } else {
        // No styles left — unwrap
        newChildren.splice(spanIdx, 1, ...spanNode.children);
      }
    } else {
      // Partially covered: split the span
      const firstEntry = entries[0];
      const lastEntry = entries[entries.length - 1];
      const selStart = computeFlatOffset(spanNode, firstEntry.path.slice(spanPath.length), firstEntry.startOffset);
      const selEnd = computeFlatOffset(spanNode, lastEntry.path.slice(spanPath.length), lastEntry.endOffset);

      const counter = { value: idCounter };
      const [beforeChildren, rest] = splitChildrenAtOffset(spanNode.children, selStart, idBase, counter);
      const [middleChildren, afterChildren] = splitChildrenAtOffset(rest, selEnd - selStart, idBase, counter);
      idCounter = counter.value;

      const replacements: StateNode[] = [];

      // Before: keep in original span (with all original styles)
      if (beforeChildren.length > 0) {
        replacements.push(createNode(
          `${idBase}-bspan-${idCounter++}`, "span", {}, beforeChildren, { ...spanNode.styles },
        ));
      }

      // Middle: apply new styles
      if (hasStyles) {
        replacements.push(createNode(
          `${idBase}-mspan-${idCounter++}`, "span", {}, middleChildren, newStyles as NodeStyles,
        ));
      } else {
        replacements.push(...middleChildren);
      }

      // After: keep in original span (with all original styles)
      if (afterChildren.length > 0) {
        replacements.push(createNode(
          `${idBase}-aspan-${idCounter++}`, "span", {}, afterChildren, { ...spanNode.styles },
        ));
      }

      newChildren.splice(spanIdx, 1, ...replacements);
    }

    const newParent = createNode(
      spanParent.id, spanParent.type, { ...spanParent.properties }, newChildren, spanParent.styles,
    );
    currentState = updateAtPath(currentState, spanParentPath, newParent);

    const pathKey = spanParentPath.join(",");
    if (!modifiedParentPaths.some(p => p.join(",") === pathKey)) {
      modifiedParentPaths.push([...spanParentPath]);
    }
  }

  // --- Process unstyled text nodes (only when setting a value) ---
  if (desiredValue !== undefined && unstyledEntries.length > 0) {
    // Work backwards to avoid path invalidation
    for (let i = unstyledEntries.length - 1; i >= 0; i--) {
      const entry = unstyledEntries[i];
      const { path, startOffset, endOffset } = entry;
      const content = getTextContent(entry.node);

      const currentNode = getNodeByPath(currentState, path);
      if (!currentNode) continue;

      const parentPath = path.slice(0, -1);
      const childIdx = path[path.length - 1];
      const parent = getNodeByPath(currentState, parentPath);
      if (!parent) continue;

      const newChildren: StateNode[] = [...parent.children];
      const replacements: StateNode[] = [];

      if (startOffset > 0) {
        replacements.push(createNode(
          `${idBase}-pre-${idCounter++}`, "text",
          { ...currentNode.properties, content: content.slice(0, startOffset) },
          [], currentNode.styles,
        ));
      }

      const styledText = createNode(
        `${idBase}-st-${idCounter++}`, "text",
        { ...currentNode.properties, content: content.slice(startOffset, endOffset) },
        [], currentNode.styles,
      );
      const styledSpan = createNode(
        `${idBase}-span-${idCounter++}`, "span", {}, [styledText],
        { [key]: desiredValue } as NodeStyles,
      );
      replacements.push(styledSpan);

      if (endOffset < content.length) {
        replacements.push(createNode(
          `${idBase}-post-${idCounter++}`, "text",
          { ...currentNode.properties, content: content.slice(endOffset) },
          [], currentNode.styles,
        ));
      }

      newChildren.splice(childIdx, 1, ...replacements);
      const newParent = createNode(
        parent.id, parent.type, { ...parent.properties }, newChildren, parent.styles,
      );
      currentState = updateAtPath(currentState, parentPath, newParent);

      const pathKey = parentPath.join(",");
      if (!modifiedParentPaths.some(p => p.join(",") === pathKey)) {
        modifiedParentPaths.push([...parentPath]);
      }
    }
  }

  // Normalize modified parents (deepest first)
  currentState = normalizeModifiedParents(currentState, modifiedParentPaths);

  return { state: currentState, idCounter };
}

/** Get the effective value of a style property for a text entry. */
function getEffectiveStyleValue(
  state: StateNode,
  entry: TextEntry,
  key: keyof NodeStyles,
): NodeStyles[keyof NodeStyles] | undefined {
  // Check the node itself first
  if (entry.node.styles[key] !== undefined) return entry.node.styles[key];
  // Then check ancestor spans
  const ancestor = findStyleSpanAncestor(state, entry.path, key);
  if (ancestor) {
    const ancestorNode = getNodeByPath(state, ancestor.spanPath);
    if (ancestorNode) return ancestorNode.styles[key];
  }
  return undefined;
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

    const effectiveStart = pathsEqual(path, start.path) ? start.offset : 0;
    const effectiveEnd = pathsEqual(path, end.path) ? end.offset : contentLen;

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

/** Walk up from a text node to find ancestor span with given style. */
function findStyleSpanAncestor(
  state: StateNode,
  textPath: number[],
  property: keyof NodeStyles,
): { spanPath: number[] } | null {
  // Check each ancestor from the text node upward
  for (let depth = textPath.length - 1; depth >= 0; depth--) {
    const ancestorPath = textPath.slice(0, depth);
    const ancestor = getNodeByPath(state, ancestorPath);
    if (ancestor && ancestor.type === "span" && ancestor.styles[property] !== undefined) {
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
      parent.id, parent.type, { ...parent.properties }, normalized, parent.styles,
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
    // Text nodes: merge if all non-content properties and styles match
    return propsEqualExcept(a.properties, b.properties, "content") &&
      stylesEqual(a.styles, b.styles);
  }

  if (a.type === "span") {
    // Spans: merge if styles are identical
    return stylesEqual(a.styles, b.styles);
  }

  return false;
}

/** Merge two compatible nodes into one. */
function mergeNodes(a: StateNode, b: StateNode): StateNode {
  if (a.type === "text") {
    return createNode(a.id, "text", {
      ...a.properties,
      content: getTextContent(a) + getTextContent(b),
    }, [], a.styles);
  }

  // Span: merge children, then normalize recursively
  const merged = normalizeChildren([...a.children, ...b.children]);
  return createNode(a.id, a.type, { ...a.properties }, merged, a.styles);
}

/** Check if two NodeStyles objects are shallowly equal. */
function stylesEqual(
  a: Readonly<NodeStyles>,
  b: Readonly<NodeStyles>,
): boolean {
  const keysA = Object.keys(a) as (keyof NodeStyles)[];
  const keysB = Object.keys(b) as (keyof NodeStyles)[];
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
        [],
        child.styles,
      ));
      right.push(createNode(
        `${idBase}-sr${counter.value++}`,
        "text",
        { ...child.properties, content: content.slice(remaining) },
        [],
        child.styles,
      ));
    } else {
      // Recursively split the child's children
      const [childLeft, childRight] = splitChildrenAtOffset(
        child.children, remaining, idBase, counter,
      );
      if (childLeft.length > 0) {
        left.push(createNode(
          `${idBase}-sl${counter.value++}`, child.type, { ...child.properties }, childLeft, child.styles,
        ));
      }
      if (childRight.length > 0) {
        right.push(createNode(
          `${idBase}-sr${counter.value++}`, child.type, { ...child.properties }, childRight, child.styles,
        ));
      }
    }
    splitDone = true;
  }

  return [left, right];
}

import type { RenderNode, ElementBox, TextBox } from "../render/render-node-v2";
import type { TextShaper } from "./text-shaper";
import type { IntrinsicSizes, IntrinsicSizesCache } from "./intrinsic-sizes";

/**
 * Compute the intrinsic inline-axis sizes (min-content, max-content) of
 * a render node. Recursive; results cached per render-node key.
 *
 * Spec: CSS Sizing 3 §6.
 *
 * Plan 3.D Task 7 ships block/inline/text/inline-block. Table support is
 * Task 10 (will return placeholder { 0, 0 } for now).
 */
export function computeIntrinsicSizes(
  node: RenderNode,
  shaper: TextShaper,
  cache: IntrinsicSizesCache,
): IntrinsicSizes {
  const cached = cache.get(node.key);
  if (cached) return cached;

  const result = computeUncached(node, shaper, cache);
  cache.set(node.key, result);
  return result;
}

function computeUncached(
  node: RenderNode,
  shaper: TextShaper,
  cache: IntrinsicSizesCache,
): IntrinsicSizes {
  if (node.type === "text") {
    return computeTextIntrinsicSizes(node, shaper);
  }
  // ElementBox
  const cs = node.computedStyle;
  if (!cs) {
    // Should not happen post-cascade, but be defensive.
    return { minContent: 0, maxContent: 0 };
  }
  switch (cs.display) {
    case "block":
    case "list-item":
    case "inline-block":
    case "table-cell":
      return computeBlockIntrinsicSizes(node, shaper, cache);
    case "inline":
      return computeInlineIntrinsicSizes(node, shaper, cache);
    case "table":
      return computeTableIntrinsicSizes(node, shaper, cache);
    case "table-row":
    case "none":
    default:
      return { minContent: 0, maxContent: 0 };
  }
}

function computeTextIntrinsicSizes(
  node: TextBox,
  shaper: TextShaper,
): IntrinsicSizes {
  if (!node.computedStyle) return { minContent: 0, maxContent: 0 };
  const text = node.text;
  if (text.length === 0) return { minContent: 0, maxContent: 0 };
  const run = shaper.shape(text, node.computedStyle, node.computedStyle.direction);
  return {
    minContent: run.minClusterInlineSize,
    maxContent: run.unbreakableRunInlineSize,
  };
}

function computeBlockIntrinsicSizes(
  node: ElementBox,
  shaper: TextShaper,
  cache: IntrinsicSizesCache,
): IntrinsicSizes {
  // Determine whether children are inline (text, inline, inline-block) or block.
  const hasInlineChildren = node.children.some(
    (c) =>
      c.type === "text" ||
      (c.type === "element" &&
        (c.computedStyle?.display === "inline" ||
          c.computedStyle?.display === "inline-block")),
  );

  if (hasInlineChildren) {
    // Inline aggregation across all inline children:
    // minContent = max over children of child.min
    // maxContent = sum of child.max (no wrapping at max-content)
    let min = 0;
    let sum = 0;
    for (const child of node.children) {
      const c = computeIntrinsicSizes(child, shaper, cache);
      if (c.minContent > min) min = c.minContent;
      sum += c.maxContent;
    }
    return { minContent: min, maxContent: sum };
  }

  // Pure block aggregation: max-over-children for both min and max.
  let min = 0;
  let max = 0;
  for (const child of node.children) {
    const c = computeIntrinsicSizes(child, shaper, cache);
    if (c.minContent > min) min = c.minContent;
    if (c.maxContent > max) max = c.maxContent;
  }
  return { minContent: min, maxContent: max };
}

function computeInlineIntrinsicSizes(
  node: ElementBox,
  shaper: TextShaper,
  cache: IntrinsicSizesCache,
): IntrinsicSizes {
  // Inline: min = max(child.min); max = sum(child.max).
  let min = 0;
  let sum = 0;
  for (const child of node.children) {
    const c = computeIntrinsicSizes(child, shaper, cache);
    if (c.minContent > min) min = c.minContent;
    sum += c.maxContent;
  }
  return { minContent: min, maxContent: sum };
}

function computeTableIntrinsicSizes(
  node: ElementBox,
  shaper: TextShaper,
  cache: IntrinsicSizesCache,
): IntrinsicSizes {
  // Walk rows → cells. For each cell, collect intrinsic sizes.
  // Per column, colMin = max(cell.min for cells in this column).
  //              colMax = max(cell.max for cells in this column).
  // Table min = sum(colMin); table max = sum(colMax).

  const colMins: number[] = [];
  const colMaxes: number[] = [];

  for (const row of node.children) {
    if (row.type !== "element" || row.computedStyle?.display !== "table-row") continue;
    let colIdx = 0;
    for (const cell of row.children) {
      if (cell.type !== "element" || cell.computedStyle?.display !== "table-cell") continue;
      const cellSizes = computeIntrinsicSizes(cell, shaper, cache);
      colMins[colIdx] = Math.max(colMins[colIdx] ?? 0, cellSizes.minContent);
      colMaxes[colIdx] = Math.max(colMaxes[colIdx] ?? 0, cellSizes.maxContent);
      colIdx++;
    }
  }

  const tableMin = colMins.reduce((s, v) => s + v, 0);
  const tableMax = colMaxes.reduce((s, v) => s + v, 0);
  return { minContent: tableMin, maxContent: tableMax };
}

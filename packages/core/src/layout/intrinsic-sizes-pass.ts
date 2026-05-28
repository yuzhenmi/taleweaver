import type { RenderNode, ElementBox, TextBox } from "../render/render-node";
import type { TextShaper } from "./text-shaper";
import type { IntrinsicSizes, IntrinsicSizesCache } from "./intrinsic-sizes";
import { flattenContents } from "./group-children";

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
    case "contents":
      // No box of its own; its children contribute as if direct children of
      // its parent. Treated as a block container here (the general mixed
      // block+inline case). Reached only if a `contents` element is the ROOT of
      // an intrinsic query — the common child case is handled by the
      // `flattenContents` calls in the block/inline loops below.
      return computeBlockIntrinsicSizes(node, shaper, cache);
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
  // L-F / C3: per CSS Sizing 3 §5.2 (max-content of a block container),
  // a block container with mixed block + inline children performs
  // anonymous-block wrapping: each consecutive run of inline children
  // becomes one anonymous block. Container's max-content is then the
  // max over (real block children's max-content) AND (each
  // anonymous-block run's max-content). Within a run, max-content =
  // sum of inline children's max-content (one line, no wrap).
  //
  // The previous heuristic used `.some()` to detect any inline child,
  // then iterated ALL children with inline accumulation — summing
  // block children's max-content into the run. For a doc element
  // with one inline child and ten block children, the inflated
  // max-content was max(over all 11) plus the sum-as-if-inline, which
  // can be much larger than the correct value.
  let containerMin = 0;
  let containerMax = 0;
  let runMin = 0;
  let runMax = 0;
  let runActive = false;

  const flushRun = (): void => {
    if (!runActive) return;
    if (runMin > containerMin) containerMin = runMin;
    if (runMax > containerMax) containerMax = runMax;
    runActive = false;
    runMin = 0;
    runMax = 0;
  };

  for (const child of flattenContents(node.children)) {
    const isInline =
      child.type === "text" ||
      (child.type === "element" &&
        (child.computedStyle?.display === "inline" ||
          child.computedStyle?.display === "inline-block"));
    const c = computeIntrinsicSizes(child, shaper, cache);
    if (isInline) {
      if (!runActive) {
        runActive = true;
        runMin = 0;
        runMax = 0;
      }
      if (c.minContent > runMin) runMin = c.minContent;
      runMax += c.maxContent; // sum within a run (no wrap at max-content)
    } else {
      flushRun();
      if (c.minContent > containerMin) containerMin = c.minContent;
      if (c.maxContent > containerMax) containerMax = c.maxContent;
    }
  }
  flushRun();

  return { minContent: containerMin, maxContent: containerMax };
}

function computeInlineIntrinsicSizes(
  node: ElementBox,
  shaper: TextShaper,
  cache: IntrinsicSizesCache,
): IntrinsicSizes {
  // Inline: min = max(child.min); max = sum(child.max).
  let min = 0;
  let sum = 0;
  for (const child of flattenContents(node.children)) {
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

  // Both walks go through `flattenContents` so a `display: contents` wrapper
  // (e.g. a `section` containing table rows in P1.C) is transparent here, just
  // as it is in BFC / IFC layout and in the inline intrinsic path above. Without
  // the flatten, the `display !== "table-row"` / "table-cell" filters would skip
  // the contents wrapper and silently produce { min: 0, max: 0 }.
  for (const row of flattenContents(node.children)) {
    if (row.type !== "element" || row.computedStyle?.display !== "table-row") continue;
    let colIdx = 0;
    for (const cell of flattenContents(row.children)) {
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

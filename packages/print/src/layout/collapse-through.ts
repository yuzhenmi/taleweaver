import type { ComputedStyle, UsedStyle } from "@taleweaver/core";
import { resolveUsedLength } from "./used-style";

/**
 * Resolve an explicit block-size, returning null for "auto" or intrinsic keywords.
 * Used to distinguish "no explicit size given" from "explicit size of 0".
 */
export function resolveExplicitBlockSizeOrNull(
  blockSize: ComputedStyle["blockSize"],
  containingInlineSize: number,
): number | null {
  if (blockSize === "auto" || blockSize === "min-content" || blockSize === "max-content" || blockSize === "fit-content") {
    return null;
  }
  return resolveUsedLength(blockSize, containingInlineSize, 0);
}

/**
 * CSS 2.1 §8.3.1 empty block: no content height, padding, border, or explicit
 * block size — its top and bottom margins collapse together (bfc's empty-block
 * rule). The one predicate bfc and the measure pass (build-fit-metas) share.
 */
export function isCollapseThroughEmpty(
  cs: ComputedStyle,
  us: Pick<UsedStyle, "paddingBlockStart" | "paddingBlockEnd" | "borderBlockStartWidth" | "borderBlockEndWidth">,
  laidOutBlockSize: number,
  containingInlineSize: number,
): boolean {
  const explicit = resolveExplicitBlockSizeOrNull(cs.blockSize, containingInlineSize);
  return (explicit === null || explicit === 0)
    && us.paddingBlockStart + us.paddingBlockEnd === 0
    && us.borderBlockStartWidth + us.borderBlockEndWidth === 0
    && laidOutBlockSize === 0;
}

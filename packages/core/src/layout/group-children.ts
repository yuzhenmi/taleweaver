import type { RenderNode, ElementBox } from "../render/render-node-v2";

export type ChildGroup =
  | { readonly kind: "block";  readonly child: RenderNode; readonly positionalIndex: number }
  | { readonly kind: "inline-run"; readonly children: readonly RenderNode[]; readonly positionalIndex: number };

/**
 * Determine if a child should be treated as inline-display for the purpose
 * of anonymous block-run grouping.
 */
function isInlineChild(child: RenderNode): boolean {
  if (child.type === "text") return true;
  if (!child.computedStyle) return false;
  const d = child.computedStyle.display;
  return d === "inline" || d === "inline-block";
}

/**
 * Walk `parent`'s children in document order. Group consecutive inline-
 * display children into one `inline-run` group; block-display children
 * become individual `block` groups. Inline / non-inline boundaries delimit
 * groups.
 *
 * `positionalIndex` is the group's ordinal position in the output, used by
 * the layout pass to generate stable keys for anonymous boxes.
 */
export function groupChildren(parent: ElementBox): readonly ChildGroup[] {
  const out: ChildGroup[] = [];
  let currentRun: RenderNode[] | null = null;

  for (const child of parent.children) {
    if (isInlineChild(child)) {
      if (!currentRun) {
        currentRun = [];
      }
      currentRun.push(child);
    } else {
      // Flush any pending inline-run.
      if (currentRun) {
        out.push({
          kind: "inline-run",
          children: currentRun,
          positionalIndex: out.length,
        });
        currentRun = null;
      }
      // Block child stands alone.
      out.push({
        kind: "block",
        child,
        positionalIndex: out.length,
      });
    }
  }

  // Flush trailing inline-run.
  if (currentRun) {
    out.push({
      kind: "inline-run",
      children: currentRun,
      positionalIndex: out.length,
    });
  }

  return out;
}

/** Generate the stable layout key for an anonymous block produced by an inline-run group. */
export function anonymousBlockKey(parentKey: string, positionalIndex: number): string {
  return `${parentKey}/anon[${positionalIndex}]`;
}

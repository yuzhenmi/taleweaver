/**
 * @module group-children
 *
 * ## Anonymous-box keying convention
 *
 * Whenever the layout engine needs to generate a synthetic (anonymous) box
 * that has no corresponding state-tree node, it must still assign a stable,
 * deterministic key so that incremental re-layout can match old boxes to new
 * ones without thrashing.  The convention across all formatting contexts is:
 *
 *   ```
 *   anonymousBlockKey(parentKey, positionalIndex)
 *   // → "<parentKey>/anon[<positionalIndex>]"
 *   ```
 *
 * where `positionalIndex` is the ordinal position of the anonymous group
 * within the *output* sequence (i.e. already-emitted groups count toward it).
 *
 * Applied sites:
 * - **BFC** (`bfc.ts`): anonymous block wrapper around each inline-run group
 *   emitted by `groupChildren`.  Parent key = the BFC container's key.
 * - **Table FC** (`table-fc.ts`): anonymous `table-row` boxes wrapping bare
 *   `table-cell` direct children of a `display:table` element.  Parent key =
 *   the table element's key.
 * - **Table FC** (`table-fc.ts`): anonymous `table-cell` boxes wrapping
 *   non-cell content inside a `display:table-row` element.  Parent key =
 *   the row's key (real or itself anonymous).
 */
import type { RenderNode, ElementBox } from "@taleweaver/core";

export type ChildGroup =
  | { readonly kind: "block";  readonly child: RenderNode; readonly positionalIndex: number }
  | { readonly kind: "inline-run"; readonly children: readonly RenderNode[]; readonly positionalIndex: number };

/**
 * Flatten `display: contents` elements (CSS Display 3 §3.2): such an element
 * generates no box, so it is replaced in place by its own children — recursively,
 * to handle nested `contents`. The element keeps its render/cascade identity (its
 * children already inherit through it via the normal cascade chain); it simply
 * contributes no box and no box-model (margins/padding/border are dropped with
 * the suppressed box).
 *
 * Returns the SAME array reference when no `contents` element is present (the
 * overwhelmingly common case — allocation-free, zero hot-path cost). Shared by
 * `groupChildren` (BFC + build-fit-metas) and the intrinsic-sizes pass so the
 * two child-walks agree on transparency.
 */
export function flattenContents(
  children: readonly RenderNode[],
): readonly RenderNode[] {
  let hasContents = false;
  for (const c of children) {
    if (c.type === "element" && c.computedStyle?.display === "contents") {
      hasContents = true;
      break;
    }
  }
  if (!hasContents) return children;

  const out: RenderNode[] = [];
  for (const c of children) {
    if (c.type === "element" && c.computedStyle?.display === "contents") {
      for (const grandchild of flattenContents(c.children)) out.push(grandchild);
    } else {
      out.push(c);
    }
  }
  return out;
}

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

  // Flatten `display: contents` children first so a contents element produces no
  // box; its children group as if direct children of `parent`. `positionalIndex`
  // below is `out.length` (the OUTPUT-group ordinal), so anonymous-block keys
  // align with the wrapper-removed tree automatically.
  for (const child of flattenContents(parent.children)) {
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

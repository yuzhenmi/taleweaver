// packages/core/src/layout/pdf-outline.ts
//
// #523 — PDF outline (`/Outlines` bookmark tree) core helper. `buildPdfOutline`
// turns `getOutline`'s flat `{ blockId, level, text }[]` into a nested,
// destination-resolved `PdfOutlineNode[]`: a stack nest-by-level (a level skip
// attaches to the nearest shallower ancestor) and each node's `dest` resolved via
// the shipped `resolveGotoDestination`. Reuses #410 `getOutline` + #522
// `resolveGotoDestination`.

import type { State } from "@taleweaver/core";
import { getOutline } from "@taleweaver/core";
import type { VirtualLayoutTree } from "./virtual-layout-tree";
import type { TextShaper } from "@taleweaver/core";
import type { TextMeasurer } from "@taleweaver/core";
import type { BlockParentLookup } from "./page-of-field-target";
import { resolveGotoDestination, type InternalDestination } from "./resolve-goto-destination";

/** A node in the PDF bookmark (`/Outlines`) tree: a heading's title, its jump
 *  destination (`null` → a bookmark with no `/Dest`), and nested child headings. */
export interface PdfOutlineNode {
  readonly title: string;
  readonly dest: InternalDestination | null;
  readonly children: readonly PdfOutlineNode[];
}

/**
 * Build the nested, destination-resolved PDF outline tree from the document's
 * headings. Reads headings in the ACCEPTED (`"final"`) view — an exported PDF
 * represents the accepted document, matching the view the `virtualTree` was laid
 * out from. Nests by heading level (a level skip attaches to the nearest shallower
 * ancestor); resolves each heading's destination via `resolveGotoDestination`.
 * Returns `[]` for a heading-free document.
 */
export function buildPdfOutline(
  state: State,
  virtualTree: VirtualLayoutTree,
  shaper: TextShaper | TextMeasurer,
  parentOf: BlockParentLookup,
): readonly PdfOutlineNode[] {
  const entries = getOutline(state, { suggestionView: "final" });

  interface Builder {
    readonly title: string;
    readonly dest: InternalDestination | null;
    readonly level: number;
    readonly children: Builder[];
  }

  const roots: Builder[] = [];
  const stack: Builder[] = [];

  for (const entry of entries) {
    const node: Builder = {
      title: entry.text,
      dest: resolveGotoDestination(state, entry.blockId, virtualTree, shaper, parentOf),
      level: entry.level,
      children: [],
    };

    // Pop any ancestor at or below this heading's level; the nearest remaining
    // entry is then a strictly-shallower ancestor (or none → a new root). `peek`
    // returns `Builder | undefined` honestly (the `noUncheckedIndexedAccess`
    // contract), so no `!`/cast is needed.
    const peek = (): Builder | undefined => (stack.length > 0 ? stack[stack.length - 1] : undefined);
    let parent = peek();
    while (parent !== undefined && parent.level >= entry.level) {
      stack.pop();
      parent = peek();
    }
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
    stack.push(node);
  }

  const freeze = (b: Builder): PdfOutlineNode => ({
    title: b.title,
    dest: b.dest,
    children: b.children.map(freeze),
  });
  return roots.map(freeze);
}

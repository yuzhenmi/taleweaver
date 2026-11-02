import type { BlockId } from "../../block";
import type { Document } from "../../document/types";
import { type ModelPosition, isAllSelection, isObjectSelection, position, samePosition } from "../../position/model-position";
import { type ParagraphLayout, type StoragePoint, flowStart, paragraphLayout } from "../../position/paragraph-layout";
import { resolveOffset } from "../../position/resolve-position";
import { comparePoints, pointAfter } from "../../position/storage-points";
import type { CommandContext } from "../command-context";

// ---------------------------------------------------------------------------
// Positions and ranges
// ---------------------------------------------------------------------------

/** A resolved position with its paragraph's layout. */
export interface At {
  readonly L: ParagraphLayout;
  readonly offset: number;
  /** A select-all's start only: the flow's start, so the range also takes the block objects before `L`. */
  readonly from?: StoragePoint;
}

export function atOf(ctx: CommandContext, pos: ModelPosition): At | null {
  const L = paragraphLayout(ctx.version, pos.blockId);
  if (L === null) return null;
  return { L, offset: resolveOffset(L, pos.offset, ctx.options) };
}

export interface Range {
  readonly start: At;
  readonly end: At;
  readonly collapsed: boolean;
}

/** The first and last paragraphs of flow `holderId` (default the body), in reading order. */
function flowParagraphs(d: Document, holderId: BlockId): { first: ParagraphLayout; last: ParagraphLayout } | null {
  const fs = d.flows.get(holderId);
  if (fs === undefined) return null;
  const tree = d.trees[fs.tree];
  const containers = fs.isRoot ? fs.sections.map((s) => s.id) : [holderId];
  let first: BlockId | null = null;
  let last: BlockId | null = null;
  for (const c of containers) {
    for (let id = tree.get(c)?.firstChildId ?? null; id !== null; id = tree.get(id)?.nextSiblingId ?? null) {
      if (tree.get(id)?.inlineContent === null) continue;
      first ??= id;
      last = id;
    }
  }
  const F = first === null ? null : paragraphLayout(d, first);
  const L = last === null ? null : paragraphLayout(d, last);
  return F === null || L === null ? null : { first: F, last: L };
}

/**
 * The selection, resolved and ordered; null for an object selection (only the commands
 * that replace or delete it take one), when an end is not a position, or when the ends
 * are in different flows (cross-context: refused, as today). A select-all is the range
 * from its flow's start to the end of its last paragraph.
 */
export function rangeOf(ctx: CommandContext): Range | null {
  const sel = ctx.selection;
  if (isObjectSelection(sel)) return null;
  if (isAllSelection(sel)) {
    const p = flowParagraphs(ctx.version, sel.flow);
    const from = p === null ? null : flowStart(p.first.fs);
    if (p === null || from === null) return null;
    return { start: { L: p.first, offset: 0, from }, end: { L: p.last, offset: p.last.length }, collapsed: false };
  }
  const { anchor, focus } = sel;
  const a = atOf(ctx, anchor);
  if (a !== null && samePosition(anchor, focus)) return { start: a, end: a, collapsed: true };
  const f = atOf(ctx, focus);
  if (a === null || f === null || a.L.fs !== f.L.fs) return null;
  const pa = pointAfter(a.L, a.offset);
  const pf = pointAfter(f.L, f.offset);
  if (pa === null || pf === null) return { start: a, end: a, collapsed: true };
  const c = comparePoints(pa, pf) || a.offset - f.offset;
  const [start, end] = c <= 0 ? [a, f] : [f, a];
  return { start, end, collapsed: a.L.block.id === f.L.block.id && a.offset === f.offset };
}

export const posOf = (a: At): ModelPosition => position(a.L.block.id, a.offset);

import { BLOCK_TYPES, type BlockId } from "../../block";
import { resolveBlock } from "../../document/blocks";
import type { Document } from "../../document/types";
import { type ModelPosition, isAllSelection, isObjectSelection, position, samePosition } from "../../position/model-position";
import { type ParagraphLayout, type StoragePoint, flowStart, paragraphLayout, terminatorOf } from "../../position/paragraph-layout";
import { resolveOffset } from "../../position/resolve-position";
import { comparePoints, pointAfter, pointOf } from "../../position/storage-points";
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

/**
 * The first and last paragraphs of container `id` (a flow's holder, or a table cell), in reading order, and the point
 * the container starts at (a select-all's start: block objects before its first paragraph are taken too; null for a
 * virtual cell).
 */
function containerParagraphs(d: Document, id: BlockId): { first: ParagraphLayout; last: ParagraphLayout; from: StoragePoint | null } | null {
  const fs = d.flows.get(id);
  const cell = fs === undefined ? resolveBlock(d, id) : null;
  if (fs === undefined && cell === null) return null;
  const tree = d.trees[fs?.tree ?? cell?.kind ?? "block"];
  const containers = fs?.isRoot === true ? fs.sections.map((s) => s.id) : [id];
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
  if (F === null || L === null) return null;
  if (fs !== undefined) return { first: F, last: L, from: flowStart(F.fs) };
  // A cell: right after its `⟨c⟩`; a virtual cell (no mark, null) is its one empty paragraph.
  const mark = terminatorOf(d, F.fs, id);
  const at = mark === null ? null : pointOf(F.fs, mark);
  return { first: F, last: L, from: at === null || mark === null ? null : { ...at, index: at.index + mark.token.len } };
}

/** The container a paragraph of `d` is in: its nearest table cell, else its flow (`""`). Text ranges stay inside one. */
export function containerKey(d: Document, L: ParagraphLayout): BlockId {
  const tree = d.trees[L.tree];
  for (let id = L.block.parentId; id !== null; id = tree.get(id)?.parentId ?? null) if (tree.get(id)?.type === BLOCK_TYPES.tableCell) return id;
  return "";
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
    const p = containerParagraphs(ctx.version, sel.container);
    if (p === null) return null;
    // A container holding nothing but one implicit paragraph (a virtual or `/empty` cell): a caret there, whose first
    // write makes it real (a range would delete nothing and leave the write without its ¶).
    const head = p.first.head;
    const only = p.first.block.id === p.last.block.id && p.first.implicit && (p.from === null || (head !== null && comparePoints(p.from, head) === 0));
    if (only || p.from === null) return { start: { L: p.first, offset: 0 }, end: { L: p.first, offset: 0 }, collapsed: true };
    return { start: { L: p.first, offset: 0, from: p.from }, end: { L: p.last, offset: p.last.length }, collapsed: false };
  }
  const { anchor, focus } = sel;
  const a = atOf(ctx, anchor);
  if (a !== null && samePosition(anchor, focus)) return { start: a, end: a, collapsed: true };
  const f = atOf(ctx, focus);
  // Ends in different flows (cross-context), or in different containers of one flow (a cell and outside it: a cell
  // selection, N7), are refused.
  if (a === null || f === null || a.L.fs !== f.L.fs || containerKey(ctx.version, a.L) !== containerKey(ctx.version, f.L)) return null;
  const pa = pointAfter(a.L, a.offset);
  const pf = pointAfter(f.L, f.offset);
  if (pa === null || pf === null) return { start: a, end: a, collapsed: true };
  const c = comparePoints(pa, pf) || a.offset - f.offset;
  const [start, end] = c <= 0 ? [a, f] : [f, a];
  return { start, end, collapsed: a.L.block.id === f.L.block.id && a.offset === f.offset };
}

export const posOf = (a: At): ModelPosition => position(a.L.block.id, a.offset);

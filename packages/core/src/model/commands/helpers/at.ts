import { type ModelPosition, position } from "../../position/model-position";
import { type ParagraphLayout, type StoragePoint, paragraphLayout } from "../../position/paragraph-layout";
import { resolveOffset } from "../../position/resolve-position";
import { comparePoints, objectsStart, pointAfter } from "../../position/storage-points";
import type { CommandContext } from "../command-context";

// ---------------------------------------------------------------------------
// Positions and ranges
// ---------------------------------------------------------------------------

/** A resolved position with its paragraph's layout. */
export interface At {
  readonly L: ParagraphLayout;
  readonly offset: number;
  /** A leading endpoint (see `ModelPosition.leading`), resolved: objects do precede the paragraph. */
  readonly leading?: boolean;
}

export function atOf(ctx: CommandContext, pos: ModelPosition): At | null {
  const L = paragraphLayout(ctx.version, pos.blockId);
  if (L === null) return null;
  const offset = resolveOffset(L, pos.offset, ctx.options);
  return { L, offset, leading: pos.leading === true && offset === 0 && objectsStart(L) !== null };
}

export interface Range {
  readonly start: At;
  readonly end: At;
  readonly collapsed: boolean;
}

/** The selection, resolved and ordered; null when an end is not a position or the ends are in different flows (cross-context: refused, as today). */
export function rangeOf(ctx: CommandContext): Range | null {
  const { anchor, focus } = ctx.selection;
  const a = atOf(ctx, anchor);
  if (a !== null && anchor.blockId === focus.blockId && anchor.offset === focus.offset && anchor.leading === focus.leading) return { start: a, end: a, collapsed: true };
  const f = atOf(ctx, focus);
  if (a === null || f === null || a.L.fs !== f.L.fs) return null;
  const pa = startPoint(a);
  const pf = startPoint(f);
  if (pa === null || pf === null) return { start: a, end: a, collapsed: true };
  const c = comparePoints(pa, pf) || a.offset - f.offset;
  const same = a.L.block.id === f.L.block.id && a.offset === f.offset && a.leading === f.leading;
  return c <= 0 ? { start: a, end: f, collapsed: same } : { start: f, end: a, collapsed: same };
}

/** Where an endpoint sits in storage: before the preceding objects for a leading one. */
const startPoint = (a: At): StoragePoint | null => (a.leading === true ? objectsStart(a.L) : pointAfter(a.L, a.offset));

export const posOf = (a: At): ModelPosition => position(a.L.block.id, a.offset);

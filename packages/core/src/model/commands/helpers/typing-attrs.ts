import { valueEqual } from "../../equality";
import type { ReadonlyAttrs } from "../../block";
import { textNeighbours } from "../../position/items";
import type { ParagraphLayout } from "../../position/paragraph-layout";
import type { CommandOptions } from "../command-context";

// ---------------------------------------------------------------------------
// Typing attrs
// ---------------------------------------------------------------------------

export const isInclusive = (k: string, opts: CommandOptions): boolean => opts.isAtomicMark?.(k) !== true && opts.isInclusiveMark?.(k) !== false;

/**
 * The formatting typed text takes at a caret `offset` (today's `inheritedAttrsAt`):
 * the text item before it (at the start: after it; embeds skipped), else the ¶'s
 * mark props. Atomic marks are never extended; a NON-inclusive mark is kept only
 * strictly inside its range (the same value on both sides), never at its edge.
 */
export function typingAttrs(L: ParagraphLayout, offset: number, opts: CommandOptions = {}): ReadonlyAttrs {
  const { before, after } = textNeighbours(L, offset);
  const base = before ?? after;
  if (base === null) return Object.fromEntries(Object.entries(L.block.markAttrs ?? {}).filter(([k]) => opts.isAtomicMark?.(k) !== true));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base.item.attrs)) {
    if (opts.isAtomicMark?.(k) === true) continue;
    if (opts.isInclusiveMark?.(k) === false) {
      if (before === null || after === null) continue;
      if (before !== after && !valueEqual(after.item.attrs[k], v)) continue;
    }
    out[k] = v;
  }
  return out;
}

/** The formatting text typed OVER a selection starting at `offset` takes: the first selected character's, minus atomic marks (today's `typeOverAttrs`). */
export function typeOverAttrs(L: ParagraphLayout, offset: number, opts: CommandOptions = {}): ReadonlyAttrs {
  const { after } = textNeighbours(L, offset);
  if (after === null) return typingAttrs(L, offset, opts);
  return Object.fromEntries(Object.entries(after.item.attrs).filter(([k]) => opts.isAtomicMark?.(k) !== true));
}

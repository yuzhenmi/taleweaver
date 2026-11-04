import type { Plan, Write } from "../../plan";
import { type BlockObject, blockObjectAt, paragraphAfterObject } from "../../position/block-object";
import { caretAt, isObjectSelection } from "../../position/model-position";
import type { CommandContext } from "../command-context";
import { type At, rangeOf } from "./at";
import { deleteBetween } from "./writes";

/**
 * Replacing an object selection: the write deleting its object, and the context of a
 * caret at the start of the paragraph right after it (W2 puts one there; after a
 * concurrent W2 break, its implicit one), where what replaces the object goes.
 * Null for any other selection.
 */
export function overObject(ctx: CommandContext): { readonly writes: readonly Write[]; readonly ctx: CommandContext; readonly object: BlockObject } | null {
  const sel = ctx.selection;
  const o = isObjectSelection(sel) ? blockObjectAt(ctx.version, sel.object) : null;
  const P = o === null ? null : paragraphAfterObject(ctx.version, o);
  if (o === null || P === null || o.last === null) return null;
  return { writes: deleteBetween(o.fs, o.point, o.end), ctx: { ...ctx, selection: caretAt(P.block.id, 0) }, object: o };
}

/** `command` over the selection: over an object selection, the object goes and `command` runs at a caret where its replacement goes ({@link overObject}). */
export function overSelection(ctx: CommandContext, command: (ctx: CommandContext) => Plan | null): Plan | null {
  if (!isObjectSelection(ctx.selection)) return command(ctx);
  const o = overObject(ctx);
  return o === null ? null : withWrites(o.writes, command(o.ctx));
}

/** Where the selection starts, for a command that reads only its paragraph (its section): an object selection's, the paragraph after the object. */
export function selectionStart(ctx: CommandContext): At | null {
  return rangeOf(overObject(ctx)?.ctx ?? ctx)?.start ?? null;
}

/** `p` with `writes` first (null stays null). */
export const withWrites = (writes: readonly Write[], p: Plan | null): Plan | null => (p === null ? null : { ...p, writes: [...writes, ...p.writes] });

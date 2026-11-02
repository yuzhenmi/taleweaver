import type { Plan, Write } from "../../plan";
import { blockObjectAt, paragraphAfterObject } from "../../position/block-object";
import { caretAt, isObjectSelection } from "../../position/model-position";
import type { TerminatorRef } from "../../position/paragraph-layout";
import type { CommandContext } from "../command-context";
import { type At, rangeOf } from "./at";

/**
 * Replacing an object selection: the write deleting its object, and the context of a
 * caret at the start of the paragraph after it (W2 puts one there; past the block
 * objects abutting it, a concurrent W2 break), where what replaces the object goes.
 * Null for any other selection, or with no paragraph after the object.
 */
export function overObject(ctx: CommandContext): { readonly write: Write; readonly ctx: CommandContext; readonly object: TerminatorRef } | null {
  const sel = ctx.selection;
  const o = isObjectSelection(sel) ? blockObjectAt(ctx.version, sel.object) : null;
  const P = o === null ? null : paragraphAfterObject(ctx.version, o.fs, o.term);
  if (o === null || P === null) return null;
  return { write: { k: "delete", piece: o.point.piece, index: o.point.index, len: 1 }, ctx: { ...ctx, selection: caretAt(P.block.id, 0) }, object: o.term };
}

/** `command` over the selection: over an object selection, the object goes and `command` runs at a caret where its replacement goes ({@link overObject}). */
export function overSelection(ctx: CommandContext, command: (ctx: CommandContext) => Plan | null): Plan | null {
  if (!isObjectSelection(ctx.selection)) return command(ctx);
  const o = overObject(ctx);
  return o === null ? null : withWrite(o.write, command(o.ctx));
}

/** Where the selection starts, for a command that reads only its paragraph (its section): an object selection's, the paragraph after the object. */
export function selectionStart(ctx: CommandContext): At | null {
  return rangeOf(overObject(ctx)?.ctx ?? ctx)?.start ?? null;
}

/** `p` with `write` first (null stays null). */
export const withWrite = (write: Write, p: Plan | null): Plan | null => (p === null ? null : { ...p, writes: [write, ...p.writes] });

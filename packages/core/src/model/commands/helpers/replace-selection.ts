import type { BlockId, ReadonlyAttrs } from "../../block";
import type { Document } from "../../document/types";
import type { InsertUnit, Plan, Write } from "../../plan";
import { type ModelSelection, caretAt } from "../../position/model-position";
import type { StoragePoint } from "../../position/paragraph-layout";
import { comparePoints, pointAfter } from "../../position/storage-points";
import type { Scalar } from "../../storage/scalar";
import type { CommandContext, CommandOptions } from "../command-context";
import { rangeOf } from "./at";
import { plan } from "./build-plan";
import { deleteRange } from "./delete-range";
import { overSelection } from "./over-object";
import { type Keys, joinKeys, keysOf, mKeys, scalar } from "./paragraph-keys";
import { isInclusive, typeOverAttrs, typingAttrs } from "./typing-attrs";
import { idAfter, insertAt, keysWrite, materialize } from "./writes";

/** The ¶-mark keys (`m:*`) typing `attrs` at a paragraph's end gives its ¶: the inclusive ones (today's `writeTypedMarkAttrs`). */
function typedMarkKeys(attrs: ReadonlyAttrs, opts: CommandOptions): Keys {
  const out: Keys = {};
  for (const [k, v] of Object.entries(attrs)) {
    const s = scalar(v);
    if (s !== undefined && s !== null && isInclusive(k, opts)) out[`m:${k}`] = s;
  }
  return out;
}

// ---------------------------------------------------------------------------
// C1 / C11 core: replace the selection with inline units
// ---------------------------------------------------------------------------

/**
 * Replace the selection with `units` (type-over deletes the range first, C9; an object
 * selection's object goes, the units going at the start of the paragraph after it);
 * caret after them. `units` receive `attrs` when they carry none of their own.
 */
export function replaceSelection(ctx: CommandContext, make: (attrs: ReadonlyAttrs) => readonly InsertUnit[], caretAfter?: (after: Document) => ModelSelection | null): Plan | null {
  return overSelection(ctx, (c) => replaceRange(c, make, caretAfter));
}

function replaceRange(ctx: CommandContext, make: (attrs: ReadonlyAttrs) => readonly InsertUnit[], caretAfter?: (after: Document) => ModelSelection | null): Plan | null {
  const r = rangeOf(ctx);
  if (r === null) return null;
  const { start, end } = r;
  const opts = ctx.options ?? {};
  const typed = r.collapsed ? typingAttrs(start.L, start.offset, opts) : typeOverAttrs(start.L, start.offset, opts);
  const units = make(typed);
  let len = 0;
  for (const u of units) len += "text" in u ? u.text.length : 1;
  const p = pointAfter(start.L, start.offset);
  if (p === null || (r.collapsed && start.L.implicit)) {
    // Nothing stored (R17, an implicit paragraph): the content goes in with its ¶ (and the flow's first piece when it has none).
    const m = materialize(start.L, {}, units);
    if (m === null) return null;
    return plan(ctx.version, m.writes, (after) => caretAfter?.(after) ?? caretAt(idAfter(m.map, start.L.block.id), len));
  }
  const writes: Write[] = [];
  let survivor: () => BlockId = () => start.L.block.id;
  let joined: Keys | null = null;
  let ins: StoragePoint = p;
  if (!r.collapsed) {
    const del = deleteRange(start, end);
    if (del === null) return null;
    writes.push(...del.writes);
    survivor = del.survivor;
    if (comparePoints(del.at, p) < 0) ins = del.at; // a select-all took leading block objects
    if (start.L.block.id !== end.L.block.id) joined = joinKeys(start);
  }
  writes.push(insertAt(ins, units));
  // Typing at the paragraph's end gives its ¶ the typed run's inclusive formatting (today's insert-text).
  const last = units[units.length - 1];
  if (end.offset === end.L.length && end.L.mark !== null && last !== undefined && "text" in last && units.every((u) => "text" in u)) {
    const from: Keys = { ...mKeys(keysOf(end.L)), ...mKeys(joined ?? {}) };
    const to = typedMarkKeys(last.attrs, opts);
    const diff: Record<string, Scalar | undefined> = {};
    for (const k of Object.keys(from)) if (!(k in to)) diff[k] = undefined;
    for (const [k, v] of Object.entries(to)) if (from[k] !== v || joined !== null) diff[k] = v;
    writes.push(...keysWrite(end.L.mark, diff));
  }
  const offset = start.offset + len;
  return plan(ctx.version, writes, (after) => caretAfter?.(after) ?? caretAt(survivor(), offset));
}

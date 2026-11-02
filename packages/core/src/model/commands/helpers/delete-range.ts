import type { BlockId } from "../../block";
import type { Plan, Write } from "../../plan";
import { caretAt } from "../../position/model-position";
import type { StoragePoint } from "../../position/paragraph-layout";
import { objectsStart, pointAfter, pointBefore } from "../../position/storage-points";
import type { CommandContext } from "../command-context";
import type { At, Range } from "./at";
import { plan } from "./build-plan";
import { type Keys, diffKeys, joinKeys, keysOf } from "./paragraph-keys";
import { deleteBetween, idAfter, keysWrite, materialize } from "./writes";

export interface Deletion {
  readonly writes: Write[];
  /** The surviving paragraph's id after Apply. */
  readonly survivor: () => BlockId;
  /** Where the deletion starts: the insertion point for what replaces the range. */
  readonly at: StoragePoint;
}

/**
 * C9: delete everything from `start` to `end` (one flow, start ≤ end). Block objects,
 * `[S]` and whole rule paragraphs inside are taken whole; the end paragraph's ¶
 * survives with the JOIN keys (or `tailKeys`, when given, overriding them).
 * From a leading `start` it also takes the block objects before its paragraph.
 */
export function deleteRange(start: At, end: At, tailKeys?: Keys): Deletion | null {
  // A range from a leading endpoint also takes the block objects before the paragraph (C9).
  const a = (start.leading === true ? objectsStart(start.L) : null) ?? pointBefore(start.L, start.offset);
  const b = pointAfter(end.L, end.offset);
  if (a === null || b === null) return null;
  const writes = deleteBetween(start.L.fs, a, b);
  const join = start.L.block.id !== end.L.block.id;
  const target = tailKeys ?? (join ? joinKeys(start) : null);
  if (end.L.mark !== null) {
    if (target !== null) writes.push(...keysWrite(end.L.mark, diffKeys(keysOf(end.L), target)));
    const id = end.L.block.id;
    return { writes, survivor: () => id, at: a };
  }
  if (!join && tailKeys === undefined) {
    const id = end.L.block.id;
    return { writes, survivor: () => id, at: a };
  }
  // The end paragraph is debris: give it a ¶ (X2) carrying the joined keys.
  const m = materialize(end.L, target ?? {});
  if (m === null) return null;
  writes.push(...m.writes);
  const fallback = end.L.block.id;
  return { writes, survivor: () => idAfter(m.map, fallback), at: a };
}

/** Backspace / Delete over a range: C9. A selected `[hr]` (a rule's object selection) is a character like any other: only it goes. */
export function deleteSelectionOf(ctx: CommandContext, r: Range): Plan | null {
  const del = deleteRange(r.start, r.end);
  if (del === null || del.writes.length === 0) return null;
  const offset = r.start.offset;
  return plan(ctx.version, del.writes, () => caretAt(del.survivor(), offset));
}

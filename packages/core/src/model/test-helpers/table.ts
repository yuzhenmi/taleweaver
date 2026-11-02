/** Test-only table builders (raw storage, including states commands never write). */
import * as Y from "yjs";
import { TRACK_KEY } from "../storage/keys";
import { mapOf, newParagraphMark } from "../storage/new-items";
import type { FlatKeys } from "../storage/scalar";
import { cellFlowKey } from "../storage/table-keys";

/** A detached one-piece flow holding `text` + a ¶ (`keys` on the ¶). */
export function textFlow(text: string, keys: FlatKeys = {}): Y.Array<Y.Text> {
  const piece = new Y.Text();
  piece.insert(0, text);
  piece.insertEmbed(text.length, newParagraphMark(keys));
  const arr = new Y.Array<Y.Text>();
  arr.insert(0, [piece]);
  return arr;
}

/**
 * A RowMap `key`: each cell entry is the slot's text (a one-¶ flow), a prebuilt flow
 * array, or null (no `c:<col>:flow`, X4). `keys`: further flat keys (spans, attrs, header).
 */
export function testRow(key: string, cells: Readonly<Record<string, string | Y.Array<Y.Text> | null>>, keys: FlatKeys = {}): Y.Map<unknown> {
  const e: Record<string, unknown> = { ...keys, [TRACK_KEY]: key };
  for (const [col, c] of Object.entries(cells)) if (c !== null) e[cellFlowKey(col)] = typeof c === "string" ? textFlow(c) : c;
  return mapOf(e);
}

/** The first `Y.Text` piece of a cell's flow. */
export function cellPiece(row: Y.Map<unknown>, col: string): Y.Text {
  const f = row.get(cellFlowKey(col));
  const p: unknown = f instanceof Y.Array ? f.get(0) : undefined;
  if (!(p instanceof Y.Text)) throw new Error(`cellPiece: no flow at ${col}`);
  return p;
}

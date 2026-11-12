import { BLOCK_TYPES } from "../block";
import { RESERVED_TYPES } from "../derive/records";
import type { Plan, Write } from "../plan";
import { type Scalar, isWriteScalar } from "../storage/scalar";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import { cellsRect } from "./table/cell-rect";
import { overCells } from "./table/over-cells";
import { mappedSelection, plan } from "./helpers/build-plan";
import { type Keys, diffKeys, keysOf } from "./helpers/paragraph-keys";
import { paragraphsBetween } from "./helpers/paragraphs-between";
import { idAfter, keysWrite, materialize } from "./helpers/writes";
import { caretAt } from "../position/model-position";
import type * as Y from "yjs";

/** Paragraph types a `p:type` write may not name (they read as "paragraph", R1). */
export const RESERVED_PARAGRAPH_TYPES: ReadonlySet<string> = RESERVED_TYPES;

/**
 * C16: write paragraph attrs on every paragraph of the selection (`type` → `p:type`;
 * null / undefined removes the key). A debris paragraph is materialized first (X2).
 */
export function setParagraphAttrs(ctx: CommandContext, attrs: Readonly<Record<string, Scalar | undefined>>): Plan | null {
  const keys: Record<string, Scalar | undefined> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "") throw new Error("model: paragraph attr with an empty key");
    if (v !== undefined && !isWriteScalar(v)) throw new Error(`model: paragraph attr ${k} must be null, a string, a finite number or a boolean`);
    if (k === "type" && v !== undefined && v !== null && (typeof v !== "string" || v === "" || RESERVED_PARAGRAPH_TYPES.has(v))) {
      throw new Error(`model: ${String(v)} is not a paragraph type`);
    }
    keys[`p:${k}`] = v === null || (k === "type" && v === BLOCK_TYPES.paragraph) ? undefined : v;
  }
  // A cell selection: every paragraph of every cell of its rectangle, virtual cells made real with the keys (GDocs / Word).
  const cells = cellsRect(ctx);
  if (cells !== null) {
    const fresh: Keys = {};
    for (const [k, v] of Object.entries(keys)) if (v !== undefined) fresh[k] = v;
    return Object.keys(keys).length === 0 ? null : overCells(ctx, cells, (c) => setParagraphAttrs(c, attrs), { para: fresh });
  }
  const r = rangeOf(ctx);
  if (r === null || Object.keys(keys).length === 0) return null;
  const writes: Write[] = [];
  let caretMap: Y.Map<unknown> | null = null;
  for (const L of paragraphsBetween(ctx.version, r.start.L.block.id, r.end.L.block.id)) {
    if (L.mark !== null) {
      const cur = keysOf(L);
      const target: Keys = { ...cur };
      for (const [k, v] of Object.entries(keys)) {
        if (v === undefined) delete target[k];
        else target[k] = v;
      }
      writes.push(...keysWrite(L.mark, diffKeys(cur, target)));
      continue;
    }
    const fresh: Keys = {};
    for (const [k, v] of Object.entries(keys)) if (v !== undefined) fresh[k] = v;
    if (Object.keys(fresh).length === 0) continue;
    const m = materialize(L, fresh);
    if (m === null) continue;
    writes.push(...m.writes);
    if (r.collapsed && L.block.id === r.start.L.block.id) caretMap = m.map;
  }
  if (writes.length === 0) return null;
  const base = ctx.version;
  const sel = ctx.selection;
  // A caret in a materialized paragraph stays in it (its storage point need not map there: a virtual end cell's is
  // the row's end mark, held by the item before it).
  const id = r.start.L.block.id;
  const offset = r.start.offset;
  return plan(base, writes, (after) => (caretMap === null ? mappedSelection(base, sel, after) : caretAt(idAfter(caretMap, id), offset)));
}

import { markerKey, markerRanges } from "../document/markers";
import type { InsertUnit, Plan, Write } from "../plan";
import { caretAt } from "../position/model-position";
import { pointAfter } from "../position/storage-points";
import { typeId } from "../storage/item-id";
import { newMarker } from "../storage/new-items";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import { mappedSelection, plan } from "./helpers/build-plan";
import { insertAt, materialize } from "./helpers/writes";

// ---------------------------------------------------------------------------
// Generic markers (D11; R12 pairs them)
// ---------------------------------------------------------------------------

/** Insert a marker pair `(ns, id)` around the selection (zero-width at a caret). A key already paired in the document is refused (throws). */
export function insertMarker(ctx: CommandContext, ns: string, id: string): Plan | null {
  if (ns === "" || id === "") throw new Error("model: a marker needs a namespace and an id");
  if (markerRanges(ctx.version).has(markerKey(ns, id))) throw new Error(`model: marker ${ns}/${id} already exists`);
  const r = rangeOf(ctx);
  if (r === null) return null;
  const start: InsertUnit = { embed: newMarker(ns, id, "start"), attrs: {} };
  const end: InsertUnit = { embed: newMarker(ns, id, "end"), attrs: {} };
  if (r.start.L.fs.synthetic) {
    // R17 (an empty holder): the markers go in with the paragraph's ¶ (X2).
    const m = materialize(r.start.L, {}, [start, end]);
    if (m === null) return null;
    return plan(ctx.version, m.writes, () => {
      const pid = typeId(m.map);
      return pid === null ? ctx.selection : caretAt(pid, 0);
    });
  }
  const a = pointAfter(r.start.L, r.start.offset);
  const b = pointAfter(r.end.L, r.end.offset);
  if (a === null || b === null) return null;
  const writes: Write[] = r.collapsed ? [insertAt(a, [start, end])] : [insertAt(a, [start]), insertAt(b, [end])];
  const base = ctx.version;
  const sel = ctx.selection;
  return plan(base, writes, (after) => mappedSelection(base, sel, after));
}

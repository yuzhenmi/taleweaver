import { markerKey, markerRanges } from "../document/markers";
import type { Plan, Write } from "../plan";
import { paragraphLayout } from "../position/paragraph-layout";
import { pointBefore } from "../position/storage-points";
import { ITEM_KINDS } from "../storage/keys";
import { kindOf } from "../storage/map-reads";
import type { CommandContext } from "./command-context";
import { mappedSelection, plan } from "./helpers/build-plan";
import { mapAtIndex } from "./helpers/map-at-index";

/** Remove the paired markers `(ns, id)`. */
export function removeMarker(ctx: CommandContext, ns: string, id: string): Plan | null {
  const range = markerRanges(ctx.version).get(markerKey(ns, id));
  if (range === undefined) return null;
  const writes: Write[] = [];
  for (const pt of [range.start, range.end]) {
    const L = paragraphLayout(ctx.version, pt.blockId);
    const p = L === null ? null : pointBefore(L, pt.offset);
    const m = p === null ? null : mapAtIndex(p.piece, p.index);
    if (p === null || m === null || kindOf(m) !== ITEM_KINDS.marker) return null;
    writes.push({ k: "delete", piece: p.piece, index: p.index, len: 1 });
  }
  const base = ctx.version;
  const sel = ctx.selection;
  return plan(base, writes, (after) => mappedSelection(base, sel, after));
}

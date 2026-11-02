import type { Document } from "../../document/types";
import { mapPosition } from "../../mapping/map-position";
import type { Plan, Write } from "../../plan";
import type { ModelPosition, ModelSelection } from "../../position/model-position";

/** Map the plan's selection into the version after it (deletes / ¶ inserts only — see `mapping/map-position.ts`). */
export function mappedSelection(base: Document, sel: ModelSelection, after: Document): ModelSelection {
  const m = (p: ModelPosition, assoc: -1 | 1): ModelPosition => mapPosition(base, after, p, assoc).position ?? p;
  return { anchor: m(sel.anchor, -1), focus: m(sel.focus, -1) };
}

export function plan(base: Document, writes: readonly Write[], selection: (after: Document) => ModelSelection): Plan {
  return { base, writes, selection };
}

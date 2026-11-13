import type { Document } from "../../document/types";
import { mapSelection } from "../../mapping/map-position";
import type { Plan, Write } from "../../plan";
import type { ModelSelection } from "../../position/model-position";

/** Map the plan's selection into the version after it (deletes / ¶ inserts only — see `mapping/map-position.ts`). */
export function mappedSelection(base: Document, sel: ModelSelection, after: Document): ModelSelection {
  return mapSelection(base, after, sel) ?? sel;
}

export function plan(base: Document, writes: readonly Write[], selection: (after: Document) => ModelSelection): Plan {
  return { base, writes, selection };
}

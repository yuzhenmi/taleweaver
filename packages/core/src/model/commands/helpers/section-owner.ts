import type * as Y from "yjs";
import type { Document } from "../../document/types";
import type { At } from "./at";

/** The `[S]` map (or DocMap) holding the props of the section that contains main-tree paragraph `at`. */
export function sectionOwner(d: Document, at: At): Y.Map<unknown> | null {
  const sectionId = at.L.block.parentId;
  return d.flows.get(d.rootId)?.sections.find((s) => s.id === sectionId)?.map ?? null;
}

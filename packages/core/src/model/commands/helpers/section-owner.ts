import type * as Y from "yjs";
import { type Block, BLOCK_TYPES } from "../../block";
import type { Document } from "../../document/types";
import type { At } from "./at";

/** The section record holding main-tree paragraph `at`, climbing through every enclosing table (O(depth)). */
export function sectionOf(d: Document, at: At): Block | null {
  let b: Block | undefined = at.L.block;
  while (b !== undefined && b.type !== BLOCK_TYPES.section) b = b.parentId === null ? undefined : d.trees.block.get(b.parentId);
  return b ?? null;
}

/** The `[S]` map (or DocMap) holding the props of the section that contains main-tree paragraph `at`. */
export function sectionOwner(d: Document, at: At): Y.Map<unknown> | null {
  const sectionId = sectionOf(d, at)?.id;
  return d.flows.get(d.rootId)?.sections.find((s) => s.id === sectionId)?.map ?? null;
}

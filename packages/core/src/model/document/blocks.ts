/**
 * Read API over a version (same names as the schema-3 document API).
 */
import { BLOCK_TYPES, type Block, type BlockId } from "../block";
import type { Document, TreeKind } from "./types";

export function getBlock(d: Document, id: BlockId): Block | null {
  return d.trees.block.get(id) ?? null;
}

export function getEmbedContent(d: Document, id: BlockId): Block | null {
  return d.trees.embedContent.get(id) ?? null;
}

export function getTemplateContent(d: Document, id: BlockId): Block | null {
  return d.trees.templateContent.get(id) ?? null;
}

export interface ResolvedBlock {
  readonly block: Block;
  readonly kind: TreeKind;
}

/** A block from any tree (precedence: main, embed contents, template contents). */
export function resolveBlock(d: Document, id: BlockId): ResolvedBlock | null {
  for (const kind of ["block", "embedContent", "templateContent"] satisfies TreeKind[]) {
    const block = d.trees[kind].get(id);
    if (block !== undefined) return { block, kind };
  }
  return null;
}

/** `resolveBlock(...)?.block`, `undefined` when absent (a version is complete: absent means absent). */
export function peekBlock(d: Document, id: BlockId): Block | undefined {
  return resolveBlock(d, id)?.block;
}

/** The root flows of `tree` (a table cell's flow has a parent: it is not a root). */
function flowIdsOf(d: Document, tree: TreeKind): BlockId[] {
  const out: BlockId[] = [];
  for (const [id, fs] of d.flows.entries()) if (fs.tree === tree && d.trees[tree].get(id)?.parentId === null) out.push(id);
  return out.sort();
}

/** Root ids of the footnote bodies (sorted: independent of map order). */
export function getEmbedContentIds(d: Document): BlockId[] {
  return flowIdsOf(d, "embedContent");
}

/** Root ids of the header / footer bodies (sorted). */
export function getTemplateContentIds(d: Document): BlockId[] {
  return flowIdsOf(d, "templateContent");
}

/** Block `id` is a container a select-all can hold: a flow's holder or a table cell. */
export const holdsAll = (d: Document, id: BlockId): boolean => d.flows.has(id) || peekBlock(d, id)?.type === BLOCK_TYPES.tableCell;

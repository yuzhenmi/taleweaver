/**
 * Placement: which container a position is in, and whether a kind may go there
 * (the kind table's `placement`, `scan/kinds.ts`). A command that would place a kind
 * outside its containers is a no-op, as today.
 */
import { BLOCK_TYPES } from "../../block";
import { type Container, type FlowKind, allowedIn } from "../../scan/kinds";
import type { Document } from "../../document/types";
import type { At } from "./at";

/** The container of position `a` of version `d` (a paragraph in a table cell is in the cell, whatever its flow). */
export function containerOf(d: Document, a: At): Container {
  if (a.L.tree === "embedContent") return "footnote";
  if (a.L.tree === "templateContent") return "headerFooter";
  const parent = a.L.block.parentId;
  return parent !== null && d.trees.block.get(parent)?.type === BLOCK_TYPES.tableCell ? "cell" : "body";
}

export const canPlace = (d: Document, k: FlowKind, a: At): boolean => allowedIn(k, containerOf(d, a));

/** The position is in the body, the only container with sections (header / footer links, R5). */
export const inSections = (d: Document, a: At): boolean => containerOf(d, a) === "body";

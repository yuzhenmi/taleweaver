/**
 * Placement: which container a position is in, and whether a kind may go there
 * (the kind table's `placement`, `scan/kinds.ts`). A command that would place a kind
 * outside its containers is a no-op, as today.
 */
import { type Container, type FlowKind, allowedIn } from "../../scan/kinds";
import type { At } from "./at";

export function containerOf(a: At): Container {
  if (a.L.tree === "embedContent") return "footnote";
  if (a.L.tree === "templateContent") return "headerFooter";
  return a.L.fs.isRoot ? "body" : "cell";
}

export const canPlace = (k: FlowKind, a: At): boolean => allowedIn(k, containerOf(a));

/** The position is in the main tree (body or a table cell), the only one with sections (header / footer links, R5). */
export const inSections = (a: At): boolean => a.L.tree === "block";

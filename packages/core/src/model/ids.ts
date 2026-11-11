/**
 * Derived block ids (X21: a block id is a Yjs item id, or derived from one).
 *
 * Collision-free by construction:
 *   - an item id is `${client}:${clock}`: digits, a colon, digits — no `/`, never
 *     starting with a letter;
 *   - every derived id is a BASE followed by a fixed `/suffix`: `/pre` (debris before
 *     a terminator), `/end` (debris / R17 at a flow end), `/fill<col>`, `/empty`, `/after` (the implicit
 *     paragraph after a block object no paragraph follows), `/section`, `/final`,
 *     `/body` (a footnote body). A base is an item id, a footnote body id
 *     `${anchor}/body` (for that body's `/end`), or a header / footer body id;
 *   - a header / footer body's id is `h/${escape(bodyId)}`, where the escape turns
 *     `%` into `%25` and `/` into `%2F`: it starts with a letter (never an item id) and
 *     its escaped part holds no `/`, so it never equals another id plus a suffix
 *     (`h/a` + `/end` ≠ `h/a%2Fend`). The escape is total (lone surrogates included);
 *   - a table, row and cell id is its mark's item id; a virtual end cell is
 *     `${mark}/fill<col>` (its row's next mark; col in decimal, unique per row) and an
 *     empty cell's paragraph is `${cell}/empty` (the cell real or virtual);
 * Distinct items give distinct bases and each base takes each suffix at most once
 * per role, so ids are unique across all trees and in the flows map.
 */
import type { BlockId } from "./block";

export const debrisBeforeId = (terminatorId: string): BlockId => `${terminatorId}/pre`;
export const afterObjectId = (objectId: string): BlockId => `${objectId}/after`;
export const flowEndId = (holderId: string): BlockId => `${holderId}/end`;
export const sectionIdOf = (breakId: string): BlockId => `${breakId}/section`;
export const finalSectionId = (rootId: string): BlockId => `${rootId}/final`;
export const footnoteBodyId = (anchorId: string): BlockId => `${anchorId}/body`;
export const virtualCellId = (nextMarkId: string, col: number): BlockId => `${nextMarkId}/fill${col}`;
export const emptyCellParagraphId = (cellId: string): BlockId => `${cellId}/empty`;
/** The next mark and column of a virtual end cell's paragraph id (`${M}/fill<col>/empty`); null for any other id. */
export function virtualCellParagraphOf(id: BlockId): { readonly mark: string; readonly col: number } | null {
  const m = /^(.*)\/fill(\d+)\/empty$/.exec(id);
  return m === null || m[1] === undefined || m[2] === undefined ? null : { mark: m[1], col: Number(m[2]) };
}
export const templateBodyId = (bodyId: string): BlockId => `h/${bodyId.replace(/%/g, "%25").replace(/\//g, "%2F")}`;

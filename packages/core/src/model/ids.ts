/**
 * Derived block ids (X21: a block id is a Yjs item id, or derived from one).
 *
 * Collision-free by construction:
 *   - an item id is `${client}:${clock}`: digits, a colon, digits — no `/`, never
 *     starting with a letter;
 *   - every derived id is a BASE followed by a fixed `/suffix`: `/pre` (debris before
 *     a terminator), `/end` (debris / R17 at a flow end), `/after` (the implicit
 *     paragraph after a block object no paragraph follows), `/section`, `/final`,
 *     `/body` (a footnote body). A base is an item id, a footnote body id
 *     `${anchor}/body` (for that body's `/end`), or a header / footer body id;
 *   - a header / footer body's id is `h/${escape(bodyId)}`, where the escape turns
 *     `%` into `%25` and `/` into `%2F`: it starts with a letter (never an item id) and
 *     its escaped part holds no `/`, so it never equals another id plus a suffix
 *     (`h/a` + `/end` ≠ `h/a%2Fend`). The escape is total (lone surrogates included);
 *   - a table cell's id is `${tableId}/${esc(rowKey)}|${esc(colKey)}`, the escape also
 *     turning `|` into `%7C`: it holds exactly one `|` and no `/` after its base, so it
 *     never equals a suffixed id (no suffix holds `|`), and a cell with no flow reads
 *     as `${cellId}/end`. Row / column keys are unique per table after R6.
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
const escCellKey = (k: string): string => k.replace(/%/g, "%25").replace(/\//g, "%2F").replace(/\|/g, "%7C");
export const cellId = (tableId: string, rowKey: string, colKey: string): BlockId => `${tableId}/${escCellKey(rowKey)}|${escCellKey(colKey)}`;
export const templateBodyId = (bodyId: string): BlockId => `h/${bodyId.replace(/%/g, "%25").replace(/\//g, "%2F")}`;

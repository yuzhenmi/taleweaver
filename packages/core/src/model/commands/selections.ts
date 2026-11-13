import { holdsAll } from "../document/blocks";
import type { BlockId } from "../block";
import type { Document } from "../document/types";
import { blockObjectAt } from "../position/block-object";
import type { AllSelection, ObjectSelection } from "../position/model-position";

/**
 * Select-all of a container (default the body): everything in it, leading block objects included. `id`: a flow's
 * holder, or a table cell (LibreOffice's first Ctrl+A in a cell; Word / GDocs select the body). Null for anything else.
 */
export function selectAll(d: Document, id: BlockId = d.rootId): AllSelection | null {
  return holdsAll(d, id) ? { kind: "all", container: id } : null;
}

/** A block object's object selection (Word / GDocs): exactly that object; null when `objectId` is no block object of `d`. */
export function objectSelection(d: Document, objectId: BlockId): ObjectSelection | null {
  return blockObjectAt(d, objectId) === null ? null : { kind: "object", object: objectId };
}

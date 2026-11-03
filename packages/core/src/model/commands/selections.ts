import type { BlockId } from "../block";
import type { Document } from "../document/types";
import { blockObjectAt } from "../position/block-object";
import type { AllSelection, ObjectSelection } from "../position/model-position";

/**
 * Select-all of a story (default the body): everything in its flow, leading block objects included; null when
 * `holderId` is no flow. A table cell's story is the body (Word / GDocs): for a caret in a cell, hosts pass the root.
 */
export function selectAll(d: Document, holderId: BlockId = d.rootId): AllSelection | null {
  return d.flows.has(holderId) ? { kind: "all", flow: holderId } : null;
}

/** A block object's object selection (Word / GDocs): exactly that object; null when `objectId` is no block object of `d`. */
export function objectSelection(d: Document, objectId: BlockId): ObjectSelection | null {
  return blockObjectAt(d, objectId) === null ? null : { kind: "object", object: objectId };
}

import type * as Y from "yjs";
import type { Block, BlockId } from "../block";
import type { Document, FlowState, ListDef, TableState, TreeKind } from "../document/types";
import type { ObjectKindRegistry } from "../object-kinds";
import { PMap } from "../pmap";
import { blockEqual } from "./block-equal";

// ---------------------------------------------------------------------------
// Working state: a mutable builder over the immutable maps
// ---------------------------------------------------------------------------

export class Working {
  trees: Record<TreeKind, PMap<Block>>;
  flows: PMap<FlowState>;
  tables: PMap<TableState>;
  listDefs: ReadonlyMap<string, ListDef>;
  readonly dirty = new Set<BlockId>();
  /** Flows derived from scratch during this derivation (their storage changes are already read). */
  readonly fresh = new Set<BlockId>();

  constructor(
    readonly rootId: BlockId,
    readonly docMap: Y.Map<unknown>,
    readonly registry: ObjectKindRegistry,
    base: Document | null,
  ) {
    this.trees = base === null ? { block: PMap.empty(), embedContent: PMap.empty(), templateContent: PMap.empty() } : { ...base.trees };
    this.flows = base === null ? PMap.empty() : base.flows;
    this.tables = base === null ? PMap.empty() : base.tables;
    this.listDefs = base === null ? new Map() : base.listDefs;
  }

  get(tree: TreeKind, id: BlockId): Block | undefined {
    return this.trees[tree].get(id);
  }

  /** Write a record; an equal record keeps the old one (same identity, not dirty). */
  put(tree: TreeKind, b: Block): void {
    const old = this.trees[tree].get(b.id);
    if (old !== undefined && blockEqual(old, b)) return;
    this.trees[tree] = this.trees[tree].set(b.id, b);
    this.dirty.add(b.id);
  }

  patch(tree: TreeKind, id: BlockId, fields: Partial<Pick<Block, "prevSiblingId" | "nextSiblingId" | "firstChildId" | "lastChildId" | "parentId">>): void {
    const b = this.get(tree, id);
    if (b === undefined) throw new Error(`model: patch of missing block ${id}`);
    const same =
      (fields.prevSiblingId === undefined || fields.prevSiblingId === b.prevSiblingId) &&
      (fields.nextSiblingId === undefined || fields.nextSiblingId === b.nextSiblingId) &&
      (fields.firstChildId === undefined || fields.firstChildId === b.firstChildId) &&
      (fields.lastChildId === undefined || fields.lastChildId === b.lastChildId) &&
      (fields.parentId === undefined || fields.parentId === b.parentId);
    if (!same) this.put(tree, Object.freeze({ ...b, ...fields }));
  }

  del(tree: TreeKind, id: BlockId): void {
    this.trees[tree] = this.trees[tree].delete(id);
    this.dirty.add(id);
  }

  finish(): Document {
    return Object.freeze({
      rootId: this.rootId,
      trees: Object.freeze({ ...this.trees }),
      flows: this.flows,
      tables: this.tables,
      listDefs: this.listDefs,
      docMap: this.docMap,
      registry: this.registry,
    });
  }
}

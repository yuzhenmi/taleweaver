import type { BlockKindResolver } from "./block-kinds";
import type { Block } from "./block";
import type { ReadonlyAttrs } from "./attrs";
import type { BlockId } from "./block-id";
import { createState, type Document } from "./state";
import { STATE_INTERNAL } from "./state-internal";
import { writeRoot, type TreeNode } from "./flow-ops";
import type { TreeKind } from "./registry";
import { writeListDefInTx, type ListDef } from "./list-defs";
import { writeCommentRecordInTx, type CommentRecord } from "./comments";
import { writeSuggestionRecordInTx, type SuggestionRecord } from "./suggestions";

export interface BuildStateFromBlocksArgs {
  readonly rootId: BlockId;
  readonly blocks: ReadonlyArray<Block>;
  readonly embedContents?: ReadonlyArray<Block>;
  readonly templateContents?: ReadonlyArray<Block>;
  /**
   * Per-list numbering configuration, keyed by list id. Written into the
   * top-level `listDefs` Y.Map via `writeListDefInTx`. Same shape
   * `buildStateWithListDefs` accepts (a plain `Record<listId, ListDef>`).
   */
  readonly listDefs?: Record<string, ListDef>;
  /** Comment thread records, written into the top-level `comments` Y.Map. */
  readonly comments?: ReadonlyArray<CommentRecord>;
  /** Suggestion records, written into the top-level `suggestions` Y.Map. */
  readonly suggestions?: ReadonlyArray<SuggestionRecord>;
  /** Storage-shape authority (the component registry), bound to the new doc. */
  readonly resolver: BlockKindResolver;
}

/**
 * Build a `Document` by writing whole-document fixtures directly into the
 * underlying `Y.Doc`, id-PRESERVING (every provided `block.id` /
 * list id / record id is written verbatim — nothing is minted). Writes all
 * three block trees (main `blocks`, `embedContents`, `templateContents`) plus
 * the side-tables (`listDefs`, `comments`, `suggestions`) inside ONE
 * transaction. Bypasses Layer 3 ops — for test-fixture construction, the
 * lossless document deserializer, and other state-module-internal use only.
 * External callers must use Layer 3 ops to mutate state.
 *
 * Lives inside `state/` so the Y.Doc-direct writes do not cross the
 * encapsulation boundary; external test fixtures call through
 * `test-utils/state-builders.buildState`, which delegates here.
 */
export function buildStateFromBlocks(args: BuildStateFromBlocksArgs): Document {
  const state = createState({ rootId: args.rootId, resolver: args.resolver });
  const doc = state[STATE_INTERNAL].doc;
  doc.transact(() => {
    const main = treesOf(args.blocks, args.rootId);
    for (const root of main) writeRoot(doc, root, "block");
    writeRoots(doc, args.embedContents, "embedContent");
    writeRoots(doc, args.templateContents, "templateContent");
    if (args.listDefs !== undefined) {
      for (const [listId, def] of Object.entries(args.listDefs)) {
        writeListDefInTx(doc, listId, def);
      }
    }
    if (args.comments !== undefined) {
      for (const record of args.comments) {
        writeCommentRecordInTx(doc, record);
      }
    }
    if (args.suggestions !== undefined) {
      for (const record of args.suggestions) {
        writeSuggestionRecordInTx(doc, record);
      }
    }
  });
  return state;
}

function writeRoots(doc: Parameters<typeof writeRoot>[0], blocks: ReadonlyArray<Block> | undefined, tree: TreeKind): void {
  if (blocks === undefined) return;
  for (const root of treesOf(blocks, null)) writeRoot(doc, root, tree);
}

/**
 * Pointer-described blocks → trees. Children follow the `firstChildId` →
 * `nextSiblingId` chain; a block naming a parent but missing from that chain is
 * appended after it (list order). Roots: `rootId`, or every block with
 * `parentId === null` when `rootId` is null.
 */
export function treesOf(
  blocks: ReadonlyArray<Block>,
  rootId: BlockId | null,
  markAttrsOf?: (b: Block) => ReadonlyAttrs | undefined,
): TreeNode[] {
  const byId = new Map<BlockId, Block>();
  for (const b of blocks) byId.set(b.id, b);
  const childrenOf = new Map<BlockId, Block[]>();
  for (const b of blocks) {
    if (b.parentId === null) continue;
    const list = childrenOf.get(b.parentId) ?? [];
    list.push(b);
    childrenOf.set(b.parentId, list);
  }
  const visited = new Set<BlockId>();
  const node = (b: Block): TreeNode => {
    visited.add(b.id);
    const kids: TreeNode[] = [];
    const seen = new Set<BlockId>();
    for (let c = b.firstChildId; c !== null && !seen.has(c); ) {
      seen.add(c);
      const cb = byId.get(c);
      if (cb === undefined) break;
      kids.push(node(cb));
      c = cb.nextSiblingId;
    }
    for (const cb of childrenOf.get(b.id) ?? []) {
      if (!seen.has(cb.id) && !visited.has(cb.id)) kids.push(node(cb));
    }
    return {
      id: b.id,
      type: b.type,
      attrs: b.attrs,
      inlineContent: b.inlineContent,
      children: kids,
      ...(b.breakSuggestion !== undefined ? { breakSuggestion: b.breakSuggestion } : {}),
      ...(markAttrsOf !== undefined ? { markAttrs: markAttrsOf(b) } : b.markAttrs !== undefined ? { markAttrs: b.markAttrs } : {}),
    };
  };
  if (rootId !== null) {
    const r = byId.get(rootId);
    return r === undefined ? [] : [node(r)];
  }
  return blocks.filter((b) => b.parentId === null).map(node);
}

export interface BuildStateWithListDefsArgs {
  readonly rootId: BlockId;
  readonly blocks: ReadonlyArray<Block>;
  readonly listDefs: Record<string, ListDef>;
  readonly resolver: BlockKindResolver;
}

/**
 * Like `buildStateFromBlocks`, but additionally seeds the `listDefs` Y.Map with
 * per-list numbering configuration. For test-fixture construction of numbered
 * lists where the render/numbering pass needs the list definitions to resolve a
 * marker. State-module-internal (writes the Y.Doc directly).
 *
 * A thin wrapper over the unified `buildStateFromBlocks`, which now accepts
 * `listDefs` directly and writes everything in one transaction.
 */
export function buildStateWithListDefs(
  args: BuildStateWithListDefsArgs,
): Document {
  return buildStateFromBlocks({
    rootId: args.rootId,
    blocks: args.blocks,
    listDefs: args.listDefs,
    resolver: args.resolver,
  });
}

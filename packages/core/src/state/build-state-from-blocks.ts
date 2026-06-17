import type { Block } from "./block";
import type { BlockId } from "./block-id";
import { createState, type State } from "./state";
import { STATE_INTERNAL } from "./state-internal";
import {
  runTransaction,
  getBlocksMap,
  getEmbedContentsMap,
  getTemplateContentsMap,
} from "./yjs-doc";
import { buildYBlock } from "./y-block";
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
}

/**
 * Build a `State` by writing whole-document fixtures directly into the
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
export function buildStateFromBlocks(args: BuildStateFromBlocksArgs): State {
  const state = createState({ rootId: args.rootId });
  const doc = state[STATE_INTERNAL].doc;
  runTransaction(doc, () => {
    const yBlocks = getBlocksMap(doc);
    for (const block of args.blocks) {
      yBlocks.set(
        block.id,
        buildYBlock({
          type: block.type,
          attrs: block.attrs,
          parentId: block.parentId,
          prevSiblingId: block.prevSiblingId,
          nextSiblingId: block.nextSiblingId,
          firstChildId: block.firstChildId,
          lastChildId: block.lastChildId,
          inlineContent: block.inlineContent,
        }),
      );
    }
    if (args.embedContents !== undefined) {
      const yEmbeds = getEmbedContentsMap(doc);
      for (const block of args.embedContents) {
        yEmbeds.set(
          block.id,
          buildYBlock({
            type: block.type,
            attrs: block.attrs,
            parentId: block.parentId,
            prevSiblingId: block.prevSiblingId,
            nextSiblingId: block.nextSiblingId,
            firstChildId: block.firstChildId,
            lastChildId: block.lastChildId,
            inlineContent: block.inlineContent,
          }),
        );
      }
    }
    if (args.templateContents !== undefined) {
      const yTemplates = getTemplateContentsMap(doc);
      for (const block of args.templateContents) {
        yTemplates.set(
          block.id,
          buildYBlock({
            type: block.type,
            attrs: block.attrs,
            parentId: block.parentId,
            prevSiblingId: block.prevSiblingId,
            nextSiblingId: block.nextSiblingId,
            firstChildId: block.firstChildId,
            lastChildId: block.lastChildId,
            inlineContent: block.inlineContent,
          }),
        );
      }
    }
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

export interface BuildStateWithListDefsArgs {
  readonly rootId: BlockId;
  readonly blocks: ReadonlyArray<Block>;
  readonly listDefs: Record<string, ListDef>;
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
): State {
  return buildStateFromBlocks({
    rootId: args.rootId,
    blocks: args.blocks,
    listDefs: args.listDefs,
  });
}

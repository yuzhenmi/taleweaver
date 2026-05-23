import type { Block } from "./block";
import type { BlockId } from "./block-id";
import { createState, type State } from "./state";
import { STATE_INTERNAL } from "./state-internal";
import { runTransaction, getBlocksMap, getEmbedContentsMap } from "./yjs-doc";
import { buildYBlock } from "./y-block";

export interface BuildStateFromBlocksArgs {
  readonly rootId: BlockId;
  readonly blocks: ReadonlyArray<Block>;
  readonly embedContents?: ReadonlyArray<Block>;
}

/**
 * Build a `State` by writing block fixtures directly into the underlying
 * `Y.Doc`. Bypasses Layer 3 ops — for test-fixture construction and
 * other state-module-internal use only. External callers must use
 * Layer 3 ops to mutate state.
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
  });
  return state;
}

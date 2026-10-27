/**
 * Builders that materialize Block / InlineContent JS shapes into detached
 * Y.Map / Y.Text trees.
 *
 * The returned Y types are NOT attached to a Y.Doc — the caller must
 * integrate the result (e.g. `getBlocksMap(doc).set(id, yBlock)` inside
 * `runTransaction`) before any read. Yjs ^13.6 rejects reads from
 * detached shared types: `Y.Map.get` returns `undefined`, `Y.Text.toString`
 * returns `""`, and a warning is logged. Tests that read the builder
 * output before attaching must wrap via a throwaway Y.Doc.
 *
 * Intended callers: `new-initial-state.ts` and Layer 3 ops.
 */
import * as Y from "yjs";
import type { BlockId } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import type { InlineContent } from "./inline-content";
import { buildYInlineText } from "./y-inline";
import { BLOCK_FIELDS } from "./block-schema";

export interface YBlockInit {
  type: string;
  attrs: ReadonlyAttrs;
  parentId: BlockId | null;
  prevSiblingId: BlockId | null;
  nextSiblingId: BlockId | null;
  firstChildId: BlockId | null;
  lastChildId: BlockId | null;
  inlineContent: InlineContent | null;
}

/**
 * Materialize a Block-shaped JS init into a detached Y.Map. Iterates the
 * shared BLOCK_FIELDS catalog and dispatches on each field's `kind`, so
 * the write path cannot drift from the read path's field list (the
 * catalog is the single source of truth, with a compile-time coverage
 * check in block-schema.ts).
 */
export function buildYBlock(init: YBlockInit): Y.Map<unknown> {
  const yBlock = new Y.Map<unknown>();
  for (const spec of BLOCK_FIELDS) {
    const value = init[spec.key];
    switch (spec.kind) {
      case "string":
        yBlock.set(spec.key, value as string);
        break;
      case "id-nullable":
        yBlock.set(spec.key, value as BlockId | null);
        break;
      case "attrs-map":
        yBlock.set(spec.key, buildYAttrs(value as ReadonlyAttrs));
        break;
      case "inline-text-nullable":
        yBlock.set(
          spec.key,
          value === null ? null : buildYInlineText(value as InlineContent),
        );
        break;
    }
  }
  return yBlock;
}

export function buildYAttrs(attrs: ReadonlyAttrs): Y.Map<unknown> {
  const yAttrs = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(attrs)) {
    yAttrs.set(key, value);
  }
  return yAttrs;
}

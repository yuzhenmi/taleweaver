import * as Y from "yjs";
import type { Block } from "./block";
import type { BlockId } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import type {
  InlineContent,
  InlineItem,
  TextItem,
  EmbedItem,
} from "./inline-content";
import { getBlocksMap, getEmbedContentsMap } from "./yjs-doc";
import { assertNoNestedYTypes } from "./y-utils";
import { BLOCK_FIELDS } from "./block-schema";

export interface SnapshotCache {
  readonly blocks: Map<BlockId, Block>;
  readonly embedContents: Map<BlockId, Block>;
}

export function createSnapshotCache(): SnapshotCache {
  return { blocks: new Map(), embedContents: new Map() };
}

/**
 * Evict the snapshot for `id` from both the blocks and embedContents
 * sub-caches. BlockIds are globally unique across the two trees, so the
 * id can live in at most one map; deleting from both is cheap (O(1)
 * miss) and avoids requiring callers to know which tree owns the id.
 */
export function invalidateSnapshot(cache: SnapshotCache, id: BlockId): void {
  cache.blocks.delete(id);
  cache.embedContents.delete(id);
}

export function invalidateAll(cache: SnapshotCache): void {
  cache.blocks.clear();
  cache.embedContents.clear();
}

export function getBlockSnapshot(
  doc: Y.Doc,
  id: BlockId,
  cache: SnapshotCache,
): Block | null {
  const cached = cache.blocks.get(id);
  if (cached !== undefined) return cached;

  const yBlock = getBlocksMap(doc).get(id);
  if (yBlock === undefined) return null;

  const snap = buildBlockSnapshot(id, yBlock);
  cache.blocks.set(id, snap);
  return snap;
}

export function getEmbedContentSnapshot(
  doc: Y.Doc,
  id: BlockId,
  cache: SnapshotCache,
): Block | null {
  const cached = cache.embedContents.get(id);
  if (cached !== undefined) return cached;

  const yBlock = getEmbedContentsMap(doc).get(id);
  if (yBlock === undefined) return null;

  const snap = buildBlockSnapshot(id, yBlock);
  cache.embedContents.set(id, snap);
  return snap;
}

/**
 * Read a required field from a block's Y.Map. Yjs `Y.Map.get` returns
 * `undefined` for absent keys, distinct from a value that was
 * deliberately set to `null`. Casting the result silently widens
 * `undefined` to the expected type and crashes opaquely downstream;
 * this helper turns "missing key" into a clear error naming the field.
 */
function requireField<T>(yBlock: Y.Map<unknown>, id: BlockId, key: string): T {
  const raw = yBlock.get(key);
  if (raw === undefined) {
    throw new Error(
      `buildBlockSnapshot: block "${id}" missing required "${key}" field`,
    );
  }
  return raw as T;
}

/**
 * Like requireField, but for fields whose legal value-set includes
 * `null` (e.g. `parentId`, `inlineContent`). `null` is a valid value
 * meaning "no parent" / "container without inline content"; `undefined`
 * (the key wasn't set) is still an error.
 */
function requireNullableField<T>(
  yBlock: Y.Map<unknown>,
  id: BlockId,
  key: string,
): T | null {
  const raw = yBlock.get(key);
  if (raw === undefined) {
    throw new Error(
      `buildBlockSnapshot: block "${id}" missing required "${key}" field (use null for absence)`,
    );
  }
  return raw as T | null;
}

/**
 * Build a frozen Block snapshot from a block's inner Y.Map. Iterates the
 * shared BLOCK_FIELDS catalog and dispatches on each field's `kind`, so
 * the read path cannot drift from the write path's field list (see
 * block-schema.ts for the compile-time coverage check).
 */
function buildBlockSnapshot(id: BlockId, yBlock: Y.Map<unknown>): Block {
  // We accumulate into a record then cast to Block at the end. The cast is
  // safe because (a) BLOCK_FIELDS' compile-time coverage check guarantees
  // every Block field except `id` is iterated, (b) `id` is assigned
  // separately below, and (c) each kind's branch assigns a value of the
  // correct shape for its key.
  const result: Record<string, unknown> = { id };
  for (const spec of BLOCK_FIELDS) {
    switch (spec.kind) {
      case "string": {
        result[spec.key] = requireField<string>(yBlock, id, spec.key);
        break;
      }
      case "id-nullable": {
        result[spec.key] = requireNullableField<BlockId>(yBlock, id, spec.key);
        break;
      }
      case "attrs-map": {
        const yAttrs = requireField<Y.Map<unknown>>(yBlock, id, spec.key);
        result[spec.key] = freezeAttrs(yMapToObject(yAttrs));
        break;
      }
      case "inline-content-array-nullable": {
        const yInline = requireNullableField<Y.Array<Y.Map<unknown>>>(
          yBlock,
          id,
          spec.key,
        );
        result[spec.key] =
          yInline === null ? null : buildInlineContentSnapshot(yInline);
        break;
      }
    }
  }
  return Object.freeze(result) as unknown as Block;
}

function buildInlineContentSnapshot(yItems: Y.Array<Y.Map<unknown>>): InlineContent {
  const items: InlineItem[] = [];
  for (let i = 0; i < yItems.length; i++) {
    const yItem = yItems.get(i);
    const kind = yItem.get("kind") as "text" | "embed";
    if (kind === "text") {
      const yText = yItem.get("text") as Y.Text;
      const yAttrs = yItem.get("attrs") as Y.Map<unknown>;
      const item: TextItem = Object.freeze({
        kind: "text",
        text: yText.toString(),
        attrs: freezeAttrs(yMapToObject(yAttrs)),
      });
      items.push(item);
    } else {
      const embedType = yItem.get("embedType") as string;
      const yAttrs = yItem.get("attrs") as Y.Map<unknown>;
      const yProps = yItem.get("properties") as Y.Map<unknown>;
      const item: EmbedItem = Object.freeze({
        kind: "embed",
        embedType,
        attrs: freezeAttrs(yMapToObject(yAttrs)),
        properties: Object.freeze(yMapToObject(yProps)),
      });
      items.push(item);
    }
  }
  return Object.freeze({ items: Object.freeze(items) });
}

/**
 * Read a Y.Map of attrs/properties into a plain object. Asserts that no
 * value (or nested array/object value) is a live Yjs shared type — see
 * `assertNoNestedYTypes` in y-utils.ts. Without this guard a snapshot
 * could embed a live Y.Map/Y.Text reference, defeating the "frozen
 * value snapshot" contract and propagating cross-doc on paste.
 */
function yMapToObject(yMap: Y.Map<unknown>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of yMap.entries()) {
    assertNoNestedYTypes(value, key);
    obj[key] = value;
  }
  return obj;
}

function freezeAttrs(obj: Record<string, unknown>): ReadonlyAttrs {
  return Object.freeze(obj) as ReadonlyAttrs;
}

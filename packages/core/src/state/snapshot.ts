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

export interface SnapshotCache {
  readonly blocks: Map<BlockId, Block>;
  readonly embedContents: Map<BlockId, Block>;
}

export function createSnapshotCache(): SnapshotCache {
  return { blocks: new Map(), embedContents: new Map() };
}

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

function buildBlockSnapshot(id: BlockId, yBlock: Y.Map<unknown>): Block {
  const type = yBlock.get("type") as string;
  const yAttrs = yBlock.get("attrs") as Y.Map<unknown>;
  const attrs = freezeAttrs(yMapToObject(yAttrs));
  const parentId = (yBlock.get("parentId") as BlockId | null) ?? null;
  const prevSiblingId = (yBlock.get("prevSiblingId") as BlockId | null) ?? null;
  const nextSiblingId = (yBlock.get("nextSiblingId") as BlockId | null) ?? null;
  const firstChildId = (yBlock.get("firstChildId") as BlockId | null) ?? null;
  const lastChildId = (yBlock.get("lastChildId") as BlockId | null) ?? null;

  const yInline = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>> | null;
  const inlineContent = yInline === null ? null : buildInlineContentSnapshot(yInline);

  return Object.freeze({
    id,
    type,
    attrs,
    parentId,
    prevSiblingId,
    nextSiblingId,
    firstChildId,
    lastChildId,
    inlineContent,
  });
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

function yMapToObject(yMap: Y.Map<unknown>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of yMap.entries()) {
    obj[key] = value;
  }
  return obj;
}

function freezeAttrs(obj: Record<string, unknown>): ReadonlyAttrs {
  return Object.freeze(obj) as ReadonlyAttrs;
}

/**
 * Builders that materialize Block / InlineContent / InlineItem JS shapes
 * into detached Y.Map / Y.Array / Y.Text trees.
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
import type { InlineContent, InlineItem } from "./inline-content";
import { assertNoNestedYTypes } from "./y-utils";

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

export function buildYBlock(init: YBlockInit): Y.Map<unknown> {
  const yBlock = new Y.Map<unknown>();
  yBlock.set("type", init.type);
  yBlock.set("attrs", buildYAttrs(init.attrs));
  yBlock.set("parentId", init.parentId);
  yBlock.set("prevSiblingId", init.prevSiblingId);
  yBlock.set("nextSiblingId", init.nextSiblingId);
  yBlock.set("firstChildId", init.firstChildId);
  yBlock.set("lastChildId", init.lastChildId);
  yBlock.set(
    "inlineContent",
    init.inlineContent === null ? null : buildYInlineContent(init.inlineContent),
  );
  return yBlock;
}

export function buildYAttrs(attrs: ReadonlyAttrs): Y.Map<unknown> {
  const yAttrs = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(attrs)) {
    yAttrs.set(key, value);
  }
  return yAttrs;
}

export function buildYInlineContent(content: InlineContent): Y.Array<Y.Map<unknown>> {
  const yItems = new Y.Array<Y.Map<unknown>>();
  for (const item of content.items) {
    yItems.push([buildYInlineItem(item)]);
  }
  return yItems;
}

export function buildYInlineItem(item: InlineItem): Y.Map<unknown> {
  // T39: assert before any Y type is constructed, so a bad value never
  // enters the Y.Doc (and a partially-built item is not left dangling).
  for (const [key, value] of Object.entries(item.attrs)) {
    assertNoNestedYTypes(value, `attrs.${key}`);
  }
  if (item.kind === "embed") {
    for (const [key, value] of Object.entries(item.properties)) {
      assertNoNestedYTypes(value, `properties.${key}`);
    }
  }
  const yItem = new Y.Map<unknown>();
  if (item.kind === "text") {
    yItem.set("kind", "text");
    const yText = new Y.Text();
    // Skip the no-op insert for empty text: equivalent result, avoids
    // emitting a zero-length CRDT op that would sync to peers as noise.
    if (item.text.length > 0) yText.insert(0, item.text);
    yItem.set("text", yText);
    yItem.set("attrs", buildYAttrs(item.attrs));
  } else {
    yItem.set("kind", "embed");
    yItem.set("embedType", item.embedType);
    yItem.set("attrs", buildYAttrs(item.attrs));
    const yProps = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(item.properties)) {
      yProps.set(key, value);
    }
    yItem.set("properties", yProps);
  }
  return yItem;
}

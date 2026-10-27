/**
 * Test-only builder of a LEGACY (schema 1) document: each leaf block's
 * `inlineContent` is a `Y.Array` of per-run `Y.Map { kind, text: Y.Text, attrs }` /
 * `{ kind: "embed", embedType, attrs, properties }` — the storage an older engine
 * wrote. No `schemaVersion` marker (old engines never wrote one).
 */
import * as Y from "yjs";
import type { BlockId } from "../state/block-id";
import type { InlineItem } from "../state/inline-content";

function legacyRun(item: InlineItem): Y.Map<unknown> {
  const yItem = new Y.Map<unknown>();
  const yAttrs = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(item.attrs)) yAttrs.set(k, v);
  if (item.kind === "text") {
    yItem.set("kind", "text");
    const yText = new Y.Text();
    yText.insert(0, item.text);
    yItem.set("text", yText);
    yItem.set("attrs", yAttrs);
  } else {
    yItem.set("kind", "embed");
    yItem.set("embedType", item.embedType);
    yItem.set("attrs", yAttrs);
    const yProps = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(item.properties)) yProps.set(k, v);
    yItem.set("properties", yProps);
  }
  return yItem;
}

/** The legacy run-array value for `items` (to write under a block's `inlineContent`). */
export function legacyInline(items: readonly InlineItem[]): Y.Array<Y.Map<unknown>> {
  const yItems = new Y.Array<Y.Map<unknown>>();
  yItems.push(items.map(legacyRun));
  return yItems;
}

function yBlock(fields: {
  type: string;
  parentId: string | null;
  prev?: string;
  next?: string;
  first?: string;
  last?: string;
  inline: Y.Array<Y.Map<unknown>> | null;
}): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set("type", fields.type);
  m.set("attrs", new Y.Map<unknown>());
  m.set("parentId", fields.parentId);
  m.set("prevSiblingId", fields.prev ?? null);
  m.set("nextSiblingId", fields.next ?? null);
  m.set("firstChildId", fields.first ?? null);
  m.set("lastChildId", fields.last ?? null);
  m.set("inlineContent", fields.inline);
  return m;
}

/** doc > [ p1(items1), p2(items2) ] in the legacy storage, rootId "doc". */
export function legacyDoc(items1: readonly InlineItem[], items2: readonly InlineItem[] = []): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const key of ["embedContents", "templateContents", "listDefs", "comments", "suggestions"]) doc.getMap(key);
    doc.getMap("meta").set("rootId", "doc");
    const blocks = doc.getMap<Y.Map<unknown>>("blocks");
    blocks.set("doc", yBlock({ type: "document", parentId: null, first: "p1", last: "p2", inline: null }));
    blocks.set("p1", yBlock({ type: "paragraph", parentId: "doc", next: "p2", inline: legacyInline(items1) }));
    blocks.set("p2", yBlock({ type: "paragraph", parentId: "doc", prev: "p1", inline: legacyInline(items2) }));
  });
  return doc;
}

export const LEGACY_ROOT = "doc" as BlockId;

import * as Y from "yjs";
import type { BlockId } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import type { InlineContent, InlineItem } from "./inline-content";

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
  const yItem = new Y.Map<unknown>();
  if (item.kind === "text") {
    yItem.set("kind", "text");
    const yText = new Y.Text();
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

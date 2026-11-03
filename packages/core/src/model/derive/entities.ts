import type * as Y from "yjs";
import { attrsEqual } from "../equality";
import type { BlockId, InlineItem } from "../block";
import { afterObjectId, debrisBeforeId, flowEndId } from "../ids";
import { isBlockObject, isParagraphBreak, isSectionBreak, isText } from "../scan/kinds";
import type { FootnoteRef, Segment, Token } from "../scan/tokens";

// ---------------------------------------------------------------------------
// Entities (grouping tokens by the read rules)
// ---------------------------------------------------------------------------

export interface ParaEntity {
  readonly k: "para";
  readonly id: BlockId;
  /** The ¶, or null for debris / a synthetic paragraph. */
  readonly map: Y.Map<unknown> | null;
  readonly items: readonly InlineItem[];
  readonly footnotes: readonly FootnoteRef[];
}
export interface TocEntity {
  readonly k: "toc";
  readonly id: BlockId;
  readonly map: Y.Map<unknown>;
}
/** A table block object; its rows / cells come from its storage (`derive/table/`). */
export interface TableEntity {
  readonly k: "table";
  readonly id: BlockId;
  readonly map: Y.Map<unknown>;
}
export interface SectionBreakEntity {
  readonly k: "S";
  readonly id: BlockId;
  readonly map: Y.Map<unknown>;
}
export type Entity = ParaEntity | TocEntity | TableEntity | SectionBreakEntity;
export type BlockEntity = ParaEntity | TocEntity | TableEntity;

export const isParaEntity = (e: Entity): e is ParaEntity => isParagraphBreak(e.k);
export const isSectionBreakEntity = (e: Entity): e is SectionBreakEntity => isSectionBreak(e.k);
/** Every entity but `[S]` is a block record (an `[S]` is its section's end, R4). */
export const isBlockEntity = (e: Entity): e is BlockEntity => !isSectionBreak(e.k);

function appendItems(dst: InlineItem[], src: readonly InlineItem[]): void {
  for (const item of src) {
    const last = dst[dst.length - 1];
    if (isText(item) && isText(last) && attrsEqual(last.attrs, item.attrs)) {
      dst[dst.length - 1] = { kind: "text", text: last.text + item.text, attrs: last.attrs };
    } else {
      dst.push(item);
    }
  }
}

/**
 * R1 / R2: group a token sequence into entities. `atEnd`: the sequence ends at
 * `<end>`. `withItems` false: the entities' kinds, ids and footnotes only (their
 * `items` stay empty) — what an incremental update needs of the OLD region.
 * `objectBefore`: the block object just before the sequence, if any.
 *
 * A block object no paragraph follows (another block object, an `[S]` or `<end>`
 * next, nothing read between: a concurrent W2 break) reads an implicit empty
 * paragraph `${object}/after` right after it; the first write there creates its ¶.
 */
export function group(tokens: Iterable<Token>, atEnd: boolean, holderId: BlockId, { withItems = true, objectBefore = null }: { withItems?: boolean; objectBefore?: BlockId | null } = {}): Entity[] {
  const out: Entity[] = [];
  let object = objectBefore;
  let items: InlineItem[] = [];
  let footnotes: FootnoteRef[] = [];
  let content = false;
  for (const t of tokens) {
    if (t.k === "run") {
      if (t.items.length > 0) content = true;
      if (withItems) appendItems(items, t.items);
      if (t.footnotes.length > 0) footnotes = footnotes.concat(t.footnotes);
      continue;
    }
    const k = t.k;
    if (isParagraphBreak(k)) {
      out.push({ k, id: t.id, map: t.map, items, footnotes });
    } else {
      if (content) out.push({ k: "para", id: debrisBeforeId(t.id), map: null, items, footnotes });
      else if (object !== null) out.push(implicitAfter(object));
      out.push({ k, id: t.id, map: t.map });
    }
    object = isBlockObject(k) ? t.id : null;
    items = [];
    footnotes = [];
    content = false;
  }
  if (atEnd && content) out.push({ k: "para", id: flowEndId(holderId), map: null, items, footnotes });
  else if (atEnd && object !== null) out.push(implicitAfter(object));
  return out;
}

const implicitAfter = (object: BlockId): ParaEntity => ({ k: "para", id: afterObjectId(object), map: null, items: [], footnotes: [] });

export function indexSegments(segments: readonly Segment[]): ReadonlyMap<Y.Text, readonly number[]> {
  const m = new Map<Y.Text, number[]>();
  segments.forEach((s, i) => {
    const xs = m.get(s.piece);
    if (xs === undefined) m.set(s.piece, [i]);
    else xs.push(i);
  });
  return m;
}

export function* flatten(segments: readonly Segment[]): Generator<Token> {
  for (const s of segments) yield* s.tokens;
}

import type * as Y from "yjs";
import { attrsEqual } from "../equality";
import type { BlockId, InlineItem } from "../block";
import { afterObjectId, debrisBeforeId, flowEndId } from "../ids";
import { isBlockObject, isParagraphBreak, isSectionBreak, isText } from "../scan/kinds";
import type { FootnoteRef, Segment, Token } from "../scan/tokens";
import type { FormedTable } from "./table/form-table";

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
/** A table block object: its `⟦` (id, map) and its formed rows / cells (`derive/table/`). */
export interface TableEntity {
  readonly k: "table";
  readonly id: BlockId;
  readonly map: Y.Map<unknown>;
  /** The base of its implicit paragraph `${after}/after`: its `⟧`, or its `⟦` when unclosed. */
  readonly after: BlockId;
  /** Null for a bare mark token grouped on its own (an incremental region only asks its kind). */
  readonly formed: FormedTable | null;
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
 * R1 / R2, incrementally: tokens are pushed in reading order and grouped into the
 * entities of ONE container, appended to `out`. `withItems` false: the entities' kinds,
 * ids and footnotes only (their `items` stay empty) — what an incremental update needs
 * of the OLD region. `objectBefore`: the block object just before the sequence, if any.
 *
 * A block object no paragraph follows (another block object, an `[S]`, the container's
 * end or `<end>` next, nothing read between: a concurrent W2 break) reads an implicit
 * empty paragraph `${object}/after` right after it; the first write there creates its ¶.
 */
export class Grouper {
  private object: BlockId | null;
  private items: InlineItem[] = [];
  private footnotes: FootnoteRef[] = [];
  private content = false;

  constructor(
    private readonly holderId: BlockId,
    readonly out: Entity[] = [],
    private readonly withItems = true,
    objectBefore: BlockId | null = null,
  ) {
    this.object = objectBefore;
  }

  push(t: Token): void {
    if (t.k === "run") {
      if (t.items.length > 0) this.content = true;
      if (this.withItems) appendItems(this.items, t.items);
      if (t.footnotes.length > 0) this.footnotes = this.footnotes.concat(t.footnotes);
      return;
    }
    if (isParagraphBreak(t.k)) {
      this.out.push({ k: t.k, id: t.id, map: t.map, items: this.items, footnotes: this.footnotes });
      this.reset(null);
      return;
    }
    const e: Entity = t.k === "table" ? { k: t.k, id: t.id, map: t.map, after: t.id, formed: null } : { k: t.k, id: t.id, map: t.map };
    this.pushObject(e, t.id, isBlockObject(t.k));
  }

  /**
   * A terminator entity other than a ¶: a block object (`object`; `afterId` is the base of
   * its implicit paragraph, a table's `⟧`) or an `[S]`.
   */
  pushObject(e: Entity, afterId: BlockId, object: boolean): void {
    this.close(debrisBeforeId(e.id));
    this.out.push(e);
    this.reset(object ? afterId : null);
  }

  /** Entities that follow a block object in place (a childless table's leads): a paragraph now follows it. */
  pushEntities(es: readonly Entity[]): void {
    const last = es[es.length - 1];
    if (last === undefined) return;
    this.out.push(...es);
    this.object = last.k === "table" ? last.after : null;
  }

  /** The container ends at the mark / `[S]` `closer` (its debris is `${closer}/pre`), or at `<end>` (null). */
  finish(closer: BlockId | null): void {
    this.close(closer === null ? flowEndId(this.holderId) : debrisBeforeId(closer));
    this.reset(null);
  }

  /** Debris before the next terminator (id `debrisId`), else the implicit paragraph after a block object. */
  private close(debrisId: BlockId): void {
    if (this.content) this.out.push({ k: "para", id: debrisId, map: null, items: this.items, footnotes: this.footnotes });
    else if (this.object !== null) this.out.push(implicitAfter(this.object));
  }

  private reset(object: BlockId | null): void {
    this.object = object;
    this.items = [];
    this.footnotes = [];
    this.content = false;
  }
}

/** R1 / R2 over a whole token sequence (see {@link Grouper}). `atEnd`: the sequence ends at `<end>`. */
export function group(tokens: Iterable<Token>, atEnd: boolean, holderId: BlockId, { withItems = true, objectBefore = null }: { withItems?: boolean; objectBefore?: BlockId | null } = {}): Entity[] {
  const g = new Grouper(holderId, [], withItems, objectBefore);
  for (const t of tokens) g.push(t);
  if (atEnd) g.finish(null);
  return g.out;
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

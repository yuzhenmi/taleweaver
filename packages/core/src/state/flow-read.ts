/**
 * The derived read model over flows + registry (schema 3, END marks).
 *
 * Every `Block` (pointers included) is DERIVED. A flow is a sequence of content units
 * and BOUNDARY items: ¶s (`{ end: P }`, a section-end `{ end: P, section: S }`) and
 * self-delimiting objects (`{ end: O }`). A paragraph is the content after the previous
 * boundary up to and including its own ¶ (a CHAIN of consecutive joining ¶s reads as
 * one); an object is its item. Implicit entities stand in where storage breaks
 * invariant I (concurrency only): content — or nothing — with no ¶ before the next
 * object / the flow end reads as `${anchor}#i` (anchor = the entity ending at the
 * previous boundary, or the holder); empty grid slots read as `${row}|${col}`.
 *
 * Sections: the root flow's section-end items partition it; the final section (the
 * root entry's `finalSection`) holds everything after the last one, so the root's
 * children are always sections (≥ 1). A section always holds the paragraph its item
 * ends — empty sections cannot exist.
 *
 * Duplicate items of one id (concurrent undos, move × move) resolve deterministically:
 * consecutive ones join; otherwise the canonical (smallest Item id) keeps the id and the
 * others read as `${id}@${client}:${clock}`. An item whose registry entry is missing is
 * HIDDEN (structurally inert). The tree cannot cycle.
 *
 * Every derivation is a LOCAL walk from an item (O(neighbouring paragraph + crossed
 * tombstones)); the parent section is the first section-end after an entity (memoized
 * per item); nothing here scans the document per keystroke.
 */
import * as Y from "yjs";
import type { Block } from "./block";
import type { BlockId } from "./block-id";
import { asBlockId } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import type { InlineContent, InlineItem, TextItem, EmbedItem } from "./inline-content";
import { isStructuralMarkerEmbedType } from "./embed-markers";
import { breakSuggestionOfEntries } from "./break-tags";
import { attrsEqual } from "./attrs";
import { assertNoNestedYTypes } from "./y-utils";
import {
  getRegistry,
  entryShape,
  entryType,
  entryAttrsMap,
  entryMarkAttrsMap,
  entryFlow,
  entryTree,
  entryString,
  entryIdArray,
  isFlowResident,
  finalSectionOf,
  type BlockShape,
  type TreeKind,
  type MapGet,
} from "./registry";
import { getMarkIndex, canonicalMark, liveMarks, newSectionMemo, type MarkIndex, type SectionMemo } from "./mark-index";
import { Locator, getLocator, cachedLocator, adoptLocator, forEachUnit } from "./locator";
import {
  markOf,
  isSubflowItem,
  subflowPieces,
  contentLength,
  nextUnit,
  prevUnit,
  firstUnitOfFlow,
  lastUnitOfFlow,
  pieceOf,
  topFlowOfPiece,
  entryOfFlow,
  type MarkContent,
} from "./y-flow";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ReadCtx {
  readonly doc: Y.Doc;
  readonly reg: Y.Map<Y.Map<unknown>>;
  readonly idx: MarkIndex;
  readonly rootId: string;
  /** A past version to read (default: the current one). */
  readonly view?: View;
  /** The grid memo of a view context (the current version memoizes in the MarkIndex). */
  readonly gridCache?: Map<string, unknown>;
  /**
   * The section memos of a view context (default: the current version's in the MarkIndex).
   * A view shares the current version's only while no section-end differs between them.
   */
  readonly sections?: SectionMemo;
}

export function readCtx(doc: Y.Doc): ReadCtx {
  const r = doc.getMap("meta").get("rootId");
  return { doc, reg: getRegistry(doc), idx: getMarkIndex(doc), rootId: typeof r === "string" ? r : "" };
}

/**
 * A past version of the document read off the current Yjs structure (tombstones
 * still hold it): the version right before one transaction, whose inserted structs
 * are not live and whose deleted structs are (see `tx-mapping.ts`). Only the
 * identity derivations (items → entity ids, regions, holders, grids) read through it.
 */
export interface View {
  live(item: Y.Item): boolean;
  /** Registry entry `id` in this version. */
  entry(id: string): Y.Map<unknown> | undefined;
  /** Value of `key` in a registry map in this version. */
  get: MapGet;
  /** Element ids of a registry id-array in this version. */
  ids(arr: Y.Array<string>): string[];
  /** The canonical (smallest Item id) item of `id` (an `end` or a `section` id) in this version. */
  canonical(id: string): Y.Item | null;
  /** Pieces never skipped as dead (they hold content this version still has). */
  keep(piece: Y.Text): boolean;
  /** The live section-end items of this version. */
  readonly sectionMarks: Iterable<Y.Item>;
}

/** `ctx` reading version `view` (no derived caches are shared with it). */
export function viewCtx(doc: Y.Doc, view: View): ReadCtx {
  return { ...readCtx(doc), view, gridCache: new Map(), sections: newSectionMemo() };
}

/** View context `view` reading through the current version's section memos (no section-end differs). */
export function sharingSectionMemos(view: ReadCtx): ReadCtx {
  return { ...view, sections: view.idx.sections };
}

const plainGet: MapGet = (map, key) => map.get(key);
const getOf = (ctx: ReadCtx): MapGet => ctx.view?.get ?? plainGet;
const isLive = (ctx: ReadCtx, it: Y.Item): boolean => (ctx.view === undefined ? !it.deleted : ctx.view.live(it));
/** Block-offset length of `u` in `ctx`'s version. */
export function clen(ctx: ReadCtx, u: Y.Item): number {
  if (ctx.view === undefined) return contentLength(u);
  if (!ctx.view.live(u) || !u.countable) return 0;
  const c = u.content;
  if (c instanceof Y.ContentString) return u.length;
  if (c instanceof Y.ContentEmbed) return markOf(u) === null ? 1 : 0;
  return 0;
}
export const entryOf = (ctx: ReadCtx, id: string): Y.Map<unknown> | undefined =>
  ctx.view === undefined ? ctx.reg.get(id) : ctx.view.entry(id);
const canonOf = (ctx: ReadCtx, id: string): Y.Item | null =>
  ctx.view === undefined ? canonicalMark(ctx.doc, id) : ctx.view.canonical(id);
const idsOf = (ctx: ReadCtx, e: Y.Map<unknown>, key: string): string[] => {
  const arr = entryIdArray(e, key, getOf(ctx));
  if (arr === null) return [];
  return ctx.view === undefined ? arr.toArray() : ctx.view.ids(arr);
};
const keepOf = (ctx: ReadCtx): ((p: Y.Text) => boolean) | undefined => ctx.view?.keep;

/** The document's final section id (the root entry's `finalSection`), or the root id when unwritten. */
export function finalSectionId(ctx: ReadCtx): string {
  const root = entryOf(ctx, ctx.rootId);
  return (root === undefined ? undefined : finalSectionOf(root, getOf(ctx))) ?? ctx.rootId;
}

/** An effective (non-hidden) live boundary item: a ¶ (`shape` text) or an object. */
export interface Eff {
  readonly item: Y.Item;
  readonly m: MarkContent;
  readonly entry: Y.Map<unknown>;
  readonly shape: BlockShape;
}

export function eff(ctx: ReadCtx, item: Y.Item | null): Eff | null {
  if (item === null || !isLive(ctx, item)) return null;
  const m = markOf(item);
  if (m === null) return null;
  const entry = entryOf(ctx, m.end);
  if (entry === undefined) return null;
  const shape = entryShape(entry, getOf(ctx));
  if (!isFlowResident(shape, entry, getOf(ctx))) return null;
  return { item, m, entry, shape };
}

const isText = (e: Eff): boolean => e.shape === "text";

/** Pairwise join rule between consecutive effective items `a` → `b`. */
function joins(a: Eff, b: Eff, liveBetween: boolean): boolean {
  if (a.m.section !== b.m.section) return false;
  if (a.m.end === b.m.end) return isText(a) || !liveBetween;
  if (a.m.implicitOf !== undefined && a.m.implicitOf === b.m.implicitOf) return isText(a) && isText(b);
  return false;
}

// ---------------------------------------------------------------------------
// Holders + flow concatenation (merged / joined cells)
// ---------------------------------------------------------------------------

/** The id of the registry entry owning `flow`. */
export function flowOwnerId(flow: Y.Array<Y.Text>): string | null {
  const e = entryOfFlow(flow);
  const it = e?._item ?? null;
  return it === null ? null : it.parentSub;
}

/** The holder (flow-owning entry id) of a unit. */
export function holderOfItem(item: Y.Item): string | null {
  return flowOwnerId(topFlowOfPiece(pieceOf(item)));
}

/** Next unit in flow order, continuing into the next flow of a cell concatenation. */
export function nextU(ctx: ReadCtx, u: Y.Item): Y.Item | null {
  const n = nextUnit(u, keepOf(ctx));
  if (n !== null) return n;
  for (let f = nextFlowInConcat(ctx, topFlowOfPiece(pieceOf(u))); f !== null; f = nextFlowInConcat(ctx, f)) {
    const first = firstUnitOfFlow(f, keepOf(ctx));
    if (first !== null) return first;
  }
  return null;
}

export function prevU(ctx: ReadCtx, u: Y.Item): Y.Item | null {
  const p = prevUnit(u, keepOf(ctx));
  if (p !== null) return p;
  for (let f = prevFlowInConcat(ctx, topFlowOfPiece(pieceOf(u))); f !== null; f = prevFlowInConcat(ctx, f)) {
    const last = lastUnitOfFlow(f, keepOf(ctx));
    if (last !== null) return last;
  }
  return null;
}

/** First unit of a holder's (possibly concatenated) content. */
export function firstUnitOfHolder(ctx: ReadCtx, flows: readonly Y.Array<Y.Text>[]): Y.Item | null {
  for (const f of flows) {
    const u = firstUnitOfFlow(f, keepOf(ctx));
    if (u !== null) return u;
  }
  return null;
}

/** Last unit of a holder's (possibly concatenated) content. */
function lastUnitOfHolder(ctx: ReadCtx, flows: readonly Y.Array<Y.Text>[]): Y.Item | null {
  for (let i = flows.length - 1; i >= 0; i--) {
    const f = flows[i];
    if (f === undefined) continue;
    const u = lastUnitOfFlow(f, keepOf(ctx));
    if (u !== null) return u;
  }
  return null;
}

// Concatenation hooks — provided by the table grid (see `table-read` section below).
function nextFlowInConcat(ctx: ReadCtx, flow: Y.Array<Y.Text>): Y.Array<Y.Text> | null {
  const owner = flowOwnerId(flow);
  if (owner === null) return null;
  const c = concatOfCell(ctx, owner);
  if (c === null) return null;
  const i = c.cells.indexOf(owner);
  const nextId = c.cells[i + 1];
  if (nextId === undefined) return null;
  const e = entryOf(ctx, nextId);
  return e === undefined ? null : entryFlow(e, getOf(ctx));
}

function prevFlowInConcat(ctx: ReadCtx, flow: Y.Array<Y.Text>): Y.Array<Y.Text> | null {
  const owner = flowOwnerId(flow);
  if (owner === null) return null;
  const c = concatOfCell(ctx, owner);
  if (c === null) return null;
  const i = c.cells.indexOf(owner);
  if (i <= 0) return null;
  const prevId = c.cells[i - 1];
  if (prevId === undefined) return null;
  const e = entryOf(ctx, prevId);
  return e === undefined ? null : entryFlow(e, getOf(ctx));
}

/** The flows a holder's children are read from (one flow, or a cell concatenation). */
export function holderFlows(ctx: ReadCtx, holderId: string): Y.Array<Y.Text>[] {
  const c = concatOfCell(ctx, holderId);
  if (c !== null) {
    const out: Y.Array<Y.Text>[] = [];
    for (const id of c.cells) {
      const e = entryOf(ctx, id);
      const f = e === undefined ? null : entryFlow(e, getOf(ctx));
      if (f !== null) out.push(f);
    }
    return out;
  }
  const e = entryOf(ctx, holderId);
  const f = e === undefined ? null : entryFlow(e, getOf(ctx));
  return f === null ? [] : [f];
}

/** The visible holder a flow's content reads under (a covered / joined cell reads in its anchor). */
export function visibleHolder(ctx: ReadCtx, holderId: string): string {
  const c = concatOfCell(ctx, holderId);
  return c === null ? holderId : c.anchorId;
}

// ---------------------------------------------------------------------------
// Scans, chains, sections
// ---------------------------------------------------------------------------

/** The nearest effective item in one direction + whether live content lies in between. */
export interface Scan {
  readonly e: Eff | null;
  readonly live: boolean;
}

/** The first effective item at or after `start` (inclusive). */
function scanFrom(ctx: ReadCtx, start: Y.Item | null): Scan {
  let live = false;
  for (let u = start; u !== null; u = nextU(ctx, u)) {
    const e = eff(ctx, u);
    if (e !== null) return { e, live };
    if (clen(ctx, u) > 0) live = true;
  }
  return { e: null, live };
}

/** The next effective item after `from` (exclusive). */
export function scanFwd(ctx: ReadCtx, from: Y.Item): Scan {
  return scanFrom(ctx, nextU(ctx, from));
}

/** The previous effective item before `from` (exclusive). */
export function scanBack(ctx: ReadCtx, from: Y.Item): Scan {
  let live = false;
  for (let u = prevU(ctx, from); u !== null; u = prevU(ctx, u)) {
    const e = eff(ctx, u);
    if (e !== null) return { e, live };
    if (clen(ctx, u) > 0) live = true;
  }
  return { e: null, live };
}

export interface Chain {
  /** The chain's joined items, in flow order (one for a plain paragraph / object). */
  readonly marks: readonly Eff[];
  /** The first effective non-joining item after the chain, or null at the flow end. */
  readonly next: Eff | null;
  /** Whether live content lies between the chain's last item and `next`. */
  readonly liveAfter: boolean;
}

/** Walk forward from `head` collecting joined items. */
export function chainForward(ctx: ReadCtx, head: Eff): Chain {
  const marks: Eff[] = [head];
  let last = head;
  for (;;) {
    const s = scanFwd(ctx, last.item);
    if (s.e !== null && joins(last, s.e, s.live)) {
      marks.push(s.e);
      last = s.e;
      continue;
    }
    return { marks, next: s.e, liveAfter: s.live };
  }
}

/** The head of the chain containing `e`: walk back while the previous item joins. */
export function chainHeadOf(ctx: ReadCtx, e: Eff): Eff {
  let cur = e;
  for (;;) {
    const s = scanBack(ctx, cur.item);
    if (s.e !== null && joins(s.e, cur, s.live)) {
      cur = s.e;
      continue;
    }
    return cur;
  }
}

/** Entity id of the chain starting at `head` (duplicates: canonical keeps the id). */
export function entityIdOfHead(ctx: ReadCtx, head: Eff): string {
  const canon = canonOf(ctx, head.m.end);
  if (canon === head.item) return head.m.end;
  if (canon !== null) {
    // Canonical inside this chain (consecutive same-id duplicates) → keeps the id.
    const chain = chainForward(ctx, head);
    if (chain.marks.some((x) => x.item === canon)) return head.m.end;
  }
  return `${head.m.end}@${head.item.id.client}:${head.item.id.clock}`;
}

/** The entity id an effective item belongs to (its chain's id). */
export function entityOf(ctx: ReadCtx, e: Eff): string {
  return entityIdOfHead(ctx, chainHeadOf(ctx, e));
}

/** True iff no following item joins `e` (it ends its chain). */
function chainLast(ctx: ReadCtx, e: Eff): boolean {
  const s = scanFwd(ctx, e.item);
  return s.e === null || !joins(e, s.e, s.live);
}

/**
 * The section entity a SECTION BOUNDARY ends: `e` is a root-flow ¶ carrying a live
 * section entry and ending its chain. Null for any other item.
 */
export function sectionBoundaryId(ctx: ReadCtx, e: Eff): string | null {
  const S = e.m.section;
  if (S === undefined || !isText(e)) return null;
  const se = entryOf(ctx, S);
  if (se === undefined || entryShape(se, getOf(ctx)) !== "section") return null;
  if (holderOfItem(e.item) !== ctx.rootId || !chainLast(ctx, e)) return null;
  const canon = canonOf(ctx, S);
  if (canon === e.item) return S;
  if (canon !== null && chainForward(ctx, chainHeadOf(ctx, e)).marks.some((x) => x.item === canon)) return S;
  return `${S}@${e.item.id.client}:${e.item.id.clock}`;
}

function rootFlow(ctx: ReadCtx): Y.Array<Y.Text> | null {
  const e = entryOf(ctx, ctx.rootId);
  return e === undefined ? null : entryFlow(e, getOf(ctx));
}

/** True iff the version has no live section-end item at all (every root entity is in the final section). */
function noSectionEnds(ctx: ReadCtx): boolean {
  for (const it of ctx.view?.sectionMarks ?? ctx.idx.sectionMarks) {
    if (isLive(ctx, it)) return false;
  }
  return true;
}

/** Items stepped over by section walks (section-of-item, section boundaries; a cost probe for tests and benches). */
export const sectionWalkStats = { steps: 0 };

/**
 * The section of the root-flow position at item `x` (inclusive): the first section
 * boundary at or after it, else the final section. Memoized per item (current
 * version), so a walk over a section is paid once per section-end change.
 */
function sectionAtOrAfter(ctx: ReadCtx, x: Y.Item | null): string {
  if (noSectionEnds(ctx)) return finalSectionId(ctx);
  const cache = (ctx.sections ?? ctx.idx.sections).parents;
  const path: Y.Item[] = [];
  let found: string | null = null;
  for (let u = x; u !== null; u = nextU(ctx, u)) {
    sectionWalkStats.steps++;
    const c = cache.get(u);
    if (c !== undefined) {
      found = c;
      break;
    }
    const e = eff(ctx, u);
    if (e === null) continue;
    path.push(u);
    const s = sectionBoundaryId(ctx, e);
    if (s !== null) {
      found = s;
      break;
    }
  }
  const out = found ?? finalSectionId(ctx);
  for (const p of path) cache.set(p, out);
  return out;
}

/** The section boundary before `item` (exclusive), or null at the root flow's start. */
function prevSectionBoundary(ctx: ReadCtx, item: Y.Item): Eff | null {
  for (let u = prevU(ctx, item); u !== null; u = prevU(ctx, u)) {
    sectionWalkStats.steps++;
    const e = eff(ctx, u);
    if (e !== null && sectionBoundaryId(ctx, e) !== null) return e;
  }
  return null;
}

/** The section boundary after `item` (exclusive), or null (the final section follows). */
function nextSectionBoundary(ctx: ReadCtx, item: Y.Item | null): Eff | null {
  for (let u = item; u !== null; u = nextU(ctx, u)) {
    sectionWalkStats.steps++;
    const e = eff(ctx, u);
    if (e !== null && sectionBoundaryId(ctx, e) !== null) return e;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type Entity =
  /** A ¶ chain (paragraph) or an object item chain. */
  | { readonly k: "mark"; readonly id: string; readonly head: Eff; readonly chain: Chain }
  | {
      readonly k: "implicit";
      readonly id: string;
      readonly holder: string;
      /** The boundary item the run starts after (null = the holder start). */
      readonly anchor: Eff | null;
      /** First unit of the run (null when empty). */
      readonly start: Y.Item | null;
      /** The boundary the run stops at: an object, or null (the flow end). */
      readonly next: Eff | null;
    }
  /** A non-final section: its boundary item (the section-end ending its last paragraph). */
  | { readonly k: "section"; readonly id: string; readonly end: Eff; readonly entry: Y.Map<unknown> }
  | { readonly k: "final"; readonly id: string; readonly entry: Y.Map<unknown> }
  | { readonly k: "struct"; readonly id: string; readonly entry: Y.Map<unknown>; readonly shape: BlockShape }
  | { readonly k: "icell"; readonly id: string; readonly row: string; readonly col: string };

const DUP_RE = /^(.*)@(\d+):(\d+)$/;

export function resolveEntity(ctx: ReadCtx, id: string): Entity | null {
  if (id.endsWith("#i")) return resolveImplicit(ctx, id, id.slice(0, -2));
  const bar = id.lastIndexOf("|");
  if (bar > 0) {
    const row = id.slice(0, bar);
    const col = id.slice(bar + 1);
    return implicitCellExists(ctx, row, col) ? { k: "icell", id, row, col } : null;
  }
  const dup = DUP_RE.exec(id);
  if (dup !== null) {
    const [, base, c, k] = dup;
    if (base === undefined || c === undefined || k === undefined) return null;
    const e = eff(ctx, itemById(ctx.doc, Number(c), Number(k)));
    if (e === null) return null;
    if (e.m.end === base) {
      const head = chainHeadOf(ctx, e);
      if (head.item !== e.item || entityIdOfHead(ctx, head) !== id || !holderLive(ctx, e.item)) return null;
      return { k: "mark", id, head, chain: chainForward(ctx, head) };
    }
    const se = entryOf(ctx, base);
    if (e.m.section === base && se !== undefined && sectionBoundaryId(ctx, e) === id) return { k: "section", id, end: e, entry: se };
    return null;
  }
  const entry = entryOf(ctx, id);
  if (entry !== undefined && entryShape(entry, getOf(ctx)) === "section") {
    if (id === finalSectionId(ctx)) return entryOf(ctx, ctx.rootId) === undefined ? null : { k: "final", id, entry };
    const canon = canonOf(ctx, id);
    const e = eff(ctx, canon);
    if (e === null) return null;
    const last = chainForward(ctx, chainHeadOf(ctx, e)).marks.at(-1) ?? e;
    return sectionBoundaryId(ctx, last) === id ? { k: "section", id, end: last, entry } : null;
  }
  const canon = canonOf(ctx, id);
  if (canon === null) {
    if (entry === undefined) return null;
    const shape = entryShape(entry, getOf(ctx));
    if (isFlowResident(shape, entry, getOf(ctx))) return null; // no live item → not in the read model
    if (!structLive(ctx, id, entry, shape)) return null;
    return { k: "struct", id, entry, shape };
  }
  const e = eff(ctx, canon);
  if (e === null) return null;
  const head = chainHeadOf(ctx, e);
  if (entityIdOfHead(ctx, head) !== id) return null;
  if (!holderLive(ctx, head.item)) return null;
  return { k: "mark", id, head, chain: chainForward(ctx, head) };
}

function itemById(doc: Y.Doc, client: number, clock: number): Y.Item | null {
  if (clock >= Y.getState(doc.store, client)) return null;
  const s = Y.getItem(doc.store, Y.createID(client, clock));
  return s instanceof Y.Item ? s : null;
}

/** A flow-resident item is live only while its holder (and the holder's ancestors) are. */
function holderLive(ctx: ReadCtx, item: Y.Item): boolean {
  const h = holderOfItem(item);
  if (h === null) return false;
  const entry = entryOf(ctx, h);
  if (entry === undefined) return false;
  const shape = entryShape(entry, getOf(ctx));
  if (shape === "cell") return cellVisibleOrConcat(ctx, h);
  if (shape === "container" && getOf(ctx)(entry, "root") === true) return true;
  // A host container in a flow: live iff its own item is.
  return canonOf(ctx, h) !== null;
}

function structLive(ctx: ReadCtx, id: string, entry: Y.Map<unknown>, shape: BlockShape): boolean {
  if (shape === "container") return getOf(ctx)(entry, "root") === true;
  if (shape === "row") {
    const t = entryString(entry, "table", getOf(ctx));
    return t !== undefined && tableLive(ctx, t) && rowLive(ctx, t, id);
  }
  if (shape === "cell") return cellVisible(ctx, id);
  return false;
}

/**
 * Whether an unterminated run between boundary `after` (null = holder start) and
 * `next` (an object or null = flow end) is read as an implicit paragraph: it holds
 * live content, or it is empty where invariant I needs a paragraph — after an object,
 * in an empty holder, or ending the (otherwise empty) final section.
 */
function implicitRunExists(ctx: ReadCtx, after: Eff | null, next: Eff | null, live: boolean): boolean {
  if (next !== null && isText(next)) return false;
  if (live) return true;
  if (after === null) return next === null;
  if (!isText(after)) return true;
  return next === null && sectionBoundaryId(ctx, after) !== null;
}

function resolveImplicit(ctx: ReadCtx, id: string, anchorId: string): Entity | null {
  // Holder-start implicit paragraph (root / body / cell / host container / implicit cell).
  const anchorEntry = entryOf(ctx, anchorId);
  const bar = anchorId.lastIndexOf("|");
  if (bar > 0 && anchorEntry === undefined) {
    const row = anchorId.slice(0, bar);
    const col = anchorId.slice(bar + 1);
    if (!implicitCellExists(ctx, row, col)) return null;
    return { k: "implicit", id, holder: anchorId, anchor: null, start: null, next: null };
  }
  if (anchorEntry !== undefined && entryFlow(anchorEntry, getOf(ctx)) !== null) {
    if (concatOfCell(ctx, anchorId) !== null && visibleHolder(ctx, anchorId) !== anchorId) return null;
    if (resolveEntity(ctx, anchorId) === null) return null;
    const first = firstUnitOfHolder(ctx, holderFlows(ctx, anchorId));
    const s = scanFrom(ctx, first);
    if (!implicitRunExists(ctx, null, s.e, s.live)) return null;
    return { k: "implicit", id, holder: anchorId, anchor: null, start: first, next: s.e };
  }
  // After an entity's last item.
  const anchor = resolveEntity(ctx, anchorId);
  if (anchor === null || anchor.k !== "mark") return null;
  const last = anchor.chain.marks[anchor.chain.marks.length - 1] ?? anchor.head;
  if (!implicitRunExists(ctx, last, anchor.chain.next, anchor.chain.liveAfter)) return null;
  const holder = holderOfItem(last.item);
  if (holder === null) return null;
  return { k: "implicit", id, holder, anchor: last, start: nextU(ctx, last.item), next: anchor.chain.next };
}

// ---------------------------------------------------------------------------
// Block derivation
// ---------------------------------------------------------------------------

/** The id of the entity owning the region right after boundary `after` (null = holder start) up to `s.e`. */
function regionOwner(ctx: ReadCtx, after: Eff | null, s: Scan, holder: string): string | null {
  if (s.e !== null && isText(s.e)) return entityOf(ctx, s.e);
  if (implicitRunExists(ctx, after, s.e, s.live)) return `${after === null ? visibleHolder(ctx, holder) : entityOf(ctx, after)}#i`;
  return s.e === null ? null : entityOf(ctx, s.e);
}

/** Previous sibling of a ¶ chain / object chain headed by `head` (`s` = the scan back from it). */
function prevOfHead(ctx: ReadCtx, head: Eff, holder: string, s: Scan = scanBack(ctx, head.item)): string | null {
  const p = s.e;
  if (!isText(head) && implicitRunExists(ctx, p, head, s.live)) return `${p === null ? visibleHolder(ctx, holder) : entityOf(ctx, p)}#i`;
  if (p === null || sectionBoundaryId(ctx, p) !== null) return null;
  return entityOf(ctx, p);
}

/** Next sibling of a chain entity. */
function nextOfChain(ctx: ReadCtx, id: string, head: Eff, chain: Chain): string | null {
  const last = chain.marks[chain.marks.length - 1] ?? head;
  if (sectionBoundaryId(ctx, last) !== null) return null;
  const n = chain.next;
  if (n !== null && isText(n)) return entityOf(ctx, n);
  if (implicitRunExists(ctx, last, n, chain.liveAfter)) return `${id}#i`;
  return n === null ? null : entityOf(ctx, n);
}

/** The parent of a holder's entity whose position is `x` (its last item; for an implicit run the object after it). */
function parentAt(ctx: ReadCtx, x: Y.Item | null, holder: string): string {
  const vis = visibleHolder(ctx, holder);
  return vis === ctx.rootId ? sectionAtOrAfter(ctx, x) : vis;
}

/** First child of a region starting at `start` right after boundary `after` (null = holder start). */
function firstChildFrom(ctx: ReadCtx, after: Eff | null, start: Y.Item | null, holder: string): string | null {
  return regionOwner(ctx, after, scanFrom(ctx, start), holder);
}

/** Last child of a region ending at the flow end (`endFrom` = the last unit, inclusive). */
function lastChildAtEnd(ctx: ReadCtx, endFrom: Y.Item | null, holder: string): string | null {
  let live = false;
  for (let u = endFrom; u !== null; u = prevU(ctx, u)) {
    const e = eff(ctx, u);
    if (e === null) {
      if (clen(ctx, u) > 0) live = true;
      continue;
    }
    return implicitRunExists(ctx, e, null, live) ? `${entityOf(ctx, e)}#i` : entityOf(ctx, e);
  }
  return `${visibleHolder(ctx, holder)}#i`;
}

function attrsOfMarks(marks: readonly Eff[]): ReadonlyAttrs {
  if (marks.length === 1) {
    const m0 = marks[0];
    return m0 === undefined ? FROZEN_EMPTY : attrsOfEntry(m0.entry);
  }
  const out: Record<string, unknown> = {};
  const seen = new Set<Y.Map<unknown>>();
  for (const m of marks) {
    if (seen.has(m.entry)) continue;
    seen.add(m.entry);
    const a = entryAttrsMap(m.entry);
    if (a === null) continue;
    for (const [k, v] of a.entries()) {
      if (!(k in out) && v !== undefined && v !== null) {
        assertNoNestedYTypes(v, k);
        out[k] = v;
      }
    }
  }
  return Object.freeze(out);
}

const FROZEN_EMPTY: ReadonlyAttrs = Object.freeze({});

export function attrsOfEntry(entry: Y.Map<unknown>): ReadonlyAttrs {
  const a = entryAttrsMap(entry);
  if (a === null || a.size === 0) return FROZEN_EMPTY;
  const out: Record<string, unknown> = {};
  for (const [k, v] of a.entries()) {
    if (v === undefined || v === null) continue;
    assertNoNestedYTypes(v, k);
    out[k] = v;
  }
  return Object.freeze(out);
}

function freezeBlock(b: Omit<Block, "id"> & { id: string }): Block {
  const { breakSuggestion, markAttrs, ...rest } = b;
  return Object.freeze({
    ...rest,
    id: asBlockId(b.id),
    ...(breakSuggestion === undefined ? {} : { breakSuggestion }),
    ...(markAttrs === undefined || Object.keys(markAttrs).length === 0 ? {} : { markAttrs }),
  });
}

/** The ¶ character props of a paragraph (its id-owning entry's `markAttrs`). */
function markAttrsOfHead(head: Eff | undefined): ReadonlyAttrs | undefined {
  const m = head === undefined ? null : entryMarkAttrsMap(head.entry);
  if (m === null || m.size === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of m.entries()) if (v !== undefined && v !== null) out[k] = v;
  return Object.freeze(out);
}

/**
 * The break-suggestion tags of an entity read off its chain items' entries (absent-key
 * rule, as attrs). A derived duplicate copy (`X@client:clock`) reads without tags: an
 * unresolved tag is drawn only at the CANONICAL item.
 */
function tagsOfMarks(ctx: ReadCtx, id: string, marks: readonly Eff[]): Block["breakSuggestion"] {
  if (marks.length === 0 || DUP_RE.test(id)) return undefined;
  return breakSuggestionOfEntries(
    marks.map((m) => m.entry),
    getOf(ctx),
  );
}

const bid = (s: string | null): BlockId | null => (s === null ? null : asBlockId(s));

/** Derive the `Block` read model for `id`, or null when it is not in the read model. */
export function deriveBlock(ctx: ReadCtx, id: string): { block: Block; tree: TreeKind } | null {
  const hit = cachedLocator(ctx, id);
  if (hit !== null) return deriveText(ctx, hit);
  const ent = resolveEntity(ctx, id);
  if (ent === null) return null;
  const loc = locatorOfEntity(ctx, ent);
  if (loc !== null) return deriveText(ctx, adoptLocator(loc));
  switch (ent.k) {
    case "mark":
      return deriveObject(ctx, ent);
    case "implicit":
      return null; // text entities derive through their locator (above)
    case "section":
      return deriveSection(ctx, ent.id, ent.entry, ent.end);
    case "final":
      return deriveSection(ctx, ent.id, ent.entry, null);
    case "struct":
      return deriveStruct(ctx, ent.id, ent.entry, ent.shape);
    case "icell":
      return deriveImplicitCell(ctx, ent.row, ent.col, ent.id);
  }
}

/**
 * A block's record WITHOUT its inline content (the dirty compare's input): O(window), no
 * extent fill, nothing cached. For a text / object entity `parentId` is left null and
 * `at` names where it is read (`parentOfRecord`), so a caller that knows the parent is
 * unchanged skips the section walk.
 */
export interface BlockRecord {
  readonly block: Block;
  readonly tree: TreeKind;
  readonly at: { readonly x: Y.Item | null; readonly holder: string } | null;
}

export function deriveRecord(ctx: ReadCtx, id: string): BlockRecord | null {
  const hit = cachedLocator(ctx, id);
  const ent = hit === null ? resolveEntity(ctx, id) : null;
  const loc = hit ?? (ent === null ? null : locatorOfEntity(ctx, ent));
  if (loc !== null) {
    return { ...deriveText(ctx, loc, true), at: { x: loc.init.boundary?.item ?? null, holder: loc.init.holder } };
  }
  if (ent === null) return null;
  if (ent.k === "mark") {
    const last = ent.chain.marks[ent.chain.marks.length - 1] ?? ent.head;
    return { ...deriveObject(ctx, ent, true), at: { x: last.item, holder: holderOfItem(ent.head.item) ?? ctx.rootId } };
  }
  const d = deriveBlock(ctx, id);
  return d === null ? null : { ...d, at: null };
}

/** The parent of a record whose `at` is set. */
export function parentOfRecord(ctx: ReadCtx, at: NonNullable<BlockRecord["at"]>): string {
  return parentAt(ctx, at.x, at.holder);
}

function treeOfHolder(ctx: ReadCtx, holder: string): TreeKind {
  const bar = holder.lastIndexOf("|");
  const e = entryOf(ctx, bar > 0 && entryOf(ctx, holder) === undefined ? holder.slice(0, bar) : holder);
  return e === undefined ? "block" : entryTree(e);
}

/** An object entity (image, table, host container, …). */
function deriveObject(ctx: ReadCtx, ent: Extract<Entity, { k: "mark" }>, lean = false): { block: Block; tree: TreeKind } {
  const { head, chain } = ent;
  const holder = holderOfItem(head.item) ?? ctx.rootId;
  const last = chain.marks[chain.marks.length - 1] ?? head;
  const shape = head.shape;
  let first: string | null = null;
  let lastChild: string | null = null;
  if (shape === "container") {
    const flows = holderFlows(ctx, head.m.end);
    first = firstChildFrom(ctx, null, firstUnitOfHolder(ctx, flows), head.m.end);
    lastChild = lastChildAtEnd(ctx, lastUnitOfHolder(ctx, flows), head.m.end);
  } else if (shape === "table") {
    const rows = liveRows(ctx, head.m.end);
    first = rows[0] ?? null;
    lastChild = rows[rows.length - 1] ?? null;
  }
  const attrs = shape === "table" ? tableAttrs(ctx, head.m.end, head.entry) : attrsOfMarks(chain.marks);
  return {
    tree: treeOfHolder(ctx, holder),
    block: freezeBlock({
      id: ent.id,
      type: entryType(head.entry),
      attrs,
      parentId: lean ? null : bid(parentAt(ctx, last.item, holder)),
      prevSiblingId: bid(prevOfHead(ctx, head, holder)),
      nextSiblingId: bid(nextOfChain(ctx, ent.id, head, chain)),
      firstChildId: bid(first),
      lastChildId: bid(lastChild),
      inlineContent: null,
    }),
  };
}

/** A section: `end` = its boundary item (null for the final section). */
function deriveSection(ctx: ReadCtx, id: string, entry: Y.Map<unknown>, end: Eff | null): { block: Block; tree: TreeKind } {
  const f = rootFlow(ctx);
  const tail = f === null ? null : lastUnitOfFlow(f, keepOf(ctx));
  const { prevB, nextB } = sectionBounds(ctx, end, tail);
  const start = prevB === null ? (f === null ? null : firstUnitOfFlow(f, keepOf(ctx))) : nextU(ctx, prevB.item);
  return {
    tree: "block",
    block: freezeBlock({
      id,
      type: entryType(entry),
      attrs: attrsOfEntry(entry),
      parentId: bid(ctx.rootId),
      prevSiblingId: bid(prevB === null ? null : sectionBoundaryId(ctx, prevB)),
      nextSiblingId: bid(end === null ? null : nextB === null ? finalSectionId(ctx) : sectionBoundaryId(ctx, nextB)),
      firstChildId: bid(firstChildFrom(ctx, prevB, start, ctx.rootId)),
      lastChildId: bid(end === null ? lastChildAtEnd(ctx, tail, ctx.rootId) : entityOf(ctx, end)),
      inlineContent: null,
    }),
  };
}

/** The boundaries around the section ending at `end` (null = the final section), memoized per section. */
function sectionBounds(ctx: ReadCtx, end: Eff | null, tail: Y.Item | null): { prevB: Eff | null; nextB: Eff | null } {
  const memo = (ctx.sections ?? ctx.idx.sections).bounds;
  const key = end?.item ?? null;
  const hit = memo.get(key);
  if (hit !== undefined) {
    const prevB = hit.prev === null ? null : eff(ctx, hit.prev);
    const nextB = hit.next === null ? null : eff(ctx, hit.next);
    if ((prevB !== null || hit.prev === null) && (nextB !== null || hit.next === null)) return { prevB, nextB };
  }
  const prevB = end === null ? (tail === null ? null : lastSectionBoundaryUpTo(ctx, tail)) : prevSectionBoundary(ctx, chainHeadOf(ctx, end).item);
  const nextB = end === null ? null : nextSectionBoundary(ctx, nextU(ctx, end.item));
  memo.set(key, { prev: prevB?.item ?? null, next: nextB?.item ?? null });
  return { prevB, nextB };
}

/** The last section boundary at or before `item` (inclusive), or null. */
function lastSectionBoundaryUpTo(ctx: ReadCtx, item: Y.Item): Eff | null {
  if (noSectionEnds(ctx)) return null;
  for (let u: Y.Item | null = item; u !== null; u = prevU(ctx, u)) {
    sectionWalkStats.steps++;
    const e = eff(ctx, u);
    if (e !== null && sectionBoundaryId(ctx, e) !== null) return e;
  }
  return null;
}

function deriveStruct(ctx: ReadCtx, id: string, entry: Y.Map<unknown>, shape: BlockShape): { block: Block; tree: TreeKind } {
  const tree = entryTree(entry);
  if (shape === "container") {
    let first: string | null;
    let last: string | null;
    const fs = id === ctx.rootId ? entryOf(ctx, finalSectionId(ctx)) : undefined;
    if (fs !== undefined && entryShape(fs, getOf(ctx)) === "section") {
      // The document root: its children are the sections (the final one always exists).
      const f = rootFlow(ctx);
      const firstB = noSectionEnds(ctx) || f === null ? null : nextSectionBoundary(ctx, firstUnitOfFlow(f, keepOf(ctx)));
      first = firstB === null ? finalSectionId(ctx) : sectionBoundaryId(ctx, firstB);
      last = finalSectionId(ctx);
    } else {
      const flows = holderFlows(ctx, id);
      first = firstChildFrom(ctx, null, firstUnitOfHolder(ctx, flows), id);
      last = lastChildAtEnd(ctx, lastUnitOfHolder(ctx, flows), id);
    }
    return {
      tree,
      block: freezeBlock({
        id,
        type: entryType(entry),
        attrs: attrsOfEntry(entry),
        parentId: null,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: bid(first),
        lastChildId: bid(last),
        inlineContent: null,
      }),
    };
  }
  if (shape === "row") return deriveRow(ctx, id, entry);
  return deriveCell(ctx, id, entry);
}

// ---------------------------------------------------------------------------
// Inline read
// ---------------------------------------------------------------------------

/** Formatting attributes active in `piece` just before `item` (fold of live format items). O(piece). */
export function attrsBefore(item: Y.Item): Map<string, unknown> {
  const cur = new Map<string, unknown>();
  for (let it = pieceOf(item)._start; it !== null && it !== item; it = it.right) {
    if (it.deleted) continue;
    const c = it.content;
    if (c instanceof Y.ContentFormat) {
      if (c.value === null) cur.delete(c.key);
      else cur.set(c.key, c.value);
    }
  }
  return cur;
}

/** One content unit of an entity with its formatting. */
export interface ContentUnit {
  readonly item: Y.Item;
  readonly attrs: ReadonlyMap<string, unknown>;
}

/**
 * Walk the content units (live chars / inline embeds) from `start` up to
 * `boundary` (exclusive), skipping marks / sub-flows / formats / tombstones, with
 * each unit's formatting. `visit` returning false stops the walk.
 */
export function walkContent(
  ctx: ReadCtx,
  start: Y.Item | null,
  boundary: Eff | null,
  visit: (item: Y.Item, attrs: ReadonlyMap<string, unknown>) => boolean | void,
): void {
  let piece: Y.Text | null = null;
  let cur = new Map<string, unknown>();
  for (let u = start; u !== null && (boundary === null || u !== boundary.item); u = nextU(ctx, u)) {
    const p = pieceOf(u);
    if (p !== piece) {
      piece = p;
      cur = attrsBefore(u);
    }
    if (u.deleted) continue;
    const c = u.content;
    if (c instanceof Y.ContentFormat) {
      if (c.value === null) cur.delete(c.key);
      else cur.set(c.key, c.value);
      continue;
    }
    if (clen(ctx, u) === 0) {
      if (isSubflowItem(u)) piece = null; // re-fold when we come back to this piece
      continue;
    }
    if (visit(u, cur) === false) return;
  }
}

type UnitIter = (visit: (item: Y.Item, attrs: ReadonlyMap<string, unknown>) => boolean | void) => void;

function inlineOf(iter: UnitIter): InlineContent {
  const items: InlineItem[] = [];
  iter((u, cur) => {
    const attrs: Record<string, unknown> = {};
    for (const [k, v] of cur) {
      if (v === null || v === undefined) continue;
      assertNoNestedYTypes(v, k);
      attrs[k] = v;
    }
    const c = u.content;
    if (c instanceof Y.ContentString) {
      const prev = items[items.length - 1];
      if (prev !== undefined && prev.kind === "text" && attrsEqual(prev.attrs, attrs)) {
        items[items.length - 1] = { kind: "text", text: prev.text + c.str, attrs: prev.attrs };
      } else {
        items.push({ kind: "text", text: c.str, attrs });
      }
      return;
    }
    if (c instanceof Y.ContentEmbed) {
      const content: unknown = c.embed;
      if (content === null || typeof content !== "object" || typeof (content as { embedType?: unknown }).embedType !== "string") {
        throw new Error("inline content: malformed embed (expected { embedType, properties })");
      }
      const { embedType, properties } = content as { embedType: string; properties?: unknown };
      const props: Record<string, unknown> = {};
      if (properties !== null && typeof properties === "object") {
        for (const [key, value] of Object.entries(properties)) {
          assertNoNestedYTypes(value, `properties.${key}`);
          props[key] = value;
        }
      }
      items.push({ kind: "embed", embedType, attrs: isStructuralMarkerEmbedType(embedType) ? {} : attrs, properties: props });
    }
  });
  const frozen = items.map((item): InlineItem =>
    item.kind === "text"
      ? Object.freeze<TextItem>({ kind: "text", text: item.text, attrs: Object.freeze(item.attrs) })
      : Object.freeze<EmbedItem>({
          kind: "embed",
          embedType: item.embedType,
          attrs: Object.freeze(item.attrs),
          properties: Object.freeze(item.properties),
        }),
  );
  return Object.freeze({ items: Object.freeze(frozen) });
}

/** Content region of a text-bearing entity: `[start, boundary)`. */
export interface Region {
  readonly start: Y.Item | null;
  /** The item the region stops at: the chain's last ¶, or (implicit) the next object / null. */
  readonly boundary: Eff | null;
  /** Where an insert at offset 0 goes: right after this boundary item (null = `startPiece` start). */
  readonly anchorItem: Y.Item | null;
  readonly startPiece: Y.Text | null;
}

/** The content region of a text-bearing entity id (its cached locator), or null when it has none. */
export function regionOf(ctx: ReadCtx, id: string): Locator | null {
  return getLocator(ctx, id);
}

/** A text-bearing entity's locator (extents not yet filled), or null for any other entity. */
export function buildTextLocator(ctx: ReadCtx, id: string): Locator | null {
  const ent = resolveEntity(ctx, id);
  return ent === null ? null : locatorOfEntity(ctx, ent);
}

function locatorOfEntity(ctx: ReadCtx, ent: Entity): Locator | null {
  if (ent.k === "mark") {
    if (!isText(ent.head)) return null;
    const { head, chain } = ent;
    const holder = holderOfItem(head.item) ?? ctx.rootId;
    const back = scanBack(ctx, head.item);
    const last = chain.marks[chain.marks.length - 1] ?? head;
    return new Locator(ctx, {
      id: ent.id,
      implicit: false,
      marks: chain.marks,
      holder,
      boundary: last,
      anchorItem: back.e?.item ?? null,
      holderFlow: back.e === null ? (holderFlows(ctx, holder)[0] ?? null) : null,
      nextItem: chain.next?.item ?? null,
      prevId: prevOfHead(ctx, head, holder, back),
      nextId: nextOfChain(ctx, ent.id, head, chain),
    });
  }
  if (ent.k !== "implicit") return null;
  const anchor = ent.anchor;
  return new Locator(ctx, {
    id: ent.id,
    implicit: true,
    marks: [],
    holder: ent.holder,
    boundary: ent.next,
    anchorItem: anchor?.item ?? null,
    holderFlow: anchor === null ? (holderFlows(ctx, ent.holder)[0] ?? null) : null,
    nextItem: ent.next?.item ?? null,
    prevId: anchor === null || sectionBoundaryId(ctx, anchor) !== null ? null : entityOf(ctx, anchor),
    nextId: ent.next === null ? null : entityOf(ctx, ent.next),
  });
}

/** Derive a text entity's block from its locator (no region walk beyond its extents). */
function deriveText(ctx: ReadCtx, loc: Locator, lean = false): { block: Block; tree: TreeKind } {
  const { init } = loc;
  const head = init.marks[0];
  return {
    tree: treeOfHolder(ctx, init.holder),
    block: freezeBlock({
      id: loc.id,
      type: head === undefined ? "paragraph" : entryType(head.entry),
      attrs: init.marks.length > 0 ? attrsOfMarks(init.marks) : FROZEN_EMPTY,
      // The parent is not cached with the region: a section-end change re-parents a whole section.
      parentId: lean ? null : bid(parentAt(ctx, init.boundary?.item ?? null, init.holder)),
      prevSiblingId: bid(init.prevId),
      nextSiblingId: bid(init.nextId),
      firstChildId: null,
      lastChildId: null,
      inlineContent: lean ? null : inlineOf((visit) => forEachUnit(loc, visit)),
      breakSuggestion: tagsOfMarks(ctx, loc.id, init.marks),
      markAttrs: markAttrsOfHead(head),
    }),
  };
}

/**
 * Owning entity id + offset of content unit `item`: the paragraph whose ¶ chain is
 * the next effective item, or — before an object / the flow end — the implicit run.
 * O(paragraph + crossed tombstones).
 */
export function ownerOfUnit(ctx: ReadCtx, item: Y.Item): { id: string; offset: number } | null {
  const f = scanFwd(ctx, item);
  let offset = 0;
  let cur: Eff | null = f.e !== null && isText(f.e) ? f.e : null;
  let p: Eff | null = null;
  for (let u = prevU(ctx, item); u !== null; u = prevU(ctx, u)) {
    const e = eff(ctx, u);
    if (e === null) {
      offset += clen(ctx, u);
      continue;
    }
    // A joined chain reads its content in flow order: keep counting past its earlier items.
    if (cur !== null && joins(e, cur, true)) {
      cur = e;
      continue;
    }
    p = e;
    break;
  }
  if (cur !== null) return { id: entityIdOfHead(ctx, cur), offset };
  const holder = holderOfItem(item);
  if (holder === null) return null;
  return { id: `${p === null ? visibleHolder(ctx, holder) : entityOf(ctx, p)}#i`, offset };
}

/**
 * The position of the gap right after boundary `after` (null = the start of
 * `holder`): offset 0 of the region that follows — a ¶'s paragraph, an implicit run,
 * or `(obj, 0)` before an object. The gap after a flow's final ¶ is not a position:
 * it reads as the end of that paragraph.
 */
export function gapAfter(ctx: ReadCtx, after: Eff | null, holder: string): { id: string; offset: number } | null {
  const s = after === null ? scanFrom(ctx, firstUnitOfHolder(ctx, holderFlows(ctx, visibleHolder(ctx, holder)))) : scanFwd(ctx, after.item);
  // Inside a joined chain: the content before `after` in its paragraph.
  if (after !== null && s.e !== null && joins(after, s.e, s.live)) return ownerOfUnit(ctx, after.item);
  const id = regionOwner(ctx, after, s, holder);
  if (id !== null) return { id, offset: 0 };
  if (after === null) return null;
  const len = getLocator(ctx, entityOf(ctx, after))?.length ?? 0;
  return { id: entityOf(ctx, after), offset: len };
}

// ---------------------------------------------------------------------------
// Tables (grid read model)
// ---------------------------------------------------------------------------

export interface GridCell {
  readonly id: string; // visible cell id (real or implicit `${row}|${col}`)
  readonly row: string;
  readonly col: string;
  readonly rowIndex: number;
  readonly colIndex: number;
  readonly colSpan: number;
  readonly rowSpan: number;
  /** Candidate + covered cell ids whose flows concatenate into this cell, in read order. */
  readonly cells: readonly string[];
}

interface Grid {
  readonly tableId: string;
  readonly rows: readonly string[];
  readonly cols: readonly string[];
  /** Visible cells per row in column order. */
  readonly byRow: ReadonlyMap<string, readonly GridCell[]>;
  /** real cell id → its visible grid cell (covered / joined cells map to their anchor). */
  readonly cellToVisible: ReadonlyMap<string, GridCell>;
}

function tableLive(ctx: ReadCtx, tableId: string): boolean {
  return canonOf(ctx, tableId) !== null && resolveEntity(ctx, tableId) !== null;
}

function rowLive(ctx: ReadCtx, tableId: string, rowId: string): boolean {
  return gridOf(ctx, tableId)?.rows.includes(rowId) ?? false;
}

export function liveRows(ctx: ReadCtx, tableId: string): readonly string[] {
  return gridOf(ctx, tableId)?.rows ?? [];
}

export function liveCols(ctx: ReadCtx, tableId: string): readonly string[] {
  return gridOf(ctx, tableId)?.cols ?? [];
}

/** The table grid (memoized per doc until the next transaction). O(table). */
export function gridOf(ctx: ReadCtx, tableId: string): Grid | null {
  const cache = ctx.gridCache ?? ctx.idx.gridCache;
  const cached = cache.get(tableId);
  if (cached !== undefined) return cached as Grid | null;
  const g = computeGrid(ctx, tableId);
  cache.set(tableId, g);
  return g;
}

function computeGrid(ctx: ReadCtx, tableId: string): Grid | null {
  const t = entryOf(ctx, tableId);
  if (t === undefined || entryShape(t, getOf(ctx)) !== "table") return null;
  const seenRows = new Set<string>();
  const rows: string[] = [];
  for (const r of idsOf(ctx, t, "rows")) {
    if (seenRows.has(r)) continue;
    const re = entryOf(ctx, r);
    if (re === undefined || entryShape(re, getOf(ctx)) !== "row") continue;
    seenRows.add(r);
    rows.push(r);
  }
  const seenCols = new Set<string>();
  const cols: string[] = [];
  for (const c of idsOf(ctx, t, "columns")) {
    if (seenCols.has(c)) continue;
    seenCols.add(c);
    cols.push(c);
  }
  const colIndex = new Map(cols.map((c, i) => [c, i]));
  const rowIndex = new Map(rows.map((r, i) => [r, i]));
  // Candidates per (row, col), in cell-id order (joined cells).
  const slots = new Map<string, string[]>();
  for (const r of rows) {
    const re = entryOf(ctx, r);
    const cells = re === undefined ? [] : (idsOf(ctx, re, "cells"));
    for (const cid of cells) {
      const ce = entryOf(ctx, cid);
      if (ce === undefined || entryShape(ce, getOf(ctx)) !== "cell") continue;
      const col = entryString(ce, "col", getOf(ctx));
      if (col === undefined || !colIndex.has(col)) continue;
      const key = `${r}|${col}`;
      const list = slots.get(key) ?? [];
      if (!list.includes(cid)) list.push(cid);
      slots.set(key, list);
    }
  }
  for (const list of slots.values()) list.sort();
  // Spans: applied in row-major order of anchors; overlaps with earlier spans dropped.
  const covered = new Map<string, string>(); // slot key → anchor slot key
  const spanOf = new Map<string, { cs: number; rs: number }>();
  for (const r of rows) {
    for (const c of cols) {
      const key = `${r}|${c}`;
      if (covered.has(key)) continue;
      const list = slots.get(key);
      const first = list?.[0];
      let cs = 1;
      let rs = 1;
      if (first !== undefined) {
        const ce = entryOf(ctx, first);
        const toC = ce === undefined ? undefined : entryString(ce, "colSpanTo", getOf(ctx));
        const toR = ce === undefined ? undefined : entryString(ce, "rowSpanTo", getOf(ctx));
        const ci = colIndex.get(c) ?? 0;
        const ri = rowIndex.get(r) ?? 0;
        if (toC !== undefined) {
          const ti = colIndex.get(toC);
          if (ti !== undefined && ti > ci) cs = ti - ci + 1;
        }
        if (toR !== undefined) {
          const ti = rowIndex.get(toR);
          if (ti !== undefined && ti > ri) rs = ti - ri + 1;
        }
        // Overlap with an earlier-applied span → read as 1×1.
        let overlap = false;
        for (let dr = 0; dr < rs && !overlap; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            if (dr === 0 && dc === 0) continue;
            const rr = rows[ri + dr];
            const cc = cols[ci + dc];
            if (rr === undefined || cc === undefined || covered.has(`${rr}|${cc}`)) {
              overlap = true;
              break;
            }
          }
        }
        if (overlap) {
          cs = 1;
          rs = 1;
        }
        for (let dr = 0; dr < rs; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            if (dr === 0 && dc === 0) continue;
            const rr = rows[ri + dr];
            const cc = cols[ci + dc];
            if (rr !== undefined && cc !== undefined) covered.set(`${rr}|${cc}`, key);
          }
        }
      }
      spanOf.set(key, { cs, rs });
    }
  }
  const byRow = new Map<string, GridCell[]>();
  const cellToVisible = new Map<string, GridCell>();
  for (const r of rows) {
    const list: GridCell[] = [];
    for (const c of cols) {
      const key = `${r}|${c}`;
      if (covered.has(key)) continue;
      const span = spanOf.get(key) ?? { cs: 1, rs: 1 };
      const cands = slots.get(key) ?? [];
      const ri = rowIndex.get(r) ?? 0;
      const ci = colIndex.get(c) ?? 0;
      const concat: string[] = [...cands];
      for (let dr = 0; dr < span.rs; dr++) {
        for (let dc = 0; dc < span.cs; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = rows[ri + dr];
          const cc = cols[ci + dc];
          if (rr === undefined || cc === undefined) continue;
          // Word / GDocs: an EMPTY covered cell (its flow holds only its final empty ¶)
          // contributes nothing to the merged cell's content.
          for (const cid of slots.get(`${rr}|${cc}`) ?? []) if (!emptyCellFlow(ctx, cid)) concat.push(cid);
        }
      }
      const gc: GridCell = {
        id: cands[0] ?? key,
        row: r,
        col: c,
        rowIndex: ri,
        colIndex: ci,
        colSpan: span.cs,
        rowSpan: span.rs,
        cells: concat,
      };
      list.push(gc);
      for (const cid of concat) cellToVisible.set(cid, gc);
    }
    byRow.set(r, list);
  }
  return { tableId, rows, cols, byRow, cellToVisible };
}

/** True iff cell `cid`'s flow holds nothing but one empty ¶ (an empty cell). O(1). */
function emptyCellFlow(ctx: ReadCtx, cid: string): boolean {
  const e = entryOf(ctx, cid);
  const f = e === undefined ? null : entryFlow(e, getOf(ctx));
  const u = f === null ? null : firstUnitOfFlow(f, keepOf(ctx));
  if (u === null) return true;
  const m = eff(ctx, u);
  return m !== null && m.shape === "text" && nextUnit(u, keepOf(ctx)) === null;
}

/** Table of a row / cell entry id. */
function tableOfRow(ctx: ReadCtx, rowId: string): string | null {
  const re = entryOf(ctx, rowId);
  return re === undefined ? null : (entryString(re, "table", getOf(ctx)) ?? null);
}

function gridCellOf(ctx: ReadCtx, cellId: string): GridCell | null {
  const ce = entryOf(ctx, cellId);
  if (ce === undefined) return null;
  const row = entryString(ce, "row", getOf(ctx));
  if (row === undefined) return null;
  const t = tableOfRow(ctx, row);
  if (t === null) return null;
  return gridOf(ctx, t)?.cellToVisible.get(cellId) ?? null;
}

/** For a cell participating in a concatenation (merge / joined), the anchor + ordered cells. */
function concatOfCell(ctx: ReadCtx, cellId: string): { anchorId: string; cells: readonly string[] } | null {
  const ce = entryOf(ctx, cellId);
  if (ce === undefined || entryShape(ce, getOf(ctx)) !== "cell") return null;
  const gc = gridCellOf(ctx, cellId);
  if (gc === null || gc.cells.length <= 1) return null;
  return { anchorId: gc.id, cells: gc.cells };
}

function cellVisible(ctx: ReadCtx, cellId: string): boolean {
  const gc = gridCellOf(ctx, cellId);
  if (gc === null) return false;
  const t = tableOfRow(ctx, gc.row);
  return gc.id === cellId && t !== null && tableLive(ctx, t);
}

function cellVisibleOrConcat(ctx: ReadCtx, cellId: string): boolean {
  const gc = gridCellOf(ctx, cellId);
  if (gc === null) return false;
  const t = tableOfRow(ctx, gc.row);
  return t !== null && tableLive(ctx, t);
}

function implicitCellExists(ctx: ReadCtx, row: string, col: string): boolean {
  const t = tableOfRow(ctx, row);
  if (t === null || !tableLive(ctx, t)) return false;
  const g = gridOf(ctx, t);
  return g?.byRow.get(row)?.some((c) => c.id === `${row}|${col}`) ?? false;
}

function tableAttrs(ctx: ReadCtx, tableId: string, entry: Y.Map<unknown>): ReadonlyAttrs {
  const base = attrsOfEntry(entry);
  const widths = entry.get("columnWidths");
  // A positional `columnWidths` attr (grid columns not yet established) reads as is.
  if (!(widths instanceof Y.Map) || widths.size === 0) return base;
  const cols = liveCols(ctx, tableId);
  const arr: number[] = [];
  for (const c of cols) {
    const w: unknown = widths.get(c);
    if (typeof w !== "number") return base;
    arr.push(w);
  }
  return Object.freeze({ ...base, columnWidths: Object.freeze(arr) });
}

function deriveRow(ctx: ReadCtx, id: string, entry: Y.Map<unknown>): { block: Block; tree: TreeKind } {
  const t = entryString(entry, "table", getOf(ctx)) ?? "";
  const rows = liveRows(ctx, t);
  const i = rows.indexOf(id);
  const cells = gridOf(ctx, t)?.byRow.get(id) ?? [];
  const tableHolder = canonOf(ctx, t);
  const holder = tableHolder === null ? null : holderOfItem(tableHolder);
  return {
    tree: holder === null ? "block" : treeOfHolder(ctx, holder),
    block: freezeBlock({
      id,
      type: entryType(entry),
      attrs: attrsOfEntry(entry),
      parentId: bid(t),
      prevSiblingId: bid(rows[i - 1] ?? null),
      nextSiblingId: bid(rows[i + 1] ?? null),
      firstChildId: bid(cells[0]?.id ?? null),
      lastChildId: bid(cells[cells.length - 1]?.id ?? null),
      inlineContent: null,
    }),
  };
}

function cellAttrs(ctx: ReadCtx, gc: GridCell): ReadonlyAttrs {
  const out: Record<string, unknown> = {};
  const cands = gc.cells.filter((c) => {
    const e = entryOf(ctx, c);
    return e !== undefined && entryString(e, "row", getOf(ctx)) === gc.row && entryString(e, "col", getOf(ctx)) === gc.col;
  });
  for (const c of cands) {
    const e = entryOf(ctx, c);
    if (e === undefined) continue;
    for (const [k, v] of Object.entries(attrsOfEntry(e))) if (!(k in out)) out[k] = v;
  }
  delete out.colSpan;
  delete out.rowSpan;
  if (gc.colSpan > 1) out.colSpan = gc.colSpan;
  if (gc.rowSpan > 1) out.rowSpan = gc.rowSpan;
  return Object.freeze(out);
}

function deriveCell(ctx: ReadCtx, id: string, entry: Y.Map<unknown>): { block: Block; tree: TreeKind } {
  const gc = gridCellOf(ctx, id);
  const row = entryString(entry, "row", getOf(ctx)) ?? "";
  const siblings = gridOf(ctx, tableOfRow(ctx, row) ?? "")?.byRow.get(row) ?? [];
  const i = siblings.findIndex((c) => c.id === id);
  const flows = holderFlows(ctx, id);
  const first = firstChildFrom(ctx, null, firstUnitOfHolder(ctx, flows), id);
  const last = lastChildAtEnd(ctx, lastUnitOfHolder(ctx, flows), id);
  const t = tableOfRow(ctx, row);
  const tm = t === null ? null : canonOf(ctx, t);
  const holder = tm === null ? null : holderOfItem(tm);
  return {
    tree: holder === null ? "block" : treeOfHolder(ctx, holder),
    block: freezeBlock({
      id,
      type: entryType(entry),
      attrs: gc === null ? attrsOfEntry(entry) : cellAttrs(ctx, gc),
      parentId: bid(row),
      prevSiblingId: bid(siblings[i - 1]?.id ?? null),
      nextSiblingId: bid(siblings[i + 1]?.id ?? null),
      firstChildId: bid(first),
      lastChildId: bid(last),
      inlineContent: null,
    }),
  };
}

function deriveImplicitCell(ctx: ReadCtx, row: string, _col: string, id: string): { block: Block; tree: TreeKind } {
  const t = tableOfRow(ctx, row) ?? "";
  const siblings = gridOf(ctx, t)?.byRow.get(row) ?? [];
  const i = siblings.findIndex((c) => c.id === id);
  const tm = canonOf(ctx, t);
  const holder = tm === null ? null : holderOfItem(tm);
  return {
    tree: holder === null ? "block" : treeOfHolder(ctx, holder),
    block: freezeBlock({
      id,
      type: "table-cell",
      attrs: FROZEN_EMPTY,
      parentId: bid(row),
      prevSiblingId: bid(siblings[i - 1]?.id ?? null),
      nextSiblingId: bid(siblings[i + 1]?.id ?? null),
      firstChildId: bid(`${id}#i`),
      lastChildId: bid(`${id}#i`),
      inlineContent: null,
    }),
  };
}

export { liveMarks };


/**
 * The block position at `Y.Text` index `index` of `piece` (a resolved
 * `RelativePosition`): the owner of the unit just before that point, offset past
 * it. A point directly after a boundary item is offset 0 of the region after it
 * (the next paragraph, or `(obj, 0)` before an object).
 */
export function positionAtPieceIndex(ctx: ReadCtx, piece: Y.Text, index: number): { id: string; offset: number } | null {
  let before: Y.Item | null = null;
  let inner = 0;
  let pos = 0;
  for (let it = piece._start; it !== null; it = it.right) {
    if (it.deleted || !it.countable) continue;
    if (pos + it.length >= index) {
      if (index > pos) {
        before = it;
        inner = index - pos;
      }
      break;
    }
    pos += it.length;
    before = it;
    inner = it.length;
  }
  if (index === 0) before = null;
  const holder = flowOwnerId(topFlowOfPiece(piece));
  if (holder === null) return null;
  let unit: Y.Item | null;
  if (before === null) {
    const first = piece._start;
    unit = first === null ? null : prevU(ctx, first);
    if (first === null) return gapAfter(ctx, null, holder);
  } else if (isSubflowItem(before)) {
    const pieces = subflowPieces(before);
    const last = pieces === null ? null : lastUnitOfFlow(pieces);
    unit = last ?? before;
  } else {
    unit = before;
  }
  // Skip back over tombstones / formats to the unit that decides the gap.
  while (unit !== null && eff(ctx, unit) === null && clen(ctx, unit) === 0) unit = prevU(ctx, unit);
  if (unit === null) return gapAfter(ctx, null, holder);
  const e = eff(ctx, unit);
  if (e !== null) return gapAfter(ctx, e, holderOfItem(unit) ?? holder);
  const o = ownerOfUnit(ctx, unit);
  if (o === null) return null;
  const add = unit === before ? Math.min(inner, clen(ctx, unit)) : clen(ctx, unit);
  return { id: o.id, offset: o.offset + add };
}

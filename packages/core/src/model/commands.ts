/**
 * Single-user commands as Plans (r7 §5, with review-r7 G1, G4–G6, G8 applied), part 1:
 * text, Enter, Backspace / Delete, range delete, marks, paragraph attrs. Inserts of
 * objects, stories, markers and paste are in `commands-insert.ts`.
 *
 * Every command reads ONE version and returns a {@link Plan} (or null: nothing to
 * do); it throws only on invalid arguments. Commands keep W1 (text is ¶-terminated)
 * and W2 (a block object is followed by a ¶-paragraph); they write only the edited
 * paragraphs and the items they create or delete.
 *
 * Shared rules:
 *   - JOIN (C3, C7, C8, C9): when a ¶ between two paragraphs is deleted, the
 *     surviving ¶ (the later paragraph's) takes the FIRST paragraph's `p:*` / `m:*`
 *     (G8, Google Docs) — unless the first is left an EMPTY DEFAULT paragraph (no
 *     text kept, plain type, no attrs): then the survivor keeps its own (today's
 *     `joinWithNext`). `t:*` tags are never moved.
 *   - X2: a command that needs a debris paragraph's ¶ first inserts that ¶.
 *   - Deletions never remove inert storage at a range's edges (`pointBefore` /
 *     `pointAfter`), and never remove a flow container or sub-flow item.
 */
import type * as Y from "yjs";
import type { Block, BlockId, InlineItem, ReadonlyAttrs } from "./block";
import { BLOCK_TYPES, EMBED_TYPES, valueEqual } from "./block";
import type { Document, FlowState } from "./derive";
import { resolveBlock } from "./document";
import { mapPosition } from "./mapping";
import type { Plan, Write, InsertUnit } from "./plan";
import {
  type ModelPosition,
  type ModelSelection,
  type ParagraphLayout,
  type PositionOptions,
  type StoragePoint,
  atomicUnitAround,
  caretAt,
  comparePoints,
  followingOf,
  graphemeStepAt,
  isFloat,
  itemAt,
  paragraphBefore,
  paragraphLayout,
  pointAfter,
  pointBefore,
  position,
  objectsStart,
  resolveOffset,
  textNeighbours,
  itemBefore,
  prevItem,
  nextItem,
} from "./position";
import { isWriteScalar, newParagraphMark, typeId, type Scalar } from "./storage";
import { RESERVED_TYPES } from "./derive";

export interface CommandOptions extends PositionOptions {
  /** Typing at a mark's edge extends it (default: every mark; atomic marks never). */
  readonly isInclusiveMark?: (key: string) => boolean;
  /** C2 next-style: the type a paragraph split at its END gives the new paragraph (default: heading → paragraph). */
  readonly nextStyle?: (type: string) => string | undefined;
  /** Paragraph attrs that belong to one paragraph and are never copied by a split (default: `listCounterOverride`). */
  readonly oneShotAttrs?: ReadonlySet<string>;
}

export interface CommandContext {
  readonly version: Document;
  readonly selection: ModelSelection;
  readonly options?: CommandOptions;
}

const DEFAULT_ONE_SHOT: ReadonlySet<string> = new Set(["listCounterOverride"]);
const defaultNextStyle = (type: string): string | undefined => (type === "heading" ? BLOCK_TYPES.paragraph : undefined);

/** Paragraph types a `p:type` write may not name (they read as "paragraph", R1). */
export const RESERVED_PARAGRAPH_TYPES: ReadonlySet<string> = RESERVED_TYPES;

// ---------------------------------------------------------------------------
// Positions and ranges
// ---------------------------------------------------------------------------

/** A resolved position with its paragraph's layout. */
export interface At {
  readonly L: ParagraphLayout;
  readonly offset: number;
  /** A leading endpoint (see `ModelPosition.leading`), resolved: objects do precede the paragraph. */
  readonly leading?: boolean;
}

export function atOf(ctx: CommandContext, pos: ModelPosition): At | null {
  const L = paragraphLayout(ctx.version, pos.blockId);
  if (L === null) return null;
  const offset = resolveOffset(L, pos.offset, ctx.options);
  return { L, offset, leading: pos.leading === true && offset === 0 && objectsStart(L) !== null };
}

export interface Range {
  readonly start: At;
  readonly end: At;
  readonly collapsed: boolean;
}

/** The selection, resolved and ordered; null when an end is not a position or the ends are in different flows (cross-context: refused, as today). */
export function rangeOf(ctx: CommandContext): Range | null {
  const { anchor, focus } = ctx.selection;
  const a = atOf(ctx, anchor);
  if (a !== null && anchor.blockId === focus.blockId && anchor.offset === focus.offset && anchor.leading === focus.leading) return { start: a, end: a, collapsed: true };
  const f = atOf(ctx, focus);
  if (a === null || f === null || a.L.fs !== f.L.fs) return null;
  const pa = startPoint(a);
  const pf = startPoint(f);
  if (pa === null || pf === null) return { start: a, end: a, collapsed: true };
  const c = comparePoints(pa, pf) || a.offset - f.offset;
  const same = a.L.block.id === f.L.block.id && a.offset === f.offset && a.leading === f.leading;
  return c <= 0 ? { start: a, end: f, collapsed: same } : { start: f, end: a, collapsed: same };
}

/** Where an endpoint sits in storage: before the preceding objects for a leading one. */
const startPoint = (a: At): StoragePoint | null => (a.leading === true ? objectsStart(a.L) : pointAfter(a.L, a.offset));

export const posOf = (a: At): ModelPosition => position(a.L.block.id, a.offset);

/** Map the plan's selection into the version after it (deletes / ¶ inserts only — see `mapping.ts`). */
export function mappedSelection(base: Document, sel: ModelSelection, after: Document): ModelSelection {
  const m = (p: ModelPosition, assoc: -1 | 1): ModelPosition => mapPosition(base, after, p, assoc).position ?? p;
  return { anchor: m(sel.anchor, -1), focus: m(sel.focus, -1) };
}

export function plan(base: Document, writes: readonly Write[], selection: (after: Document) => ModelSelection): Plan {
  return { base, writes, selection };
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Flat `p:*` / `m:*` keys. */
export type Keys = Record<string, Scalar>;

const scalar = (v: unknown): Scalar | undefined => (isWriteScalar(v) ? v : undefined);

/** A paragraph's ¶ keys as the version reads them (a debris / R17 paragraph has none). */
export function keysOf(L: ParagraphLayout): Keys {
  const out: Keys = {};
  if (L.mark === null) return out;
  if (L.block.type !== BLOCK_TYPES.paragraph) out["p:type"] = L.block.type;
  for (const [k, v] of Object.entries(L.block.attrs)) {
    const s = scalar(v);
    if (s !== undefined) out[`p:${k}`] = s;
  }
  for (const [k, v] of Object.entries(L.block.markAttrs ?? {})) {
    const s = scalar(v);
    if (s !== undefined) out[`m:${k}`] = s;
  }
  return out;
}

/** The writes turning keys `from` into `to` (p:* / m:* only). */
export function diffKeys(from: Keys, to: Keys): Record<string, Scalar | undefined> {
  const out: Record<string, Scalar | undefined> = {};
  for (const k of Object.keys(from)) if (!(k in to)) out[k] = undefined;
  for (const [k, v] of Object.entries(to)) if (from[k] !== v) out[k] = v;
  return out;
}

const pKeys = (k: Keys): Keys => Object.fromEntries(Object.entries(k).filter(([key]) => key.startsWith("p:")));
const mKeys = (k: Keys): Keys => Object.fromEntries(Object.entries(k).filter(([key]) => key.startsWith("m:")));

/** JOIN: the keys the surviving ¶ takes, or null when it keeps its own (the first paragraph is left an empty default paragraph). */
export function joinKeys(start: At): Keys | null {
  const b = start.L.block;
  const wins = start.offset > 0 || b.type !== BLOCK_TYPES.paragraph || Object.keys(b.attrs).length > 0;
  return wins ? keysOf(start.L) : null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export const insertAt = (p: StoragePoint, units: readonly InsertUnit[]): Write => ({ k: "insert", piece: p.piece, index: p.index, units });

export function keysWrite(map: Y.Map<unknown>, keys: Record<string, Scalar | undefined>): Write[] {
  return Object.keys(keys).length === 0 ? [] : [{ k: "keys", map, keys }];
}

/** Delete storage `[a, b)` of one flow, per segment (sub-flow items between segments are kept). */
export function deleteBetween(fs: FlowState, a: StoragePoint, b: StoragePoint): Write[] {
  if (comparePoints(a, b) >= 0) return [];
  const out: Write[] = [];
  for (let j = a.seg; j <= b.seg; j++) {
    const seg = fs.segments[j];
    if (seg === undefined) continue;
    const from = j === a.seg ? a.index : seg.start;
    const to = j === b.seg ? b.index : seg.start + seg.len;
    if (to > from) out.push({ k: "delete", piece: seg.piece, index: from, len: to - from });
  }
  return out;
}

/**
 * X2: the writes inserting a ¶ (with `keys`) at the end of debris / R17 paragraph `L`,
 * and the new map. Null when the flow cannot be written (a holder without a flow).
 */
export function materialize(L: ParagraphLayout, keys: Keys, before: readonly InsertUnit[] = []): { writes: Write[]; map: Y.Map<unknown> } | null {
  const map = newParagraphMark(keys);
  const units: InsertUnit[] = [...before, { embed: map, attrs: {} }];
  const p = pointAfter(L, L.length);
  if (p !== null) return { writes: [insertAt(p, units)], map };
  return L.fs.array === null ? null : { writes: [{ k: "firstPiece", flow: L.fs.array, units }], map };
}

/** The id a materialized / surviving ¶ reads as after Apply. */
const idAfter = (map: Y.Map<unknown>, fallback: BlockId): BlockId => typeId(map) ?? fallback;

export interface Deletion {
  readonly writes: Write[];
  /** The surviving paragraph's id after Apply. */
  readonly survivor: () => BlockId;
  /** Where the deletion starts: the insertion point for what replaces the range. */
  readonly at: StoragePoint;
}

/**
 * C9: delete everything from `start` to `end` (one flow, start ≤ end). Block objects,
 * `[S]` and whole rule paragraphs inside are taken whole; the end paragraph's ¶
 * survives with the JOIN keys (or `tailKeys`, when given, overriding them).
 * From a leading `start` it also takes the block objects before its paragraph.
 */
export function deleteRange(start: At, end: At, tailKeys?: Keys): Deletion | null {
  // A range from a leading endpoint also takes the block objects before the paragraph (C9).
  const a = (start.leading === true ? objectsStart(start.L) : null) ?? pointBefore(start.L, start.offset);
  const b = pointAfter(end.L, end.offset);
  if (a === null || b === null) return null;
  const writes = deleteBetween(start.L.fs, a, b);
  const join = start.L.block.id !== end.L.block.id;
  const target = tailKeys ?? (join ? joinKeys(start) : null);
  if (end.L.mark !== null) {
    if (target !== null) writes.push(...keysWrite(end.L.mark, diffKeys(keysOf(end.L), target)));
    const id = end.L.block.id;
    return { writes, survivor: () => id, at: a };
  }
  if (!join && tailKeys === undefined) {
    const id = end.L.block.id;
    return { writes, survivor: () => id, at: a };
  }
  // The end paragraph is debris: give it a ¶ (X2) carrying the joined keys.
  const m = materialize(end.L, target ?? {});
  if (m === null) return null;
  writes.push(...m.writes);
  const fallback = end.L.block.id;
  return { writes, survivor: () => idAfter(m.map, fallback), at: a };
}

// ---------------------------------------------------------------------------
// Typing attrs
// ---------------------------------------------------------------------------

const isInclusive = (k: string, opts: CommandOptions): boolean => opts.isAtomicMark?.(k) !== true && opts.isInclusiveMark?.(k) !== false;

/**
 * The formatting typed text takes at a caret `offset` (today's `inheritedAttrsAt`):
 * the text item before it (at the start: after it; embeds skipped), else the ¶'s
 * mark props. Atomic marks are never extended; a NON-inclusive mark is kept only
 * strictly inside its range (the same value on both sides), never at its edge.
 */
export function typingAttrs(L: ParagraphLayout, offset: number, opts: CommandOptions = {}): ReadonlyAttrs {
  const { before, after } = textNeighbours(L, offset);
  const base = before ?? after;
  if (base === null) return Object.fromEntries(Object.entries(L.block.markAttrs ?? {}).filter(([k]) => opts.isAtomicMark?.(k) !== true));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base.item.attrs)) {
    if (opts.isAtomicMark?.(k) === true) continue;
    if (opts.isInclusiveMark?.(k) === false) {
      if (before === null || after === null) continue;
      if (before !== after && !valueEqual(after.item.attrs[k], v)) continue;
    }
    out[k] = v;
  }
  return out;
}

/** The formatting text typed OVER a selection starting at `offset` takes: the first selected character's, minus atomic marks (today's `typeOverAttrs`). */
export function typeOverAttrs(L: ParagraphLayout, offset: number, opts: CommandOptions = {}): ReadonlyAttrs {
  const { after } = textNeighbours(L, offset);
  if (after === null) return typingAttrs(L, offset, opts);
  return Object.fromEntries(Object.entries(after.item.attrs).filter(([k]) => opts.isAtomicMark?.(k) !== true));
}

/** The ¶-mark keys (`m:*`) typing `attrs` at a paragraph's end gives its ¶: the inclusive ones (today's `writeTypedMarkAttrs`). */
function typedMarkKeys(attrs: ReadonlyAttrs, opts: CommandOptions): Keys {
  const out: Keys = {};
  for (const [k, v] of Object.entries(attrs)) {
    const s = scalar(v);
    if (s !== undefined && s !== null && isInclusive(k, opts)) out[`m:${k}`] = s;
  }
  return out;
}

// ---------------------------------------------------------------------------
// C1 / C11 core: replace the selection with inline units
// ---------------------------------------------------------------------------

/**
 * Replace the selection with `units` (type-over deletes the range first, C9);
 * caret after them. `units` receive `attrs` when they carry none of their own.
 */
export function replaceSelection(ctx: CommandContext, make: (attrs: ReadonlyAttrs) => readonly InsertUnit[], caretAfter?: (after: Document) => ModelSelection | null): Plan | null {
  const r = rangeOf(ctx);
  if (r === null) return null;
  const { start, end } = r;
  const opts = ctx.options ?? {};
  const typed = r.collapsed ? typingAttrs(start.L, start.offset, opts) : typeOverAttrs(start.L, start.offset, opts);
  const units = make(typed);
  let len = 0;
  for (const u of units) len += "text" in u ? u.text.length : 1;
  const p = pointAfter(start.L, start.offset);
  if (p === null || start.L.fs.synthetic) {
    // R17 (an empty holder): the content goes in with its ¶ (and the flow's first piece when it has none).
    const m = materialize(start.L, {}, units);
    if (m === null) return null;
    return plan(ctx.version, m.writes, (after) => caretAfter?.(after) ?? caretAt(idAfter(m.map, start.L.block.id), len));
  }
  const writes: Write[] = [];
  let survivor: () => BlockId = () => start.L.block.id;
  let joined: Keys | null = null;
  let ins: StoragePoint = p;
  if (!r.collapsed) {
    const del = deleteRange(start, end);
    if (del === null) return null;
    writes.push(...del.writes);
    survivor = del.survivor;
    if (comparePoints(del.at, p) < 0) ins = del.at; // the range took leading objects
    if (start.L.block.id !== end.L.block.id) joined = joinKeys(start);
  }
  writes.push(insertAt(ins, units));
  // Typing at the paragraph's end gives its ¶ the typed run's inclusive formatting (today's insert-text).
  const last = units[units.length - 1];
  if (end.offset === end.L.length && end.L.mark !== null && last !== undefined && "text" in last && units.every((u) => "text" in u)) {
    const from: Keys = { ...mKeys(keysOf(end.L)), ...mKeys(joined ?? {}) };
    const to = typedMarkKeys(last.attrs, opts);
    const diff: Record<string, Scalar | undefined> = {};
    for (const k of Object.keys(from)) if (!(k in to)) diff[k] = undefined;
    for (const [k, v] of Object.entries(to)) if (from[k] !== v || joined !== null) diff[k] = v;
    writes.push(...keysWrite(end.L.mark, diff));
  }
  const offset = start.offset + len;
  return plan(ctx.version, writes, (after) => caretAfter?.(after) ?? caretAt(survivor(), offset));
}

/** C1: type `text` (with `attrs`, default the typing attrs) over the selection. */
export function insertText(ctx: CommandContext, text: string, attrs?: ReadonlyAttrs): Plan | null {
  if (text === "") return null;
  const exact = attrs === undefined ? undefined : checkScalars(attrs, "text attr");
  return replaceSelection(ctx, (typing) => [{ text, attrs: exact ?? typing }]);
}

// ---------------------------------------------------------------------------
// C2 Enter
// ---------------------------------------------------------------------------

/** C2's keys for a split of a paragraph with keys `K` at `k` of `n` units. */
export function splitKeys(K: Keys, type: string, k: number, n: number, L: ParagraphLayout, opts: CommandOptions = {}): { head: Keys; tail: Keys } {
  const oneShot = opts.oneShotAttrs ?? DEFAULT_ONE_SHOT;
  const without = Object.fromEntries(Object.entries(pKeys(K)).filter(([key]) => !oneShot.has(key.slice(2))));
  // One-shot attrs follow the content: they stay on the tail only at k = 0 of a non-empty paragraph.
  const stays = k === 0 && n > 0;
  const headP = stays ? without : pKeys(K);
  const next = k === n ? (opts.nextStyle ?? defaultNextStyle)(type) : undefined;
  const tailP: Keys = next !== undefined ? (next === BLOCK_TYPES.paragraph ? {} : { "p:type": next }) : stays ? pKeys(K) : without;
  let headM: Keys = mKeys(K);
  if (n > 0) {
    headM = {};
    const src = caretTextAttrs(L, k);
    for (const [key, v] of Object.entries(src)) {
      const s = scalar(v);
      if (s !== undefined && opts.isAtomicMark?.(key) !== true && opts.isInclusiveMark?.(key) !== false) headM[`m:${key}`] = s;
    }
  }
  return { head: { ...headP, ...headM }, tail: { ...tailP, ...mKeys(K) } };
}

/** The formatting of the text item before `k` (at the start: after it), as today's split takes for the head's ¶ props. */
function caretTextAttrs(L: ParagraphLayout, k: number): ReadonlyAttrs {
  const { before, after } = textNeighbours(L, k);
  return (k > 0 ? (before ?? after) : (after ?? before))?.item.attrs ?? {};
}

/** Exit a list (Enter on an empty item, Backspace at an item's start): outdent one level, or at level 0 become a paragraph. */
function listExit(ctx: CommandContext, L: ParagraphLayout, sel: ModelSelection): Plan | null {
  if (L.mark === null) return null;
  const raw = L.block.attrs["listLevel"];
  const level = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0;
  const keys: Record<string, Scalar | undefined> =
    level > 0 ? { "p:listLevel": level - 1 } : { "p:type": undefined, "p:listId": undefined, "p:listLevel": undefined, "p:listCounterOverride": undefined };
  return plan(ctx.version, keysWrite(L.mark, keys), () => sel);
}

const isListItem = (b: Block): boolean => b.type === "list-item";

/**
 * The writes splitting the paragraph at `at` (the C2 shape: ¶N inserted at the
 * split, before `extra` units), `deletion` first when the selection was a range.
 * Shared by Enter, TOC / section-break inserts and paste.
 */
export function splitWrites(ctx: CommandContext, r: Range, extra: readonly InsertUnit[] = []): { writes: Write[]; tail: () => BlockId; head: Y.Map<unknown> } | null {
  const { start, end } = r;
  const p = pointAfter(start.L, start.offset);
  if (p === null) return null;
  // The paragraph being split: the start paragraph joined with the end's tail.
  const join = start.L.block.id !== end.L.block.id;
  const winner = join && joinKeys(start) === null ? end.L : start.L;
  const K = keysOf(winner);
  const n = start.offset + (end.L.length - end.offset);
  const { head, tail } = splitKeys(K, winner.block.type, start.offset, n, start.L, ctx.options);
  const headMark = newParagraphMark(head);
  const writes: Write[] = [];
  let tailId: () => BlockId;
  let ins: StoragePoint = p;
  if (!r.collapsed) {
    const del = deleteRange(start, end, tail);
    if (del === null) return null;
    writes.push(...del.writes);
    tailId = del.survivor;
    if (comparePoints(del.at, p) < 0) ins = del.at;
  } else if (end.L.mark !== null) {
    writes.push(...keysWrite(end.L.mark, diffKeys(keysOf(end.L), tail)));
    const id = end.L.block.id;
    tailId = () => id;
  } else {
    // X2: Enter in debris gives the tail its ¶.
    const m = materialize(end.L, tail);
    if (m === null) return null;
    writes.push(...m.writes);
    const fallback = end.L.block.id;
    tailId = () => idAfter(m.map, fallback);
  }
  // ¶N first: when the materialized tail ¶ lands at the same index, plan order puts ¶N before it.
  writes.unshift(insertAt(ins, [{ embed: headMark, attrs: {} }, ...extra]));
  return { writes, tail: tailId, head: headMark };
}

/**
 * C2 Enter. A range is deleted first. On an empty list item it exits the list (today).
 * Caret: the start of the tail, which keeps the paragraph's ¶ and id.
 * E2 (Enter at the start of a leading table's first cell) is P2: tables are not in the model yet.
 */
export function splitParagraph(ctx: CommandContext): Plan | null {
  const r = rangeOf(ctx);
  if (r === null) return null;
  if (r.collapsed && isListItem(r.start.L.block) && r.start.L.length === 0) return listExit(ctx, r.start.L, ctx.selection);
  const s = splitWrites(ctx, r);
  if (s === null) return null;
  return plan(ctx.version, s.writes, () => caretAt(s.tail(), 0));
}

// ---------------------------------------------------------------------------
// Backspace / Delete (C3, C4, C4f, C4r, C6, C7, C8, C9)
// ---------------------------------------------------------------------------

/** A rule paragraph: a ¶ paragraph whose only content is one `[hr]`. */
export function isRuleParagraph(L: ParagraphLayout): boolean {
  const items = L.block.inlineContent?.items ?? [];
  const only = items[0];
  return L.mark !== null && items.length === 1 && only !== undefined && only.kind === "embed" && only.embedType === EMBED_TYPES.horizontalLine;
}

/** Caret steps skip these: markers (no caret stop) and floats (C4f). */
const skippable = (i: InlineItem | undefined): boolean => i !== undefined && i.kind === "embed" && (i.embedType === EMBED_TYPES.marker || isFloat(i));

/** The unit Backspace (dir −1) / Delete (+1) at `offset` removes: a grapheme of the text item, or one embed; atomic marks widen it (R14). Null when only skippables remain. Walks items outward from `offset` only. */
function unitToDelete(L: ParagraphLayout, offset: number, dir: -1 | 1, opts: CommandOptions): { from: number; to: number } | null {
  let ref = dir < 0 ? itemBefore(L, offset) : itemAt(L, offset);
  let o = offset;
  while (ref !== null && skippable(ref.item)) {
    o = dir < 0 ? ref.start : ref.start + 1;
    ref = dir < 0 ? prevItem(L, ref) : nextItem(L, ref);
  }
  if (ref === null) return null;
  let from: number;
  let to: number;
  if (ref.item.kind === "text") {
    if (dir < 0) {
      to = o;
      from = graphemeStepAt(L, o, -1);
    } else {
      from = o;
      to = graphemeStepAt(L, o, 1);
    }
  } else {
    from = ref.start;
    to = ref.start + 1;
  }
  const isAtomic = opts.isAtomicMark;
  if (isAtomic !== undefined) {
    from = atomicUnitAround(L, from, isAtomic)?.start ?? from;
    to = atomicUnitAround(L, to, isAtomic)?.end ?? to;
  }
  return { from, to };
}

/** Delete storage of read units `[from, to)` of one paragraph. */
function deleteUnits(L: ParagraphLayout, from: number, to: number): Write[] {
  const a = pointBefore(L, from);
  const b = pointAfter(L, to);
  return a === null || b === null ? [] : deleteBetween(L.fs, a, b);
}

/** C4r: delete rule paragraph R (`[hr]` and ¶M), or only its `[hr]` when ¶M must stay (W2 / before `[S]` / the flow's final ¶). */
function deleteRule(d: Document, R: ParagraphLayout): Write[] {
  if (R.end === null) return [];
  const before = R.before?.token.k;
  const next = followingOf(d, R.fs, R.end).k;
  // ¶M stays only where removing it would leave nothing after: before [S], at the flow end, or a TOC left without a paragraph.
  const keepMark = next === "S" || next === "end" || (before === "toc" && next !== "para");
  const a = pointBefore(R, 0);
  const seg = R.fs.segments[R.end.seg];
  if (a === null || seg === undefined) return [];
  const b: StoragePoint = keepMark ? { piece: seg.piece, index: R.end.index, seg: R.end.seg } : { piece: seg.piece, index: R.end.index + 1, seg: R.end.seg };
  return deleteBetween(R.fs, a, b);
}

const deleteTerminator = (fs: FlowState, t: { seg: number; index: number }): Write[] => {
  const seg = fs.segments[t.seg];
  return seg === undefined ? [] : [{ k: "delete", piece: seg.piece, index: t.index, len: 1 }];
};

/** Backspace / Delete over a range: C9. A selected `[hr]` (a rule's object selection) is a character like any other: only it goes. */
function deleteSelectionOf(ctx: CommandContext, r: Range): Plan | null {
  const del = deleteRange(r.start, r.end);
  if (del === null || del.writes.length === 0) return null;
  const offset = r.start.offset;
  return plan(ctx.version, del.writes, () => caretAt(del.survivor(), offset));
}

/** C9: delete the selection (cut / type-over without text). */
export function deleteSelection(ctx: CommandContext): Plan | null {
  const r = rangeOf(ctx);
  if (r === null || r.collapsed) return null;
  return deleteSelectionOf(ctx, r);
}

/**
 * Backspace. Range → C9. Mid-paragraph: the grapheme / embed before the caret
 * (C4 — an inline image or `[hr]` is one character, G5; floats and markers are
 * stepped over, C4f). At the paragraph start: a list item exits the list; after a
 * rule paragraph C4r; after a TOC C6; after `[S]` C7; else the C3 join.
 */
export function deleteBackward(ctx: CommandContext): Plan | null {
  const r = rangeOf(ctx);
  if (r === null) return null;
  if (!r.collapsed) return deleteSelectionOf(ctx, r);
  const { L, offset } = r.start;
  const d = ctx.version;
  const u = unitToDelete(L, offset, -1, ctx.options ?? {});
  if (u !== null) {
    const writes = deleteUnits(L, u.from, u.to);
    const id = L.block.id;
    const back = offset - u.from;
    return writes.length === 0 ? null : plan(d, writes, () => caretAt(id, offset - back));
  }
  if (isListItem(L.block)) return listExit(ctx, L, ctx.selection);
  const before = L.before;
  if (before === null) return null; // the flow's first position
  const here = L.block.id;
  if (before.token.k === "toc") {
    // C6: delete the TOC (today's delete-adjacent-atomic-leaf).
    return plan(d, deleteTerminator(L.fs, before), () => caretAt(here, offset));
  }
  // C5 (a table before the paragraph) arrives with tables in P2.
  const X = before.token.k === "para" ? paragraphLayout(d, before.token.id) : paragraphBefore(d, L.fs, before);
  if (before.token.k === "para" && X !== null && isRuleParagraph(X)) {
    const writes = deleteRule(d, X);
    return writes.length === 0 ? null : plan(d, writes, () => caretAt(here, offset));
  }
  if (X === null) {
    // C7 with no paragraph before the [S] (Q1's [S][S], or an object): delete only the [S].
    return before.token.k === "S" ? plan(d, deleteTerminator(L.fs, before), () => caretAt(here, offset)) : null;
  }
  // C3 / C7: the join — delete ¶X (and the [S] after it); skipped markers / floats before the caret stay.
  const del = deleteRange({ L: X, offset: X.length }, { L, offset: 0 });
  if (del === null) return null;
  const shift = X.length;
  return plan(d, del.writes, () => caretAt(del.survivor(), shift + offset));
}

/**
 * Delete (forward): the mirror of Backspace (C8). At the end of a paragraph: the
 * next rule paragraph goes (C4r), a TOC goes (C6), `[S]` is joined across — except
 * when a block object or another `[S]` follows the `[S]` (the C8 correction): then
 * only the `[S]` goes. At the flow's final ¶: nothing.
 */
export function deleteForward(ctx: CommandContext): Plan | null {
  const r = rangeOf(ctx);
  if (r === null) return null;
  if (!r.collapsed) return deleteSelectionOf(ctx, r);
  const { L, offset } = r.start;
  const d = ctx.version;
  const u = unitToDelete(L, offset, 1, ctx.options ?? {});
  const here = L.block.id;
  if (u !== null) {
    const writes = deleteUnits(L, u.from, u.to);
    return writes.length === 0 ? null : plan(d, writes, () => caretAt(here, offset));
  }
  const end = L.end;
  if (end === null) return null;
  if (end.token.k !== "para") return plan(d, deleteTerminator(L.fs, end), () => caretAt(here, offset)); // debris: the object / [S] after it
  const next = followingOf(d, L.fs, end);
  if (next.k === "end") return null;
  if (next.k === "toc") return plan(d, deleteTerminator(L.fs, next.term), () => caretAt(here, offset));
  let N: ParagraphLayout;
  if (next.k === "S") {
    const after = followingOf(d, L.fs, next.term);
    if (after.k !== "para") return plan(d, deleteTerminator(L.fs, next.term), () => caretAt(here, offset));
    N = after.L;
  } else if (next.k === "para") {
    N = next.L;
    if (isRuleParagraph(N)) {
      const writes = deleteRule(d, N);
      return writes.length === 0 ? null : plan(d, writes, () => caretAt(here, offset));
    }
  } else return null;
  const del = deleteRange({ L, offset: L.length }, { L: N, offset: 0 });
  if (del === null) return null;
  return plan(d, del.writes, () => caretAt(del.survivor(), offset));
}

// ---------------------------------------------------------------------------
// Marks and paragraph attrs (C16)
// ---------------------------------------------------------------------------

export function checkScalars(attrs: Readonly<Record<string, unknown>>, what: string): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "") throw new Error(`model: ${what} with an empty key`);
    const s = scalar(v);
    if (s === undefined || !isWriteScalar(v)) throw new Error(`model: ${what} ${k} must be null, a string, a finite number or a boolean`);
    out[k] = s;
  }
  return out;
}

/** Inline formatting over the selection: `attrs` values set (null removes). A caret has no stored marks in the model (an editor concern). */
export function setMarks(ctx: CommandContext, attrs: Readonly<Record<string, Scalar>>): Plan | null {
  const values = checkScalars(attrs, "mark");
  const r = rangeOf(ctx);
  if (r === null || r.collapsed || Object.keys(values).length === 0) return null;
  const a = pointBefore(r.start.L, r.start.offset);
  const b = pointAfter(r.end.L, r.end.offset);
  if (a === null || b === null) return null;
  const writes: Write[] = deleteBetween(r.start.L.fs, a, b).map((w) => (w.k === "delete" ? { k: "format", piece: w.piece, index: w.index, len: w.len, attrs: values } : w));
  // The ¶s: one the range covers, or the end paragraph's when the range ends at its end with
  // content selected, merges the inclusive values into its mark props (today's apply-attrs).
  const opts = ctx.options ?? {};
  const mark: Record<string, Scalar | undefined> = {};
  for (const [k, v] of Object.entries(values)) if (isInclusive(k, opts)) mark[`m:${k}`] = v ?? undefined;
  const endId = r.end.L.block.id;
  const endSelected = r.end.offset === r.end.L.length && (r.start.L.block.id === endId ? r.start.offset < r.end.offset : r.end.offset > 0);
  if (Object.keys(mark).length > 0) {
    for (const L of paragraphsBetween(ctx.version, r.start.L.block.id, endId)) {
      if (L.mark === null || (L.block.id === endId && !endSelected)) continue;
      const cur = keysOf(L);
      const diff: Record<string, Scalar | undefined> = {};
      for (const [k, v] of Object.entries(mark)) if (cur[k] !== v && !(v === undefined && !(k in cur))) diff[k] = v;
      writes.push(...keysWrite(L.mark, diff));
    }
  }
  if (writes.length === 0) return null;
  const sel = ctx.selection;
  return plan(ctx.version, writes, () => sel);
}

/** The paragraphs from `startId` to `endId` in reading order (block objects skipped). */
function* paragraphsBetween(d: Document, startId: BlockId, endId: BlockId): Generator<ParagraphLayout> {
  let b = resolveBlock(d, startId);
  while (b !== null) {
    const L = paragraphLayout(d, b.block.id);
    if (L !== null) yield L;
    if (b.block.id === endId) return;
    let nextId = b.block.nextSiblingId;
    if (nextId === null && b.kind === "block" && b.block.parentId !== null) {
      // Across a section boundary: the next non-empty section's first child.
      for (let s = resolveBlock(d, b.block.parentId)?.block.nextSiblingId ?? null; s !== null && nextId === null; ) {
        const sec = resolveBlock(d, s)?.block;
        nextId = sec?.firstChildId ?? null;
        s = sec?.nextSiblingId ?? null;
      }
    }
    b = nextId === null ? null : resolveBlock(d, nextId);
  }
}

/**
 * C16: write paragraph attrs on every paragraph of the selection (`type` → `p:type`;
 * null / undefined removes the key). A debris paragraph is materialized first (X2).
 */
export function setParagraphAttrs(ctx: CommandContext, attrs: Readonly<Record<string, Scalar | undefined>>): Plan | null {
  const keys: Record<string, Scalar | undefined> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "") throw new Error("model: paragraph attr with an empty key");
    if (v !== undefined && !isWriteScalar(v)) throw new Error(`model: paragraph attr ${k} must be null, a string, a finite number or a boolean`);
    if (k === "type" && v !== undefined && v !== null && (typeof v !== "string" || v === "" || RESERVED_PARAGRAPH_TYPES.has(v))) {
      throw new Error(`model: ${String(v)} is not a paragraph type`);
    }
    keys[`p:${k}`] = v === null || (k === "type" && v === BLOCK_TYPES.paragraph) ? undefined : v;
  }
  const r = rangeOf(ctx);
  if (r === null || Object.keys(keys).length === 0) return null;
  const writes: Write[] = [];
  for (const L of paragraphsBetween(ctx.version, r.start.L.block.id, r.end.L.block.id)) {
    if (L.mark !== null) {
      const cur = keysOf(L);
      const target: Keys = { ...cur };
      for (const [k, v] of Object.entries(keys)) {
        if (v === undefined) delete target[k];
        else target[k] = v;
      }
      writes.push(...keysWrite(L.mark, diffKeys(cur, target)));
      continue;
    }
    const fresh: Keys = {};
    for (const [k, v] of Object.entries(keys)) if (v !== undefined) fresh[k] = v;
    if (Object.keys(fresh).length === 0) continue;
    const m = materialize(L, fresh);
    if (m !== null) writes.push(...m.writes);
  }
  if (writes.length === 0) return null;
  const base = ctx.version;
  const sel = ctx.selection;
  return plan(base, writes, (after) => mappedSelection(base, sel, after));
}


// ---------------------------------------------------------------------------
// Selections that start at a leading endpoint
// ---------------------------------------------------------------------------

/** Select-all of a flow (default the body): from before any leading block objects to the end of its last paragraph. */
export function selectAll(d: Document, holderId: BlockId = d.rootId): ModelSelection | null {
  const fs = d.flows.get(holderId);
  if (fs === undefined) return null;
  const tree = d.trees[fs.tree];
  const containers = fs.isRoot ? fs.sections.map((s) => s.id) : [holderId];
  let first: BlockId | null = null;
  let last: BlockId | null = null;
  for (const c of containers) {
    for (let id = tree.get(c)?.firstChildId ?? null; id !== null; id = tree.get(id)?.nextSiblingId ?? null) {
      if (tree.get(id)?.inlineContent === null) continue;
      first ??= id;
      last = id;
    }
  }
  const L = last === null ? null : paragraphLayout(d, last);
  if (first === null || L === null) return null;
  return { anchor: { blockId: first, offset: 0, leading: true }, focus: position(L.block.id, L.length) };
}

/** A TOC's object selection: the range over the block objects directly before the paragraph after it. */
export function objectSelection(d: Document, tocId: BlockId): ModelSelection | null {
  const next = resolveBlock(d, tocId)?.block.nextSiblingId ?? null;
  let id = next;
  while (id !== null && resolveBlock(d, id)?.block.inlineContent === null) id = resolveBlock(d, id)?.block.nextSiblingId ?? null;
  if (id === null) return null;
  return { anchor: { blockId: id, offset: 0, leading: true }, focus: position(id, 0) };
}

/**
 * Piece scanning: a piece's items → TOKENS — content runs and terminators (¶,
 * block object, `[S]`). The read rules group tokens into paragraphs (`derive.ts`).
 *
 * Inline item read rules (all total; nothing is rewritten):
 *   - text carries the piece's formatting at its position (Yjs format items);
 *   - an `object` reads by its registered kind, else as a placeholder (R-obj,
 *     `object-kinds.ts`); `w` / `h` are kept only as finite numbers ≥ 0; a `wrap`
 *     outside left|right|break reads as inline;
 *   - a `marker` with a non-string `ns` / `id` or an `edge` outside start|end, an
 *     embed whose `k` is unknown, and any non-map embed are INERT: they occupy their
 *     storage index but read as nothing;
 *   - a sub-flow is read in place (its pieces' content continues the run), down to
 *     {@link SUBFLOW_DEPTH_CAP} (the write side's cap): a sub-flow item inside a piece
 *     at that depth is INERT, so a peer's arbitrarily deep nesting bounds the read;
 *   - a footnote anchor outside the main tree (in a footnote, header or footer body:
 *     Word / GDocs allow footnotes only in the body) is INERT, so footnote bodies nest
 *     at most one level.
 */
import * as Y from "yjs";
import type { EmbedItem, InlineItem, ReadonlyAttrs } from "./block";
import { EMBED_TYPES, attrsEqual } from "./block";
import { BODY_KEY, ITEM_KINDS, PIECES_KEY, SUBFLOW_DEPTH_CAP, childMap, itemId, kindOf, scalarsWithPrefix } from "./storage";
import { resolveObjectProps, type ObjectKindRegistry } from "./object-kinds";
import { footnoteBodyId } from "./ids";

export interface FootnoteRef {
  /** The anchor embed's item id; its body's root id is `${id}/body`. */
  readonly id: string;
  readonly body: Y.Map<unknown> | null;
}

export interface RunToken {
  readonly k: "run";
  /** Storage index units (Y.Text length) the run spans in its piece. */
  readonly len: number;
  readonly items: readonly InlineItem[];
  readonly footnotes: readonly FootnoteRef[];
  /**
   * Run-relative storage offsets (ascending) of the INERT units — storage that reads
   * as nothing. Read offset ↔ storage index within the run skips exactly these.
   */
  readonly inert: readonly number[];
}

const NO_INERT: readonly number[] = Object.freeze([]);

export type TerminatorKind = "para" | "toc" | "S";

export interface TerminatorToken {
  readonly k: TerminatorKind;
  readonly len: number;
  readonly id: string;
  readonly map: Y.Map<unknown>;
}

export type Token = RunToken | TerminatorToken;

/**
 * A SEGMENT: the tokens of `[start, start + len)` of one piece, a range holding no
 * sub-flow item. A flow reads as its segments in reading order: a piece holding
 * sub-flows splits into one segment per gap around its sub-flow items, and each
 * sub-flow's pieces' segments sit between them (X12, read in place). Every piece is
 * therefore scanned — and re-scanned on a delta — on its own.
 */
export interface Segment {
  readonly piece: Y.Text;
  /** Sub-flow depth of the piece (0 = top level). */
  readonly depth: number;
  /** Storage index of the segment's start in its piece. */
  readonly start: number;
  /** Storage index units the segment spans. */
  readonly len: number;
  readonly tokens: readonly Token[];
}

const isFiniteNonNegative = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const WRAPS: ReadonlySet<unknown> = new Set(["left", "right", "break"]);

/** What a flow's read depends on besides storage. */
export interface ScanCtx {
  readonly registry: ObjectKindRegistry;
  /** Footnote anchors are read (main tree only); otherwise they are inert. */
  readonly footnotes: boolean;
}

interface ScanState {
  readonly ctx: ScanCtx;
  /** Sub-flow items are inert (the piece is at the depth cap). */
  readonly inertSubs: boolean;
  readonly tokens: Token[];
  items: InlineItem[];
  footnotes: FootnoteRef[];
  inert: number[];
  runLen: number;
  hasRun: boolean;
}

function flushRun(st: ScanState): void {
  if (!st.hasRun) return;
  st.tokens.push({ k: "run", len: st.runLen, items: st.items, footnotes: st.footnotes, inert: st.inert.length === 0 ? NO_INERT : st.inert });
  st.items = [];
  st.footnotes = [];
  st.inert = [];
  st.runLen = 0;
  st.hasRun = false;
}

function pushItem(st: ScanState, item: InlineItem | null, len: number): void {
  st.hasRun = true;
  if (item === null) for (let i = 0; i < len; i++) st.inert.push(st.runLen + i);
  st.runLen += len;
  if (item === null) return;
  const last = st.items[st.items.length - 1];
  // The flag is read from the slice just taken (a Yjs string), never from the merged text.
  const joins = item.kind === "text" && joinsForwardAtEnd(item.text);
  if (item.kind === "text" && last !== undefined && last.kind === "text" && attrsEqual(last.attrs, item.attrs)) {
    const merged: InlineItem = { kind: "text", text: last.text + item.text, attrs: last.attrs };
    st.items[st.items.length - 1] = merged;
    if (joins) joinsForward.add(merged);
  } else {
    st.items.push(item);
    if (joins) joinsForward.add(item);
  }
}

// ---------------------------------------------------------------------------
// R15 at item edges: MAY a text item's last code point join a following simple code
// unit (U+0020..U+02FF) into one cluster — a Prepend (GB9b) or a ZWJ before an
// Extended_Pictographic such as © / ® (GB11)? Conservative: a true flag only routes the
// boundary check to the exact (segmenting) path. Recorded when the scan builds the
// item, from the slice of the Yjs string it takes — so a check reads a flag, not the
// (rope) text.
// ---------------------------------------------------------------------------

const joinsForward = new WeakSet<InlineItem>();
const mayJoinMemo = new Map<number, boolean>();
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const isOneCluster = (s: string): boolean => {
  let n = 0;
  for (const _seg of graphemeSegmenter.segment(s)) n++;
  return n === 1;
};

/** The code point may join a following simple code unit (per the engine's UAX #29). */
function mayJoinSimple(cp: number): boolean {
  let v = mayJoinMemo.get(cp);
  if (v === undefined) {
    const c = String.fromCodePoint(cp);
    v = isOneCluster(`${c}a`) || isOneCluster(`\u{1F469}${c}\u00A9`);
    mayJoinMemo.set(cp, v);
  }
  return v;
}

function joinsForwardAtEnd(text: string): boolean {
  const n = text.length;
  if (n === 0) return false;
  const last = text.charCodeAt(n - 1);
  if (last < 0x600) return false; // no Prepend or ZWJ below U+0600
  const cp = last >= 0xdc00 && last <= 0xdfff && n >= 2 ? (text.codePointAt(n - 2) ?? last) : last;
  return mayJoinSimple(cp);
}

/** Whether text item `item`'s last code point may join a following simple code unit (GB9b / GB11). */
export const endsJoiningForward = (item: InlineItem): boolean => joinsForward.has(item);

function objectEmbed(m: Y.Map<unknown>, attrs: ReadonlyAttrs, registry: ObjectKindRegistry): EmbedItem {
  const rawKind = m.get("kind");
  const kind = typeof rawKind === "string" ? rawKind : "";
  const stored = scalarsWithPrefix(m, "a:");
  const resolved = resolveObjectProps(registry, kind, stored);
  const w = m.get("w");
  const h = m.get("h");
  const wrap = m.get("wrap");
  const properties: Record<string, unknown> = { kind, placeholder: resolved === null, props: resolved ?? stored };
  if (isFiniteNonNegative(w)) properties["width"] = w;
  if (isFiniteNonNegative(h)) properties["height"] = h;
  if (WRAPS.has(wrap)) properties["wrap"] = wrap;
  return { kind: "embed", embedType: EMBED_TYPES.object, attrs, properties };
}

/** Handle one embedded map. Returns false when the scan must abort (a sub-flow in a no-sub scan). */
function scanMap(st: ScanState, item: Y.Item, m: Y.Map<unknown>, attrs: () => ReadonlyAttrs): boolean {
  const k = kindOf(m);
  switch (k) {
    case ITEM_KINDS.para:
    case ITEM_KINDS.toc:
    case ITEM_KINDS.sectionBreak: {
      flushRun(st);
      const kind: TerminatorKind = k === ITEM_KINDS.para ? "para" : k === ITEM_KINDS.toc ? "toc" : "S";
      st.tokens.push({ k: kind, len: 1, id: itemId(item), map: m });
      return true;
    }
    case ITEM_KINDS.object:
      pushItem(st, objectEmbed(m, attrs(), st.ctx.registry), 1);
      return true;
    case ITEM_KINDS.hr:
      pushItem(st, { kind: "embed", embedType: EMBED_TYPES.horizontalLine, attrs: attrs(), properties: {} }, 1);
      return true;
    case ITEM_KINDS.footnote: {
      if (!st.ctx.footnotes) {
        pushItem(st, null, 1);
        return true;
      }
      const id = itemId(item);
      st.footnotes.push({ id, body: childMap(m, BODY_KEY) });
      pushItem(
        st,
        { kind: "embed", embedType: EMBED_TYPES.footnoteAnchor, attrs: attrs(), properties: { contentBlockId: footnoteBodyId(id) } },
        1,
      );
      return true;
    }
    case ITEM_KINDS.marker: {
      const ns = m.get("ns");
      const id = m.get("id");
      const edge = m.get("edge");
      const valid = typeof ns === "string" && typeof id === "string" && (edge === "start" || edge === "end");
      pushItem(st, valid ? { kind: "embed", embedType: EMBED_TYPES.marker, attrs: attrs(), properties: { ns, id, edge } } : null, 1);
      return true;
    }
    case ITEM_KINDS.sub:
      if (!st.inertSubs) return false;
      pushItem(st, null, 1);
      return true;
    default:
      pushItem(st, null, 1);
      return true;
  }
}

/** Scan `[from, to)` of `piece` (storage index units) into `st`. False = aborted on a sub-flow. */
function scanInto(st: ScanState, piece: Y.Text, from: number, to: number): boolean {
  const fmt = new Map<string, unknown>();
  let snapshot: ReadonlyAttrs | null = null;
  const attrs = (): ReadonlyAttrs => (snapshot ??= Object.freeze(Object.fromEntries(fmt)));
  let idx = 0;
  for (let it = piece._start; it !== null && idx < to; it = it.right) {
    const c = it.content;
    if (c instanceof Y.ContentFormat) {
      if (!it.deleted) {
        if (c.value === null) fmt.delete(c.key);
        else fmt.set(c.key, c.value);
        snapshot = null;
      }
      continue;
    }
    if (it.deleted || !it.countable) continue;
    const len = it.length;
    if (idx + len <= from) {
      idx += len;
      continue;
    }
    if (c instanceof Y.ContentString) {
      const s = c.str.slice(Math.max(0, from - idx), Math.min(len, to - idx));
      pushItem(st, { kind: "text", text: s, attrs: attrs() }, s.length);
    } else if (c instanceof Y.ContentType && c.type instanceof Y.Map) {
      if (!scanMap(st, it, c.type, attrs)) return false;
    } else {
      pushItem(st, null, len);
    }
    idx += len;
  }
  return true;
}

function newState(ctx: ScanCtx, inertSubs: boolean): ScanState {
  return { ctx, inertSubs, tokens: [], items: [], footnotes: [], inert: [], runLen: 0, hasRun: false };
}

/** Tokens of `[from, to)` of `piece` at sub-flow `depth`, or null when the range holds a read sub-flow item. */
export function scanRange(piece: Y.Text, from: number, to: number, ctx: ScanCtx, depth: number): Token[] | null {
  const st = newState(ctx, depth >= SUBFLOW_DEPTH_CAP);
  if (!scanInto(st, piece, from, to)) return null;
  flushRun(st);
  return st.tokens;
}

/** The pieces of a sub-flow item's map, in order. */
export function subflowPieces(m: Y.Map<unknown>): Y.Text[] {
  const arr = m.get(PIECES_KEY);
  const out: Y.Text[] = [];
  if (arr instanceof Y.Array) for (const p of arr.toArray()) if (p instanceof Y.Text) out.push(p);
  return out;
}

/** Live sub-flow items of `piece`: their storage index and map. */
function subflowItems(piece: Y.Text): { index: number; map: Y.Map<unknown> }[] {
  const out: { index: number; map: Y.Map<unknown> }[] = [];
  let idx = 0;
  for (let it = piece._start; it !== null; it = it.right) {
    if (it.deleted || !it.countable) continue;
    const c = it.content;
    if (c instanceof Y.ContentType && c.type instanceof Y.Map && kindOf(c.type) === ITEM_KINDS.sub) out.push({ index: idx, map: c.type });
    idx += it.length;
  }
  return out;
}

/**
 * A piece's segments in reading order, its sub-flows' pieces (recursively, at most
 * {@link SUBFLOW_DEPTH_CAP} levels) between them. `depth`: the piece's sub-flow depth.
 */
export function flattenPiece(piece: Y.Text, ctx: ScanCtx, out: Segment[] = [], depth = 0): Segment[] {
  let start = 0;
  const seg = (end: number): void => {
    out.push({ piece, depth, start, len: end - start, tokens: scanRange(piece, start, end, ctx, depth) ?? [] });
  };
  for (const sub of depth >= SUBFLOW_DEPTH_CAP ? [] : subflowItems(piece)) {
    seg(sub.index);
    for (const p of subflowPieces(sub.map)) flattenPiece(p, ctx, out, depth + 1);
    start = sub.index + 1;
  }
  seg(piece.length);
  return out;
}

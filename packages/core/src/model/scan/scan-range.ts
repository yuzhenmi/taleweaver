/**
 * Piece scanning: a piece's items → TOKENS — content runs and terminators (¶,
 * block object, `[S]`). The read rules group tokens into paragraphs (`derive/entities.ts`).
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
import { attrsEqual } from "../equality";
import { EMBED_TYPES, type EmbedItem, type InlineItem, type ReadonlyAttrs } from "../block";
import { footnoteBodyId } from "../ids";
import { type ObjectKindRegistry, resolveObjectProps } from "../object-kinds";
import { itemId } from "../storage/item-id";
import { BODY_KEY, ITEM_KINDS } from "../storage/keys";
import { SUBFLOW_DEPTH_CAP } from "../storage/limits";
import { childMap, kindOf, scalarsWithPrefix } from "../storage/map-reads";
import { joinsForward, joinsForwardAtEnd } from "./joins";
import type { FootnoteRef, ScanCtx, TerminatorKind, Token } from "./tokens";

const NO_INERT: readonly number[] = Object.freeze([]);

const isFiniteNonNegative = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const WRAPS: ReadonlySet<unknown> = new Set(["left", "right", "break"]);

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

/** A marker's `ns` / `id` / `edge`; null when it is INERT. */
function markerProps(m: Y.Map<unknown>): { ns: string; id: string; edge: "start" | "end" } | null {
  const ns = m.get("ns");
  const id = m.get("id");
  const edge = m.get("edge");
  return typeof ns === "string" && typeof id === "string" && (edge === "start" || edge === "end") ? { ns, id, edge } : null;
}

/**
 * Whether a live embedded map that is not a terminator or a sub-flow reads as content
 * (what {@link scanMap} gives an item), not INERT. `footnotes`: the flow reads anchors.
 */
export function readsAsContent(m: Y.Map<unknown>, footnotes: boolean): boolean {
  switch (kindOf(m)) {
    case ITEM_KINDS.object:
    case ITEM_KINDS.hr:
      return true;
    case ITEM_KINDS.footnote:
      return footnotes;
    case ITEM_KINDS.marker:
      return markerProps(m) !== null;
    default:
      return false;
  }
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
    case ITEM_KINDS.sub:
      if (!st.inertSubs) return false;
      pushItem(st, null, 1);
      return true;
  }
  // The INERT decision is {@link readsAsContent}'s alone (the oracle's storage walk shares it).
  if (!readsAsContent(m, st.ctx.footnotes)) {
    pushItem(st, null, 1);
    return true;
  }
  switch (k) {
    case ITEM_KINDS.object:
      pushItem(st, objectEmbed(m, attrs(), st.ctx.registry), 1);
      return true;
    case ITEM_KINDS.hr:
      pushItem(st, { kind: "embed", embedType: EMBED_TYPES.horizontalLine, attrs: attrs(), properties: {} }, 1);
      return true;
    case ITEM_KINDS.footnote: {
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
      // readsAsContent checked the props; the null test only narrows the type.
      const props = markerProps(m);
      if (props === null) break;
      pushItem(st, { kind: "embed", embedType: EMBED_TYPES.marker, attrs: attrs(), properties: props }, 1);
      return true;
    }
  }
  pushItem(st, null, 1);
  return true;
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

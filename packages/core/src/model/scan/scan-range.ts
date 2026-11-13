/**
 * Piece scanning: a piece's items → TOKENS — content runs and terminators (¶,
 * block object — TOC or table —, `[S]`). The read rules group tokens into paragraphs (`derive/entities.ts`).
 *
 * Inline item read rules (all total; nothing is rewritten):
 *   - text carries the piece's formatting at its position (Yjs format items);
 *   - an `object` reads by its registered kind, else as a placeholder (R-obj,
 *     `object-kinds.ts`); `w` / `h` are kept only as finite numbers ≥ 0; a `wrap`
 *     outside left|right|break reads as inline;
 *   - a `field` reads by `field-props.ts` (an unknown field kind is INERT);
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
import { fieldProps } from "./field-props";
import { markDepth, markRole } from "../storage/table-marks";
import { type FlowKind, KINDS, holdsFlows, isTerminatorKind, isText, kindOfStored } from "./kinds";
import { SUBFLOW_DEPTH_CAP } from "../storage/limits";
import { childMap, kindOf, scalarsWithPrefix } from "../storage/map-reads";
import { joinsForward, joinsForwardAtEnd } from "./joins";
import type { FootnoteRef, ScanCtx, Token } from "./tokens";

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
  const joins = isText(item) && joinsForwardAtEnd(item.text);
  if (isText(item) && isText(last) && attrsEqual(last.attrs, item.attrs)) {
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
  switch (kindOfStored(kindOf(m))) {
    case "object":
    case "hr":
    case "lineBreak":
      return true;
    case "footnote":
      return footnotes;
    case "marker":
      return markerProps(m) !== null;
    case "field":
      return fieldProps(m) !== null;
    default:
      return false;
  }
}

/** Handle one embedded map. Returns false when the scan must abort (a sub-flow in a no-sub scan). */
function scanMap(st: ScanState, item: Y.Item, m: Y.Map<unknown>, attrs: () => ReadonlyAttrs): boolean {
  const stored = kindOf(m);
  if (stored === ITEM_KINDS.sub) {
    if (!st.inertSubs) return false;
    pushItem(st, null, 1);
    return true;
  }
  const k = kindOfStored(stored);
  if (k !== null && isTerminatorKind(k)) {
    flushRun(st);
    st.tokens.push(holdsFlows(k) ? { k, len: 1, id: itemId(item), map: m, mark: { role: markRole(m), d: markDepth(m) } } : { k, len: 1, id: itemId(item), map: m });
    return true;
  }
  // The INERT decision is {@link readsAsContent}'s alone (the oracle's storage walk shares it).
  if (k === null || !readsAsContent(m, st.ctx.footnotes)) {
    pushItem(st, null, 1);
    return true;
  }
  pushItem(st, inlineEmbed(st, k, item, m, attrs()), 1);
  return true;
}

/** The read embed of a content item of inline kind `k` (kind-specific props; INERT ones were filtered by {@link readsAsContent}). */
function inlineEmbed(st: ScanState, k: FlowKind, item: Y.Item, m: Y.Map<unknown>, attrs: ReadonlyAttrs): EmbedItem | null {
  const embed = (properties: Readonly<Record<string, unknown>>): EmbedItem | null => {
    const embedType = KINDS[k].embedType;
    return embedType === null ? null : { kind: "embed", embedType, attrs, properties };
  };
  switch (k) {
    case "object":
      return objectEmbed(m, attrs, st.ctx.registry);
    case "footnote": {
      const id = itemId(item);
      st.footnotes.push({ id, body: childMap(m, BODY_KEY) });
      return embed({ contentBlockId: footnoteBodyId(id) });
    }
    case "marker":
      return embed(markerProps(m) ?? {});
    case "field":
      return embed(fieldProps(m) ?? {});
    default:
      return embed({});
  }
}

function newState(ctx: ScanCtx, inertSubs: boolean): ScanState {
  return { ctx, inertSubs, tokens: [], items: [], footnotes: [], inert: [], runLen: 0, hasRun: false };
}

/** Tokens of `[from, to)` of `piece` at sub-flow `depth`, or null when the range holds a read sub-flow item. */
export function scanRange(piece: Y.Text, from: number, to: number, ctx: ScanCtx, depth: number): Token[] | null {
  return scanRanges(piece, [[from, to]], ctx, depth)?.[0] ?? null;
}

/**
 * {@link scanRange} of each of the sorted, disjoint `ranges` (storage index units), in one walk of the piece; null when
 * one holds a read sub-flow item.
 */
export function scanRanges(piece: Y.Text, ranges: readonly (readonly [number, number])[], ctx: ScanCtx, depth: number): Token[][] | null {
  const out: Token[][] = [];
  const inertSubs = depth >= SUBFLOW_DEPTH_CAP;
  let st = newState(ctx, inertSubs);
  const finish = (): void => {
    flushRun(st);
    out.push(st.tokens);
    st = newState(ctx, inertSubs);
  };
  const fmt = new Map<string, unknown>();
  let snapshot: ReadonlyAttrs | null = null;
  const attrs = (): ReadonlyAttrs => (snapshot ??= Object.freeze(Object.fromEntries(fmt)));
  let idx = 0;
  for (let it = piece._start; it !== null && out.length < ranges.length; it = it.right) {
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
    // The item's part in each range it overlaps (a string can span several).
    for (let r = ranges[out.length]; r !== undefined; r = ranges[out.length]) {
      const [from, to] = r;
      if (idx + len <= from) break;
      if (idx < to) {
        if (c instanceof Y.ContentString) {
          const sl = c.str.slice(Math.max(0, from - idx), Math.min(len, to - idx));
          pushItem(st, { kind: "text", text: sl, attrs: attrs() }, sl.length);
        } else if (c instanceof Y.ContentType && c.type instanceof Y.Map) {
          if (!scanMap(st, it, c.type, attrs)) return null;
        } else {
          pushItem(st, null, Math.min(len, to - idx) - Math.max(0, from - idx));
        }
        if (idx + len <= to) break;
      }
      finish();
    }
    idx += len;
  }
  while (out.length < ranges.length) finish();
  return out;
}

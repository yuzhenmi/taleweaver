/**
 * The inline storage of a leaf block: ONE `Y.Text` per block under the block's
 * `inlineContent` key. Text runs are characters carrying Yjs formatting
 * attributes (the run's attrs); inline embeds are `insertEmbed` items whose
 * content is plain JSON `{ embedType, properties }` plus formatting attributes.
 * Block offsets count UTF-16 code units + 1 per embed — exactly `Y.Text`
 * indexing, so a `Position.offset` IS a `Y.Text` index.
 *
 * Every inline write goes through the offset primitives here
 * ({@link insertInlineItems} / {@link deleteInlineRange} / {@link formatInlineRange}):
 * `format` never deletes characters, so formatting never changes a character's
 * CRDT identity, concurrent format/format and type/format converge without loss,
 * and an undo entry survives foreign formatting.
 *
 * Invariants upheld here:
 *   - attrs enter Yjs only through {@link toYAttributes} (`null` / `undefined`
 *     dropped — Yjs treats `null` as "remove");
 *   - inserts always pass COMPLETE attrs (Yjs negates unlisted neighbour keys);
 *   - `format` ranges are clamped to the content and split around structural
 *     marker embeds (they never carry formatting);
 *   - every endpoint is snapped OUT to a grapheme-cluster boundary, so Yjs never
 *     splits a surrogate pair;
 *   - the read model ({@link inlineItemsFromYText}) coalesces adjacent runs whose
 *     attrs are deep-equal and projects marker embeds' attrs to their allowed
 *     (empty) set, so a peer-formatted marker never reaches a reader.
 */
import * as Y from "yjs";
import type { BlockId } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import { attrsEqual, deepValueEqual } from "./attrs";
import type { InlineContent, InlineItem, TextItem, EmbedItem } from "./inline-content";
import { assertNoNestedYTypes } from "./y-utils";
import { getTreeMaps } from "./yjs-doc";
import { isStructuralMarkerEmbedType } from "./embed-markers";
import { nextGraphemeBoundary, prevGraphemeBoundary } from "../cursor/grapheme-utils";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../cascade/attr-registry";

/**
 * Thrown when a document (or one of its blocks) still uses the legacy inline
 * storage (a `Y.Array` of run maps under `inlineContent`). Such a document must
 * be upgraded with `upgradeDocument` by a single authority before an editor can
 * load it; no read path parses legacy storage.
 */
export class LegacyDocumentError extends Error {
  readonly blockIds: readonly BlockId[];
  constructor(blockIds: readonly BlockId[]) {
    super(
      `Legacy inline storage in block(s) ${blockIds.map((id) => `"${id}"`).join(", ")}: ` +
        `run upgradeDocument(doc) (single authority) before loading this document.`,
    );
    this.name = "LegacyDocumentError";
    this.blockIds = blockIds;
  }
}

/**
 * The live item a `RelativePosition`'s anchor id now denotes: the item itself, or
 * — when an undo/redo restored it — its latest redone copy (Yjs `followRedone`).
 * Null when the id is unknown to this doc or garbage-collected. The caller checks
 * `.deleted` (a deleted, unrestored anchor char).
 */
export function followRedoneItem(doc: Y.Doc, id: Y.ID): Y.Item | null {
  let next: Y.ID | null = id;
  let item: Y.Item | Y.GC | null = null;
  while (next !== null) {
    if (next.clock >= Y.getState(doc.store, next.client)) return null;
    item = Y.getItem(doc.store, next);
    if (!(item instanceof Y.Item)) return null;
    const diff: number = next.clock - item.id.clock;
    next = item.redone === null ? null : Y.createID(item.redone.client, item.redone.clock + diff);
  }
  return item instanceof Y.Item ? item : null;
}

/** True iff `value` (a block's `inlineContent` Y value) is the legacy run-array shape. */
export function isLegacyInlineValue(value: unknown): value is Y.Array<unknown> {
  return value instanceof Y.Array;
}

/**
 * The block's inline `Y.Text`, or `null` for a container (`inlineContent === null`).
 * Throws {@link LegacyDocumentError} on the legacy shape and a plain error on any
 * other malformed value.
 */
export function readYInline(yBlock: Y.Map<unknown>, blockId: BlockId): Y.Text | null {
  const raw = yBlock.get("inlineContent");
  if (raw === null) return null;
  if (raw instanceof Y.Text) return raw;
  if (isLegacyInlineValue(raw)) throw new LegacyDocumentError([blockId]);
  throw new Error(`block "${blockId}": malformed inlineContent (expected Y.Text or null)`);
}

/**
 * Dev-mode post-op check over the blocks an op touched: each leaf's inline storage
 * is a `Y.Text` (no op wrote the run-array shape) and no Y.Text item holds a lone
 * surrogate (no op split a pair — every endpoint is grapheme-snapped). O(touched content).
 */
export function assertInlineStorageInvariants(doc: Y.Doc, opName: string, blockIds: Iterable<BlockId>): void {
  for (const id of blockIds) {
    for (const tree of getTreeMaps(doc)) {
      const yBlock = tree.get(id);
      if (yBlock === undefined) continue;
      const yText = readYInline(yBlock, id);
      if (yText === null) break;
      // Per Y.Text ITEM, not the joined text: a pair split across two items (two runs,
      // or two same-attr items Yjs keeps apart) reads whole once joined, but each half
      // is a lone surrogate in storage — Yjs splices it to U+FFFD on a later split.
      for (let item = yText._start; item !== null; item = item.right) {
        if (!item.deleted && item.content instanceof Y.ContentString && LONE_SURROGATE.test(item.content.str)) {
          throw new Error(`${opName}: block "${id}" holds a lone surrogate (an offset split a pair)`);
        }
      }
      break;
    }
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** {@link readYInline} for a write path that requires a leaf. */
export function requireYInline(yBlock: Y.Map<unknown>, blockId: BlockId, opName: string): Y.Text {
  const yText = readYInline(yBlock, blockId);
  if (yText === null) throw new Error(`${opName}: block "${blockId}" is not a leaf (no inlineContent)`);
  return yText;
}

/**
 * The single path for attrs into Yjs: drops `null` / `undefined` values (stored
 * attrs never hold either) and asserts no nested Y types.
 */
export function toYAttributes(attrs: ReadonlyAttrs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    assertNoNestedYTypes(value, `attrs.${key}`);
    out[key] = value;
  }
  return out;
}

/**
 * A format DELTA for `Y.Text.format`: a `null` / `undefined` value removes the key
 * (Yjs `null`), every other value sets it.
 */
export function toYFormatDelta(delta: ReadonlyAttrs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(delta)) {
    if (value === null || value === undefined) {
      out[key] = null;
      continue;
    }
    assertNoNestedYTypes(value, `attrs.${key}`);
    out[key] = value;
  }
  return out;
}

/** The plain-JSON content stored for an inline embed. */
interface EmbedContent {
  readonly embedType: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

function embedContentOf(item: EmbedItem): EmbedContent {
  for (const [key, value] of Object.entries(item.properties)) {
    assertNoNestedYTypes(value, `properties.${key}`);
  }
  return { embedType: item.embedType, properties: { ...item.properties } };
}

/** Width of one inline item in offset units. */
function itemLength(item: InlineItem): number {
  return item.kind === "text" ? item.text.length : 1;
}

/**
 * Insert `items` into a DETACHED or integrated `yText` at `offset` (no snapping,
 * no canonicalization — the raw writer shared by the builders and
 * {@link insertInlineItems}). Each item carries its COMPLETE attrs.
 */
function writeItems(yText: Y.Text, offset: number, items: ReadonlyArray<InlineItem>): void {
  let at = offset;
  for (const item of items) {
    if (item.kind === "text") {
      if (item.text.length === 0) continue;
      yText.insert(at, item.text, toYAttributes(item.attrs));
      at += item.text.length;
    } else {
      yText.insertEmbed(at, embedContentOf(item), toYAttributes(item.attrs));
      at += 1;
    }
  }
}

/** Build a detached `Y.Text` holding `content` (integrate it before reading). */
export function buildYInlineText(content: InlineContent): Y.Text {
  const yText = new Y.Text();
  writeItems(yText, 0, content.items);
  return yText;
}

type DeltaOp = { insert?: unknown; attributes?: Record<string, unknown> };

/**
 * The read model of an inline `Y.Text`: one `InlineItem` per run / embed, adjacent
 * text runs with deep-equal attrs coalesced (Yjs compares attribute values flat),
 * structural marker embeds' attrs projected to their allowed (empty) set. Items are
 * NOT frozen (callers freeze for snapshots).
 */
export function inlineItemsFromYText(yText: Y.Text): InlineItem[] {
  const items: InlineItem[] = [];
  for (const op of yText.toDelta() as DeltaOp[]) {
    const attrs: Record<string, unknown> = {};
    if (op.attributes !== undefined) {
      for (const [key, value] of Object.entries(op.attributes)) {
        if (value === null || value === undefined) continue;
        assertNoNestedYTypes(value, key);
        attrs[key] = value;
      }
    }
    if (typeof op.insert === "string") {
      const prev = items[items.length - 1];
      if (prev !== undefined && prev.kind === "text" && attrsEqual(prev.attrs, attrs)) {
        items[items.length - 1] = { kind: "text", text: prev.text + op.insert, attrs: prev.attrs };
      } else {
        items.push({ kind: "text", text: op.insert, attrs });
      }
      continue;
    }
    const content = op.insert;
    if (
      content === null ||
      typeof content !== "object" ||
      content instanceof Y.AbstractType ||
      typeof (content as { embedType?: unknown }).embedType !== "string"
    ) {
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
    items.push({
      kind: "embed",
      embedType,
      attrs: isStructuralMarkerEmbedType(embedType) ? {} : attrs,
      properties: props,
    });
  }
  return items;
}

/** Frozen snapshot form of {@link inlineItemsFromYText}. */
export function inlineContentSnapshot(yText: Y.Text): InlineContent {
  const items = inlineItemsFromYText(yText).map((item): InlineItem =>
    item.kind === "text"
      ? Object.freeze<TextItem>({ kind: "text", text: item.text, attrs: Object.freeze(item.attrs) })
      : Object.freeze<EmbedItem>({
          kind: "embed",
          embedType: item.embedType,
          attrs: Object.freeze(item.attrs),
          properties: Object.freeze(item.properties),
        }),
  );
  return Object.freeze({ items: Object.freeze(items) });
}

// ---------------------------------------------------------------------------
// Grapheme snapping (invariant: offsets are aligned, never rejected)
// ---------------------------------------------------------------------------

/** Window (UTF-16 units) each side of an offset inspected for cluster boundaries. */
// ponytail: a cluster longer than SNAP_WINDOW units (e.g. Zalgo stacks) snaps at
// the window edge — still a code-point boundary; widen if that ever matters.
const SNAP_WINDOW = 32;

/**
 * The text run (between embeds) containing `offset`, as `{ text, base }` where
 * `base` is the run's block offset. `null` when `offset` touches no text run.
 */
function textRunAround(items: ReadonlyArray<InlineItem>, offset: number): { text: string; base: number } | null {
  let pos = 0;
  let runText = "";
  let runBase = 0;
  for (const item of items) {
    if (item.kind === "text") {
      if (runText === "") runBase = pos;
      runText += item.text;
      pos += item.text.length;
      continue;
    }
    if (runText !== "" && offset > runBase && offset < pos) return { text: runText, base: runBase };
    runText = "";
    pos += 1;
  }
  if (runText !== "" && offset > runBase && offset < pos) return { text: runText, base: runBase };
  return null;
}

/** Snap `offset` to a grapheme boundary: backward (`dir = -1`) or forward (`dir = 1`). */
function snap(items: ReadonlyArray<InlineItem>, offset: number, dir: -1 | 1): number {
  const run = textRunAround(items, offset);
  if (run === null) return offset;
  const local = offset - run.base;
  const lo = Math.max(0, local - SNAP_WINDOW);
  // Never cut the window inside a surrogate pair.
  const winStart = lo > 0 && isLowSurrogate(run.text.charCodeAt(lo)) ? lo - 1 : lo;
  let winEnd = Math.min(run.text.length, local + SNAP_WINDOW);
  if (winEnd < run.text.length && isLowSurrogate(run.text.charCodeAt(winEnd))) winEnd += 1;
  const window = run.text.slice(winStart, winEnd);
  const w = local - winStart;
  const clusterStart = prevGraphemeBoundary(window, w + 1);
  if (clusterStart === w) return offset;
  const snapped = dir < 0 ? clusterStart : nextGraphemeBoundary(window, w);
  return run.base + winStart + snapped;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Snap a range OUT to grapheme boundaries (start backward, end forward), clamped. */
export function snapRange(
  items: ReadonlyArray<InlineItem>,
  start: number,
  end: number,
): [number, number] {
  const len = items.reduce((n, it) => n + itemLength(it), 0);
  const s = Math.max(0, Math.min(start, len));
  const e = Math.max(s, Math.min(end, len));
  return [snap(items, s, -1), snap(items, e, 1)];
}

/**
 * Snap one offset to a grapheme boundary (clamped to the content): backward by
 * default, forward with `dir = 1` (a range END snapped OUT).
 */
export function snapOffset(items: ReadonlyArray<InlineItem>, offset: number, dir: -1 | 1 = -1): number {
  const len = items.reduce((n, it) => n + itemLength(it), 0);
  return snap(items, Math.max(0, Math.min(offset, len)), dir);
}

// ---------------------------------------------------------------------------
// Offset write primitives
// ---------------------------------------------------------------------------

/**
 * The attrs of the nearest NON-marker item strictly before (`dir = -1`) or at /
 * after (`dir = 1`) `offset`, or `null` when there is none. Structural marker
 * embeds are skipped — they are never a source of inherited attrs.
 */
function neighbourAttrs(items: ReadonlyArray<InlineItem>, offset: number, dir: -1 | 1): ReadonlyAttrs | null {
  let pos = 0;
  let before: ReadonlyAttrs | null = null;
  for (const item of items) {
    const end = pos + itemLength(item);
    const marker = item.kind === "embed" && isStructuralMarkerEmbedType(item.embedType);
    if (dir < 0) {
      if (pos >= offset) break;
      if (!marker) before = item.attrs;
    } else if (pos >= offset && !marker) {
      return item.attrs;
    }
    pos = end;
  }
  return dir < 0 ? before : null;
}

/** `attrs` replaced by a registry-equal neighbour's stored value (canonical storage). */
function canonical(
  attrs: ReadonlyAttrs,
  candidates: ReadonlyArray<ReadonlyAttrs | null>,
  registry: AttrRegistry | undefined,
): ReadonlyAttrs {
  for (const c of candidates) {
    if (c !== null && attrsEqual(c, attrs, registry)) return c;
  }
  return attrs;
}

/**
 * Insert `items` at `offset` (snapped backward to a grapheme boundary) into a live
 * inline `Y.Text`. Every item is written with its COMPLETE attrs; a first / last
 * text item whose attrs are registry-equal to its non-marker neighbour is written
 * with the neighbour's stored value, so storage stays canonical. Returns the
 * offset actually used.
 */
export function insertInlineItems(
  yText: Y.Text,
  offset: number,
  items: ReadonlyArray<InlineItem>,
  registry?: AttrRegistry,
): number {
  if (items.length === 0) return offset;
  const live = inlineItemsFromYText(yText);
  const at = snapOffset(live, offset);
  const left = neighbourAttrs(live, at, -1);
  const right = neighbourAttrs(live, at, 1);
  const last = items.length - 1;
  const canon = items.map((item, i): InlineItem => {
    if (item.kind !== "text") return item;
    const candidates = i === 0 && i === last ? [left, right] : i === 0 ? [left] : i === last ? [right] : [];
    const attrs = canonical(item.attrs, candidates, registry);
    return attrs === item.attrs ? item : { ...item, attrs };
  });
  writeItems(yText, at, canon);
  return at;
}

/** Insert one text run (complete `attrs`) at `offset`. See {@link insertInlineItems}. */
export function insertInlineText(
  yText: Y.Text,
  offset: number,
  text: string,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): number {
  if (text.length === 0) return offset;
  return insertInlineItems(yText, offset, [{ kind: "text", text, attrs }], registry);
}

/**
 * Replace `[start, end)` with one text run (complete `attrs`), given `live` — the
 * block's read model from the caller's ONE read. Callers applying several
 * replacements to one block go in DESCENDING order, so `live`'s offsets before each
 * replacement stay valid. The range is snapped OUT; the run is canonicalized
 * against its non-marker neighbours in `live` (a stale right neighbour of an
 * adjacent earlier replacement only offers a registry-equal candidate, so it can
 * change which equal value is stored, never the semantics).
 */
export function replaceInlineText(
  yText: Y.Text,
  live: ReadonlyArray<InlineItem>,
  start: number,
  end: number,
  text: string,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): void {
  const [s, e] = snapRange(live, start, end);
  if (e > s) yText.delete(s, e - s);
  if (text.length === 0) return;
  const stored = canonical(attrs, [neighbourAttrs(live, s, -1), neighbourAttrs(live, e, 1)], registry);
  writeItems(yText, s, [{ kind: "text", text, attrs: stored }]);
}

/** Delete `[start, end)` (snapped OUT to grapheme boundaries, clamped). */
export function deleteInlineRange(yText: Y.Text, start: number, end: number): void {
  const [s, e] = snapRange(inlineItemsFromYText(yText), start, end);
  if (e > s) yText.delete(s, e - s);
}

/** True iff applying `yDelta` to `attrs` changes something (registry-aware equality). */
function deltaChanges(attrs: ReadonlyAttrs, yDelta: Readonly<Record<string, unknown>>, registry: AttrRegistry | undefined): boolean {
  for (const [key, value] of Object.entries(yDelta)) {
    const prev = attrs[key];
    if (value === null) {
      if (prev !== undefined) return true;
      continue;
    }
    if (prev === undefined) return true;
    const eq = registry?.get(key)?.equals;
    if (!(eq !== undefined ? eq(prev, value) : deepValueEqual(prev, value))) return true;
  }
  return false;
}

/**
 * Apply a format delta to `[start, end)`: a `null` / `undefined` value removes
 * the key, others set it (merge semantics — unlisted keys are untouched). The
 * range is clamped, snapped OUT to grapheme boundaries, and split around
 * structural marker embeds (one `format` per maximal subrange), so a marker
 * never carries formatting. Items the delta would not change are skipped too
 * (registry-aware), so re-applying an existing format writes nothing (no Yjs
 * event, no dirty block).
 */
export function formatInlineRange(
  yText: Y.Text,
  start: number,
  end: number,
  delta: ReadonlyAttrs,
  registry?: AttrRegistry,
): void {
  const yDelta = toYFormatDelta(delta);
  if (Object.keys(yDelta).length === 0) return;
  const live = inlineItemsFromYText(yText);
  const [s, e] = snapRange(live, start, end);
  if (e <= s) return;
  let pos = 0;
  let runStart = -1;
  const flush = (to: number): void => {
    if (runStart >= 0 && to > runStart) yText.format(runStart, to - runStart, yDelta);
    runStart = -1;
  };
  for (const item of live) {
    const itemEnd = pos + itemLength(item);
    if (pos >= e) break;
    if (itemEnd > s) {
      const marker = item.kind === "embed" && isStructuralMarkerEmbedType(item.embedType);
      if (marker || !deltaChanges(item.attrs, yDelta, registry)) flush(pos);
      else if (runStart < 0) runStart = Math.max(pos, s);
    }
    pos = itemEnd;
  }
  flush(e);
}

/**
 * The format delta turning `from` into `to`: every key of `to` that differs, plus
 * `null` for every key of `from` absent in `to`. Empty when the attrs are equal.
 */
export function attrsDiff(from: ReadonlyAttrs, to: ReadonlyAttrs, registry?: AttrRegistry): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(to)) {
    if (value === null || value === undefined) continue;
    const eq = registry?.get(key)?.equals;
    const prev = from[key];
    if (prev !== undefined && prev !== null && (eq !== undefined ? eq(prev, value) : deepValueEqual(prev, value))) continue;
    delta[key] = value;
  }
  for (const key of Object.keys(from)) {
    if (!(key in to) || to[key] === null || to[key] === undefined) delta[key] = null;
  }
  return delta;
}

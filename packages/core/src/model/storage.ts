/**
 * Schema-4 storage (yjs-valid-by-definition r7 §3), tables excluded (P2).
 *
 * Root: `doc.getMap("v4").get("doc")` = DocMap, created together with
 * `meta.schemaVersion = 4`. DocMap keys:
 *   - `flow`: the body flow, a `Y.Array<Y.Text>` of PIECES (X11);
 *   - `s:*` / `h:<region>:<variant>`: the LAST section's props;
 *   - `bodies`: `Y.Map<bodyId, BodyMap{flow}>` header / footer bodies (X19 base);
 *   - `listDefs`, `comments`, `suggestions`: side maps.
 *
 * A flow's content is the pieces' character sequence. Every item kind other than
 * text is an embedded `Y.Map` whose `k` key names it (written at creation, never
 * rewritten):
 *   - `para`: a ¶ (flat keys `p:*` paragraph attrs, `m:*` ¶-mark run props,
 *     `t:ins` / `t:del` tracked-break tags);
 *   - `object`: a generic inline object `{kind, w?, h?, wrap?, a:<prop>…}`; images
 *     are kind `"image"` (`a:src`, `a:alt`); `wrap` ∈ left|right|break, absent = inline;
 *   - `hr`: an inline horizontal rule;
 *   - `sectionBreak`: `[S]`, holding the props (`s:*`, `h:*`) of the section it ends;
 *   - `toc`: a table-of-contents block object (`a:*` options);
 *   - `footnote`: an inline footnote anchor whose `body` is a nested `Y.Map{flow}` (X20);
 *   - `marker`: a generic range marker `{ns, id, edge: "start"|"end"}` (bookmarks,
 *     comment anchors);
 *   - `sub`: a SUB-FLOW `Y.Map{pieces}` read in place (X12).
 *
 * Every holder flow is created holding one ¶ (G3). Writes carry the editor's
 * `Symbol` origin (X16); history uses {@link flowContainerDeleteFilter} (X17).
 *
 * Yjs internals read (X14, item-level reads): `AbstractType._item/_start`,
 * `Item.parent/parentSub/right/deleted/countable/length/content/id`.
 */
import * as Y from "yjs";

export const SCHEMA_VERSION = 4;
export const ROOT_MAP = "v4";
export const DOC_KEY = "doc";
export const META_MAP = "meta";
export const SCHEMA_VERSION_KEY = "schemaVersion";

export const FLOW_KEY = "flow";
export const BODIES_KEY = "bodies";
export const LIST_DEFS_KEY = "listDefs";
export const COMMENTS_KEY = "comments";
export const SUGGESTIONS_KEY = "suggestions";
export const KIND_KEY = "k";
export const PIECES_KEY = "pieces";
export const BODY_KEY = "body";

export const ITEM_KINDS = {
  para: "para",
  object: "object",
  hr: "hr",
  sectionBreak: "sectionBreak",
  toc: "toc",
  footnote: "footnote",
  marker: "marker",
  sub: "sub",
} as const;

/** No write inserts into a piece holding this many structs (incl. tombstones / formats). */
export const PIECE_SOFT_MAX = 1024;
/** Sub-flow nesting cap: past it, writes enter the full piece. */
export const SUBFLOW_DEPTH_CAP = 4;

export type Scalar = string | number | boolean | null;
/** Flat, already-prefixed scalar keys (`p:type`, `m:bold`, `s:pageInlineSize`, `a:src`, …). */
export type FlatKeys = Readonly<Record<string, Scalar>>;

function mapOf(entries: Readonly<Record<string, unknown>>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(entries)) m.set(k, v);
  return m;
}

// ---------------------------------------------------------------------------
// Item constructors (detached; nested types are created with their parent, G1)
// ---------------------------------------------------------------------------

/** A ¶ with flat `p:*` / `m:*` / `t:*` keys. */
export function newParagraphMark(keys: FlatKeys = {}): Y.Map<unknown> {
  return mapOf({ ...keys, [KIND_KEY]: ITEM_KINDS.para });
}

export interface ObjectProps {
  readonly w?: number;
  readonly h?: number;
  readonly wrap?: "left" | "right" | "break";
  /** Kind-specific scalar props, stored as `a:<name>`. */
  readonly props?: FlatKeys;
}

/** A generic inline object of `kind` (`"image"` or `"<ns>:<name>"`). */
export function newObject(kind: string, o: ObjectProps = {}): Y.Map<unknown> {
  const e: Record<string, unknown> = { [KIND_KEY]: ITEM_KINDS.object, kind };
  if (o.w !== undefined) e["w"] = o.w;
  if (o.h !== undefined) e["h"] = o.h;
  if (o.wrap !== undefined) e["wrap"] = o.wrap;
  for (const [k, v] of Object.entries(o.props ?? {})) e[`a:${k}`] = v;
  return mapOf(e);
}

export function newHorizontalRule(): Y.Map<unknown> {
  return mapOf({ [KIND_KEY]: ITEM_KINDS.hr });
}

/** `[S]` holding the ended section's `s:*` / `h:*` keys. */
export function newSectionBreak(keys: FlatKeys = {}): Y.Map<unknown> {
  return mapOf({ ...keys, [KIND_KEY]: ITEM_KINDS.sectionBreak });
}

/** A TOC block object with `a:*` options. */
export function newTableOfContents(keys: FlatKeys = {}): Y.Map<unknown> {
  return mapOf({ ...keys, [KIND_KEY]: ITEM_KINDS.toc });
}

/** A footnote anchor whose nested body holds a fresh flow (one ¶). */
export function newFootnote(): Y.Map<unknown> {
  return mapOf({ [KIND_KEY]: ITEM_KINDS.footnote, [BODY_KEY]: newBody() });
}

/** A header / footer (or footnote) body: `Y.Map{flow}` with one ¶. */
export function newBody(): Y.Map<unknown> {
  return mapOf({ [FLOW_KEY]: newFlow() });
}

export function newMarker(ns: string, id: string, edge: "start" | "end"): Y.Map<unknown> {
  return mapOf({ [KIND_KEY]: ITEM_KINDS.marker, ns, id, edge });
}

/** A detached flow: one piece holding one default ¶ (G3). */
export function newFlow(): Y.Array<Y.Text> {
  const piece = new Y.Text();
  piece.insertEmbed(0, newParagraphMark());
  const arr = new Y.Array<Y.Text>();
  arr.insert(0, [piece]);
  return arr;
}

/** A detached sub-flow holding `piece`. */
export function newSubflow(piece: Y.Text): Y.Map<unknown> {
  const arr = new Y.Array<Y.Text>();
  arr.insert(0, [piece]);
  return mapOf({ [KIND_KEY]: ITEM_KINDS.sub, [PIECES_KEY]: arr });
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

/** The DocMap, or null for a document with no schema-4 root. */
export function getDocMap(doc: Y.Doc): Y.Map<unknown> | null {
  const m = doc.getMap(ROOT_MAP).get(DOC_KEY);
  return m instanceof Y.Map ? m : null;
}

/** Create the schema-4 root (one transaction): DocMap with a one-¶ body flow, side maps, `meta.schemaVersion = 4`. */
export function createDocMap(doc: Y.Doc, origin: unknown = null): Y.Map<unknown> {
  if (getDocMap(doc) !== null) throw new Error("schema4: document already has a root");
  const docMap = mapOf({
    [FLOW_KEY]: newFlow(),
    [BODIES_KEY]: new Y.Map<unknown>(),
    [LIST_DEFS_KEY]: new Y.Map<unknown>(),
    [COMMENTS_KEY]: new Y.Map<unknown>(),
    [SUGGESTIONS_KEY]: new Y.Map<unknown>(),
  });
  doc.transact(() => {
    doc.getMap(ROOT_MAP).set(DOC_KEY, docMap);
    doc.getMap(META_MAP).set(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
  }, origin);
  return docMap;
}

/** A Yjs scalar (null or a non-object): the only values the read takes from flat keys. */
export const isScalar = (v: unknown): boolean => v === null || typeof v !== "object";

/**
 * The scalar values of `prefix`-keyed entries of `m`, prefix stripped (stripping is
 * injective, so no two keys alias). Built in sorted key order: independent of the
 * map's iteration order.
 */
export function scalarsWithPrefix(m: Y.Map<unknown>, prefix: string): Record<string, unknown> {
  const keys: string[] = [];
  m.forEach((v, k) => {
    if (k.length > prefix.length && k.startsWith(prefix) && isScalar(v)) keys.push(k);
  });
  // fromEntries defines own data properties: a `p:__proto__` key cannot set the prototype.
  return Object.fromEntries(keys.sort().map((k) => [k.slice(prefix.length), m.get(k)]));
}

/** A holder's flow: its `flow` key when that is a `Y.Array`, else null. */
export function flowOf(m: Y.Map<unknown>): Y.Array<Y.Text> | null {
  const f = m.get(FLOW_KEY);
  return f instanceof Y.Array ? f : null;
}

/** `m.get(key)` when it is a `Y.Map`, else null. */
export function childMap(m: Y.Map<unknown>, key: string): Y.Map<unknown> | null {
  const c = m.get(key);
  return c instanceof Y.Map ? c : null;
}

/** The `k` of an embedded item map ("" when missing / not a string). */
export function kindOf(m: Y.Map<unknown>): string {
  const k = m.get(KIND_KEY);
  return typeof k === "string" ? k : "";
}

// ---------------------------------------------------------------------------
// Ids (X21: block id = Yjs item id)
// ---------------------------------------------------------------------------

export function itemId(item: Y.Item): string {
  return `${item.id.client}:${item.id.clock}`;
}

/** Anything with a Yjs item (every integrated shared type). */
export interface HasItem {
  readonly _item: Y.Item | null;
}

/** The item id of an integrated type, or null when detached. */
export function typeId(t: HasItem): string | null {
  return t._item === null ? null : itemId(t._item);
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** The flow / sub-flow array holding `piece`. */
export function arrayOfPiece(piece: Y.Text): Y.Array<Y.Text> {
  const it = piece._item;
  if (it === null || !(it.parent instanceof Y.Array)) throw new Error("schema4: detached piece");
  return it.parent;
}

/** The piece holding a sub-flow array, or null when `arr` is a holder's flow. */
export function pieceHoldingSubflow(arr: Y.Array<Y.Text>): Y.Text | null {
  const owner = arr._item;
  if (owner === null || owner.parentSub !== PIECES_KEY || !(owner.parent instanceof Y.Map)) return null;
  const subItem = owner.parent._item;
  return subItem !== null && subItem.parent instanceof Y.Text ? subItem.parent : null;
}

/** Sub-flow nesting depth of `piece` (0 = a top-level piece). */
export function pieceDepth(piece: Y.Text): number {
  let d = 0;
  for (let p = pieceHoldingSubflow(arrayOfPiece(piece)); p !== null; p = pieceHoldingSubflow(arrayOfPiece(p))) d++;
  return d;
}

/** Index of `piece` in its array: a walk bounded by the array's piece count. */
export function pieceIndex(piece: Y.Text): number {
  const arr = arrayOfPiece(piece);
  let n = 0;
  for (let it = arr._start; it !== null; it = it.right) {
    if (it === piece._item) return n;
    if (!it.deleted && it.countable) n += it.length;
  }
  throw new Error("schema4: piece not in its array");
}

/** Insert `fresh` right after `piece` (public `Y.Array.insert` after a bounded walk; X13 dropped). */
export function insertPieceAfter(piece: Y.Text, fresh: Y.Text): void {
  arrayOfPiece(piece).insert(pieceIndex(piece) + 1, [fresh]);
}

export function insertPieceBefore(piece: Y.Text, fresh: Y.Text): void {
  arrayOfPiece(piece).insert(pieceIndex(piece), [fresh]);
}

/** Struct count of a piece (incl. tombstones and formats): the size metric. O(piece). */
export function pieceStructCount(piece: Y.Text): number {
  let n = 0;
  for (let it = piece._start; it !== null; it = it.right) n++;
  return n;
}

export interface PiecePoint {
  readonly piece: Y.Text;
  readonly index: number;
}

/**
 * The piece-size rule (X11/X12): the point a write of `budget` structs at `p`
 * actually goes to. A full piece gets a fresh piece after / before it, or (mid
 * piece) a fresh piece inside a new sub-flow, up to {@link SUBFLOW_DEPTH_CAP}.
 * Must run inside the write's transaction.
 */
export function writablePoint(p: PiecePoint, budget = 1): PiecePoint {
  if (pieceStructCount(p.piece) + budget <= PIECE_SOFT_MAX) return p;
  if (p.index >= p.piece.length) {
    const fresh = new Y.Text();
    insertPieceAfter(p.piece, fresh);
    return { piece: fresh, index: 0 };
  }
  if (p.index === 0) {
    const fresh = new Y.Text();
    insertPieceBefore(p.piece, fresh);
    return { piece: fresh, index: 0 };
  }
  if (pieceDepth(p.piece) >= SUBFLOW_DEPTH_CAP) return p;
  const fresh = new Y.Text();
  p.piece.insertEmbed(p.index, newSubflow(fresh), {});
  return { piece: fresh, index: 0 };
}

// ---------------------------------------------------------------------------
// History hooks (X16 / X17)
// ---------------------------------------------------------------------------

/** A fresh per-editor transaction origin (X16): undo tracks only this editor's writes. */
export function createEditorOrigin(label = "taleweaver-editor"): symbol {
  return Symbol(label);
}

/**
 * `Y.UndoManager` `deleteFilter` (X17): an undo never deletes a flow container —
 * a piece, a sub-flow (map or its pieces array) or a holder's `flow` array — so a
 * peer's text inside a container this editor created survives the undo. Such a
 * container dies only with its parent (a deleted footnote / body).
 */
export function flowContainerDeleteFilter(item: Y.Item): boolean {
  const c = item.content;
  if (!(c instanceof Y.ContentType)) return true;
  const t = c.type;
  if (t instanceof Y.Text && item.parent instanceof Y.Array) return false;
  if (t instanceof Y.Array && (item.parentSub === FLOW_KEY || item.parentSub === PIECES_KEY)) return false;
  if (t instanceof Y.Map && kindOf(t) === ITEM_KINDS.sub) return false;
  return true;
}

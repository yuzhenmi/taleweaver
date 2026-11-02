/**
 * The total read model (r7 §4) and from-scratch derivation of an immutable version.
 *
 * Read rules applied here (tables, R6–R10, are P2):
 *   - R1 paragraph: a run ended by a ¶; attrs = the ¶'s `p:*` (`p:type` = the block
 *     type, default "paragraph"), `m:*` = markAttrs, `t:ins` / `t:del` =
 *     breakSuggestion; absent keys = defaults. An EMPTY run before a block object,
 *     `[S]` or `<end>` is nothing.
 *   - R2 debris (X1): a non-empty run ended by a block object / `[S]` reads as a
 *     default paragraph `${terminator}/pre`; ended by `<end>`, `${holder}/end`.
 *   - R4 sections: the body flow's `[S]` items partition it; section `${S}/section`
 *     takes the `[S]`'s `s:*`; the last section `${root}/final` takes DocMap's. A
 *     section with no paragraph has no children. `[S]` outside the body flow is a
 *     terminator only (it ends a run; nothing else).
 *   - R5 header links: `h:<region>:<variant>` (region header|footer, variant
 *     default|first|even; no other spelling is read) = an existing bodyId → that
 *     body (`h/${bodyId}`, see `ids.ts`); `none` → none; absent / missing body / a
 *     non-string → inherit the previous section's. `s:` keys spelled like a link attr
 *     are not read.
 *   - R11 lists: see `listLevelConfig` (`document.ts`).
 *   - Footnote bodies (X20): `${anchor}/body` in the embedContents tree; a body with
 *     no flow reads as R17.
 *   - R17 empty holder: a flow whose read yields no paragraph and no block object
 *     (no ¶ and no content, or only `[S]`s) reads as one empty default paragraph
 *     `${holder}/end`.
 *   - A `p:type` naming a container / block-object type reads as "paragraph"; only
 *     scalar values (null or non-object) of prefixed keys are read.
 *
 * Every read is independent of Y.Map iteration order (keys are read by their exact
 * canonical spelling or sorted), so peers holding the same storage read the same.
 */
import * as Y from "yjs";
import type { Block, BlockId, InlineItem, ReadonlyAttrs } from "./block";
import { BLOCK_TYPES, EMBED_TYPES, attrsEqual } from "./block";
import { PMap } from "./pmap";
import { flattenPiece, type FootnoteRef, type Segment, type Token } from "./scan";
import { BODIES_KEY, LIST_DEFS_KEY, childMap, flowOf, getDocMap, scalarsWithPrefix, typeId } from "./storage";
import { debrisBeforeId, finalSectionId, flowEndId, footnoteBodyId, sectionIdOf, templateBodyId } from "./ids";
import type { ObjectKindRegistry } from "./object-kinds";
import type { CounterStyle } from "../styles/format-counter";

export type TreeKind = "block" | "embedContent" | "templateContent";

export interface SectionInfo {
  readonly id: BlockId;
  /** The `[S]` map holding the section's props (DocMap for the last section). */
  readonly map: Y.Map<unknown>;
}

/** Derivation state of one flow (internal to the model). */
export interface FlowState {
  readonly holderId: BlockId;
  readonly tree: TreeKind;
  readonly isRoot: boolean;
  readonly array: Y.Array<Y.Text> | null;
  /** The flow's segments in reading order (`scan.ts`). */
  readonly segments: readonly Segment[];
  /** Piece → the indices of its segments in `segments` (ascending). */
  readonly segIndex: ReadonlyMap<Y.Text, readonly number[]>;
  /** Body flow only: its sections in order, the last one `${root}/final`. */
  readonly sections: readonly SectionInfo[];
  /** R17 fired: the flow reads as one synthetic empty paragraph. */
  readonly synthetic: boolean;
}

export type ListRestart = "always" | "never" | "after-break";

export interface ListLevelDef {
  readonly style: CounterStyle;
  readonly start: number;
  readonly restart: ListRestart;
}

export interface ListDef {
  readonly levels: readonly ListLevelDef[];
}

/** An immutable version of the document (D4/D6: the version IS the Document). */
export interface Document {
  readonly rootId: BlockId;
  readonly trees: Readonly<Record<TreeKind, PMap<Block>>>;
  readonly flows: PMap<FlowState>;
  readonly listDefs: ReadonlyMap<string, ListDef>;
  /** Internal: what derivation reads (not part of the read API). */
  readonly docMap: Y.Map<unknown>;
  readonly registry: ObjectKindRegistry;
}

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
export interface SectionBreakEntity {
  readonly k: "S";
  readonly id: BlockId;
  readonly map: Y.Map<unknown>;
}
export type Entity = ParaEntity | TocEntity | SectionBreakEntity;
export type BlockEntity = ParaEntity | TocEntity;

function appendItems(dst: InlineItem[], src: readonly InlineItem[]): void {
  for (const item of src) {
    const last = dst[dst.length - 1];
    if (item.kind === "text" && last !== undefined && last.kind === "text" && attrsEqual(last.attrs, item.attrs)) {
      dst[dst.length - 1] = { kind: "text", text: last.text + item.text, attrs: last.attrs };
    } else {
      dst.push(item);
    }
  }
}

/** R1 / R2: group a token sequence into entities. `atEnd`: the sequence ends at `<end>`. */
export function group(tokens: Iterable<Token>, atEnd: boolean, holderId: BlockId): Entity[] {
  const out: Entity[] = [];
  let items: InlineItem[] = [];
  let footnotes: FootnoteRef[] = [];
  for (const t of tokens) {
    if (t.k === "run") {
      appendItems(items, t.items);
      if (t.footnotes.length > 0) footnotes = footnotes.concat(t.footnotes);
      continue;
    }
    if (t.k === "para") {
      out.push({ k: "para", id: t.id, map: t.map, items, footnotes });
    } else {
      if (items.length > 0) out.push({ k: "para", id: debrisBeforeId(t.id), map: null, items, footnotes });
      out.push(t.k === "toc" ? { k: "toc", id: t.id, map: t.map } : { k: "S", id: t.id, map: t.map });
    }
    items = [];
    footnotes = [];
  }
  if (atEnd && items.length > 0) out.push({ k: "para", id: flowEndId(holderId), map: null, items, footnotes });
  return out;
}

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

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/**
 * Block types a `p:type` can never name: they belong to containers / block objects,
 * so a ¶ carrying one reads as a plain paragraph.
 */
const RESERVED_TYPES: ReadonlySet<string> = new Set([
  BLOCK_TYPES.document,
  BLOCK_TYPES.section,
  BLOCK_TYPES.tableOfContents,
  BLOCK_TYPES.templateBody,
  BLOCK_TYPES.footnoteBody,
  "table",
  "table-row",
  "table-cell",
  "image",
  "horizontal-line",
]);

const EMPTY_ATTRS: ReadonlyAttrs = Object.freeze({});

interface Links {
  readonly parentId: BlockId | null;
  readonly prevSiblingId: BlockId | null;
  readonly nextSiblingId: BlockId | null;
}

export function entityRecord(e: BlockEntity, links: Links): Block {
  if (e.k === "toc") {
    return Object.freeze({
      id: e.id,
      type: BLOCK_TYPES.tableOfContents,
      attrs: Object.freeze(scalarsWithPrefix(e.map, "a:")),
      ...links,
      firstChildId: null,
      lastChildId: null,
      inlineContent: null,
    });
  }
  const base = {
    id: e.id,
    ...links,
    firstChildId: null,
    lastChildId: null,
    inlineContent: Object.freeze({ items: Object.freeze(e.items.slice()) }),
  };
  if (e.map === null) return Object.freeze({ ...base, type: BLOCK_TYPES.paragraph, attrs: EMPTY_ATTRS });
  const p = scalarsWithPrefix(e.map, "p:");
  const rawType = p["type"];
  const type = typeof rawType === "string" && rawType !== "" && !RESERVED_TYPES.has(rawType) ? rawType : BLOCK_TYPES.paragraph;
  delete p["type"];
  const m = scalarsWithPrefix(e.map, "m:");
  const ins = e.map.get("t:ins");
  const del = e.map.get("t:del");
  const bs = {
    ...(typeof ins === "string" ? { insertionId: ins } : {}),
    ...(typeof del === "string" ? { deletionId: del } : {}),
  };
  return Object.freeze({
    ...base,
    type,
    attrs: Object.freeze(p),
    ...(Object.keys(m).length > 0 ? { markAttrs: Object.freeze(m) } : {}),
    ...(Object.keys(bs).length > 0 ? { breakSuggestion: Object.freeze(bs) } : {}),
  });
}

/** An empty section record (attrs and sibling links come from {@link writeSections}). */
export function sectionRecord(id: BlockId, rootId: BlockId): Block {
  return containerRecord(id, BLOCK_TYPES.section, EMPTY_ATTRS, { parentId: rootId, prevSiblingId: null, nextSiblingId: null }, null, null);
}

function containerRecord(id: BlockId, type: string, attrs: ReadonlyAttrs, links: Links, first: BlockId | null, last: BlockId | null): Block {
  return Object.freeze({ id, type, attrs, ...links, firstChildId: first, lastChildId: last, inlineContent: null });
}

function itemEqual(a: InlineItem, b: InlineItem): boolean {
  if (a.kind === "text") return b.kind === "text" && a.text === b.text && attrsEqual(a.attrs, b.attrs);
  return b.kind === "embed" && a.embedType === b.embedType && attrsEqual(a.attrs, b.attrs) && attrsEqual(a.properties, b.properties);
}

const optAttrsEqual = (a: ReadonlyAttrs | undefined, b: ReadonlyAttrs | undefined): boolean =>
  a === undefined || b === undefined ? a === b : attrsEqual(a, b);

/** Two records read the same. */
export function blockEqual(a: Block, b: Block): boolean {
  if (
    a.id !== b.id ||
    a.type !== b.type ||
    a.parentId !== b.parentId ||
    a.prevSiblingId !== b.prevSiblingId ||
    a.nextSiblingId !== b.nextSiblingId ||
    a.firstChildId !== b.firstChildId ||
    a.lastChildId !== b.lastChildId ||
    !attrsEqual(a.attrs, b.attrs) ||
    !optAttrsEqual(a.markAttrs, b.markAttrs) ||
    a.breakSuggestion?.insertionId !== b.breakSuggestion?.insertionId ||
    a.breakSuggestion?.deletionId !== b.breakSuggestion?.deletionId ||
    (a.breakSuggestion === undefined) !== (b.breakSuggestion === undefined)
  ) {
    return false;
  }
  const ia = a.inlineContent?.items;
  const ib = b.inlineContent?.items;
  if (ia === undefined || ib === undefined) return ia === ib;
  if (ia.length !== ib.length) return false;
  for (let i = 0; i < ia.length; i++) {
    const x = ia[i];
    const y = ib[i];
    if (x === undefined || y === undefined || !itemEqual(x, y)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Working state: a mutable builder over the immutable maps
// ---------------------------------------------------------------------------

export class Working {
  trees: Record<TreeKind, PMap<Block>>;
  flows: PMap<FlowState>;
  listDefs: ReadonlyMap<string, ListDef>;
  readonly dirty = new Set<BlockId>();
  /** Flows derived from scratch during this derivation (their storage changes are already read). */
  readonly fresh = new Set<BlockId>();

  constructor(
    readonly rootId: BlockId,
    readonly docMap: Y.Map<unknown>,
    readonly registry: ObjectKindRegistry,
    base: Document | null,
  ) {
    this.trees = base === null ? { block: PMap.empty(), embedContent: PMap.empty(), templateContent: PMap.empty() } : { ...base.trees };
    this.flows = base === null ? PMap.empty() : base.flows;
    this.listDefs = base === null ? new Map() : base.listDefs;
  }

  get(tree: TreeKind, id: BlockId): Block | undefined {
    return this.trees[tree].get(id);
  }

  /** Write a record; an equal record keeps the old one (same identity, not dirty). */
  put(tree: TreeKind, b: Block): void {
    const old = this.trees[tree].get(b.id);
    if (old !== undefined && blockEqual(old, b)) return;
    this.trees[tree] = this.trees[tree].set(b.id, b);
    this.dirty.add(b.id);
  }

  patch(tree: TreeKind, id: BlockId, fields: Partial<Pick<Block, "prevSiblingId" | "nextSiblingId" | "firstChildId" | "lastChildId" | "parentId">>): void {
    const b = this.get(tree, id);
    if (b === undefined) throw new Error(`model: patch of missing block ${id}`);
    const same =
      (fields.prevSiblingId === undefined || fields.prevSiblingId === b.prevSiblingId) &&
      (fields.nextSiblingId === undefined || fields.nextSiblingId === b.nextSiblingId) &&
      (fields.firstChildId === undefined || fields.firstChildId === b.firstChildId) &&
      (fields.lastChildId === undefined || fields.lastChildId === b.lastChildId) &&
      (fields.parentId === undefined || fields.parentId === b.parentId);
    if (!same) this.put(tree, Object.freeze({ ...b, ...fields }));
  }

  del(tree: TreeKind, id: BlockId): void {
    this.trees[tree] = this.trees[tree].delete(id);
    this.dirty.add(id);
  }

  finish(): Document {
    return Object.freeze({
      rootId: this.rootId,
      trees: Object.freeze({ ...this.trees }),
      flows: this.flows,
      listDefs: this.listDefs,
      docMap: this.docMap,
      registry: this.registry,
    });
  }
}

// ---------------------------------------------------------------------------
// Flow derivation
// ---------------------------------------------------------------------------

export function piecesOf(arr: Y.Array<Y.Text> | null): Y.Text[] {
  if (arr === null) return [];
  const out: Y.Text[] = [];
  for (const p of arr.toArray()) if (p instanceof Y.Text) out.push(p);
  return out;
}


/** Split entities at `[S]`s: segments[i] ends at breaks[i]; the last segment ends the flow. */
export function segmentsOf(ents: readonly Entity[]): { segments: BlockEntity[][]; breaks: SectionBreakEntity[] } {
  const segments: BlockEntity[][] = [[]];
  const breaks: SectionBreakEntity[] = [];
  for (const e of ents) {
    if (e.k === "S") {
      breaks.push(e);
      segments.push([]);
    } else {
      const seg = segments[segments.length - 1];
      if (seg !== undefined) seg.push(e);
    }
  }
  return { segments, breaks };
}

/** Write a segment's records (siblings of one container), `prev` / `next` at its ends. */
export function writeSegment(w: Working, tree: TreeKind, seg: readonly BlockEntity[], parentId: BlockId, prev: BlockId | null, next: BlockId | null): void {
  for (let i = 0; i < seg.length; i++) {
    const e = seg[i];
    if (e === undefined) continue;
    w.put(
      tree,
      entityRecord(e, {
        parentId,
        prevSiblingId: i === 0 ? prev : (seg[i - 1]?.id ?? null),
        nextSiblingId: i === seg.length - 1 ? next : (seg[i + 1]?.id ?? null),
      }),
    );
  }
}

const isBlockEntity = (e: Entity): e is BlockEntity => e.k !== "S";

/** Derive one flow from scratch (and, recursively, the footnote bodies its paragraphs anchor). */
export function deriveFlow(w: Working, holderId: BlockId, tree: TreeKind, array: Y.Array<Y.Text> | null, isRoot: boolean): void {
  const flowSegments: Segment[] = [];
  for (const p of piecesOf(array)) flattenPiece(p, w.registry, flowSegments);
  let ents = group(flatten(flowSegments), true, holderId);
  if (!isRoot) ents = ents.filter(isBlockEntity);
  const synthetic = !ents.some(isBlockEntity);
  if (synthetic) ents.push({ k: "para", id: flowEndId(holderId), map: null, items: [], footnotes: [] });
  const { segments, breaks } = segmentsOf(ents);
  const sections: SectionInfo[] = isRoot
    ? [...breaks.map((b) => ({ id: sectionIdOf(b.id), map: b.map })), { id: finalSectionId(w.rootId), map: w.docMap }]
    : [];
  if (isRoot) {
    segments.forEach((seg, i) => {
      const sec = sections[i];
      if (sec === undefined) return;
      writeSegment(w, tree, seg, sec.id, null, null);
      w.put(tree, containerRecord(sec.id, BLOCK_TYPES.section, EMPTY_ATTRS, { parentId: holderId, prevSiblingId: null, nextSiblingId: null }, seg[0]?.id ?? null, seg[seg.length - 1]?.id ?? null));
    });
  } else {
    const seg = segments[0] ?? [];
    writeSegment(w, tree, seg, holderId, null, null);
    const type = tree === "templateContent" ? BLOCK_TYPES.templateBody : BLOCK_TYPES.footnoteBody;
    w.put(tree, containerRecord(holderId, type, EMPTY_ATTRS, { parentId: null, prevSiblingId: null, nextSiblingId: null }, seg[0]?.id ?? null, seg[seg.length - 1]?.id ?? null));
  }
  w.flows = w.flows.set(holderId, { holderId, tree, isRoot, array, segments: flowSegments, segIndex: indexSegments(flowSegments), sections, synthetic });
  w.fresh.add(holderId);
  if (isRoot) writeSections(w);
  for (const e of ents) if (e.k === "para") for (const f of e.footnotes) deriveFootnote(w, f);
}

export function deriveFootnote(w: Working, f: FootnoteRef): void {
  deriveFlow(w, footnoteBodyId(f.id), "embedContent", f.body === null ? null : flowOf(f.body), false);
}

/** The footnote body ids anchored by a block's inline content. */
export function footnoteBodiesOf(b: Block | undefined): BlockId[] {
  const out: BlockId[] = [];
  for (const item of b?.inlineContent?.items ?? []) {
    if (item.kind === "embed" && item.embedType === EMBED_TYPES.footnoteAnchor) {
      const id = item.properties["contentBlockId"];
      if (typeof id === "string") out.push(id);
    }
  }
  return out;
}

/** Every container of a flow: the sections + root, or the holder. */
function containersOf(fs: FlowState): BlockId[] {
  return fs.isRoot ? fs.sections.map((s) => s.id) : [fs.holderId];
}

/** Remove a flow's records (and, recursively, the footnote bodies it anchors). */
export function removeFlow(w: Working, holderId: BlockId): void {
  const fs = w.flows.get(holderId);
  if (fs === undefined) return;
  for (const c of containersOf(fs)) {
    let id = w.get(fs.tree, c)?.firstChildId ?? null;
    while (id !== null) {
      const b = w.get(fs.tree, id);
      if (b === undefined) break;
      for (const body of footnoteBodiesOf(b)) removeFlow(w, body);
      w.del(fs.tree, id);
      id = b.nextSiblingId;
    }
    w.del(fs.tree, c);
  }
  if (fs.isRoot) w.del(fs.tree, fs.holderId);
  w.flows = w.flows.delete(holderId);
}

// ---------------------------------------------------------------------------
// Sections (R4 / R5) and the root record
// ---------------------------------------------------------------------------

/** R5's link slots: the only `h:` keys read, and the section attrs they resolve to. */
export const HEADER_LINKS: readonly { readonly key: string; readonly attr: string }[] = ["header", "footer"].flatMap((region) =>
  ["default", "first", "even"].map((variant) => ({
    key: `h:${region}:${variant}`,
    attr: variant === "default" ? `${region}BlockId` : `${region}${variant.charAt(0).toUpperCase()}${variant.slice(1)}BlockId`,
  })),
);
const LINK_ATTRS: ReadonlySet<string> = new Set(HEADER_LINKS.map((l) => l.attr));

/** Rewrite every section record's attrs (s:* + R5 links) and sibling links, and the root record. */
export function writeSections(w: Working): void {
  const fs = w.flows.get(w.rootId);
  if (fs === undefined) return;
  const bodies = childMap(w.docMap, BODIES_KEY);
  const inherited = new Map<string, BlockId | null>();
  fs.sections.forEach((s, i) => {
    const attrs: Record<string, unknown> = scalarsWithPrefix(s.map, "s:");
    for (const a of LINK_ATTRS) delete attrs[a];
    for (const { key, attr } of HEADER_LINKS) {
      const raw = s.map.get(key);
      let link = inherited.get(key) ?? null;
      if (raw === "none") link = null;
      else if (typeof raw === "string" && bodies?.get(raw) instanceof Y.Map) link = templateBodyId(raw);
      inherited.set(key, link);
      if (link !== null) attrs[attr] = link;
    }
    const old = w.get(fs.tree, s.id);
    w.put(
      fs.tree,
      containerRecord(
        s.id,
        BLOCK_TYPES.section,
        Object.freeze(attrs),
        { parentId: w.rootId, prevSiblingId: fs.sections[i - 1]?.id ?? null, nextSiblingId: fs.sections[i + 1]?.id ?? null },
        old?.firstChildId ?? null,
        old?.lastChildId ?? null,
      ),
    );
  });
  w.put(
    fs.tree,
    containerRecord(w.rootId, BLOCK_TYPES.document, EMPTY_ATTRS, { parentId: null, prevSiblingId: null, nextSiblingId: null }, fs.sections[0]?.id ?? null, fs.sections[fs.sections.length - 1]?.id ?? null),
  );
}

// ---------------------------------------------------------------------------
// List definitions (R11 storage read)
// ---------------------------------------------------------------------------

const MAX_LEVEL = 8;
const LEVEL_FIELDS = ["style", "start", "restart"];
export const DEFAULT_LIST_LEVEL: ListLevelDef = Object.freeze({ style: "decimal", start: 1, restart: "after-break" });
const STYLES: ReadonlySet<unknown> = new Set(["decimal", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman", "disc", "circle", "square"]);
const RESTARTS: ReadonlySet<unknown> = new Set(["always", "never", "after-break"]);
const isStyle = (v: unknown): v is CounterStyle => STYLES.has(v);
const isRestart = (v: unknown): v is ListRestart => RESTARTS.has(v);

/**
 * `listDefs`: `Y.Map<listId, Y.Map>` with flat keys `<level>:style|start|restart`
 * (level written as a plain decimal 0..8; no other spelling is read).
 * Levels run 0..(highest level key); a missing / malformed field takes the default level's.
 */
export function readListDefs(docMap: Y.Map<unknown>): ReadonlyMap<string, ListDef> {
  const out = new Map<string, ListDef>();
  const defs = childMap(docMap, LIST_DEFS_KEY);
  const ids: string[] = [];
  defs?.forEach((_def, listId) => ids.push(listId));
  for (const listId of ids.sort()) {
    const def = defs?.get(listId);
    if (!(def instanceof Y.Map)) continue;
    // Only the exact keys `${n}:style|start|restart`, n = 0..8, are read.
    let top = -1;
    for (let n = 0; n <= MAX_LEVEL; n++) if (LEVEL_FIELDS.some((f) => def.has(`${n}:${f}`))) top = n;
    const levels: ListLevelDef[] = [];
    for (let i = 0; i <= top; i++) {
      const style: unknown = def.get(`${i}:style`);
      const start: unknown = def.get(`${i}:start`);
      const restart: unknown = def.get(`${i}:restart`);
      levels.push(
        Object.freeze({
          style: isStyle(style) ? style : DEFAULT_LIST_LEVEL.style,
          start: typeof start === "number" && Number.isFinite(start) ? start : DEFAULT_LIST_LEVEL.start,
          restart: isRestart(restart) ? restart : DEFAULT_LIST_LEVEL.restart,
        }),
      );
    }
    out.set(listId, Object.freeze({ levels: Object.freeze(levels) }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// From scratch
// ---------------------------------------------------------------------------

/** Derive the whole document from storage. Throws when the document has no schema-4 root. */
export function deriveDocument(doc: Y.Doc, registry: ObjectKindRegistry): Document {
  const docMap = getDocMap(doc);
  const rootId = docMap === null ? null : typeId(docMap);
  if (docMap === null || rootId === null) throw new Error("model: document has no schema-4 root");
  const w = new Working(rootId, docMap, registry, null);
  deriveAll(w);
  return w.finish();
}

export function deriveAll(w: Working): void {
  deriveFlow(w, w.rootId, "block", flowOf(w.docMap), true);
  childMap(w.docMap, BODIES_KEY)?.forEach((body, bodyId) => {
    if (body instanceof Y.Map) deriveFlow(w, templateBodyId(bodyId), "templateContent", flowOf(body), false);
  });
  w.listDefs = readListDefs(w.docMap);
}

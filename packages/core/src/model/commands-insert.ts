/**
 * Single-user commands, part 2 (r7 §5 + review-r7 G1, G6): inline objects (C11 /
 * C12), the horizontal rule (C13), TOC (C14) and block-object delete (C10), section
 * breaks (C15), footnotes (S1), headers / footers (S2), generic markers, paste (C17).
 * Shared machinery is in `commands.ts`.
 *
 * Main-tree only, as today (a no-op elsewhere): rules, TOCs, section breaks,
 * footnotes, headers / footers, and a paste that holds a TOC, `[S]` or footnote.
 */
import * as Y from "yjs";
import type { BlockId, InlineItem, ReadonlyAttrs } from "./block";
import type { Document } from "./derive";
import { markerKey, markerRanges, resolveBlock } from "./document";
import { resolveObjectProps } from "./object-kinds";
import { chunked, type InsertUnit, type Plan, type Write } from "./plan";
import { type ModelPosition, type StoragePoint, caretAt, comparePoints, paragraphLayout, pointAfter, pointBefore, positionAtPoint, terminatorOf } from "./position";
import { BLOCK_TYPES } from "./block";
import {
  type At,
  type CommandContext,
  atOf,
  checkScalars,
  type Keys,
  deleteRange,
  diffKeys,
  insertAt,
  keysOf,
  keysWrite,
  mappedSelection,
  materialize,
  plan,
  rangeOf,
  replaceSelection,
  splitWrites,
} from "./commands";
import {
  BODIES_KEY,
  ITEM_KINDS,
  childMap,
  isWriteScalar,
  kindOf,
  newBody,
  newFootnote,
  newFootnoteOf,
  newHorizontalRule,
  newMarker,
  newObject,
  newParagraphMark,
  newSectionBreak,
  newTableOfContents,
  typeId,
  type FlatKeys,
  type ObjectProps,
  type Scalar,
} from "./storage";

const inMainTree = (a: At): boolean => a.L.tree === "block";

/** The embedded item map at storage `index` of `piece` (Plans read storage only where the version keeps no reference). */
function mapAtIndex(piece: Y.Text, index: number): Y.Map<unknown> | null {
  let n = 0;
  for (let it = piece._start; it !== null; it = it.right) {
    if (it.deleted || !it.countable) continue;
    if (n === index) return it.content instanceof Y.ContentType && it.content.type instanceof Y.Map ? it.content.type : null;
    n += it.length;
    if (n > index) return null;
  }
  return null;
}

function checkKeys(keys: FlatKeys, prefixes: readonly string[], what: string): Keys {
  const out: Keys = {};
  for (const [k, v] of Object.entries(keys)) {
    if (!prefixes.some((p) => k.startsWith(p) && k.length > p.length)) throw new Error(`model: ${what} key ${k} is not ${prefixes.join(" / ")}`);
    if (!isWriteScalar(v)) throw new Error(`model: ${what} key ${k} must be null, a string, a finite number or a boolean`);
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// C11 / C12 inline objects
// ---------------------------------------------------------------------------

function validObject(ctx: CommandContext, kind: string, o: ObjectProps): void {
  const props: Record<string, unknown> = checkScalars(o.props ?? {}, "object prop");
  if (resolveObjectProps(ctx.version.registry, kind, props) === null) throw new Error(`model: object kind ${kind} is unregistered or misses a required prop`);
  for (const n of [o.w, o.h]) if (n !== undefined && !(Number.isFinite(n) && n >= 0)) throw new Error("model: object size must be a finite number ≥ 0");
}

/** C11: insert an inline object (an image: kind "image", `props.src`) at the caret, over the selection; inline (no `wrap`), as GDocs Insert ▸ Image. */
export function insertObject(ctx: CommandContext, kind: string, o: Omit<ObjectProps, "wrap"> = {}): Plan | null {
  validObject(ctx, kind, o);
  return replaceSelection(ctx, (attrs) => [{ embed: newObject(kind, o), attrs }]);
}

export interface ObjectPropsPatch {
  /** null = inline (deletes `wrap`). */
  readonly wrap?: "left" | "right" | "break" | null;
  readonly w?: number | null;
  readonly h?: number | null;
  /** Kind props (`a:*`); null deletes. */
  readonly props?: Readonly<Record<string, Scalar>>;
}

/** C12: write wrap / size / kind props on the object whose unit starts at `at`. */
export function setObjectProps(ctx: CommandContext, at: ModelPosition, patch: ObjectPropsPatch): Plan | null {
  const L = paragraphLayout(ctx.version, at.blockId);
  const item = L === null ? null : embedAt(L.block.inlineContent?.items ?? [], at.offset);
  if (L === null || item === null || item.kind !== "embed" || item.embedType !== "object") return null;
  const p = pointBefore(L, at.offset);
  const map = p === null ? null : mapAtIndex(p.piece, p.index);
  if (map === null || kindOf(map) !== ITEM_KINDS.object) return null;
  const keys: Record<string, Scalar | undefined> = {};
  if (patch.wrap !== undefined) {
    if (patch.wrap !== null && !["left", "right", "break"].includes(patch.wrap)) throw new Error("model: wrap must be left / right / break / null");
    keys["wrap"] = patch.wrap ?? undefined;
  }
  for (const [k, v] of [["w", patch.w], ["h", patch.h]] as const) {
    if (v === undefined) continue;
    if (v !== null && !(Number.isFinite(v) && v >= 0)) throw new Error("model: object size must be a finite number ≥ 0");
    keys[k] = v ?? undefined;
  }
  for (const [k, v] of Object.entries(patch.props ?? {})) {
    if (k === "") throw new Error("model: object prop with an empty key");
    if (!isWriteScalar(v)) throw new Error(`model: object prop ${k} must be null, a string, a finite number or a boolean`);
    keys[`a:${k}`] = v ?? undefined;
  }
  // A patch may not turn a valid object into a placeholder (removing / retyping a required prop);
  // an object that already reads as a placeholder can still be patched.
  const stored: Record<string, unknown> = {};
  map.forEach((v, k) => {
    if (k.startsWith("a:")) stored[k.slice(2)] = v;
  });
  const patched: Record<string, unknown> = { ...stored };
  for (const [k, v] of Object.entries(keys)) if (k.startsWith("a:")) patched[k.slice(2)] = v;
  const kind = map.get("kind");
  const reg = ctx.version.registry;
  if (typeof kind === "string" && resolveObjectProps(reg, kind, stored) !== null && resolveObjectProps(reg, kind, patched) === null) {
    throw new Error("model: the patch removes or retypes a required object prop");
  }
  const writes = keysWrite(map, keys);
  if (writes.length === 0) return null;
  const sel = ctx.selection;
  return plan(ctx.version, writes, () => sel);
}

/** The embed whose unit starts at `offset`, or null. */
function embedAt(items: readonly InlineItem[], offset: number): InlineItem | null {
  let pos = 0;
  for (const i of items) {
    const n = i.kind === "text" ? i.text.length : 1;
    if (offset === pos && i.kind === "embed") return i;
    if (offset < pos + n) return null;
    pos += n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// C13 horizontal rule (G1: Enter's shape), C14 TOC, C10 block-object delete
// ---------------------------------------------------------------------------

/**
 * C13 with review-r7 G1's shape: before the focus paragraph P's ¶ insert ¶N (a copy
 * of P's keys), `[hr]`, ¶M — `x¶N [hr]¶M ¶P` — and clear ¶P's keys, so the derived
 * result is today's: P's text, a rule paragraph, then an empty Normal paragraph with
 * the caret at its start. Every insert is at or before the flow's final ¶ (A1).
 * Debris P gets its ¶ (X2). Applied directly in suggest mode too (G2).
 */
export function insertHorizontalRule(ctx: CommandContext): Plan | null {
  // Today's shape: at the selection's focus paragraph (no split, no range delete).
  const focus = atOf(ctx, ctx.selection.focus);
  if (focus === null || !inMainTree(focus)) return null;
  const L = focus.L;
  const p = pointAfter(L, L.length);
  if (p === null) return null;
  const units: InsertUnit[] = [{ embed: newParagraphMark(keysOf(L)), attrs: {} }, { embed: newHorizontalRule(), attrs: {} }, { embed: newParagraphMark(), attrs: {} }];
  const writes: Write[] = [];
  let caretId: () => BlockId;
  if (L.mark !== null) {
    writes.push(insertAt(p, units), ...keysWrite(L.mark, diffKeys(keysOf(L), {})));
    const id = L.block.id;
    caretId = () => id;
  } else {
    const m = materialize(L, {}, units);
    if (m === null) return null;
    writes.push(...m.writes);
    const fallback = L.block.id;
    caretId = () => typeId(m.map) ?? fallback;
  }
  return plan(ctx.version, writes, () => caretAt(caretId(), 0));
}

/** Insert block object `obj` at the focus (C14's placement): k > 0 splits (C2 keys) and puts it before the tail; k = 0 puts it before the paragraph, after a ¶M when the item before is a block object. Caret: the tail's start. */
function insertBlockAt(ctx: CommandContext, obj: Y.Map<unknown>): Plan | null {
  // At the selection's focus, as today (no range delete).
  const at = atOf(ctx, ctx.selection.focus);
  if (at === null || !inMainTree(at)) return null;
  const point = { start: at, end: at, collapsed: true };
  if (at.offset > 0) {
    const s = splitWrites(ctx, point, [{ embed: obj, attrs: {} }]);
    if (s === null) return null;
    return plan(ctx.version, s.writes, () => caretAt(s.tail(), 0));
  }
  const head = pointAfter(at.L, 0);
  if (head === null) return null;
  const units: InsertUnit[] = at.L.before?.token.k === "toc" ? [{ embed: newParagraphMark(), attrs: {} }] : [];
  units.push({ embed: obj, attrs: {} });
  const id = at.L.block.id;
  return plan(ctx.version, [insertAt(head, units)], () => caretAt(id, 0));
}

/** C14: insert a table of contents (`options` → `a:*`) at the focus. */
export function insertTableOfContents(ctx: CommandContext, options: Readonly<Record<string, Scalar>> = {}): Plan | null {
  const keys: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(options)) keys[`a:${k}`] = v;
  return insertBlockAt(ctx, newTableOfContents(checkKeys(keys, ["a:"], "TOC")));
}

/** C10: delete block object `id` (a TOC): just its item. Caret: the position where it was. */
export function deleteBlockObject(ctx: CommandContext, id: BlockId): Plan | null {
  const d = ctx.version;
  const b = resolveBlock(d, id);
  const fs = d.flows.get(d.rootId);
  if (b === null || b.block.type !== BLOCK_TYPES.tableOfContents || fs === undefined) return null;
  // Its own terminator, whatever follows it ([T][U]¶ and [T][S] included).
  const t = terminatorOf(d, fs, id);
  const seg = t === null ? undefined : fs.segments[t.seg];
  if (t === null || seg === undefined || t.token.k !== "toc") return null;
  const piece = seg.piece;
  const index = t.index;
  const sel = ctx.selection;
  return plan(d, [{ k: "delete", piece, index, len: 1 }], (after) => {
    // The caret: whatever now sits where the TOC was.
    const afs = after.flows.get(after.rootId);
    const p = afs === undefined ? null : positionAtPoint(after, afs, piece, index, 1);
    return p === null ? sel : caretAt(p.blockId, p.offset);
  });
}

// ---------------------------------------------------------------------------
// C15 section break
// ---------------------------------------------------------------------------

/** The `[S]` map (or DocMap) holding the props of the section that contains main-tree paragraph `at`. */
function sectionOwner(d: Document, at: At): Y.Map<unknown> | null {
  const sectionId = at.L.block.parentId;
  return d.flows.get(d.rootId)?.sections.find((s) => s.id === sectionId)?.map ?? null;
}

/**
 * C15: split the focus paragraph at k and put `[S]` after ¶N. The `[S]` copies the
 * section's `s:*`; its explicit `h:*` move to the new `[S]` so the tail section
 * inherits them ("Same as Previous", Word). Caret: the tail's start.
 */
export function insertSectionBreak(ctx: CommandContext): Plan | null {
  const at = atOf(ctx, ctx.selection.focus);
  if (at === null || !inMainTree(at)) return null;
  const owner = sectionOwner(ctx.version, at);
  if (owner === null) return null;
  const s: Record<string, Scalar> = {};
  const moved: Record<string, Scalar | undefined> = {};
  owner.forEach((v, k) => {
    if (!isWriteScalar(v)) return; // a peer's non-scalar / bigint / NaN is not copied
    if (k.startsWith("s:")) s[k] = v;
    else if (k.startsWith("h:")) {
      s[k] = v;
      moved[k] = undefined;
    }
  });
  const split = splitWrites(ctx, { start: at, end: at, collapsed: true }, [{ embed: newSectionBreak(s), attrs: {} }]);
  if (split === null) return null;
  const writes = [...split.writes, ...keysWrite(owner, moved)];
  return plan(ctx.version, writes, () => caretAt(split.tail(), 0));
}

// ---------------------------------------------------------------------------
// S1 footnote, S2 header / footer
// ---------------------------------------------------------------------------

/** S1: insert a footnote anchor at the caret (over the selection); its body holds one ¶; the caret goes into the body. */
export function insertFootnote(ctx: CommandContext): Plan | null {
  const r = rangeOf(ctx);
  if (r === null || !inMainTree(r.start)) return null;
  const mark = newParagraphMark();
  return replaceSelection(
    ctx,
    (attrs) => [{ embed: newFootnote(mark), attrs }],
    () => {
      const id = typeId(mark);
      return id === null ? null : caretAt(id, 0);
    },
  );
}

export type Region = "header" | "footer";
export type Variant = "default" | "first" | "even";

const linkKey = (region: Region, variant: Variant): string => `h:${region}:${variant}`;
const linkAttr = (region: Region, variant: Variant): string => (variant === "default" ? `${region}BlockId` : `${region}${variant.charAt(0).toUpperCase()}${variant.slice(1)}BlockId`);

/**
 * S2 insert: link a new header / footer body (one ¶) on the focus's section and put
 * the caret in it. A section that already shows one (its own or inherited, R5)
 * gets the caret in that body instead (GDocs: one header per section; Word: "Same as
 * Previous" edits the shared one).
 */
export function insertHeaderFooter(ctx: CommandContext, region: Region, variant: Variant = "default"): Plan | null {
  const r = rangeOf(ctx);
  if (r === null || !inMainTree(r.start)) return null;
  const d = ctx.version;
  const section = r.start.L.block.parentId === null ? null : resolveBlock(d, r.start.L.block.parentId)?.block;
  const owner = sectionOwner(d, r.start);
  const bodies = childMap(d.docMap, BODIES_KEY);
  const doc = d.docMap.doc;
  if (section === undefined || section === null || owner === null || bodies === null || doc === null) return null;
  const existing = section.attrs[linkAttr(region, variant)];
  if (typeof existing === "string") {
    const first = resolveBlock(d, existing)?.block.firstChildId;
    if (first === undefined || first === null) return null;
    return plan(d, [], () => caretAt(first, 0));
  }
  // A body id unique in the document: this client's id and next clock (never reused).
  const bodyId = `b${doc.clientID}.${Y.getState(doc.store, doc.clientID)}`;
  const mark = newParagraphMark();
  const writes: Write[] = [{ k: "entry", map: bodies, key: bodyId, value: newBody(mark) }, ...keysWrite(owner, { [linkKey(region, variant)]: bodyId })];
  const sel = ctx.selection;
  return plan(d, writes, () => {
    const id = typeId(mark);
    return id === null ? sel : caretAt(id, 0);
  });
}

/**
 * S2 remove: the section shows no header / footer (`none`). A body the section links
 * itself is deleted; an inherited one is kept for the sections that own it.
 */
export function removeHeaderFooter(ctx: CommandContext, region: Region, variant: Variant = "default"): Plan | null {
  const r = rangeOf(ctx);
  if (r === null || !inMainTree(r.start)) return null;
  const d = ctx.version;
  const owner = sectionOwner(d, r.start);
  const bodies = childMap(d.docMap, BODIES_KEY);
  if (owner === null || bodies === null) return null;
  const key = linkKey(region, variant);
  const own = owner.get(key);
  const section = r.start.L.block.parentId === null ? undefined : resolveBlock(d, r.start.L.block.parentId)?.block;
  if (section?.attrs[linkAttr(region, variant)] === undefined) return null; // the section shows none
  const writes: Write[] = keysWrite(owner, { [key]: "none" });
  if (typeof own === "string" && bodies.get(own) instanceof Y.Map) writes.push({ k: "entry", map: bodies, key: own, value: null });
  const sel = ctx.selection;
  return plan(d, writes, () => sel);
}

// ---------------------------------------------------------------------------
// Generic markers (D11; R12 pairs them)
// ---------------------------------------------------------------------------

/** Insert a marker pair `(ns, id)` around the selection (zero-width at a caret). A key already paired in the document is refused (throws). */
export function insertMarker(ctx: CommandContext, ns: string, id: string): Plan | null {
  if (ns === "" || id === "") throw new Error("model: a marker needs a namespace and an id");
  if (markerRanges(ctx.version).has(markerKey(ns, id))) throw new Error(`model: marker ${ns}/${id} already exists`);
  const r = rangeOf(ctx);
  if (r === null) return null;
  const start: InsertUnit = { embed: newMarker(ns, id, "start"), attrs: {} };
  const end: InsertUnit = { embed: newMarker(ns, id, "end"), attrs: {} };
  if (r.start.L.fs.synthetic) {
    // R17 (an empty holder): the markers go in with the paragraph's ¶ (X2).
    const m = materialize(r.start.L, {}, [start, end]);
    if (m === null) return null;
    return plan(ctx.version, m.writes, () => {
      const pid = typeId(m.map);
      return pid === null ? ctx.selection : caretAt(pid, 0);
    });
  }
  const a = pointAfter(r.start.L, r.start.offset);
  const b = pointAfter(r.end.L, r.end.offset);
  if (a === null || b === null) return null;
  const writes: Write[] = r.collapsed ? [insertAt(a, [start, end])] : [insertAt(a, [start]), insertAt(b, [end])];
  const base = ctx.version;
  const sel = ctx.selection;
  return plan(base, writes, (after) => mappedSelection(base, sel, after));
}

/** Remove the paired markers `(ns, id)`. */
export function removeMarker(ctx: CommandContext, ns: string, id: string): Plan | null {
  const range = markerRanges(ctx.version).get(markerKey(ns, id));
  if (range === undefined) return null;
  const writes: Write[] = [];
  for (const pt of [range.start, range.end]) {
    const L = paragraphLayout(ctx.version, pt.blockId);
    const p = L === null ? null : pointBefore(L, pt.offset);
    const m = p === null ? null : mapAtIndex(p.piece, p.index);
    if (p === null || m === null || kindOf(m) !== ITEM_KINDS.marker) return null;
    writes.push({ k: "delete", piece: p.piece, index: p.index, len: 1 });
  }
  const base = ctx.version;
  const sel = ctx.selection;
  return plan(base, writes, (after) => mappedSelection(base, sel, after));
}

// ---------------------------------------------------------------------------
// C17 paste
// ---------------------------------------------------------------------------

/** A model fragment item (what copy produces; a paste payload). */
export type FragmentItem =
  | { readonly k: "text"; readonly text: string; readonly attrs?: ReadonlyAttrs }
  /** A ¶ with its `p:*` / `m:*` keys. */
  | { readonly k: "para"; readonly keys?: FlatKeys }
  | { readonly k: "object"; readonly kind: string; readonly props?: ObjectProps; readonly attrs?: ReadonlyAttrs }
  | { readonly k: "hr"; readonly attrs?: ReadonlyAttrs }
  /** A footnote anchor and its body's content (text / ¶ / object / rule items), placed before the body's ¶. */
  | { readonly k: "footnote"; readonly body: readonly FragmentItem[]; readonly attrs?: ReadonlyAttrs }
  /** A TOC block object (`a:*` keys). */
  | { readonly k: "toc"; readonly keys?: FlatKeys }
  /** A section break (`s:*` keys; a pasted `[S]` never carries `h:*`). */
  | { readonly k: "S"; readonly keys?: FlatKeys };

const isBlockItem = (i: FragmentItem): boolean => i.k === "toc" || i.k === "S";

function units(ctx: CommandContext, items: readonly FragmentItem[], inBody: boolean): InsertUnit[] {
  const out: InsertUnit[] = [];
  let prev: FragmentItem | null = null;
  for (const i of items) {
    // W1 / W2 inside the payload: a block object or [S] follows a ¶ (or starts the payload); nothing abuts a TOC but a ¶.
    if (isBlockItem(i) && prev !== null && prev.k !== "para") throw new Error("model: a pasted block object or [S] must follow a ¶");
    if (prev !== null && prev.k === "toc" && i.k !== "para") throw new Error("model: a pasted TOC must be followed by a ¶");
    if (inBody && (isBlockItem(i) || i.k === "footnote")) throw new Error("model: a footnote body holds no TOC, [S] or footnote");
    const attrs = "attrs" in i && i.attrs !== undefined ? checkScalars(i.attrs, "pasted attr") : {};
    switch (i.k) {
      case "text":
        if (i.text !== "") out.push({ text: i.text, attrs });
        break;
      case "para":
        out.push({ embed: newParagraphMark(checkKeys(i.keys ?? {}, ["p:", "m:"], "paragraph")), attrs: {} });
        break;
      case "object":
        validObject(ctx, i.kind, i.props ?? {});
        out.push({ embed: newObject(i.kind, i.props ?? {}), attrs });
        break;
      case "hr":
        out.push({ embed: newHorizontalRule(), attrs });
        break;
      case "footnote": {
        // The body: its content then its final ¶ (G3), in pieces within the cap (X11); nested types created with their parent (G1).
        const body = [...units(ctx, i.body, true), { embed: newParagraphMark(), attrs: {} }];
        out.push({ embed: newFootnoteOf(...chunked(body)), attrs });
        break;
      }
      case "toc":
        out.push({ embed: newTableOfContents(checkKeys(i.keys ?? {}, ["a:"], "TOC")), attrs: {} });
        break;
      case "S": {
        const keys = Object.fromEntries(Object.entries(i.keys ?? {}).filter(([k]) => !k.startsWith("h:")));
        out.push({ embed: newSectionBreak(checkKeys(keys, ["s:"], "section")), attrs: {} });
        break;
      }
    }
    prev = i;
  }
  return out;
}

/**
 * C17 with review-r7 G6. A payload with no ¶ and no block object is typed (C1).
 * Otherwise it goes in at the caret (a range is deleted first): the first pasted
 * paragraph's text continues the head paragraph, which then carries the pasted ¶'s
 * keys (Word); the payload's last paragraph joins the tail, whose ¶ survives. Only a
 * payload that STARTS with a block object / `[S]` splits at k > 0 (C14's placement);
 * at k = 0 it gets ¶M first when the item before is a block object (or, for `[S]`,
 * not a ¶). Caret: after the pasted content.
 */
export function paste(ctx: CommandContext, fragment: readonly FragmentItem[]): Plan | null {
  if (fragment.length === 0) return null;
  const r = rangeOf(ctx);
  if (r === null) return null;
  const needsMain = fragment.some((i) => isBlockItem(i) || i.k === "footnote");
  if (needsMain && !inMainTree(r.start)) return null;
  const us = units(ctx, fragment, false);
  const structural = fragment.some((i) => i.k === "para" || isBlockItem(i));
  // Read units after the payload's last ¶ / block object: the caret's offset in the tail.
  let lastLen = 0;
  for (const i of fragment) {
    if (i.k === "para" || isBlockItem(i)) lastLen = 0;
    else lastLen += i.k === "text" ? i.text.length : 1;
  }
  if (!structural) return replaceSelection(ctx, () => us);
  const first = fragment[0];
  const startsWithBlock = first !== undefined && isBlockItem(first);
  if (startsWithBlock && r.start.offset > 0) {
    const s = splitWrites(ctx, r, us);
    if (s === null) return null;
    return plan(ctx.version, s.writes, () => caretAt(s.tail(), lastLen));
  }
  const { start } = r;
  const p = pointAfter(start.L, start.offset);
  if (p === null || start.L.fs.synthetic) {
    // R17 (an empty holder): the payload goes in with a ¶ of its own (X2), which its last paragraph joins.
    const m = materialize(start.L, {}, us);
    if (m === null) return null;
    return plan(ctx.version, m.writes, () => {
      const pid = typeId(m.map);
      return pid === null ? ctx.selection : caretAt(pid, lastLen);
    });
  }
  const writes: Write[] = [];
  let tail: () => BlockId = () => start.L.block.id;
  let ins: StoragePoint = p;
  if (!r.collapsed) {
    // A range is deleted first (C9, with its join), then the payload goes in at the collapse point.
    const del = deleteRange(r.start, r.end);
    if (del === null) return null;
    writes.push(...del.writes);
    tail = del.survivor;
    if (comparePoints(del.at, p) < 0) ins = del.at;
  }
  // What precedes the insertion point: the paragraph's previous terminator, or the flow start when the range took leading objects.
  const before = ins === p ? start.L.before?.token.k : undefined;
  const lead: InsertUnit[] = [];
  if (startsWithBlock && start.offset === 0 && (before === "toc" || (first?.k === "S" && before !== "para"))) lead.push({ embed: newParagraphMark(), attrs: {} });
  writes.push(insertAt(ins, [...lead, ...us]));
  return plan(ctx.version, writes, () => caretAt(tail(), lastLen));
}

import { BLOCK_TYPES, type Block, EMBED_TYPES, type InlineItem, type ReadonlyAttrs } from "../../block";
import type { Document, TreeKind } from "../../document/types";
import { HEADER_LINKS } from "../../derive/sections";
import { unitsOf } from "../../position/items";
import { paragraphLayout } from "../../position/paragraph-layout";
import type { FlatKeys } from "../../storage/scalar";
import type { Range } from "./at";
import type { FragmentItem } from "./fragment";
import { keysOf, scalar } from "./paragraph-keys";

// ---------------------------------------------------------------------------
// Copy's reader: a slice of the READ structure (PM's `selection.content()`), the inverse of paste
// ---------------------------------------------------------------------------

/** Read attrs as storage keys under `prefix` (scalars only); undefined when there are none. */
function keysFrom(attrs: ReadonlyAttrs, prefix: string, skip: ReadonlySet<string> = new Set()): FlatKeys | undefined {
  const out: Record<string, NonNullable<ReturnType<typeof scalar>> | null> = {};
  for (const [k, v] of Object.entries(attrs)) {
    const s = scalar(v);
    if (s !== undefined && !skip.has(k)) out[`${prefix}${k}`] = s;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

const withAttrs = <T extends FragmentItem>(item: T, attrs: ReadonlyAttrs): T => (Object.keys(attrs).length === 0 ? item : { ...item, attrs });

/** A read inline item as a fragment item; null for what is not copied (anchors). */
function itemOf(d: Document, i: InlineItem): FragmentItem | null {
  if (i.kind === "text") return withAttrs({ k: "text", text: i.text }, i.attrs);
  const p = i.properties;
  switch (i.embedType) {
    case EMBED_TYPES.object: {
      const o: { w?: number; h?: number; wrap?: "left" | "right" | "break"; props?: FlatKeys } = {};
      const [w, h, wrap, props] = [p["width"], p["height"], p["wrap"], p["props"]];
      if (typeof w === "number") o.w = w;
      if (typeof h === "number") o.h = h;
      if (wrap === "left" || wrap === "right" || wrap === "break") o.wrap = wrap;
      const keys = typeof props === "object" && props !== null ? keysFrom(Object.fromEntries(Object.entries(props)), "") : undefined;
      if (keys !== undefined) o.props = keys;
      return withAttrs({ k: "object", kind: String(p["kind"]), ...(Object.keys(o).length === 0 ? {} : { props: o }) }, i.attrs);
    }
    case EMBED_TYPES.horizontalLine:
      return withAttrs({ k: "hr" }, i.attrs);
    case EMBED_TYPES.lineBreak:
      return withAttrs({ k: "lineBreak" }, i.attrs);
    case EMBED_TYPES.field:
      return withAttrs({ k: "field", field: String(p["fieldKind"]), numberStyle: String(p["numberStyle"]) }, i.attrs);
    case EMBED_TYPES.footnoteAnchor: {
      const body = p["contentBlockId"];
      return typeof body === "string" ? withAttrs({ k: "footnote", body: readAll(d, "embedContent", body) }, i.attrs) : null;
    }
    default:
      return null; // markers: anchors are not copied
  }
}

/** A paragraph's read items in read units `[from, to)`. */
function inlineSlice(d: Document, b: Block, from: number, to: number): FragmentItem[] {
  const out: FragmentItem[] = [];
  let at = 0;
  for (const i of b.inlineContent?.items ?? []) {
    const n = unitsOf(i);
    const [a, z] = [Math.max(from, at), Math.min(to, at + n)];
    at += n;
    if (z <= a) continue;
    const item = i.kind === "text" && z - a < n ? withAttrs<FragmentItem>({ k: "text", text: i.text.slice(a - (at - n), z - (at - n)) }, i.attrs) : itemOf(d, i);
    if (item !== null) out.push(item);
  }
  return out;
}

/** A paragraph's ¶ with its keys (a debris / implicit paragraph's is keyless). */
function paraOf(d: Document, b: Block): FragmentItem {
  const L = paragraphLayout(d, b.id);
  const keys = L === null ? {} : keysOf(L);
  return Object.keys(keys).length === 0 ? { k: "para" } : { k: "para", keys };
}

/** A block object's item; null for a table (C2). */
function blockObjectOf(b: Block): FragmentItem | null {
  if (b.type === BLOCK_TYPES.tableOfContents) {
    const keys = keysFrom(b.attrs, "a:");
    return keys === undefined ? { k: "toc" } : { k: "toc", keys };
  }
  return null;
}

const LINK_ATTRS: ReadonlySet<string> = new Set(HEADER_LINKS.map((l) => l.attr));

/**
 * The `[S]` ending section `s`: its `s:*` props, and its header / footer links as read against the section before it
 * (R5): the same body is inherited (no key), none where one was is `"none"`, another body is copied whole.
 */
function sectionOf(d: Document, s: Block): FragmentItem {
  const keys: Record<string, NonNullable<ReturnType<typeof scalar>> | null> = { ...keysFrom(s.attrs, "s:", LINK_ATTRS) };
  const prev = s.prevSiblingId === null ? undefined : d.trees.block.get(s.prevSiblingId)?.attrs;
  const bodies: Record<string, FragmentItem[]> = {};
  for (const { key, attr } of HEADER_LINKS) {
    const cur = s.attrs[attr];
    if (cur === prev?.[attr]) continue;
    if (typeof cur === "string") bodies[key] = readAll(d, "templateContent", cur);
    else keys[key] = "none";
  }
  return {
    k: "S",
    ...(Object.keys(keys).length === 0 ? {} : { keys }),
    ...(Object.keys(bodies).length === 0 ? {} : { bodies }),
  };
}

/** A whole container `holder` of `tree` (a footnote / header / footer body): its blocks, ¶-terminated. Null-free: unread blocks are skipped. */
function readAll(d: Document, tree: TreeKind, holder: string): FragmentItem[] {
  const t = d.trees[tree];
  const out: FragmentItem[] = [];
  for (let id = t.get(holder)?.firstChildId ?? null; id !== null; ) {
    const b = t.get(id);
    if (b === undefined) break;
    if (b.inlineContent !== null) out.push(...inlineSlice(d, b, 0, Infinity), paraOf(d, b));
    else {
      const o = blockObjectOf(b);
      if (o !== null) out.push(o);
    }
    id = b.nextSiblingId;
  }
  return out;
}

/**
 * Range `r` (one container) as fragment items: its blocks in read order, crossing section ends as `[S]`; the start
 * paragraph from its offset with its ¶, middle blocks whole, the end paragraph up to its offset with no ¶. A
 * select-all's `from` starts at the container's first block. Null when the range holds a table (C2).
 */
export function readSlice(d: Document, r: Range): FragmentItem[] | null {
  const tree = d.trees[r.start.L.tree];
  const parentOf = (b: Block): Block | undefined => (b.parentId === null ? undefined : tree.get(b.parentId));
  let b: Block | undefined = r.start.L.block;
  if (r.start.from !== undefined) {
    // The container's first block: in the body, the first section's.
    const parent = parentOf(b);
    const first = parent?.type === BLOCK_TYPES.section ? parentOf(parent)?.firstChildId : parent?.firstChildId;
    b = first === null || first === undefined ? undefined : tree.get(first);
    if (b?.type === BLOCK_TYPES.section) b = b.firstChildId === null ? undefined : tree.get(b.firstChildId);
  }
  const out: FragmentItem[] = [];
  const endId = r.end.L.block.id;
  while (b !== undefined) {
    if (b.inlineContent !== null) {
      const from = b.id === r.start.L.block.id ? r.start.offset : 0;
      if (b.id === endId) {
        out.push(...inlineSlice(d, b, from, r.end.offset));
        return out;
      }
      out.push(...inlineSlice(d, b, from, Infinity), paraOf(d, b));
    } else {
      const o = blockObjectOf(b);
      if (o === null) return null;
      out.push(o);
    }
    // The next block: the next sibling, else across the section's [S] into the next section (an empty one adds its [S] too).
    let next: Block | undefined = b.nextSiblingId === null ? undefined : tree.get(b.nextSiblingId);
    for (let s = parentOf(b); next === undefined && s?.type === BLOCK_TYPES.section && s.nextSiblingId !== null; ) {
      out.push(sectionOf(d, s));
      s = tree.get(s.nextSiblingId);
      next = s?.firstChildId === null || s?.firstChildId === undefined ? undefined : tree.get(s.firstChildId);
    }
    b = next;
  }
  return out;
}

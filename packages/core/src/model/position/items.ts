import { EMBED_TYPES, type InlineItem } from "../block";
import type { RunToken } from "../scan/tokens";
import type { ParagraphLayout } from "./paragraph-layout";

export const unitsOf = (i: InlineItem): number => (i.kind === "text" ? i.text.length : 1);

export const isFloat = (i: InlineItem | undefined): boolean =>
  i !== undefined && i.kind === "embed" && i.embedType === EMBED_TYPES.object && typeof i.properties["wrap"] === "string";

// ---------------------------------------------------------------------------
// Items around an offset. Plans read a paragraph's items through its layout's run
// tokens — one token per segment — so finding the item at an offset costs the
// paragraph's segment count plus a search in one token (piece-bounded), not a scan
// of every item of the paragraph.
// ---------------------------------------------------------------------------

/** An item of a paragraph: its read start, and where it sits (part `p`, item `i` of that part's token). */
export interface ItemRef {
  readonly item: InlineItem;
  readonly start: number;
  readonly p: number;
  readonly i: number;
}

const itemStartsMemo = new WeakMap<RunToken, readonly number[]>();

/** Read offsets (token-relative) of a run token's items (memoized: tokens are immutable). */
function itemStarts(t: RunToken): readonly number[] {
  const memo = itemStartsMemo.get(t);
  if (memo !== undefined) return memo;
  const out: number[] = [];
  let n = 0;
  for (const i of t.items) {
    out.push(n);
    n += unitsOf(i);
  }
  itemStartsMemo.set(t, out);
  return out;
}

function refOf(L: ParagraphLayout, p: number, i: number): ItemRef | null {
  const part = L.parts[p];
  const item = part?.token.items[i];
  const rel = part === undefined ? undefined : itemStarts(part.token)[i];
  return part === undefined || item === undefined || rel === undefined ? null : { item, start: part.readStart + rel, p, i };
}

/** The item holding read unit `offset`, or null past the end. */
export function itemAt(L: ParagraphLayout, offset: number): ItemRef | null {
  for (let p = 0; p < L.parts.length; p++) {
    const part = L.parts[p];
    if (part === undefined || part.read === 0 || offset < part.readStart || offset >= part.readStart + part.read) continue;
    const st = itemStarts(part.token);
    const rel = offset - part.readStart;
    let lo = 0;
    let hi = st.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((st[mid] ?? 0) <= rel) lo = mid;
      else hi = mid - 1;
    }
    return refOf(L, p, lo);
  }
  return null;
}

/** The item holding read unit `offset − 1`. */
export const itemBefore = (L: ParagraphLayout, offset: number): ItemRef | null => (offset <= 0 ? null : itemAt(L, offset - 1));

export function prevItem(L: ParagraphLayout, r: ItemRef): ItemRef | null {
  if (r.i > 0) return refOf(L, r.p, r.i - 1);
  for (let p = r.p - 1; p >= 0; p--) {
    const n = L.parts[p]?.token.items.length ?? 0;
    if (n > 0) return refOf(L, p, n - 1);
  }
  return null;
}

export function nextItem(L: ParagraphLayout, r: ItemRef): ItemRef | null {
  if (r.i + 1 < (L.parts[r.p]?.token.items.length ?? 0)) return refOf(L, r.p, r.i + 1);
  for (let p = r.p + 1; p < L.parts.length; p++) if ((L.parts[p]?.token.items.length ?? 0) > 0) return refOf(L, p, 0);
  return null;
}

/** The text items either side of `offset` (embeds skipped); both the same item when `offset` is strictly inside one. */
export function textNeighbours(L: ParagraphLayout, offset: number): { before: ItemRef | null; after: ItemRef | null } {
  const at = itemAt(L, offset);
  if (at !== null && at.item.kind === "text" && at.start < offset) return { before: at, after: at };
  let after = at;
  while (after !== null && after.item.kind !== "text") after = nextItem(L, after);
  let before = itemBefore(L, offset);
  while (before !== null && before.item.kind !== "text") before = prevItem(L, before);
  return { before, after };
}

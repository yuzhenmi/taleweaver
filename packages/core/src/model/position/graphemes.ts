import { endsJoiningForward } from "../scan/joins";
import { type ItemRef, itemAt, itemBefore, nextItem, prevItem } from "./items";
import type { ParagraphLayout } from "./paragraph-layout";

// ---------------------------------------------------------------------------
// Graphemes (R15), atomic marks (R14)
// ---------------------------------------------------------------------------

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const WINDOW = 64;

/**
 * Grapheme cluster boundaries of `text` near `offset`. A boundary is certain between
 * two code units of U+0020..U+02FF (the fast path); otherwise a window of
 * ±{@link WINDOW} units is segmented.
 * ponytail: a regional-indicator run longer than the window may pair wrongly; segment
 * from the item start if flags-in-bulk ever matter.
 */
function boundariesNear(text: string, offset: number): number[] {
  const a = Math.max(0, offset - WINDOW);
  const b = Math.min(text.length, offset + WINDOW);
  const out: number[] = [];
  for (const seg of graphemes.segment(text.slice(a, b))) out.push(a + seg.index);
  out.push(b);
  return out;
}

const isSimple = (x: number, y: number): boolean => x >= 0x20 && x < 0x300 && y >= 0x20 && y < 0x300;
const simplePair = (text: string, i: number): boolean => isSimple(text.charCodeAt(i - 1), text.charCodeAt(i));

/** `offset` snapped down to a grapheme cluster boundary of `text`. */
export function graphemeFloor(text: string, offset: number): number {
  if (offset <= 0 || offset >= text.length || simplePair(text, offset)) return offset;
  let best = 0;
  for (const x of boundariesNear(text, offset)) if (x <= offset) best = x;
  return best;
}

/** The previous (`dir` −1) / next (+1) grapheme boundary of `text` from a boundary `offset`. */
export function graphemeStep(text: string, offset: number, dir: -1 | 1): number {
  if (dir < 0) {
    if (offset <= 0) return 0;
    if (offset >= 2 && simplePair(text, offset - 1)) return offset - 1;
    let best = 0;
    for (const x of boundariesNear(text, offset)) if (x < offset) best = x;
    return best;
  }
  if (offset >= text.length) return text.length;
  if (offset + 1 < text.length && simplePair(text, offset + 1)) return offset + 1;
  for (const x of boundariesNear(text, offset)) if (x > offset) return x;
  return text.length;
}

/**
 * The paragraph's merged TEXT around read unit `unit`: the text items holding it and
 * its text neighbours — whatever their formatting — joined across parts (piece /
 * segment boundaries), up to the nearest embeds, clipped to ±{@link WINDOW} units.
 * Null when `unit` is not text. Every per-text reading rule (R15) reads through this,
 * so neither storage splits nor formatting changes ever split a cluster.
 */
export function textRunAt(L: ParagraphLayout, unit: number): { readonly text: string; readonly start: number } | null {
  const seed = itemAt(L, unit);
  if (seed === null || seed.item.kind !== "text") return null;
  const same = (r: ItemRef | null): r is ItemRef => r !== null && r.item.kind === "text";
  const lo = unit - WINDOW;
  const hi = unit + WINDOW;
  let left = seed;
  for (let p = prevItem(L, left); left.start > lo && same(p); p = prevItem(L, left)) left = p;
  let text = "";
  const start = Math.max(left.start, lo);
  for (let r: ItemRef | null = left; same(r) && r.start < hi; r = nextItem(L, r)) {
    if (r.item.kind !== "text") break;
    text += r.item.text.slice(Math.max(0, lo - r.start), Math.max(0, hi - r.start));
  }
  return { text, start };
}

/**
 * R15: an offset inside a run of text snaps to a cluster boundary of that merged text
 * (UAX #29 on the paragraph's text, as a browser segments it). Embeds are always
 * boundaries (U+FFFC never clusters with a following combining mark); neither piece
 * boundaries nor formatting changes ever are. R14 applies after this.
 */
export function graphemeFloorAt(L: ParagraphLayout, offset: number): number {
  const at = itemAt(L, offset);
  if (at === null || at.item.kind !== "text") return offset;
  // Fast paths: between two simple code units, inside one item or across an item edge.
  if (at.start < offset && simplePair(at.item.text, offset - at.start)) return offset;
  if (at.start === offset) {
    const b = itemBefore(L, offset);
    if (b === null || b.item.kind !== "text") return offset;
    // A simple code unit after an item edge starts a cluster unless the char before may
    // join it (Prepend, GB9b; ZWJ, GB11): read as the flag the scan recorded, not from the (rope) text.
    const y = at.item.text.charCodeAt(0);
    if (y >= 0x20 && y < 0x300 && !endsJoiningForward(b.item)) return offset;
  }
  const run = textRunAt(L, offset);
  if (run === null || run.start >= offset) return offset;
  return run.start + graphemeFloor(run.text, offset - run.start);
}

/** The grapheme boundary before (`dir` −1) / after (+1) boundary `offset`, in the merged text holding the unit stepped over. */
export function graphemeStepAt(L: ParagraphLayout, offset: number, dir: -1 | 1): number {
  // Fast path: the stepped-over unit and its neighbour on the far side are simple code units of one item.
  const at = itemAt(L, dir < 0 ? offset - 1 : offset);
  if (at !== null && at.item.kind === "text") {
    const local = offset - at.start;
    const t = at.item.text;
    if (dir < 0 && local >= 2 && simplePair(t, local - 1) && (local === t.length || simplePair(t, local))) return offset - 1;
    if (dir > 0 && local + 2 <= t.length && simplePair(t, local + 1) && (local === 0 || simplePair(t, local))) return offset + 1;
  }
  const run = textRunAt(L, dir < 0 ? offset - 1 : offset);
  if (run === null) return offset + dir;
  return run.start + graphemeStep(run.text, offset - run.start, dir);
}

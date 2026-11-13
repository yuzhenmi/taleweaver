import type { InlineItem } from "../block";

// ---------------------------------------------------------------------------
// R15 at item edges: MAY a text item's last code point join a following simple code
// unit (U+0020..U+02FF) into one cluster — a Prepend (GB9b) or a ZWJ before an
// Extended_Pictographic such as © / ® (GB11)? Conservative: a true flag only routes the
// boundary check to the exact (segmenting) path. Recorded when the scan builds the
// item, from the slice of the Yjs string it takes — so a check reads a flag, not the
// (rope) text.
// ---------------------------------------------------------------------------

export const joinsForward = new WeakSet<InlineItem>();
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

export function joinsForwardAtEnd(text: string): boolean {
  const n = text.length;
  if (n === 0) return false;
  const last = text.charCodeAt(n - 1);
  if (last < 0x600) return false; // no Prepend or ZWJ below U+0600
  const cp = last >= 0xdc00 && last <= 0xdfff && n >= 2 ? (text.codePointAt(n - 2) ?? last) : last;
  return mayJoinSimple(cp);
}

/** Whether text item `item`'s last code point may join a following simple code unit (GB9b / GB11). */
export const endsJoiningForward = (item: InlineItem): boolean => joinsForward.has(item);

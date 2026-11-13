/**
 * The regions of a transaction's changes in a flow (N4b): each changed token window widens to whole entities, from the
 * terminator before it to the one ending it (crossing into neighbouring segments when its own has none). Regions that
 * overlap or touch merge, so a transaction yields K disjoint regions in flow order; a single-site edit, one.
 */
import { type Segment, isTerminator } from "../scan/tokens";
import { type Anchor, type Pos, before, leftAnchor, rightAnchor } from "./anchors";
import type { Splice } from "./piece-splice";

/** The tokens strictly after `L` (null = the flow's start) up to `R` (null = its end), in the new segments. */
export interface Region {
  readonly L: Anchor | null;
  readonly R: Anchor | null;
}

/** `splices` sorted, with `n1s[i]` the new index of splice i's first segment. */
export function regionsOf(newScans: readonly Segment[], splices: readonly Splice[], n1s: readonly number[]): Region[] {
  const out: Region[] = [];
  splices.forEach((sp, i) => {
    const n1 = n1s[i] ?? sp.o1;
    for (const win of sp.windows) {
      const L = leftAnchor(newScans, n1 + win.pStart, win.startNew - 1);
      const pE = n1 + win.pEnd;
      const closingTok = win.closed ? newScans[pE]?.tokens[win.endNew - 1] : undefined;
      const R: Anchor | null =
        closingTok !== undefined && isTerminator(closingTok) ? { p: pE, t: win.endNew - 1, tok: closingTok } : rightAnchor(newScans, pE, win.endNew);
      const prev = out[out.length - 1];
      // Windows come in flow order, and so do their L: merge with the previous region when L is at or before its R.
      if (prev !== undefined && (prev.R === null || L === null || !before(prev.R, L))) {
        out[out.length - 1] = { L: prev.L, R: prev.R === null || R === null ? null : before(prev.R, R) ? R : prev.R };
      } else out.push({ L, R });
    }
  });
  return out;
}

/** The old position of an unchanged new-space token (a closed window's closing terminator included); null when new. */
export function oldPosOf(splices: readonly Splice[], n1s: readonly number[], pos: Pos): Pos | null {
  // The last splice starting at or before pos.
  let lo = 0;
  let hi = splices.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((n1s[mid] ?? 0) <= pos.p) lo = mid + 1;
    else hi = mid;
  }
  const sp = splices[lo - 1];
  const n1 = n1s[lo - 1];
  if (sp === undefined || n1 === undefined) return pos;
  const n2 = n1 + sp.segs.length;
  if (pos.p >= n2) return { p: pos.p - n2 + sp.o2, t: pos.t };
  if (sp.o2 - sp.o1 !== 1) return null; // inserted segments: all new
  // One old segment (rescanned, or a rebuilt subtree's whole window): the last window starting at or before the token.
  const q = pos.p - n1;
  const ws = sp.windows;
  let a = 0;
  let b = ws.length;
  while (a < b) {
    const mid = (a + b) >> 1;
    const w = ws[mid];
    if (w !== undefined && (w.pStart < q || (w.pStart === q && w.startNew <= pos.t))) a = mid + 1;
    else b = mid;
  }
  const win = ws[a - 1];
  // Outside every window, a token is in the segment's old run of unchanged tokens (no split before / between windows).
  if (win === undefined) return q === 0 ? { p: sp.o1, t: pos.t } : null;
  if (q > win.pEnd || (q === win.pEnd && pos.t >= win.endNew)) return q === win.pEnd ? { p: sp.o1, t: pos.t - win.endNew + win.endOld } : null;
  return win.closed && q === win.pEnd && pos.t === win.endNew - 1 ? { p: sp.o1, t: win.endOld - 1 } : null;
}

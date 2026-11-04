import type { Segment, TerminatorToken, Token } from "../scan/tokens";
import { isTerminator } from "../scan/tokens";

// ---------------------------------------------------------------------------
// Flow level
// ---------------------------------------------------------------------------

export interface Pos {
  readonly p: number;
  readonly t: number;
}
export interface Anchor extends Pos {
  readonly tok: TerminatorToken;
}

/** Tokens strictly after `from` (null = flow start) up to `to` (null = flow end), `to` itself included unless `withTo` is false. */
export function* between(scans: readonly Segment[], from: Pos | null, to: Pos | null, withTo = true): Generator<Token> {
  let t = from === null ? 0 : from.t + 1;
  for (let p = from === null ? 0 : from.p; p < scans.length; p++, t = 0) {
    const toks = scans[p]?.tokens ?? [];
    for (; t < toks.length; t++) {
      const tok = toks[t];
      const last = to !== null && p === to.p && t === to.t;
      if (tok !== undefined && (withTo || !last)) yield tok;
      if (last) return;
    }
  }
}

export function leftAnchor(scans: readonly Segment[], p0: number, t0: number): Anchor | null {
  for (let p = p0; p >= 0; p--) {
    const toks = scans[p]?.tokens ?? [];
    for (let t = p === p0 ? t0 : toks.length - 1; t >= 0; t--) {
      const tok = toks[t];
      if (tok !== undefined && isTerminator(tok)) return { p, t, tok };
    }
  }
  return null;
}

export function rightAnchor(scans: readonly Segment[], p0: number, t0: number): Anchor | null {
  for (let p = p0; p < scans.length; p++) {
    const toks = scans[p]?.tokens ?? [];
    for (let t = p === p0 ? t0 : 0; t < toks.length; t++) {
      const tok = toks[t];
      if (tok !== undefined && isTerminator(tok)) return { p, t, tok };
    }
  }
  return null;
}

import { describe, it, expect } from "vitest";
import { computeParagraphLevel, classCode } from "./bidi";

function codes(s: string): Uint8Array {
  const cps = [...s].map((ch) => {
    const cp = ch.codePointAt(0);
    if (cp === undefined) throw new Error("empty");
    return classCode(cp);
  });
  return Uint8Array.from(cps);
}

describe("computeParagraphLevel (P2/P3)", () => {
  it("LTR (0) when the first strong char is L", () => {
    const t = codes("abc");
    expect(computeParagraphLevel(t, 0, t.length)).toBe(0);
  });
  it("RTL (1) when the first strong char is R", () => {
    const t = codes("אב"); // Hebrew alef bet
    expect(computeParagraphLevel(t, 0, t.length)).toBe(1);
  });
  it("RTL (1) when the first strong char is AL (Arabic)", () => {
    const t = codes("اب"); // Arabic alef beh
    expect(computeParagraphLevel(t, 0, t.length)).toBe(1);
  });
  it("ignores numbers/neutrals before the first strong char", () => {
    const t = codes("123 א"); // digits + space then Hebrew → 1
    expect(computeParagraphLevel(t, 0, t.length)).toBe(1);
  });
  it("P3 default 0 when there is no strong char", () => {
    const t = codes("123 "); // only EN + WS
    expect(computeParagraphLevel(t, 0, t.length)).toBe(0);
  });
  it("skips an isolate-initiated run when finding the first strong char", () => {
    // LRI <Hebrew> PDI <Hebrew>: the Hebrew INSIDE the isolate is skipped;
    // the first strong char OUTSIDE the isolate is the trailing Hebrew → 1.
    const t = codes("⁦א⁩ב"); // LRI alef PDI bet
    expect(computeParagraphLevel(t, 0, t.length)).toBe(1);
  });
  it("an LTR char inside an isolate does not set the level if a later outside char is strong", () => {
    // LRI <Latin 'a'> PDI <Hebrew>: 'a' (L) is inside the isolate → skipped;
    // first strong OUTSIDE is Hebrew → 1.
    const t = codes("⁦a⁩א");
    expect(computeParagraphLevel(t, 0, t.length)).toBe(1);
  });
  it("a strong char outside the range start/end is not considered", () => {
    // "aא" but scan only [1,2): first strong is Hebrew → 1.
    const t = codes("aא");
    expect(computeParagraphLevel(t, 1, t.length)).toBe(1);
  });
  it("handles nested isolates: inner+outer fully skipped", () => {
    // LRI LRI <Hebrew> PDI PDI <Hebrew>: both isolates skipped; trailing Hebrew → 1.
    const t = codes("⁦⁦א⁩⁩ב");
    expect(computeParagraphLevel(t, 0, t.length)).toBe(1);
  });
  it("an unmatched isolate initiator swallows the rest of the range (P3 default 0)", () => {
    // LRI <Hebrew> with no PDI: the Hebrew stays inside the (unmatched) isolate,
    // so no strong char is seen at depth 0 → P3 default 0.
    const t = codes("⁦א");
    expect(computeParagraphLevel(t, 0, t.length)).toBe(0);
  });
  it("a stray PDI (no matching initiator) does not un-skip a following strong char", () => {
    // PDI <Hebrew>: the stray PDI must FLOOR depth at 0 (not go negative); the
    // Hebrew is then seen at depth 0 → 1. If the floor guard were removed, depth
    // would be -1 and the Hebrew would be wrongly skipped → 0. Guards the floor.
    const t = codes("⁩א"); // PDI alef
    expect(computeParagraphLevel(t, 0, t.length)).toBe(1);
  });
});

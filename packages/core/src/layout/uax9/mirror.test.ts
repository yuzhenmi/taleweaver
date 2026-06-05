import { describe, it, expect } from "vitest";
import { bidiMirror, bracketPair, canonicalBracketEquiv } from "./mirror";

describe("bidiMirror / bracketPair", () => {
  it("mirrors paired punctuation", () => {
    expect(bidiMirror(0x28)).toBe(0x29); // ( -> )
    expect(bidiMirror(0x29)).toBe(0x28); // ) -> (
    expect(bidiMirror(0x5b)).toBe(0x5d); // [ -> ]
    expect(bidiMirror(0xab)).toBe(0xbb); // « -> »
    expect(bidiMirror(0x41)).toBeNull(); // 'A' no mirror
  });

  it("identifies bracket pairs with open/close kind for N0", () => {
    expect(bracketPair(0x28)).toEqual({ paired: 0x29, kind: "open" });
    expect(bracketPair(0x29)).toEqual({ paired: 0x28, kind: "close" });
    expect(bracketPair(0x5b)).toEqual({ paired: 0x5d, kind: "open" });
    expect(bracketPair(0x41)).toBeNull(); // not a bracket
  });

  it("exposes both angle-bracket forms raw + canonical-equivalence for N0 (BD16)", () => {
    // bracketPair stays faithful to the data: each form pairs within itself.
    expect(bracketPair(0x2329)).toEqual({ paired: 0x232a, kind: "open" });  // ⟨ → ⟩
    expect(bracketPair(0x232a)).toEqual({ paired: 0x2329, kind: "close" }); // ⟩ → ⟨
    expect(bracketPair(0x3008)).toEqual({ paired: 0x3009, kind: "open" });  // 〈 → 〉
    expect(bracketPair(0x3009)).toEqual({ paired: 0x3008, kind: "close" }); // 〉 → 〈
    // canonicalBracketEquiv normalizes the two canonically-equivalent forms to a
    // single key, so the N0 matcher matches cross-form (2329 opener ↔ 3009 closer).
    expect(canonicalBracketEquiv(0x2329)).toBe(0x3008); // ⟨ ≡ 〈
    expect(canonicalBracketEquiv(0x3008)).toBe(0x3008); // identity
    expect(canonicalBracketEquiv(0x232a)).toBe(0x3009); // ⟩ ≡ 〉
    expect(canonicalBracketEquiv(0x3009)).toBe(0x3009); // identity
    expect(canonicalBracketEquiv(0x28)).toBe(0x28);     // ( has no canonical equiv
    // The trap this closes: a 2329 opener and a 3009 closer must match under N0 —
    // canon(bracketPair(0x2329).paired) === canon(0x3009).
    expect(canonicalBracketEquiv(0x232a)).toBe(canonicalBracketEquiv(0x3009));
  });
});

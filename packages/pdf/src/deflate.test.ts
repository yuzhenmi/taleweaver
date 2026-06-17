import { describe, it, expect } from "vitest";
import { deflate } from "./deflate";
import { inflate } from "./inflate";
import { buildTestSfnt } from "./test-support/sfnt-builder";

const ENC = new TextEncoder();

/** The corpus the round-trip oracle covers. */
function corpus(): Uint8Array[] {
  const sfnt = buildTestSfnt({
    unitsPerEm: 1000, numGlyphs: 4,
    hMetrics: [{ advanceWidth: 500, lsb: 0 }], numberOfHMetrics: 1,
    ascender: 800, descender: -200, xMin: 0, yMin: -200, xMax: 500, yMax: 800, macStyle: 0,
  });
  const random = new Uint8Array(2000);
  for (let i = 0; i < random.length; i++) random[i] = (i * 2654435761) & 0xff; // deterministic pseudo-random
  return [
    new Uint8Array(0),                                  // empty
    Uint8Array.of(0x42),                                // single byte
    ENC.encode("ABAB".repeat(500)),                     // repetitive → LZ77 matches + overlap copy
    ENC.encode("The quick brown fox ".repeat(50)),      // text
    random,                                             // incompressible → stored fallback
    sfnt,                                               // real font bytes (the actual payloads)
  ];
}

describe("deflate ↔ inflate round-trip (the load-bearing oracle)", () => {
  it.each(corpus().map((x, i) => [i, x] as const))("round-trips corpus[%i] byte-identically", (_i, x) => {
    expect([...inflate(deflate(x))]).toEqual([...x]);
  });

  it("compresses repetitive/text input (real compression, not stored-only)", () => {
    const rep = ENC.encode("ABAB".repeat(500)); // 2000 bytes
    expect(deflate(rep).length).toBeLessThan(rep.length);
    const text = ENC.encode("The quick brown fox ".repeat(50));
    expect(deflate(text).length).toBeLessThan(text.length);
  });

  it("LZ77 actually emits back-references (closes the trivially-passing gap)", () => {
    // 1000 identical bytes: a literals-only / stored encoding cannot get below
    // ~900 bytes; a match-based one is tens of bytes. `< 100` proves the
    // match-finder ran — the test fails if LZ77 is dead even though the
    // round-trip oracle alone would still pass.
    const run = ENC.encode("A".repeat(1000));
    expect(deflate(run).length).toBeLessThan(100);
    expect([...inflate(deflate(run))]).toEqual([...run]); // still correct
  });

  it("does not catastrophically expand incompressible input (stored fallback)", () => {
    const random = new Uint8Array(2000);
    for (let i = 0; i < random.length; i++) random[i] = (i * 2654435761) & 0xff;
    // A stored encoding adds ~5 bytes per 65535-byte block; assert a tight bound.
    expect(deflate(random).length).toBeLessThan(random.length + 64);
  });
});

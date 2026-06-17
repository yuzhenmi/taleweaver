import { describe, expect, it } from "vitest";
import { resolveBidiLevels, type BaseDirection } from "@taleweaver/core";
import {
  bidiLevelAtSourceOffset,
  resolveParagraphBidi,
} from "./ifc-bidi";

describe("resolveParagraphBidi", () => {
  it("mirrors the engine output on a multi-run concatenated source", () => {
    // Simulate the IFC concatenating an LTR run + a Hebrew run + a digit run
    // into one logical-order paragraph source. Bidi context spans runs, so the
    // helper must run the engine on the WHOLE source.
    const source = "abc " + "אבג" + " 123";
    const base: BaseDirection = "ltr";

    const engine = resolveBidiLevels(source, base);
    const pb = resolveParagraphBidi(source, base);

    expect(pb.levels).toEqual(engine.levels);
    expect(pb.types).toEqual(engine.types);
    expect(pb.paragraphLevel).toBe(engine.paragraphLevel);

    // All codepoints in this source are BMP, so UTF-16 offset === codepoint
    // index and the query must reproduce the engine level at each.
    const cps = [...source];
    let u = 0;
    for (let cp = 0; cp < cps.length; cp++) {
      expect(bidiLevelAtSourceOffset(pb, u)).toBe(engine.levels[cp]);
      const cpStr = cps[cp];
      if (cpStr === undefined) throw new Error(`expected codepoint at index ${cp}`);
      u += cpStr.length;
    }

    // Spot-check the Hebrew run start (offset 4) and the trailing digits.
    expect(bidiLevelAtSourceOffset(pb, 4)).toBe(engine.levels[4]);
    const digitsStart = source.indexOf("123");
    expect(bidiLevelAtSourceOffset(pb, digitsStart)).toBe(
      engine.levels[digitsStart],
    );
  });

  it("resolves a later character using earlier-run context (cross-run dependency)", () => {
    // Arabic letter (AL) earlier in the paragraph influences how the later
    // European digits resolve: in an AL context the digits embed at level 2
    // (W2 sequence), whereas an isolated digit run in an LTR paragraph stays at
    // level 0. Simulates the IFC concatenating an Arabic run + a digit run.
    const source = "ا 123";
    const base: BaseDirection = "ltr";

    const engine = resolveBidiLevels(source, base);
    const pb = resolveParagraphBidi(source, base);

    const digitsStart = source.indexOf("123");
    // Full-paragraph result for the first digit (raised to 2 by the AL context).
    const fullParagraphLevel = engine.levels[digitsStart];
    expect(bidiLevelAtSourceOffset(pb, digitsStart)).toBe(fullParagraphLevel);

    // Sanity: resolving the bare digit run on its own yields a DIFFERENT level,
    // proving per-run resolution would be wrong.
    const isolated = resolveBidiLevels("123", base);
    expect(isolated.levels[0]).not.toBe(fullParagraphLevel);
  });

  it("maps UTF-16 offsets to codepoints across an astral character", () => {
    // "a" (BMP) + "😀" (astral, surrogate PAIR) + "ב" (Hebrew, BMP).
    // Codepoint indices: a=0, 😀=1, ב=2.
    // UTF-16 offsets:     a=0, 😀=1..2 (hi/lo surrogate), ב=3.
    const source = "a😀ב";
    const base: BaseDirection = "rtl";

    const engine = resolveBidiLevels(source, base);
    const pb = resolveParagraphBidi(source, base);

    expect([...source].length).toBe(3);
    expect(source.length).toBe(4); // 1 + 2 + 1 UTF-16 units

    const offsetOfHebrew = 3; // 1 (a) + 2 (emoji surrogate pair)
    // A naive levels[utf16Offset] would read levels[3] (out of a 3-codepoint
    // array) — the helper must convert to codepoint index 2.
    expect(bidiLevelAtSourceOffset(pb, offsetOfHebrew)).toBe(engine.levels[2]);

    // The "a" at offset 0 → codepoint 0.
    expect(bidiLevelAtSourceOffset(pb, 0)).toBe(engine.levels[0]);
    // The emoji high surrogate at offset 1 → codepoint 1.
    expect(bidiLevelAtSourceOffset(pb, 1)).toBe(engine.levels[1]);
    // The emoji LOW surrogate at offset 2 clamps to the emoji's start
    // codepoint (index 1), NOT the Hebrew.
    expect(bidiLevelAtSourceOffset(pb, 2)).toBe(engine.levels[1]);

    // The mapping array directly.
    expect(pb.cpIndexAtUtf16[0]).toBe(0); // a
    expect(pb.cpIndexAtUtf16[1]).toBe(1); // emoji high surrogate
    expect(pb.cpIndexAtUtf16[2]).toBe(1); // emoji low surrogate → clamps to emoji
    expect(pb.cpIndexAtUtf16[3]).toBe(2); // Hebrew
    expect(pb.cpIndexAtUtf16[4]).toBe(3); // end sentinel = total codepoint count
  });

  it("clamps out-of-range offsets to the paragraph level without throwing", () => {
    const source = "abc";
    const pb = resolveParagraphBidi(source, "ltr");

    // At source.length the codepoint index is the end sentinel → paragraph level.
    expect(bidiLevelAtSourceOffset(pb, source.length)).toBe(pb.paragraphLevel);
    // Past the end clamps to the same edge.
    expect(bidiLevelAtSourceOffset(pb, source.length + 10)).toBe(
      pb.paragraphLevel,
    );
    // Negative clamps to offset 0 (first codepoint), not throw.
    expect(() => bidiLevelAtSourceOffset(pb, -5)).not.toThrow();
    expect(bidiLevelAtSourceOffset(pb, -5)).toBe(bidiLevelAtSourceOffset(pb, 0));
  });

  it("handles an empty source", () => {
    const ltr = resolveParagraphBidi("", "ltr");
    expect(ltr.levels.length).toBe(0);
    expect(ltr.paragraphLevel).toBe(0);
    expect(bidiLevelAtSourceOffset(ltr, 0)).toBe(0);

    const rtl = resolveParagraphBidi("", "rtl");
    expect(rtl.paragraphLevel).toBe(1);
    expect(bidiLevelAtSourceOffset(rtl, 0)).toBe(1);
  });
});

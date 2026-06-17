import { describe, it, expect } from "vitest";
import { buildToUnicodeCMap } from "./tounicode";

describe("buildToUnicodeCMap", () => {
  it("emits the standard CMap skeleton + a bfchar block", () => {
    const cmap = buildToUnicodeCMap(new Map([[1, "A"]]));
    expect(cmap).toContain("/CIDInit /ProcSet findresource begin");
    expect(cmap).toContain("begincmap");
    expect(cmap).toContain(
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    );
    expect(cmap).toContain("/CMapName /Adobe-Identity-UCS def");
    expect(cmap).toContain("/CMapType 2 def");
    expect(cmap).toContain("1 begincodespacerange");
    expect(cmap).toContain("<0000> <FFFF>");
    expect(cmap).toContain("endcodespacerange");
    expect(cmap).toMatch(/\d+ beginbfchar/);
    expect(cmap).toContain("endbfchar");
    expect(cmap).toContain("endcmap");
    expect(cmap).toContain("currentdict /CMap defineresource pop");
    expect(cmap).toMatch(/end\nend/);
  });

  it("maps a BMP single char to its 4-digit UTF-16BE scalar, CID zero-padded to 4 hex digits", () => {
    const cmap = buildToUnicodeCMap(new Map([[1, "A"]]));
    // CID 1 → <0001>, 'A' = U+0041 → <0041>
    expect(cmap).toContain("<0001> <0041>");
  });

  it("concatenates UTF-16BE code units for a multi-char ligature (no surrogate involved)", () => {
    const cmap = buildToUnicodeCMap(new Map([[2, "fi"]]));
    // CID 2 → <0002>, "fi" = U+0066 U+0069 → <00660069>
    expect(cmap).toContain("<0002> <00660069>");
  });

  it("emits an astral scalar as a UTF-16BE SURROGATE PAIR, not a 4-byte UCS-4 value", () => {
    const cmap = buildToUnicodeCMap(new Map([[3, "\u{1F600}"]]));
    // CID 3 → <0003>, U+1F600 → surrogate pair D83D DE00 (NOT 0001F600)
    expect(cmap).toContain("<0003> <D83DDE00>");
    expect(cmap).not.toContain("0001F600");
  });

  it("preserves Map insertion order in the bfchar block", () => {
    const cmap = buildToUnicodeCMap(
      new Map([
        [1, "A"],
        [2, "fi"],
        [3, "\u{1F600}"],
      ]),
    );
    const iA = cmap.indexOf("<0001> <0041>");
    const iFi = cmap.indexOf("<0002> <00660069>");
    const iEmoji = cmap.indexOf("<0003> <D83DDE00>");
    expect(iA).toBeGreaterThanOrEqual(0);
    expect(iFi).toBeGreaterThan(iA);
    expect(iEmoji).toBeGreaterThan(iFi);
  });

  it("chunks >100 entries into multiple beginbfchar/endbfchar blocks (≤100 per block)", () => {
    const entries = new Map<number, string>();
    for (let i = 1; i <= 150; i++) {
      entries.set(i, String.fromCharCode(0x40 + (i % 26)));
    }
    const cmap = buildToUnicodeCMap(entries);

    // At least two beginbfchar tokens (150 entries → 100 + 50).
    const blockCount = [...cmap.matchAll(/beginbfchar/g)].length;
    expect(blockCount).toBeGreaterThanOrEqual(2);
    // Matching number of endbfchar tokens.
    expect([...cmap.matchAll(/endbfchar/g)].length).toBe(blockCount);

    // No single block declares more than 100 entries.
    for (const m of cmap.matchAll(/(\d+) beginbfchar/g)) {
      expect(Number(m[1])).toBeLessThanOrEqual(100);
    }

    // Every entry is present.
    for (const [cid, uni] of entries) {
      const cidHex = cid.toString(16).toUpperCase().padStart(4, "0");
      const uniHex = uni.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
      expect(cmap).toContain(`<${cidHex}> <${uniHex}>`);
    }
  });
});

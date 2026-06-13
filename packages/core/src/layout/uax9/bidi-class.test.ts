import { describe, it, expect } from "vitest";
import { bidiClass } from "./bidi-class";

describe("bidiClass", () => {
  it("classifies representative codepoints", () => {
    expect(bidiClass(0x41)).toBe("L");
    expect(bidiClass(0x5d0)).toBe("R"); // Hebrew alef
    expect(bidiClass(0x627)).toBe("AL"); // Arabic alef
    expect(bidiClass(0x30)).toBe("EN");
    expect(bidiClass(0x660)).toBe("AN"); // Arabic-Indic 0
    expect(bidiClass(0x20)).toBe("WS");
    expect(bidiClass(0x21)).toBe("ON");
    expect(bidiClass(0x2066)).toBe("LRI");
    expect(bidiClass(0x2069)).toBe("PDI");
    expect(bidiClass(0x202a)).toBe("LRE");
    expect(bidiClass(0x300)).toBe("NSM");
    expect(bidiClass(0x2029)).toBe("B");
    expect(bidiClass(0x9)).toBe("S");
  });

  it("honors @missing default-bidi ranges for unassigned codepoints", () => {
    // U+05EB is unassigned but in the Hebrew block → default R per @missing.
    expect(bidiClass(0x5eb)).toBe("R");
  });
});

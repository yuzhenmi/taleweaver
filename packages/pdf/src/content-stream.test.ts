import { describe, it, expect } from "vitest";
import { ContentStreamBuilder, num } from "./content-stream";

const decode = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

describe("ContentStreamBuilder", () => {
  it("emits a fill color (rg) with trimmed numbers", () => {
    const c = new ContentStreamBuilder();
    c.setFillColor({ r: 1, g: 0, b: 0.5 });
    expect(decode(c.toBytes())).toBe("1 0 0.5 rg\n");

    // A near-zero non-integer collapses to "0", not "" — the trim regex must
    // leave the leading digit (regression: `0.00001` → `"0"`, never `" rg"`).
    const c2 = new ContentStreamBuilder();
    c2.setFillColor({ r: 0.00001, g: 0, b: 0 });
    expect(decode(c2.toBytes())).toBe("0 0 0 rg\n");
  });

  it("emits a positioned showtext run", () => {
    const c = new ContentStreamBuilder();
    c.showTextAt("/F0", 12, 30, 56.25, Uint8Array.from([0x41, 0x42]));
    expect(decode(c.toBytes())).toBe(
      "BT\n/F0 12 Tf\n30 56.25 Td\n<4142> Tj\nET\n",
    );
  });

  it("escapes hex bytes with zero-padding", () => {
    const c = new ContentStreamBuilder();
    c.showTextAt("/F0", 10, 0, 0, Uint8Array.from([0x0a, 0xff]));
    expect(decode(c.toBytes())).toBe("BT\n/F0 10 Tf\n0 0 Td\n<0aff> Tj\nET\n");
  });

  it("emits a filled rect (rg + re + f)", () => {
    const c = new ContentStreamBuilder();
    c.fillRect({ r: 1, g: 0, b: 0 }, 10, 20, 30, 40);
    expect(decode(c.toBytes())).toBe("1 0 0 rg\n10 20 30 40 re\nf\n");
  });

  it("drawImageXObject emits q cm /Name Do Q", () => {
    const b = new ContentStreamBuilder();
    b.drawImageXObject("/Im0", [150, 0, 0, 100, 7.5, 49.5]);
    const out = decode(b.toBytes());
    expect(out).toBe("q\n150 0 0 100 7.5 49.5 cm\n/Im0 Do\nQ\n");
  });

  it("emits a filled circle as four Bézier curves", () => {
    const c = new ContentStreamBuilder();
    c.fillCircle({ r: 0, g: 0, b: 0 }, 50, 50, 10);
    const s = decode(c.toBytes());
    expect(s.startsWith("0 0 0 rg\n")).toBe(true);
    expect(s).toContain("60 50 m\n");          // moveto rightmost point (cx+r, cy)
    expect((s.match(/ c\n/g) ?? []).length).toBe(4);
    expect(s).toContain(" 60 50 c\n");         // 4th curve closes back to the start point
    expect(s.trimEnd().endsWith("f")).toBe(true);
  });
});

describe("ContentStreamBuilder marked content (tagged PDF)", () => {
  it("wraps showText in /<tag> <</MCID n>> BDC … EMC, BDC before BT and EMC after ET", () => {
    const b = new ContentStreamBuilder();
    b.beginMarkedContent("P", 3);
    b.showTextAt("/F0", 12, 10, 20, new Uint8Array([0x41]));
    b.endMarkedContent();
    const s = decode(b.toBytes());
    expect(s).toContain("/P <</MCID 3>> BDC");
    expect(s).toContain("EMC");
    expect(s.indexOf("/P <</MCID 3>> BDC")).toBeLessThan(s.indexOf("BT"));
    expect(s.lastIndexOf("ET")).toBeLessThan(s.indexOf("EMC"));
  });

  it("emits an artifact sequence /Artifact BDC … EMC with no MCID", () => {
    const b = new ContentStreamBuilder();
    b.beginArtifact();
    b.fillRect({ r: 0, g: 0, b: 0 }, 0, 0, 5, 1);
    b.endArtifact();
    const s = decode(b.toBytes());
    expect(s).toContain("/Artifact BDC");
    expect(s).toContain("EMC");
    expect(s).not.toContain("MCID");
  });

  it("rejects a non-integer or negative MCID (chokepoint, like num())", () => {
    const b = new ContentStreamBuilder();
    expect(() => b.beginMarkedContent("P", 1.5)).toThrow();
    expect(() => b.beginMarkedContent("P", -1)).toThrow();
  });
});

describe("num", () => {
  it("throws RangeError on non-finite input (fail-loud chokepoint)", () => {
    // A non-finite value would emit "NaN"/"Infinity" — an invalid PDF token that
    // corrupts the whole content stream. num() is the single numeric chokepoint
    // and must fail loud rather than pass garbage through.
    expect(() => num(NaN)).toThrow(RangeError);
    expect(() => num(Infinity)).toThrow(RangeError);
    expect(() => num(-Infinity)).toThrow(RangeError);
  });

  it("formats finite values (incl. -0, large, fractional) unchanged", () => {
    expect(num(-0)).toBe("0");
    expect(num(0)).toBe("0");
    expect(num(42)).toBe("42");
    expect(num(1234567)).toBe("1234567");
    expect(num(0.5)).toBe("0.5");
    expect(num(0.00001)).toBe("0");
  });
});

import { describe, it, expect } from "vitest";
import { readCffIndex, parseTopDict, parseCharset, resolveStringSid, parseCff } from "./cff-parser";
import { Reader } from "./truetype-parser";

/** Build a CFF INDEX from item byte-arrays (offSize 1). */
function buildIndex(items: readonly Uint8Array[]): Uint8Array {
  if (items.length === 0) return new Uint8Array([0, 0]);
  const offsets: number[] = [1];
  let last = 1; // running offset (1-based); avoids a non-null index read
  for (const it of items) { last += it.length; offsets.push(last); }
  const offSize = 1; // all our test offsets fit in 1 byte
  const head = [items.length >> 8, items.length & 0xff, offSize, ...offsets];
  const data = items.flatMap((it) => [...it]);
  return new Uint8Array([...head, ...data]);
}

describe("cff INDEX reader", () => {
  it("reads a 2-item INDEX's item ranges and end", () => {
    const idx = buildIndex([new Uint8Array([0xaa]), new Uint8Array([0xbb, 0xcc])]);
    const r = new Reader(idx);
    const out = readCffIndex(r, 0);
    expect(out.items.length).toBe(2);
    const [a, b] = out.items;
    if (a === undefined || b === undefined) throw new Error("expected 2 items");
    expect([...idx.subarray(a.offset, a.offset + a.length)]).toEqual([0xaa]);
    expect([...idx.subarray(b.offset, b.offset + b.length)]).toEqual([0xbb, 0xcc]);
    expect(out.end).toBe(idx.length);
  });
  it("reads an empty INDEX (count 0) — end is pos+2", () => {
    const r = new Reader(new Uint8Array([0, 0, 0xff]));
    expect(readCffIndex(r, 0)).toEqual({ items: [], end: 2 });
  });
});

describe("cff Top DICT decode", () => {
  it("decodes int operands + collects charset(15)/CharStrings(17)", () => {
    // 300 in the 247-form: (b0-247)*256 + b1 + 108 = 300 → b0=247, b1=192 (108+192=300).
    // value V in [-107,107] uses single byte 139+V. 120 > 107, so use 247-form:
    // 120 = (247-247)*256 + 12 + 108 → b0=247, b1=12.
    const dict = new Uint8Array([
      247, 192, // operand 300
      15,       // operator charset
      247, 12,  // operand 120
      17,       // operator CharStrings
    ]);
    const r = new Reader(dict);
    const td = parseTopDict(r, 0, dict.length);
    expect(td.charsetOffset).toBe(300);
    expect(td.charStringsOffset).toBe(120);
    expect(td.ros).toBeUndefined();
  });
  it("detects ROS (operator 12 30) → captures the 3 operands", () => {
    const dict = new Uint8Array([
      139 + 50, // SID registry 50
      139 + 60, // SID ordering 60
      139 + 0,  // supplement 0
      12, 30,   // operator ROS (escape 30)
      139 + 7,  // CharStrings offset 7
      17,
    ]);
    const td = parseTopDict(new Reader(dict), 0, dict.length);
    expect(td.ros).toEqual({ registrySid: 50, orderingSid: 60, supplement: 0 });
    expect(td.charStringsOffset).toBe(7);
  });
});

describe("cff charset (GID→CID)", () => {
  it("format 0: each GID 1..N-1 gets its explicit SID/CID", () => {
    const bytes = new Uint8Array([0, 0, 5, 0, 6, 0, 7]); // format 0; CIDs 5,6,7 for numGlyphs=4
    const map = parseCharset(new Reader(bytes), 0, 4);
    expect(map.get(1)).toBe(5);
    expect(map.get(2)).toBe(6);
    expect(map.get(3)).toBe(7);
    expect(map.has(0)).toBe(false); // GID0/.notdef implicit
  });
  it("format 1: ranges of (first SID u16, nLeft u8)", () => {
    const bytes = new Uint8Array([1, 0, 10, 2]); // first=10, nLeft=2 → GID1→10,2→11,3→12
    const map = parseCharset(new Reader(bytes), 0, 4);
    expect([map.get(1), map.get(2), map.get(3)]).toEqual([10, 11, 12]);
  });
  it("format 2: ranges of (first SID u16, nLeft u16)", () => {
    const bytes = new Uint8Array([2, 0, 20, 0, 2]); // first=20, nLeft=2
    const map = parseCharset(new Reader(bytes), 0, 4);
    expect([map.get(1), map.get(2), map.get(3)]).toEqual([20, 21, 22]);
  });
});

describe("cff String INDEX SID resolution", () => {
  it("resolves a custom SID (>=391) from the String INDEX", () => {
    const strIndex = buildIndex([asciiBytes("Adobe"), asciiBytes("Japan1")]);
    const r = new Reader(strIndex);
    const idx = readCffIndex(r, 0);
    expect(resolveStringSid(r, idx, 391)).toBe("Adobe");
    expect(resolveStringSid(r, idx, 392)).toBe("Japan1");
  });
  it("throws on a standard-string SID (<391) — unsupported ROS string", () => {
    const r = new Reader(buildIndex([]));
    const idx = readCffIndex(r, 0);
    expect(() => resolveStringSid(r, idx, 5)).toThrow(/standard-string SID/);
  });
});

// parseCff is exercised end-to-end via parseSfnt in a later task (needs the OTTO
// fixture); referenced here so the public export is bound in this test module.
expect(typeof parseCff).toBe("function");

function asciiBytes(s: string): Uint8Array {
  return new Uint8Array([...s].map((c) => c.charCodeAt(0)));
}

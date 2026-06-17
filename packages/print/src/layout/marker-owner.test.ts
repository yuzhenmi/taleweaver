import { describe, it, expect } from "vitest";
import { sourceBlockIdOf, markerOwnerKey } from "../index";

describe("markerOwnerKey (#526 tagged-PDF marker owner derivation)", () => {
  it("strips the -marker suffix then sourceBlockIdOf to recover the list-item block id", () => {
    expect(markerOwnerKey("li-block-7-marker")).toBe(sourceBlockIdOf("li-block-7"));
  });
  it("returns the same as sourceBlockIdOf for a key without the -marker suffix", () => {
    expect(markerOwnerKey("li-block-7")).toBe(sourceBlockIdOf("li-block-7"));
  });
  it("strips both -marker and an /anon[...] decoration (suffix order: -marker first, then sourceBlockIdOf strips /anon)", () => {
    expect(markerOwnerKey("blk/anon[0]-marker")).toBe(sourceBlockIdOf("blk/anon[0]"));
  });
});

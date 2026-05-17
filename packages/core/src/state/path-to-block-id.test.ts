import { describe, it, expect } from "vitest";
import { pathToBlockId } from "./path-to-block-id";

describe("pathToBlockId", () => {
  it("encodes an empty path (root) as the 'R' token (non-empty, distinct from any non-root path)", () => {
    expect(pathToBlockId([])).toBe("R");
  });

  it("encodes a single-step path with the R/ prefix", () => {
    expect(pathToBlockId([3])).toBe("R/3");
  });

  it("encodes a multi-step path", () => {
    expect(pathToBlockId([0, 1, 2])).toBe("R/0/1/2");
  });

  it("produces the same id for the same path", () => {
    expect(pathToBlockId([5, 7, 9])).toBe(pathToBlockId([5, 7, 9]));
  });

  it("produces different ids for different paths", () => {
    expect(pathToBlockId([1, 2])).not.toBe(pathToBlockId([1, 3]));
    expect(pathToBlockId([1, 2])).not.toBe(pathToBlockId([2, 1]));
  });

  it("root id is never empty string (which is reserved by various sentinel checks)", () => {
    expect(pathToBlockId([])).not.toBe("");
  });
});

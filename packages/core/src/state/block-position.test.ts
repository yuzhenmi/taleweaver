import { describe, it, expect } from "vitest";
import { createPosition, type Position } from "./block-position";
import type { BlockId } from "./block-id";

describe("createPosition", () => {
  it("constructs a frozen position", () => {
    const p: Position = createPosition("blk-0" as BlockId, 5);
    expect(p.blockId).toBe("blk-0");
    expect(p.offset).toBe(5);
    expect(Object.isFrozen(p)).toBe(true);
  });
});

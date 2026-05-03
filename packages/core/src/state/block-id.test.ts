import { describe, it, expect } from "vitest";
import { productionAllocator, type BlockId } from "./block-id";

describe("productionAllocator", () => {
  it("produces unique ids on repeated calls", () => {
    const a = productionAllocator.allocate();
    const b = productionAllocator.allocate();
    expect(a).not.toBe(b);
  });

  it("produces ids matching the UUID v4 shape", () => {
    const id: BlockId = productionAllocator.allocate();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

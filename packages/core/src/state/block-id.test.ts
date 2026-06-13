import { describe, it, expect } from "vitest";
import { productionAllocator, createTestAllocator, asBlockId, type BlockId } from "./block-id";

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

describe("createTestAllocator", () => {
  it("produces deterministic, sequential ids with default prefix", () => {
    const a = createTestAllocator();
    expect(a.allocate()).toBe("blk-0");
    expect(a.allocate()).toBe("blk-1");
    expect(a.allocate()).toBe("blk-2");
  });

  it("uses a custom prefix when provided", () => {
    const a = createTestAllocator("para");
    expect(a.allocate()).toBe("para-0");
    expect(a.allocate()).toBe("para-1");
  });

  it("each allocator has its own counter", () => {
    const a = createTestAllocator();
    const b = createTestAllocator();
    a.allocate();
    a.allocate();
    expect(b.allocate()).toBe("blk-0");
  });
});

describe("asBlockId", () => {
  it("returns the value, typed as a BlockId, at a validated boundary", () => {
    const raw = "abc";
    const id: BlockId = asBlockId(raw);
    expect(id).toBe("abc");
  });
});

import { describe, it, expect } from "vitest";
import * as ops from "./operations";

describe("operations barrel", () => {
  it("re-exports all Phase 4a Layer 3 operations", () => {
    expect(typeof ops.setBlockAttrs).toBe("function");
    expect(typeof ops.setBlockType).toBe("function");
    expect(typeof ops.insertBlock).toBe("function");
    expect(typeof ops.removeBlock).toBe("function");
  });

  it("re-exports Phase 4b operations", () => {
    expect(typeof ops.insertText).toBe("function");
  });

  it("re-exports Phase 4c-1 operations", () => {
    expect(typeof ops.applyAttrsToRange).toBe("function");
  });

  it("re-exports Phase 4c-2 operations", () => {
    expect(typeof ops.splitBlockAtPosition).toBe("function");
  });

  it("re-exports Phase 4c-3 operations", () => {
    expect(typeof ops.mergeAdjacentBlocks).toBe("function");
  });

  it("re-exports Phase 4c-4 operations", () => {
    expect(typeof ops.deleteRange).toBe("function");
  });
});

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
});

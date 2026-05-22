import { describe, it, expect } from "vitest";
import * as ops from "./operations";

describe("operations barrel", () => {
  it("re-exports block-level operations", () => {
    expect(typeof ops.setBlockAttrs).toBe("function");
    expect(typeof ops.mergeBlockAttrs).toBe("function");
    expect(typeof ops.setBlockType).toBe("function");
    expect(typeof ops.insertBlock).toBe("function");
    expect(typeof ops.removeBlock).toBe("function");
  });

  it("re-exports insertText", () => {
    expect(typeof ops.insertText).toBe("function");
  });

  it("re-exports applyAttrsToRange", () => {
    expect(typeof ops.applyAttrsToRange).toBe("function");
  });

  it("re-exports splitBlockAtPosition", () => {
    expect(typeof ops.splitBlockAtPosition).toBe("function");
  });

  it("re-exports mergeAdjacentBlocks", () => {
    expect(typeof ops.mergeAdjacentBlocks).toBe("function");
  });

  it("re-exports deleteRange", () => {
    expect(typeof ops.deleteRange).toBe("function");
  });

  it("re-exports replaceRange", () => {
    expect(typeof ops.replaceRange).toBe("function");
  });

  it("re-exports clonePastedSubtree", () => {
    expect(typeof ops.clonePastedSubtree).toBe("function");
  });
});

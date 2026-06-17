import { describe, it, expect } from "vitest";
import { INLINE_KEY_SEPARATOR, inlineRenderKey } from "./inline-render-key";
import { asBlockId } from "../state";

describe("inlineRenderKey", () => {
  it("formats ${blockId}/inline/${i}", () => {
    expect(INLINE_KEY_SEPARATOR).toBe("/inline/");
    expect(inlineRenderKey(asBlockId("blk"), 3)).toBe("blk/inline/3");
    expect(inlineRenderKey(asBlockId("blk"), 0)).toBe("blk/inline/0");
  });
});

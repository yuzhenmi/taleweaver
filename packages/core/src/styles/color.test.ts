import { describe, it, expect } from "vitest";
import type { Color } from "./color";

describe("Color", () => {
  it("accepts CSS color strings", () => {
    const named: Color = "black";
    const hex: Color = "#ff0000";
    const rgba: Color = "rgba(0, 0, 0, 0.5)";
    expect(typeof named).toBe("string");
    expect(typeof hex).toBe("string");
    expect(typeof rgba).toBe("string");
  });
});

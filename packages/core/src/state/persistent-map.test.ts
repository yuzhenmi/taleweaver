import { describe, it, expect } from "vitest";
import { createPersistentMap } from "./persistent-map";

describe("persistent-map", () => {
  it("creates an empty map", () => {
    const m = createPersistentMap<string, number>();
    expect(m.size).toBe(0);
    expect(m.has("a")).toBe(false);
    expect(m.get("a")).toBeUndefined();
  });
});

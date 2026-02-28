import { describe, it, expect } from "vitest";
import { createChange } from "./change";
import { createNode } from "./create-node";

describe("createChange", () => {
  it("stores old and new state", () => {
    const old = createNode("doc", "document");
    const next = createNode("doc", "document", { modified: true });
    const change = createChange(old, next);
    expect(change.oldState).toBe(old);
    expect(change.newState).toBe(next);
  });

  it("defaults timestamp to Date.now()", () => {
    const old = createNode("doc", "document");
    const before = Date.now();
    const change = createChange(old, old);
    const after = Date.now();
    expect(change.timestamp).toBeGreaterThanOrEqual(before);
    expect(change.timestamp).toBeLessThanOrEqual(after);
  });

  it("accepts explicit timestamp", () => {
    const old = createNode("doc", "document");
    const change = createChange(old, old, 12345);
    expect(change.timestamp).toBe(12345);
  });

  it("returns a frozen object", () => {
    const old = createNode("doc", "document");
    const change = createChange(old, old);
    expect(Object.isFrozen(change)).toBe(true);
  });
});

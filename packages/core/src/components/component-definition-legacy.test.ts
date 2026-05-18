import { describe, it, expectTypeOf, expect } from "vitest";
import type { ComponentDefinition } from "./component-definition-legacy";

describe("ComponentDefinition (post-redesign)", () => {
  it("has type and render only", () => {
    const def: ComponentDefinition = {
      type: "test",
      render: () => ({ type: "text", key: "k", style: {}, text: "x" }),
    };
    expect(def.type).toBe("test");
    // The type should not have createInitialState anymore.
    expectTypeOf<ComponentDefinition>().not.toHaveProperty("createInitialState");
  });
});

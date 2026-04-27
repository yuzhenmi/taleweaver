import { describe, it, expect } from "vitest";
import type { Length, LengthOrAuto } from "./length";

describe("Length", () => {
  it("accepts a bare number as px shorthand", () => {
    const x: Length = 10;
    expect(typeof x).toBe("number");
  });

  it("accepts an object with unit and value", () => {
    const px: Length = { unit: "px", value: 12 };
    const pct: Length = { unit: "percent", value: 50 };
    const em: Length = { unit: "em", value: 1.5 };
    expect(px.unit).toBe("px");
    expect(pct.unit).toBe("percent");
    expect(em.unit).toBe("em");
  });

  it("LengthOrAuto accepts 'auto'", () => {
    const v: LengthOrAuto = "auto";
    expect(v).toBe("auto");
  });
});

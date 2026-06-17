import { describe, it, expect } from "vitest";
import { imageWrapFloat, langFromAttrs } from "./leaf-style-attrs";

describe("langFromAttrs", () => {
  it("returns a non-empty string verbatim (no BCP-47 normalization)", () => {
    expect(langFromAttrs("en-US")).toBe("en-US");
    expect(langFromAttrs("de")).toBe("de");
    // Verbatim — case and region subtags are preserved, not canonicalized.
    expect(langFromAttrs("ZH-hans-CN")).toBe("ZH-hans-CN");
  });
  it("returns undefined for an empty string (so the cascade inherits, not clobbers)", () => {
    expect(langFromAttrs("")).toBeUndefined();
  });
  it("returns undefined for non-string values", () => {
    expect(langFromAttrs(undefined)).toBeUndefined();
    expect(langFromAttrs(null)).toBeUndefined();
    expect(langFromAttrs(42)).toBeUndefined();
    expect(langFromAttrs({ tag: "en" })).toBeUndefined();
  });
});

describe("imageWrapFloat", () => {
  it("maps wrap-left to physical-left in LTR (inline-start)", () => {
    expect(imageWrapFloat("left", "ltr")).toBe("inline-start");
  });
  it("maps wrap-left to physical-left in RTL (inline-end)", () => {
    // Google-Docs 'wrap left' is PHYSICAL left; logical inline-start is the
    // RIGHT side under RTL, so wrap-left must resolve to inline-END in RTL.
    expect(imageWrapFloat("left", "rtl")).toBe("inline-end");
  });
  it("maps wrap-right to physical-right in LTR (inline-end) and RTL (inline-start)", () => {
    expect(imageWrapFloat("right", "ltr")).toBe("inline-end");
    expect(imageWrapFloat("right", "rtl")).toBe("inline-start");
  });
  it("maps break (and any unknown) to undefined → no float (block default)", () => {
    expect(imageWrapFloat("break", "ltr")).toBeUndefined();
    expect(imageWrapFloat(undefined, "ltr")).toBeUndefined();
    expect(imageWrapFloat("bogus", "ltr")).toBeUndefined();
  });
});

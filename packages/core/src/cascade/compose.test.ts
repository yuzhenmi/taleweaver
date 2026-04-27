import { describe, it, expect } from "vitest";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { composeComputed } from "./compose";

describe("composeComputed", () => {
  it("uses specified value when present", () => {
    const result = composeComputed(
      { display: "block", color: "red" },
      INITIAL_COMPUTED_STYLE,
    );
    expect(result.display).toBe("block");
    expect(result.color).toBe("red");
  });

  it("inherits inheritable properties from parent when unspecified", () => {
    const parent = { ...INITIAL_COMPUTED_STYLE, color: "red", fontSize: 24 };
    const result = composeComputed({ display: "inline" }, parent);
    expect(result.color).toBe("red");          // inheritable, inherited
    expect(result.fontSize).toBe(24);          // inheritable, inherited
    expect(result.display).toBe("inline");     // specified
  });

  it("uses initial value when unspecified and not inheritable", () => {
    const parent = { ...INITIAL_COMPUTED_STYLE, marginTop: 100 };
    const result = composeComputed({}, parent);
    expect(result.marginTop).toBe(0);          // marginTop does NOT inherit
  });

  it("resolves with no parent (root cascade)", () => {
    const result = composeComputed({ display: "block" }, null);
    expect(result.display).toBe("block");
    expect(result.color).toBe("black");        // initial
    expect(result.fontSize).toBe(16);          // initial
    expect(result.marginTop).toBe(0);
  });
});

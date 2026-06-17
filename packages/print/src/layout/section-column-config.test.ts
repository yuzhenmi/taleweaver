import { describe, it, expect } from "vitest";
import { resolveColumnConfig } from "./section-column-config";
import { DEFAULT_COLUMN_CONFIG } from "@taleweaver/core";
import type { ColumnConfig } from "@taleweaver/core";

// A reference doc-default config. Two columns, default gap, no rule — chosen so
// that "fall back to docDefault" is observably different from the engine-wide
// DEFAULT_COLUMN_CONFIG (single column) where it matters.
const DOC_DEFAULT: ColumnConfig = {
  columnCount: 2,
  columnGap: 48,
  columnRule: null,
};

describe("resolveColumnConfig", () => {
  it("undefined metadata → returns docDefault (deep-equal)", () => {
    expect(resolveColumnConfig(DOC_DEFAULT, undefined)).toEqual(DOC_DEFAULT);
  });

  it("empty metadata → returns docDefault (deep-equal)", () => {
    expect(resolveColumnConfig(DOC_DEFAULT, {})).toEqual(DOC_DEFAULT);
  });

  it("a valid columnCount override applies; other fields from docDefault", () => {
    const cfg = resolveColumnConfig(DEFAULT_COLUMN_CONFIG, { columnCount: 3 });
    expect(cfg.columnCount).toBe(3);
    expect(cfg.columnGap).toBe(DEFAULT_COLUMN_CONFIG.columnGap);
    expect(cfg.columnRule).toBe(DEFAULT_COLUMN_CONFIG.columnRule);
  });

  it("columnCount 1 is a valid override (single-column no-op)", () => {
    const cfg = resolveColumnConfig(DOC_DEFAULT, { columnCount: 1 });
    expect(cfg.columnCount).toBe(1);
  });

  it("a fractional columnCount is floored (2.9 → 2)", () => {
    expect(resolveColumnConfig(DEFAULT_COLUMN_CONFIG, { columnCount: 2.9 }).columnCount).toBe(2);
  });

  it("a fractional columnCount below 1 is clamped to docDefault (0.5 → docDefault)", () => {
    // floor(0.5) = 0 < 1 ⇒ not a usable count ⇒ docDefault wins.
    expect(resolveColumnConfig(DOC_DEFAULT, { columnCount: 0.5 }).columnCount).toBe(
      DOC_DEFAULT.columnCount,
    );
  });

  it("zero / negative columnCount → docDefault", () => {
    expect(resolveColumnConfig(DOC_DEFAULT, { columnCount: 0 }).columnCount).toBe(
      DOC_DEFAULT.columnCount,
    );
    expect(resolveColumnConfig(DOC_DEFAULT, { columnCount: -3 }).columnCount).toBe(
      DOC_DEFAULT.columnCount,
    );
  });

  it("NaN / Infinity / string columnCount → docDefault", () => {
    expect(resolveColumnConfig(DOC_DEFAULT, { columnCount: NaN }).columnCount).toBe(
      DOC_DEFAULT.columnCount,
    );
    expect(
      resolveColumnConfig(DOC_DEFAULT, { columnCount: Number.POSITIVE_INFINITY }).columnCount,
    ).toBe(DOC_DEFAULT.columnCount);
    expect(resolveColumnConfig(DOC_DEFAULT, { columnCount: "2" }).columnCount).toBe(
      DOC_DEFAULT.columnCount,
    );
  });

  it("a valid columnGap override applies", () => {
    expect(resolveColumnConfig(DOC_DEFAULT, { columnGap: 24 }).columnGap).toBe(24);
  });

  it("columnGap 0 is accepted (>= 0)", () => {
    expect(resolveColumnConfig(DOC_DEFAULT, { columnGap: 0 }).columnGap).toBe(0);
  });

  it("negative / NaN / Infinity / string columnGap → docDefault", () => {
    expect(resolveColumnConfig(DOC_DEFAULT, { columnGap: -5 }).columnGap).toBe(
      DOC_DEFAULT.columnGap,
    );
    expect(resolveColumnConfig(DOC_DEFAULT, { columnGap: NaN }).columnGap).toBe(
      DOC_DEFAULT.columnGap,
    );
    // Infinity is non-finite ⇒ rejected (guards a future drop of the isFinite check).
    expect(
      resolveColumnConfig(DOC_DEFAULT, { columnGap: Number.POSITIVE_INFINITY }).columnGap,
    ).toBe(DOC_DEFAULT.columnGap);
    expect(resolveColumnConfig(DOC_DEFAULT, { columnGap: "24" }).columnGap).toBe(
      DOC_DEFAULT.columnGap,
    );
  });

  it("a valid columnRule override applies", () => {
    const cfg = resolveColumnConfig(DOC_DEFAULT, {
      columnRule: { width: 2, style: "solid", color: "#ff0000" },
    });
    expect(cfg.columnRule).toEqual({ width: 2, style: "solid", color: "#ff0000" });
  });

  it("a columnRule with width 0 is accepted (>= 0)", () => {
    const cfg = resolveColumnConfig(DOC_DEFAULT, {
      columnRule: { width: 0, style: "solid", color: "#000000" },
    });
    expect(cfg.columnRule).toEqual({ width: 0, style: "solid", color: "#000000" });
  });

  it("explicit null columnRule is accepted (no line)", () => {
    const cfg = resolveColumnConfig(
      { columnCount: 2, columnGap: 48, columnRule: { width: 1, style: "solid", color: "#000000" } },
      { columnRule: null },
    );
    expect(cfg.columnRule).toBeNull();
  });

  it("a non-object columnRule → docDefault's rule", () => {
    expect(resolveColumnConfig(DOC_DEFAULT, { columnRule: 5 }).columnRule).toBe(
      DOC_DEFAULT.columnRule,
    );
    expect(resolveColumnConfig(DOC_DEFAULT, { columnRule: "solid" }).columnRule).toBe(
      DOC_DEFAULT.columnRule,
    );
  });

  it("a columnRule missing/invalid fields → docDefault's rule", () => {
    const docWithRule: ColumnConfig = {
      columnCount: 2,
      columnGap: 48,
      columnRule: { width: 1, style: "solid", color: "#000000" },
    };
    // negative width
    expect(
      resolveColumnConfig(docWithRule, {
        columnRule: { width: -1, style: "solid", color: "#000000" },
      }).columnRule,
    ).toEqual(docWithRule.columnRule);
    // invalid style
    expect(
      resolveColumnConfig(docWithRule, {
        columnRule: { width: 1, style: "groovy", color: "#000000" },
      }).columnRule,
    ).toEqual(docWithRule.columnRule);
    // non-string color
    expect(
      resolveColumnConfig(docWithRule, {
        columnRule: { width: 1, style: "solid", color: 42 },
      }).columnRule,
    ).toEqual(docWithRule.columnRule);
  });

  it("combined valid overrides all apply together", () => {
    const cfg = resolveColumnConfig(DEFAULT_COLUMN_CONFIG, {
      columnCount: 3,
      columnGap: 30,
      columnRule: { width: 1, style: "dotted", color: "#333333" },
    });
    expect(cfg).toEqual({
      columnCount: 3,
      columnGap: 30,
      columnRule: { width: 1, style: "dotted", color: "#333333" },
    });
  });

  it("does not mutate the input docDefault", () => {
    const frozen: ColumnConfig = {
      columnCount: 2,
      columnGap: 48,
      columnRule: { width: 1, style: "solid", color: "#000000" },
    };
    const snapshot = JSON.stringify(frozen);
    resolveColumnConfig(frozen, { columnCount: 4, columnGap: 12 });
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
});

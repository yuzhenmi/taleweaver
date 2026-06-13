import { describe, it, expect } from "vitest";
import {
  DEFAULT_COLUMN_CONFIG,
  DEFAULT_COLUMN_GAP,
  columnConfigsEqual,
} from "./column-config";
import type { ColumnConfig } from "./column-config";

describe("DEFAULT_COLUMN_CONFIG", () => {
  it("is single-column (count 1), the default gap, no rule", () => {
    expect(DEFAULT_COLUMN_CONFIG).toEqual({
      columnCount: 1,
      columnGap: DEFAULT_COLUMN_GAP,
      columnRule: null,
    });
  });

  it("DEFAULT_COLUMN_GAP is the Google-Docs 0.5in default at 96dpi (48px)", () => {
    expect(DEFAULT_COLUMN_GAP).toBe(48);
  });
});

describe("columnConfigsEqual", () => {
  const base: ColumnConfig = { columnCount: 2, columnGap: 48, columnRule: null };

  it("field-equal configs (both null rule) → true", () => {
    expect(columnConfigsEqual(base, { ...base })).toBe(true);
  });

  it("differing columnCount → false", () => {
    expect(columnConfigsEqual(base, { ...base, columnCount: 3 })).toBe(false);
  });

  it("differing columnGap → false", () => {
    expect(columnConfigsEqual(base, { ...base, columnGap: 24 })).toBe(false);
  });

  it("null vs non-null rule → false", () => {
    const withRule: ColumnConfig = {
      ...base,
      columnRule: { width: 1, style: "solid", color: "#000000" },
    };
    expect(columnConfigsEqual(base, withRule)).toBe(false);
    expect(columnConfigsEqual(withRule, base)).toBe(false);
  });

  it("both non-null, field-equal rule → true", () => {
    const a: ColumnConfig = {
      columnCount: 2,
      columnGap: 48,
      columnRule: { width: 1, style: "solid", color: "#000000" },
    };
    const b: ColumnConfig = {
      columnCount: 2,
      columnGap: 48,
      columnRule: { width: 1, style: "solid", color: "#000000" },
    };
    expect(columnConfigsEqual(a, b)).toBe(true);
  });

  it("both non-null, differing rule width → false", () => {
    const a: ColumnConfig = {
      columnCount: 2,
      columnGap: 48,
      columnRule: { width: 1, style: "solid", color: "#000000" },
    };
    const b: ColumnConfig = {
      columnCount: 2,
      columnGap: 48,
      columnRule: { width: 2, style: "solid", color: "#000000" },
    };
    expect(columnConfigsEqual(a, b)).toBe(false);
  });

  it("both non-null, differing rule style → false", () => {
    const a: ColumnConfig = {
      columnCount: 2,
      columnGap: 48,
      columnRule: { width: 1, style: "solid", color: "#000000" },
    };
    const b: ColumnConfig = {
      columnCount: 2,
      columnGap: 48,
      columnRule: { width: 1, style: "dashed", color: "#000000" },
    };
    expect(columnConfigsEqual(a, b)).toBe(false);
  });

  it("both non-null, differing rule color → false", () => {
    const a: ColumnConfig = {
      columnCount: 2,
      columnGap: 48,
      columnRule: { width: 1, style: "solid", color: "#000000" },
    };
    const b: ColumnConfig = {
      columnCount: 2,
      columnGap: 48,
      columnRule: { width: 1, style: "solid", color: "#ff0000" },
    };
    expect(columnConfigsEqual(a, b)).toBe(false);
  });
});

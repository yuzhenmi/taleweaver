import type { LeaderStyle } from "../styles/tab-stops";

export interface TocAttrs {
  readonly levels: readonly number[];
  readonly leader: LeaderStyle;
  readonly showPageNumbers: boolean;
  readonly indentStep: number; // px per level
}

export const DEFAULT_TOC_ATTRS: TocAttrs = {
  levels: [1, 2, 3, 4, 5, 6],
  leader: "dot",
  showPageNumbers: true,
  indentStep: 18,
};

export function tocLevelsFromAttrs(value: unknown): number[] {
  if (!Array.isArray(value)) return [1, 2, 3, 4, 5, 6];
  const out = value.filter(
    (n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 6,
  );
  return out.length > 0 ? out : [1, 2, 3, 4, 5, 6];
}

export function tocLeaderFromAttrs(value: unknown): LeaderStyle {
  return value === "dot" || value === "dash" || value === "line" || value === "none" ? value : "dot";
}

export function tocShowPageNumbersFromAttrs(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

export function tocIndentStepFromAttrs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 18;
}

import type { ComputedStyle } from "@taleweaver/core";

export const FONT_CONFIG = {
  fontFamily: '"Inter", sans-serif',
  fontSize: 16,
  lineHeight: 1.2,
} as const;

/** Build a CSS font shorthand string from computed styles. */
export function buildCssFontString(styles: Readonly<Pick<ComputedStyle, "fontFamily" | "fontSize" | "fontWeight" | "fontStyle">>): string {
  const family = styles.fontFamily;
  const size = styles.fontSize;
  const parts: string[] = [];
  if (styles.fontStyle && styles.fontStyle !== "normal") parts.push(styles.fontStyle);
  if (styles.fontWeight && styles.fontWeight !== "normal") parts.push(String(styles.fontWeight));
  parts.push(`${size}px ${family}`);
  return parts.join(" ");
}

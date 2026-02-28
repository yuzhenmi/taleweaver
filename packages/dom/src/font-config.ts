import type { RenderStyles } from "@taleweaver/core";

export const FONT_CONFIG = {
  fontFamily: '"Inter", sans-serif',
  fontSize: 16,
  lineHeight: 24,
} as const;

/** Build a CSS font shorthand string from render styles, filling defaults from FONT_CONFIG. */
export function buildCssFontString(styles: RenderStyles): string {
  const family = styles.fontFamily ?? FONT_CONFIG.fontFamily;
  const size = styles.fontSize ?? FONT_CONFIG.fontSize;
  const parts: string[] = [];
  if (styles.fontStyle) parts.push(styles.fontStyle);
  if (styles.fontWeight) parts.push(styles.fontWeight);
  parts.push(`${size}px ${family}`);
  return parts.join(" ");
}

/** Return styles with FONT_CONFIG defaults filled in for fontFamily, fontSize, lineHeight. */
export function getEffectiveStyles(styles: RenderStyles): RenderStyles {
  return {
    ...styles,
    fontFamily: styles.fontFamily ?? FONT_CONFIG.fontFamily,
    fontSize: styles.fontSize ?? FONT_CONFIG.fontSize,
    lineHeight: styles.lineHeight ?? FONT_CONFIG.lineHeight,
  };
}

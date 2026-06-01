import type { ComputedStyle } from "@taleweaver/core";

export const FONT_CONFIG = {
  fontFamily: '"Inter", sans-serif',
  fontSize: 16,
  lineHeight: 1.2,
} as const;

type PartialFontStyles = Partial<Pick<ComputedStyle, "fontFamily" | "fontSize" | "fontWeight" | "fontStyle" | "lineHeight">>;

/** Fill in FONT_CONFIG defaults for any missing font-related properties. */
export function getEffectiveStyles(styles: PartialFontStyles): Required<PartialFontStyles> & PartialFontStyles {
  return {
    fontFamily: styles.fontFamily ?? FONT_CONFIG.fontFamily,
    fontSize: styles.fontSize ?? FONT_CONFIG.fontSize,
    lineHeight: styles.lineHeight ?? FONT_CONFIG.lineHeight,
    fontWeight: styles.fontWeight,
    fontStyle: styles.fontStyle,
  } as Required<PartialFontStyles> & PartialFontStyles;
}

/** Build a CSS font shorthand string from computed styles. */
export function buildCssFontString(styles: PartialFontStyles): string {
  const effective = getEffectiveStyles(styles);
  const family = effective.fontFamily;
  const size = effective.fontSize;
  const parts: string[] = [];
  if (effective.fontStyle && effective.fontStyle !== "normal") parts.push(effective.fontStyle);
  if (effective.fontWeight && effective.fontWeight !== "normal") parts.push(String(effective.fontWeight));
  parts.push(`${size}px ${family}`);
  return parts.join(" ");
}

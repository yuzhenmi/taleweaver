import type { ComputedStyle } from "../styles";

export interface TextMeasurer {
  measureWidth(text: string, style: Readonly<ComputedStyle>): number;
  measureHeight(style: Readonly<ComputedStyle>): number;
}

/** Mock measurer for tests: fixed char width, fixed line height. */
export function createMockMeasurer(charWidth: number, lineHeight: number): TextMeasurer {
  return {
    measureWidth: (text: string) => text.length * charWidth,
    measureHeight: () => lineHeight,
  };
}

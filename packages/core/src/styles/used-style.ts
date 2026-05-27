import type {
  Display, BorderStyle, FontWeight, FontStyle, TextDecoration,
  WhiteSpace, VerticalAlign, TextAlign, Float, Clear,
  BreakBefore, BreakAfter, BreakInside,
  ListStyleType, ListStylePosition, BoxSizing,
} from "./style";
import type { Color } from "./color";
import type { UsedLength } from "./length";
import type { WritingMode, Direction } from "./writing-mode";

/**
 * Used style — fully numeric. Produced by the layout pass per LayoutBox.
 * Carries only resolved margin/padding/border/typography values.
 * Sizing (inlineSize/blockSize/min-size/max-size) lives on LayoutBox exclusively.
 */
export interface UsedStyle {
  display: Display;

  writingMode: WritingMode;
  direction:   Direction;

  // (NO inlineSize / blockSize / min* / max* — those live on LayoutBox.)
  boxSizing: BoxSizing;

  marginBlockStart:  UsedLength;
  marginBlockEnd:    UsedLength;
  marginInlineStart: UsedLength;
  marginInlineEnd:   UsedLength;

  paddingBlockStart:  UsedLength;
  paddingBlockEnd:    UsedLength;
  paddingInlineStart: UsedLength;
  paddingInlineEnd:   UsedLength;

  borderBlockStartWidth:  number;
  borderBlockEndWidth:    number;
  borderInlineStartWidth: number;
  borderInlineEndWidth:   number;
  borderBlockStartStyle:  BorderStyle;
  borderBlockEndStyle:    BorderStyle;
  borderInlineStartStyle: BorderStyle;
  borderInlineEndStyle:   BorderStyle;
  borderBlockStartColor:  Color;
  borderBlockEndColor:    Color;
  borderInlineStartColor: Color;
  borderInlineEndColor:   Color;

  backgroundColor: Color;

  fontFamily:     string;
  fontSize:       number;
  fontWeight:     FontWeight;
  fontStyle:      FontStyle;
  textDecoration: TextDecoration;
  lineHeight:     number;
  color:          Color;

  whiteSpace:    WhiteSpace;
  verticalAlign: VerticalAlign;

  textAlign:           TextAlign;
  textIndent:          UsedLength;
  textWrap:            "wrap" | "nowrap" | "balance" | "pretty" | "stable";
  hyphens:             "none" | "manual" | "auto";
  letterSpacing:       UsedLength | "normal";
  wordSpacing:         UsedLength | "normal";
  textTransform:       "none" | "capitalize" | "uppercase" | "lowercase";
  fontFeatureSettings: readonly string[];
  tabSize:             number;

  float: Float;
  clear: Clear;

  breakBefore: BreakBefore;
  breakAfter:  BreakAfter;
  breakInside: BreakInside;

  widows:  number;
  orphans: number;

  listStyleType:     ListStyleType;
  listStylePosition: ListStylePosition;
}

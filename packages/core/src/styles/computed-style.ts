import type {
  Display, BorderStyle, FontWeight, FontStyle, TextDecoration,
  WhiteSpace, VerticalAlign, TextAlign, Float, Clear,
  BreakBefore, BreakAfter, BreakInside,
  ListStyleType, ListStylePosition, BoxSizing,
} from "./style";
import type { Color } from "./color";
import type { ComputedLength, ComputedLengthOrAuto, IntrinsicSizingKeyword } from "./length";
import type { WritingMode, Direction } from "./writing-mode";

/**
 * Resolved style — every property is required. Lengths are in canonical
 * form: `em`/`rem` resolved to px; `percent` kept symbolic. Layout-time
 * resolution converts `percent` to numeric in `UsedStyle`.
 */
export interface ComputedStyle {
  display: Display;

  writingMode: WritingMode;
  direction:   Direction;

  inlineSize:    ComputedLengthOrAuto | IntrinsicSizingKeyword;
  blockSize:     ComputedLengthOrAuto | IntrinsicSizingKeyword;
  minInlineSize: ComputedLength | IntrinsicSizingKeyword;
  minBlockSize:  ComputedLength | IntrinsicSizingKeyword;
  maxInlineSize: ComputedLength | "none" | IntrinsicSizingKeyword;
  maxBlockSize:  ComputedLength | "none" | IntrinsicSizingKeyword;
  boxSizing:     BoxSizing;

  marginBlockStart:  ComputedLengthOrAuto;
  marginBlockEnd:    ComputedLengthOrAuto;
  marginInlineStart: ComputedLengthOrAuto;
  marginInlineEnd:   ComputedLengthOrAuto;

  paddingBlockStart:  ComputedLength;
  paddingBlockEnd:    ComputedLength;
  paddingInlineStart: ComputedLength;
  paddingInlineEnd:   ComputedLength;

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
  fontSize:       number;       // em/rem already resolved at cascade time
  fontWeight:     FontWeight;
  fontStyle:      FontStyle;
  textDecoration: TextDecoration;
  lineHeight:     number | ComputedLength;
  color:          Color;

  whiteSpace:    WhiteSpace;
  verticalAlign: VerticalAlign;

  // Text typography
  textAlign:           TextAlign;
  textIndent:          ComputedLength;
  textWrap:            "wrap" | "nowrap" | "balance" | "pretty" | "stable";
  hyphens:             "none" | "manual" | "auto";
  letterSpacing:       ComputedLength | "normal";
  wordSpacing:         ComputedLength | "normal";
  textTransform:       "none" | "capitalize" | "uppercase" | "lowercase";
  fontFeatureSettings: readonly string[];
  tabSize:             number;

  float: Float;
  clear: Clear;

  breakBefore: BreakBefore;
  breakAfter:  BreakAfter;
  breakInside: BreakInside;

  // Fragmentation extras
  widows:  number;
  orphans: number;

  listStyleType:     ListStyleType;
  listStylePosition: ListStylePosition;

  // Generated marker content (see Style.markerText). `undefined` = no explicit
  // marker. Non-inheriting; flows through composeComputed generically.
  markerText: string | undefined;
}

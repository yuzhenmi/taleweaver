import type {
  Display, BorderStyle, FontWeight, FontStyle,
  WhiteSpace, VerticalAlign, TextAlign, TextTransform, Float, Clear,
  BreakBefore, BreakAfter, BreakInside,
  ListStyleType, ListStylePosition, BoxSizing,
} from "./style";
import type { Color } from "./color";
import type { ComputedLength, ComputedLengthOrAuto, IntrinsicSizingKeyword } from "./length";
import type { WritingMode, Direction } from "./writing-mode";
import type { TabStop } from "./tab-stops";
import type { Position, TransformFn, TransformOrigin } from "./position";

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
  underline:      boolean;  // text-decoration-line ∋ underline
  lineThrough:    boolean;  // text-decoration-line ∋ line-through
  lineHeight:     number | ComputedLength;
  color:          Color;

  whiteSpace:    WhiteSpace;
  verticalAlign: VerticalAlign;

  // Text typography
  textAlign:           TextAlign;
  textIndent:          ComputedLength;
  textWrap:            "wrap" | "nowrap" | "balance" | "pretty" | "stable";
  hyphens:             "none" | "manual" | "auto";
  // Content language (BCP-47 tag, e.g. "en-US") for auto-hyphenation.
  // `""` = no language. Inherits.
  language:            string;
  // Auto-hyphenation limits (CSS Text 4 `hyphenate-limit-chars`):
  // [min-word, min-before, min-after]. Inherits.
  hyphenateLimitChars: readonly [number, number, number];
  // CSS Text 3 §5.1 — last-resort within-word break to avoid overflow. v1 ships
  // `normal` (initial — overflow) + `break-word` (break an unbreakable word at a
  // grapheme boundary). `anywhere` (the min-content variant) is a follow-up.
  overflowWrap:        "normal" | "break-word" | "anywhere";
  letterSpacing:       ComputedLength | "normal";
  wordSpacing:         ComputedLength | "normal";
  textTransform:       TextTransform;
  fontFeatureSettings: readonly string[];
  tabStops:            readonly TabStop[];
  defaultTabStop:      number;

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

  // Positioning (resolved). Insets are `ComputedLength | "auto"` — `em` is
  // flattened to px in the cascade like other length-valued computed
  // properties; `percent` stays symbolic (resolved at the use-site against the
  // containing block). `transform` length args stay verbatim (paint-time
  // resolved). All non-inheriting.
  position: Position;
  insetBlockStart:  ComputedLength | "auto";
  insetBlockEnd:    ComputedLength | "auto";
  insetInlineStart: ComputedLength | "auto";
  insetInlineEnd:   ComputedLength | "auto";
  zIndex:          number | "auto";
  transform:       readonly TransformFn[];
  transformOrigin: TransformOrigin;
  opacity:         number;
}

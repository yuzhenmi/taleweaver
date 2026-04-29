import type { Length, LengthOrAuto, IntrinsicSizingKeyword } from "./length";
import type { Color } from "./color";
import type { WritingMode, Direction } from "./writing-mode";

export type Display =
  | "block" | "inline" | "inline-block" | "list-item"
  | "table" | "table-row" | "table-cell" | "flow-root" | "none";

export type BorderStyle = "none" | "solid" | "dashed" | "dotted";

export type FontWeight =
  | "normal" | "bold" | "lighter" | "bolder"
  | number;

export type FontStyle = "normal" | "italic" | "oblique";

export type TextDecoration = "none" | "underline" | "line-through";

export type WhiteSpace = "normal" | "nowrap" | "pre" | "pre-wrap" | "pre-line";

export type VerticalAlign = "baseline" | "top" | "middle" | "bottom";

export type Float = "none" | "inline-start" | "inline-end";
export type Clear = "none" | "inline-start" | "inline-end" | "both";

export type BreakBefore = "auto" | "page" | "avoid";
export type BreakAfter = "auto" | "page" | "avoid";
export type BreakInside = "auto" | "avoid";

export type ListStyleType =
  | "disc" | "circle" | "square"
  | "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman"
  | "none"
  | { readonly content: string };

export type ListStylePosition = "outside" | "inside";

export type BoxSizing = "content-box" | "border-box";

/** Partial style — what a render fn or state node specifies. Properties are optional. */
export interface Style {
  // Display & layout participation
  readonly display?: Display;

  // Writing-mode and direction (Plan 3.A: horizontal-tb only; ltr/rtl both supported)
  readonly writingMode?: WritingMode;
  readonly direction?:   Direction;

  // Sizing — logical
  readonly inlineSize?:    LengthOrAuto | IntrinsicSizingKeyword;
  readonly blockSize?:     LengthOrAuto | IntrinsicSizingKeyword;
  readonly minInlineSize?: Length | IntrinsicSizingKeyword;
  readonly minBlockSize?:  Length | IntrinsicSizingKeyword;
  readonly maxInlineSize?: Length | "none" | IntrinsicSizingKeyword;
  readonly maxBlockSize?:  Length | "none" | IntrinsicSizingKeyword;
  readonly boxSizing?:     BoxSizing;

  // Margin — logical
  readonly marginBlockStart?:  LengthOrAuto;
  readonly marginBlockEnd?:    LengthOrAuto;
  readonly marginInlineStart?: LengthOrAuto;
  readonly marginInlineEnd?:   LengthOrAuto;

  // Padding — logical
  readonly paddingBlockStart?:  Length;
  readonly paddingBlockEnd?:    Length;
  readonly paddingInlineStart?: Length;
  readonly paddingInlineEnd?:   Length;

  // Border — logical
  readonly borderBlockStartWidth?:  number;
  readonly borderBlockEndWidth?:    number;
  readonly borderInlineStartWidth?: number;
  readonly borderInlineEndWidth?:   number;
  readonly borderBlockStartStyle?:  BorderStyle;
  readonly borderBlockEndStyle?:    BorderStyle;
  readonly borderInlineStartStyle?: BorderStyle;
  readonly borderInlineEndStyle?:   BorderStyle;
  readonly borderBlockStartColor?:  Color;
  readonly borderBlockEndColor?:    Color;
  readonly borderInlineStartColor?: Color;
  readonly borderInlineEndColor?:   Color;

  // Background
  readonly backgroundColor?: Color;

  // Typography (unchanged)
  readonly fontFamily?:     string;
  readonly fontSize?:       Length;
  readonly fontWeight?:     FontWeight;
  readonly fontStyle?:      FontStyle;
  readonly textDecoration?: TextDecoration;
  readonly lineHeight?:     number | Length;
  readonly color?:          Color;

  // Inline / text (unchanged)
  readonly whiteSpace?:    WhiteSpace;
  readonly verticalAlign?: VerticalAlign;

  // Text — typography (Plan 3.C reservations; consumers in Plan 3.G + Plan 4)
  readonly textAlign?:           "start" | "end" | "center" | "justify";
  readonly textIndent?:          Length;
  readonly textWrap?:            "wrap" | "nowrap" | "balance" | "pretty" | "stable";
  readonly hyphens?:             "none" | "manual" | "auto";
  readonly letterSpacing?:       Length | "normal";
  readonly wordSpacing?:         Length | "normal";
  readonly textTransform?:       "none" | "capitalize" | "uppercase" | "lowercase";
  readonly fontFeatureSettings?: readonly string[];
  readonly tabSize?:             number;

  // Float / clear (sides are logical now)
  readonly float?: Float;
  readonly clear?: Clear;

  // Fragmentation (unchanged)
  readonly breakBefore?: BreakBefore;
  readonly breakAfter?:  BreakAfter;
  readonly breakInside?: BreakInside;

  // Fragmentation — additional (Plan 3.C reservations; consumers in Plan 5)
  readonly widows?:  number;
  readonly orphans?: number;

  // List
  readonly listStyleType?:     ListStyleType;
  readonly listStylePosition?: ListStylePosition;
}

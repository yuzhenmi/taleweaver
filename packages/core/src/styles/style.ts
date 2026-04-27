import type { Length, LengthOrAuto } from "./length";
import type { Color } from "./color";

export type Display =
  | "block" | "inline" | "inline-block" | "list-item"
  | "table" | "table-row" | "table-cell" | "none";

export type BorderStyle = "none" | "solid" | "dashed" | "dotted";

export type FontWeight =
  | "normal" | "bold" | "lighter" | "bolder"
  | number;

export type FontStyle = "normal" | "italic" | "oblique";

export type TextDecoration = "none" | "underline" | "line-through";

export type WhiteSpace = "normal" | "nowrap" | "pre" | "pre-wrap" | "pre-line";

export type VerticalAlign = "baseline" | "top" | "middle" | "bottom";

export type Float = "none" | "left" | "right";
export type Clear = "none" | "left" | "right" | "both";

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

  // Sizing
  readonly width?:     LengthOrAuto;
  readonly height?:    LengthOrAuto;
  readonly minWidth?:  Length;
  readonly minHeight?: Length;
  readonly maxWidth?:  Length | "none";
  readonly maxHeight?: Length | "none";
  readonly boxSizing?: BoxSizing;

  // Margin
  readonly marginTop?:    LengthOrAuto;
  readonly marginRight?:  LengthOrAuto;
  readonly marginBottom?: LengthOrAuto;
  readonly marginLeft?:   LengthOrAuto;

  // Padding
  readonly paddingTop?:    Length;
  readonly paddingRight?:  Length;
  readonly paddingBottom?: Length;
  readonly paddingLeft?:   Length;

  // Border
  readonly borderTopWidth?:    number;
  readonly borderRightWidth?:  number;
  readonly borderBottomWidth?: number;
  readonly borderLeftWidth?:   number;
  readonly borderTopStyle?:    BorderStyle;
  readonly borderRightStyle?:  BorderStyle;
  readonly borderBottomStyle?: BorderStyle;
  readonly borderLeftStyle?:   BorderStyle;
  readonly borderTopColor?:    Color;
  readonly borderRightColor?:  Color;
  readonly borderBottomColor?: Color;
  readonly borderLeftColor?:   Color;

  // Background
  readonly backgroundColor?: Color;

  // Typography
  readonly fontFamily?:     string;
  readonly fontSize?:       Length;
  readonly fontWeight?:     FontWeight;
  readonly fontStyle?:      FontStyle;
  readonly textDecoration?: TextDecoration;
  readonly lineHeight?:     number | Length;
  readonly color?:          Color;

  // Inline / text
  readonly whiteSpace?:    WhiteSpace;
  readonly verticalAlign?: VerticalAlign;

  // Float / clear
  readonly float?: Float;
  readonly clear?: Clear;

  // Fragmentation
  readonly breakBefore?: BreakBefore;
  readonly breakAfter?:  BreakAfter;
  readonly breakInside?: BreakInside;
  readonly widows?:      number;
  readonly orphans?:     number;

  // List markers
  readonly listStyleType?:     ListStyleType;
  readonly listStylePosition?: ListStylePosition;
}

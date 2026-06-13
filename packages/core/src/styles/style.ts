import type { Length, LengthOrAuto, IntrinsicSizingKeyword } from "./length";
import type { Color } from "./color";
import type { WritingMode, Direction } from "./writing-mode";
import type { TabStop } from "./tab-stops";
import type { Position, TransformFn, TransformOrigin } from "./position";

export type Display =
  | "block" | "inline" | "inline-block" | "list-item"
  | "table" | "table-row" | "table-cell" | "flow-root" | "none"
  // `contents`: the element generates NO box; its children lay out as if they
  // were direct children of the element's parent (CSS Display 3 §3.2). The
  // layout pipeline implements this by flattening such elements in
  // `group-children`'s `flattenContents` (shared by the BFC, build-fit-metas,
  // and the intrinsic-sizes pass). Used by transparent `section` blocks.
  | "contents";

export type BorderStyle = "none" | "solid" | "dashed" | "dotted";

export type FontWeight =
  | "normal" | "bold" | "lighter" | "bolder"
  | number;

export type FontStyle = "normal" | "italic" | "oblique";

export type WhiteSpace = "normal" | "nowrap" | "pre" | "pre-wrap" | "pre-line" | "break-spaces";

export type VerticalAlign = "baseline" | "sub" | "super" | "top" | "middle" | "bottom";

export type TextAlign = "start" | "end" | "center" | "justify";
export type TextTransform = "none" | "capitalize" | "uppercase" | "lowercase";

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
  // Text decorations — an independent-flag SET (CSS text-decoration-line).
  // A run can carry both at once; each composes via a disjoint Style key.
  readonly underline?:      boolean;  // text-decoration-line ∋ underline
  readonly lineThrough?:    boolean;  // text-decoration-line ∋ line-through
  readonly lineHeight?:     number | Length;
  readonly color?:          Color;

  // Inline / text (unchanged)
  readonly whiteSpace?:    WhiteSpace;
  readonly verticalAlign?: VerticalAlign;

  // Text — typography (Plan 3.C reservations; consumers in Plan 3.G + Plan 4)
  readonly textAlign?:           TextAlign;
  readonly textIndent?:          Length;
  readonly textWrap?:            "wrap" | "nowrap" | "balance" | "pretty" | "stable";
  readonly hyphens?:             "none" | "manual" | "auto";
  // Content language (BCP-47 tag, e.g. "en-US"). Selects the language for
  // auto-hyphenation. `""` = no language. Inherits.
  readonly language?:            string;
  // Auto-hyphenation limits (CSS Text 4 `hyphenate-limit-chars`):
  // [min-word, min-before, min-after]. Default [5, 2, 2]. Inherits.
  readonly hyphenateLimitChars?: readonly [number, number, number];
  readonly overflowWrap?:        "normal" | "break-word" | "anywhere";
  readonly letterSpacing?:       Length | "normal";
  readonly wordSpacing?:         Length | "normal";
  readonly textTransform?:       TextTransform;
  readonly fontFeatureSettings?: readonly string[];
  // Tab stops — per-paragraph stop list + default interval (paragraph style).
  // A tab itself is the `"tab"` inline embed; these style its placement.
  readonly tabStops?:            readonly TabStop[];
  readonly defaultTabStop?:      number;

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

  // Generated marker content (CSS `::marker` `content`-like): an explicit
  // presentation string rendered as a marker before the box, independent of
  // the `list-style-type` auto-counter. Absent (undefined) means "no explicit
  // marker". Non-inheriting. The marker is a generated layout sibling, NOT an
  // editable/offset-bearing inline item.
  readonly markerText?: string;

  // Positioning (CSS Positioned Layout 3 / Transforms 1) — all non-inheriting.
  // Layout/paint consumers land in later positioning slices; the vocabulary is
  // inert until then.
  readonly position?: Position;
  // Logical insets. `insetInlineStart` wins over `insetInlineEnd` when both are
  // set (and the block pair symmetrically); resolved against the containing
  // block at the use-site (NOT in UsedStyle).
  readonly insetBlockStart?:  LengthOrAuto;
  readonly insetBlockEnd?:    LengthOrAuto;
  readonly insetInlineStart?: LengthOrAuto;
  readonly insetInlineEnd?:   LengthOrAuto;
  readonly zIndex?:          number | "auto";
  readonly transform?:       readonly TransformFn[];
  readonly transformOrigin?: TransformOrigin;
  readonly opacity?:         number;
}

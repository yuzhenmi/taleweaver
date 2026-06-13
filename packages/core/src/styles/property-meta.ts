import type { Style } from "./style";
import type { ComputedStyle } from "./computed-style";
import type { TransformFn, TransformOrigin } from "./position";
import type { Length } from "./length";

/**
 * Shared frozen defaults for the object/array-valued positioning properties, so
 * every default ComputedStyle references the same instance (mirrors how
 * `fontFeatureSettings`/`tabStops` reuse a constant rather than allocating a new
 * literal per cascade).
 */
const EMPTY_TRANSFORM: readonly TransformFn[] = Object.freeze([]);
const CENTER_LENGTH: Length = Object.freeze({ unit: "percent", value: 50 });
const CENTER_TRANSFORM_ORIGIN: TransformOrigin = Object.freeze({
  x: CENTER_LENGTH,
  y: CENTER_LENGTH,
});

export const PROPERTY_META: Record<keyof Style, { inherits: boolean }> = {
  display:         { inherits: false },

  writingMode:     { inherits: true },
  direction:       { inherits: true },

  inlineSize:      { inherits: false },
  blockSize:       { inherits: false },
  minInlineSize:   { inherits: false },
  minBlockSize:    { inherits: false },
  maxInlineSize:   { inherits: false },
  maxBlockSize:    { inherits: false },
  boxSizing:       { inherits: false },

  marginBlockStart:  { inherits: false },
  marginBlockEnd:    { inherits: false },
  marginInlineStart: { inherits: false },
  marginInlineEnd:   { inherits: false },

  paddingBlockStart:  { inherits: false },
  paddingBlockEnd:    { inherits: false },
  paddingInlineStart: { inherits: false },
  paddingInlineEnd:   { inherits: false },

  borderBlockStartWidth:  { inherits: false },
  borderBlockEndWidth:    { inherits: false },
  borderInlineStartWidth: { inherits: false },
  borderInlineEndWidth:   { inherits: false },
  borderBlockStartStyle:  { inherits: false },
  borderBlockEndStyle:    { inherits: false },
  borderInlineStartStyle: { inherits: false },
  borderInlineEndStyle:   { inherits: false },
  borderBlockStartColor:  { inherits: false },
  borderBlockEndColor:    { inherits: false },
  borderInlineStartColor: { inherits: false },
  borderInlineEndColor:   { inherits: false },

  backgroundColor: { inherits: false },

  fontFamily:     { inherits: true },
  fontSize:       { inherits: true },
  fontWeight:     { inherits: true },
  fontStyle:      { inherits: true },
  // Per CSS Text Decoration Module Level 3, `text-decoration` does NOT
  // inherit. The "decoration spans descendants visually" behavior is a
  // paint-time concern (ancestor box paints the decoration across its
  // line area, visually covering descendants), not a cascade concern.
  // Inheriting at cascade would make `{ underline: false }` on a child
  // span ineffective — the parent's underline would inherit back. Modelled
  // as two independent flags (CSS text-decoration-line is a SET), so a run
  // can carry underline + line-through at once.
  underline:   { inherits: false },
  lineThrough: { inherits: false },
  lineHeight:     { inherits: true },
  color:          { inherits: true },

  whiteSpace:    { inherits: true },
  verticalAlign: { inherits: false },

  textAlign:           { inherits: true },
  textIndent:          { inherits: true },
  textWrap:            { inherits: true },
  hyphens:             { inherits: true },
  language:            { inherits: true },
  hyphenateLimitChars: { inherits: true },
  overflowWrap:        { inherits: true },
  letterSpacing:       { inherits: true },
  wordSpacing:         { inherits: true },
  textTransform:       { inherits: true },
  fontFeatureSettings: { inherits: true },
  // Per CSS Text 4, `tab-size` (the default interval) inherits; the explicit
  // stop LIST is a paragraph property and does NOT inherit.
  tabStops:            { inherits: false },
  defaultTabStop:      { inherits: true },

  float: { inherits: false },
  clear: { inherits: false },

  breakBefore: { inherits: false },
  breakAfter:  { inherits: false },
  breakInside: { inherits: false },

  widows:  { inherits: true },
  orphans: { inherits: true },

  listStyleType:     { inherits: true },
  listStylePosition: { inherits: true },

  markerText:        { inherits: false },

  // Positioning — all non-inheriting (CSS Positioned Layout 3 / Transforms 1).
  position:         { inherits: false },
  insetBlockStart:  { inherits: false },
  insetBlockEnd:    { inherits: false },
  insetInlineStart: { inherits: false },
  insetInlineEnd:   { inherits: false },
  zIndex:           { inherits: false },
  transform:        { inherits: false },
  transformOrigin:  { inherits: false },
  opacity:          { inherits: false },
};

export const INITIAL_COMPUTED_STYLE: ComputedStyle = {
  display: "inline",

  writingMode: "horizontal-tb",
  direction:   "ltr",

  inlineSize:    "auto",
  blockSize:     "auto",
  minInlineSize: 0,
  minBlockSize:  0,
  maxInlineSize: "none",
  maxBlockSize:  "none",
  boxSizing:     "content-box",

  marginBlockStart:  0,
  marginBlockEnd:    0,
  marginInlineStart: 0,
  marginInlineEnd:   0,

  paddingBlockStart:  0,
  paddingBlockEnd:    0,
  paddingInlineStart: 0,
  paddingInlineEnd:   0,

  borderBlockStartWidth:  0,
  borderBlockEndWidth:    0,
  borderInlineStartWidth: 0,
  borderInlineEndWidth:   0,
  borderBlockStartStyle:  "none",
  borderBlockEndStyle:    "none",
  borderInlineStartStyle: "none",
  borderInlineEndStyle:   "none",
  borderBlockStartColor:  "currentColor",
  borderBlockEndColor:    "currentColor",
  borderInlineStartColor: "currentColor",
  borderInlineEndColor:   "currentColor",

  backgroundColor: "transparent",

  fontFamily:     "sans-serif",
  fontSize:       16,
  fontWeight:     "normal",
  fontStyle:      "normal",
  underline:      false,
  lineThrough:    false,
  lineHeight:     1.2,
  color:          "#000",

  whiteSpace:    "normal",
  verticalAlign: "baseline",

  textAlign:           "start",
  textIndent:          0,
  textWrap:            "wrap",
  hyphens:             "manual",
  language:            "",
  hyphenateLimitChars: [5, 2, 2],
  overflowWrap:        "normal",
  letterSpacing:       "normal",
  wordSpacing:         "normal",
  textTransform:       "none",
  fontFeatureSettings: [],
  tabStops:            [],
  defaultTabStop:      48,

  float: "none",
  clear: "none",

  breakBefore: "auto",
  breakAfter:  "auto",
  breakInside: "auto",

  widows:  2,
  orphans: 2,

  listStyleType:     "disc",
  listStylePosition: "outside",

  markerText: undefined,

  position:         "static",
  insetBlockStart:  "auto",
  insetBlockEnd:    "auto",
  insetInlineStart: "auto",
  insetInlineEnd:   "auto",
  zIndex:           "auto",
  transform:        EMPTY_TRANSFORM,
  transformOrigin:  CENTER_TRANSFORM_ORIGIN,
  opacity:          1,
};

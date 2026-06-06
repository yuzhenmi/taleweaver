import type { Style, CounterAction } from "./style";
import type { ComputedStyle } from "./computed-style";

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
  letterSpacing:       { inherits: true },
  wordSpacing:         { inherits: true },
  textTransform:       { inherits: true },
  fontFeatureSettings: { inherits: true },
  tabSize:             { inherits: true },

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

  // Generated content + CSS counters — none inherit (CSS Generated Content 3 /
  // Lists 3).
  content:           { inherits: false },
  counterReset:      { inherits: false },
  counterIncrement:  { inherits: false },
};

/**
 * Shared frozen empty array used as the INITIAL value for BOTH `counterReset`
 * and `counterIncrement`. A single reference keeps `composeComputed`'s
 * initial-value fallthrough ref-equal across all default-path computed styles
 * (so `computedStylesEqual`'s `av === bv` fast-path fires and incremental reuse
 * is preserved), mirroring the `fontFeatureSettings: []` precedent above. Frozen
 * so it can't be mutated through the readonly array type.
 */
const EMPTY_COUNTER_ACTIONS: readonly CounterAction[] = Object.freeze([]);

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
  letterSpacing:       "normal",
  wordSpacing:         "normal",
  textTransform:       "none",
  fontFeatureSettings: [],
  tabSize:             4,

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

  content:          "normal",
  counterReset:     EMPTY_COUNTER_ACTIONS,
  counterIncrement: EMPTY_COUNTER_ACTIONS,
};

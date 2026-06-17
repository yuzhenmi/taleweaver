import type { RenderNode } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import type { ComputedStyle, WhiteSpace, TabStop, LeaderStyle } from "@taleweaver/core";
import type { LayoutBox, LineBox, InlineBox, BlockBox } from "./layout-box";
import type { BlockId } from "@taleweaver/core";
import { HARD_BREAK_EMBED_TYPE } from "@taleweaver/core";
import { createInlineBox, createInlineBlockBox, createLineBox, createTextRunBox, withInlineOffset, withBlockOffset, assertLayoutBoxConsistent, createBlockBox } from "./layout-box";
import type { FragmentationContext, LayoutResult } from "./fragmentation";
import type { TextShaper } from "@taleweaver/core";
import type { Hyphenator } from "@taleweaver/core";
import type { TextMeasurer } from "@taleweaver/core";
import { adaptShaperToMeasurer } from "@taleweaver/core";
import { tokenize, LINE_BREAK } from "@taleweaver/core";
import { graphemeClusters } from "@taleweaver/core";
import { lineBreakOpportunities } from "@taleweaver/core";
import { transformRun } from "@taleweaver/core";
import { layoutBlock } from "./bfc";
import type { WritingMode, Direction } from "@taleweaver/core";
import { axisMapFor } from "@taleweaver/core";
import { computeUsedStyle, resolveUsedLength } from "./used-style";
import type { LayoutContext } from "./layout-context";
import { makeRootContext, makeChildContext } from "./layout-context";
import type { IntrinsicSizesCache } from "@taleweaver/core";
import { computeIntrinsicSizes } from "./intrinsic-sizes-pass";
import { findChangePoint } from "./wrap-incremental";
import { flattenContents } from "./group-children";
import { markStart, markEnd } from "@taleweaver/core";
import { computeAlignmentOffset, computeJustifyExpansions } from "./ifc-align";
import { resolveSpacingPx } from "@taleweaver/core";
import { resolveParagraphBidi, type ParagraphBidi } from "./ifc-bidi";
import { applyL1 } from "@taleweaver/core";
import { reorderLineLeaves } from "./ifc-bidi-reorder";

/**
 * Derive the SOURCE block id from an IFC parent's render-node key.
 * BFC wraps inline runs in anonymous blocks keyed
 * `${sourceKey}/anon[N]` (see `group-children.ts:anonymousBlockKey`);
 * the IFC stamps `ownerBlockId` on emitted LineBoxes with the source
 * id so downstream consumers (hit-test, cursor-position, state APIs)
 * see the state-model block, not the layout-only wrap.
 *
 * The "/anon[N]" suffix is the only marker; nested anonymous blocks
 * (rare) follow the same convention recursively, but the BFC creates
 * at most one anonymous layer per inline-run group, so a single
 * suffix-strip is sufficient.
 */
export function sourceBlockIdOf(parentKey: string): BlockId {
  const idx = parentKey.lastIndexOf("/anon[");
  if (idx === -1) return parentKey as BlockId;
  return parentKey.slice(0, idx) as BlockId;
}

/** The source block id that OWNS a synthesized marker box. A marker box is
 *  keyed `${listItemKey}-marker` (`bfc.ts` createMarkerBox); strip that suffix,
 *  then `sourceBlockIdOf` (which strips any `/anon[...]`) recovers the list-item
 *  block id. Used by the tagged-PDF emitter to route a bullet/number's MCID to
 *  its list item's `Lbl` (#526). */
export function markerOwnerKey(key: string): BlockId {
  const base = key.endsWith("-marker") ? key.slice(0, -"-marker".length) : key;
  return sourceBlockIdOf(base);
}

/**
 * Structural equality for two resolved tab-stop lists. The cached lines bake in
 * the tab-stop geometry, so the incremental-wrap cache-hit gate must reject a
 * tab-stop change even when tokens + width + align + indent are unchanged.
 * Compares length + per-index position/alignment/leader.
 */
function tabStopsEqual(a: readonly TabStop[], b: readonly TabStop[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const sa = a[i];
    const sb = b[i];
    if (sa === undefined || sb === undefined) {
      throw new Error(`ifc: tabStopsEqual index ${i} missing (unreachable)`);
    }
    if (
      sa.position !== sb.position ||
      sa.alignment !== sb.alignment ||
      sa.leader !== sb.leader
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Resolve the next tab stop strictly to the RIGHT of pen position `x`
 * (tab stops, S3). Returns both the destination `position` and the explicit
 * `stop` it landed on (or `null` for a default-grid stop) so the caller can read
 * the stop's `leader`.
 *
 * Algorithm (Google-Docs / word-processor convergent model, spec §"The model"):
 *  - the explicit stop with the smallest EFFECTIVE position `> x`, if any;
 *    otherwise
 *  - the next default-grid position `(floor(x / D) + 1) * D` — the smallest
 *    multiple of `D` strictly greater than `x`.
 *
 * A stop's EFFECTIVE position is its `position`, except a `content-edge` stop —
 * whose destination is the line's content edge (`contentEdge`), not its stored
 * `position` (which is `0` so the synthesized stop sorts first). Because a
 * content-edge stop's effective position diverges from its array order, this no
 * longer relies on the sorted-array "first match wins" assumption: it does a
 * NEAREST-AHEAD min-scan (smallest effective position `> x`). For all-regular
 * sorted stops this is behavior-identical to first-in-sorted-order.
 */
function nextStop(
  x: number,
  tabStops: readonly TabStop[],
  defaultTabStop: number,
  contentEdge: number,
): { position: number; stop: TabStop | null } {
  let best: { position: number; stop: TabStop } | null = null;
  for (const stop of tabStops) {
    const effective = stop.alignment === "content-edge" ? contentEdge : stop.position;
    if (effective > x && (best === null || effective < best.position)) {
      best = { position: effective, stop };
    }
  }
  if (best !== null) return best;
  // No explicit stop right of the pen → next default-grid multiple. Guard a
  // non-positive `D` (defensive — the cascade default is 48) so we always make
  // forward progress.
  const grid = defaultTabStop > 0 ? defaultTabStop : 48;
  return { position: (Math.floor(x / grid) + 1) * grid, stop: null };
}

/**
 * Shared empty arrays for token creation. Used to ensure reference equality
 * when comparing tokens with identical empty ancestor stacks across layouts.
 */
const emptyAncestors: readonly string[] = [];
const emptyAncestorStyles: readonly ComputedStyle[] = [];

/**
 * True for the white-space modes that PRESERVE leading/interior/trailing
 * whitespace verbatim (`pre`, `pre-wrap`, `break-spaces`).
 * `normal`/`nowrap` collapse all whitespace; `pre-line` collapses INTERIOR
 * whitespace like `normal` and only preserves `\n` (via LINE_BREAK) — so
 * neither is "preserving" for the purpose of rendering orphan/leading spaces.
 *
 * Used by the IFC wrap-unit grouper to decide whether leading/orphan space
 * tokens become a rendered space-run wrap unit (preserving modes) or are
 * dropped (collapsing modes).
 */
export function preservesWhitespace(ws: WhiteSpace): boolean {
  // `break-spaces` preserves leading/interior/trailing whitespace like
  // `pre`/`pre-wrap` (nothing collapses). It differs only in the IFC grouper
  // (one wrap unit per space token) — not in collapse behavior.
  return ws === "pre" || ws === "pre-wrap" || ws === "break-spaces";
}

interface Token {
  /** Stable identifier for this token. Format: "{sourceKey}:{offset}" for text tokens
   * (where offset is the character index within the source text node where the token starts);
   * "{sourceKey}:lb" for text `\n` LINE_BREAK tokens; "{sourceKey}" for atomic
   * inline-block tokens AND embed-derived isLineBreak tokens (hard-break, where the
   * key is the hard-break embed ElementBox key). */
  id: string;
  /** Key of the source TextBox (render node) — used for layout key tracing. */
  sourceKey: string;
  text: string;
  /**
   * Number of SOURCE (state-model) characters this token spans. Differs from
   * `text.length` when the tokenizer collapsed whitespace: a token absorbs the
   * source gap up to the next token's `matchStart` (and, for the last token of
   * a node, the trailing source up to the node's end), so collapsed-away
   * whitespace is attributed to the preceding token. This keeps every cursor
   * offset after a collapsed run aligned with its state offset. For text
   * without collapse `sourceLength === text.length`. Inline-block tokens (an
   * embed = 1 state unit) and a lone `LINE_BREAK` token carry `1`.
   */
  sourceLength: number;
  /**
   * Absolute UTF-16 offset of this token's first code unit into the assembled
   * paragraph source (`IfcSourceAssembly.source`) — i.e. `childBase + matchStart`
   * for text tokens, the OBJECT REPLACEMENT char's offset for an inline-block,
   * and the `\n`'s offset for a LINE_BREAK. Mirrors the parallel
   * `asm.tokenBases[]` at construction time; the bidi reorder (P4-C) reads it
   * off the token directly so boxes built from a token can be ordered by source
   * position without re-walking the tree. When a token is split at wrap time
   * (`trySoftSplit` / `tryHyphenSplit`) the prefix keeps the original base and
   * the suffix's base advances by the prefix's DISPLAY length (the same quantity
   * used to slice the prefix `text`); a synthetic run (e.g. the hyphen glyph)
   * with no backing source takes the split point's base (it owns 0 source).
   */
  absoluteSourceBase: number;
  width: number;
  style: ComputedStyle;
  isSpace: boolean;
  isLineBreak: boolean;
  /** The hyperlink URL of the source TextBox, threaded for export consumers (PDF /Link). Opaque to layout geometry. */
  link?: string;
  /** ElementBox keys of all inline ancestors, root-most first. */
  inlineAncestors: readonly string[];
  /** Computed styles of all inline ancestors (parallel to inlineAncestors). */
  inlineAncestorStyles: readonly ComputedStyle[];
  /** When set, this token represents an inline-block atomic unit. */
  inlineBlock?: {
    key: string;
    blockSize: number;
    children: readonly LayoutBox[];
    /** Cross-reference target id (render `metadata.targetId`), threaded to
     *  `InlineBlockBox.targetId` for the PDF /GoTo exporter. `undefined` for a
     *  non-cross-ref inline-block. */
    targetId?: string;
    /** Replaced inline-block (render `metadata.replacedInline`), threaded to
     *  `InlineBlockBox.isReplaced` so `applyVerticalAlign` uses the bottom-edge
     *  baseline (CSS2 §10.8.1). `undefined` for a text-bearing inline-block. */
    isReplaced?: boolean;
  };
  /**
   * Set on the inline-block token of a `"tab"` embed (tab stops S2). Recognizes
   * the tab as a tab unit so later slices can compute its destination-stop
   * advance (S3) + leader paint (S9). A recognized tab is still a zero-advance
   * inline-block in S2 — no advance logic rides this flag yet.
   */
  isTab?: boolean;
  /**
   * Destination-stop leader for a recognized tab token (tab stops S3). The tab's
   * advance is position-dependent, so its destination stop — and therefore its
   * leader — is resolved only at the wrap-loop overflow-check seam, where the
   * frozen unit's token carries the resolved leader. Read by the box-emit
   * (`buildLineChildrenForAncestorLevel`) to stamp `InlineBlockBox.inlineMeta`.
   * Absent until the tab is resolved (the S2 zero-advance sentinel has none →
   * the box-emit defaults to `"none"`).
   */
  tabLeader?: LeaderStyle;
  /**
   * Hyphen break opportunities within this token's text (cluster indices
   * relative to this token's text). Only present for text tokens from a
   * shaped run that contains "hyphen" kind break opportunities.
   */
  hyphenBreaks?: readonly number[];
  /**
   * UAX #14 SOFT break opportunities INTERIOR to this token's display text
   * (offsets relative to `text`, in (0, text.length)). The wrap loop may
   * split the token here (via `trySoftSplit`) — e.g. between CJK ideographs.
   * Mirrors `hyphenBreaks` but carries no hyphen glyph. Bounded to the DISPLAY
   * span, never the collapsed-whitespace zone.
   */
  softBreaks?: readonly number[];
  /**
   * Whether the wrap loop may break the line BEFORE this token. Derived from
   * UAX #14 over the IFC source text (gated by white-space). Default-absent is
   * treated as `true` (break allowed). `false` = e.g. an NBSP-joined neighbour
   * that must stay on the same line even if it overflows.
   */
  breakableBefore?: boolean;
  /**
   * Width of each character (cluster) in this token's text, in order.
   * Used to compute the width of a prefix when splitting at a hyphen break.
   */
  clusterWidths?: readonly number[];
  /**
   * Present only when a `text-transform` (other than `none`) changed this
   * token's DISPLAY length relative to its SOURCE length (a "grow" mapping,
   * e.g. `ß`→`SS` under `uppercase`). `sourceDisplayLengths[i]` is the number
   * of DISPLAY UTF-16 code units produced by SOURCE code unit `i` (so its
   * length equals the token's SOURCE length, i.e. `text` before transform).
   * For a 1:1 transform (every source unit → one display unit) it is omitted
   * (the leaf concat treats absence as all-1s). Whitespace tokens never carry
   * this — case mapping never alters whitespace, so token boundaries are
   * identical in source and display.
   */
  sourceDisplayLengths?: readonly number[];
}

/**
 * A wrap unit is a non-space token optionally followed by a space token
 * from the same source. This is the atomic unit for line wrapping and
 * produces text run boxes where a word and its trailing space are merged.
 * LINE_BREAK tokens produce a unit with isLineBreak: true.
 */
interface WrapUnit {
  tokens: Token[];
  totalWidth: number;
  sourceKey: string;
  isLineBreak: boolean;
  /** Ancestor stack from the first token in this unit (all tokens share the same stack). */
  inlineAncestors: readonly string[];
  /** Ancestor styles from the first token in this unit (parallel to inlineAncestors). */
  inlineAncestorStyles: readonly ComputedStyle[];
  /**
   * Index of the first token (in the flat tokens array) that this unit represents.
   * Used to compute per-line token ranges for incremental-wrap cache metadata.
   */
  tokenStartIdx: number;
  /**
   * Index of the last token (in the flat tokens array) that this unit represents.
   * Usually tokenStartIdx or tokenStartIdx+1 (for a word + trailing space unit).
   */
  tokenEndIdx: number;
  /**
   * Set when this unit's (single) token is a recognized `"tab"` inline-block
   * (tab stops S2). A tab inline-block is always its own one-token wrap unit.
   */
  isTab?: boolean;
}

/**
 * Describes a hyphen break chosen for the end of a line.
 * When set, `buildLineWithFragments` appends a synthetic hyphen TextRunBox
 * after the last normal token.
 */
interface HyphenBreak {
  style: ComputedStyle;
  inlineAncestors: readonly string[];
  inlineAncestorStyles: readonly ComputedStyle[];
  sourceKey: string;
  /**
   * The hyperlink URL of the split word's source token (#521 PDF /Link),
   * threaded so the synthetic hyphen run inherits its parent word's link.
   * Opaque to geometry; `undefined` when the word carries no link.
   */
  link?: string;
}

/**
 * Width of the run of TRAILING whitespace at the end of a line's accumulated
 * units, in laid-out pixels. Used to exclude trailing spaces from the visible
 * content width for alignment (a centered line centers its glyphs, not its
 * trailing spaces; a right-aligned line places its last GLYPH at the edge; a
 * justified line distributes the gap measured from the trailing-excluded edge).
 *
 * The trailing whitespace can span MULTIPLE units, so we sum the trailing RUN
 * of space units — walking from the END, accumulating each unit's trailing
 * `isSpace` token widths, and continuing to the previous unit only while the
 * current unit was ENTIRELY trailing spaces (no non-space token reached). This
 * covers every white-space mode:
 *   - `normal`/`pre-wrap`: the trailing space(s) are SLURPED into the final
 *     word's unit (`[word, space*]`) → we sum that one unit's trailing spaces
 *     then stop at the word token.
 *   - `break-spaces` (#314, the editor default): each preserved space is its
 *     OWN single-glyph unit, so a line ending in N trailing spaces has N
 *     standalone space units → we sum all N then stop at the preceding word
 *     unit (#339 — before this, only the last unit's space was excluded).
 *   - a line-break / zero-width sentinel unit carries a non-space token, which
 *     stops the walk (it contributes nothing).
 * An empty-tokens unit (degenerate — shouldn't occur) also stops the walk.
 * Allocation-free.
 */
function trailingSpaceWidthOf(units: readonly WrapUnit[]): number {
  let w = 0;
  for (let u = units.length - 1; u >= 0; u--) {
    const unit = units[u];
    if (unit === undefined) throw new Error(`ifc: trailingSpaceWidthOf unit ${u} missing (unreachable)`);
    let sawNonSpace = false;
    for (let i = unit.tokens.length - 1; i >= 0; i--) {
      const tok = unit.tokens[i];
      if (tok === undefined) throw new Error(`ifc: trailingSpaceWidthOf token ${i} missing (unreachable)`);
      if (tok.isSpace) {
        w += tok.width;
      } else {
        sawNonSpace = true;
        break;
      }
    }
    if (sawNonSpace || unit.tokens.length === 0) break;
  }
  return w;
}

/**
 * CSS Text 3 §8.1: the trailing tracking (`letter-spacing`) of the LAST
 * typographic unit on a line is removed — a line's content box does not include
 * hanging tracking, and the end-of-line caret sits at the trimmed edge.
 *
 * This returns the letter-spacing (px) baked into the last RETAINED typographic
 * unit's advance — i.e. the last non-space token, skipping any trailing run of
 * space units exactly as `trailingSpaceWidthOf` does. The skip is load-bearing:
 * a hung/clamped trailing space (and its own letter+word spacing) is already
 * removed by the trailing-space path, so the trim targets the last visible
 * GLYPH unit underneath it (NOT the space — that would double-subtract). When
 * the line ends in a letter, that letter's trailing tracking is removed; when
 * it ends in a space, the space leaves with its spacing and the preceding
 * word's trailing tracking is removed instead.
 *
 * Returns 0 when there is no visible (non-space) unit on the line, or when the
 * last unit's effective `letterSpacing` is `normal` (the default — the
 * normal-identity contract).
 *
 * Reads the SAME per-token `style` source `trailingSpaceWidthOf` uses to detect
 * spaces (`token.isSpace`) and the run's resolved letter-spacing
 * (`token.style.letterSpacing`, already flattened by the cascade).
 * Allocation-free.
 */
function trailingLetterSpacingOf(units: readonly WrapUnit[]): number {
  for (let u = units.length - 1; u >= 0; u--) {
    const unit = units[u];
    if (unit === undefined) throw new Error(`ifc: trailingLetterSpacingOf unit ${u} missing (unreachable)`);
    for (let i = unit.tokens.length - 1; i >= 0; i--) {
      const tok = unit.tokens[i];
      if (tok === undefined) throw new Error(`ifc: trailingLetterSpacingOf token ${i} missing (unreachable)`);
      if (!tok.isSpace) {
        return resolveSpacingPx(tok.style.letterSpacing);
      }
    }
    // `unit` was entirely spaces (or empty) — continue to the previous unit,
    // mirroring `trailingSpaceWidthOf`'s "skip the trailing run of space units"
    // walk. An empty-tokens unit (degenerate) stops the walk.
    if (unit.tokens.length === 0) break;
  }
  return 0;
}

/**
 * CSS Text 3 §8.1 caret-edge trim, applied to a single line-end leaf. Returns
 * `box` rebuilt with its trailing glyph's letter-spacing trimmed off (inlineSize
 * reduced by `trim`), or `undefined` when `box` is NOT a trimmable glyph leaf
 * (trailing whitespace-only text-run, or an atomic inline-block/marker) — the
 * caller skips an `undefined` result and tries the preceding leaf.
 *
 * The last typographic unit can be a top-level `text-run` OR a `text-run` nested
 * inside one or more `display:inline` InlineBoxes (e.g. `<em>word</em>` at the
 * line end). For the nested case the trailing tracking lives on the innermost
 * text-run leaf, and BOTH that leaf and every enclosing InlineBox must shrink by
 * `trim` so the line-end caret/selection (which sums leaf inline extents while
 * recursing into InlineBoxes) lands at the trimmed content edge.
 *
 * Every box in a line is built with `containingInlineSize = lineInlineSize` at
 * EVERY nesting level (top-level runs, nested InlineBoxes, and their children
 * alike), so the caller passes `lineInlineSize` as `containingInlineSize` and
 * this helper forwards it unchanged through the recursion. The rebuild only
 * shrinks `inlineSize`; offsets are untouched (the later `alignmentOffset` shift
 * composes fine), and a text-run's `sourceDisplayLengths` is geometry-
 * independent so it copies through verbatim.
 *
 * Note (documented limitation): an inline element with trailing padding/border
 * is not modeled here — a simple `inlineSize - trim` would over-trim the box by
 * the padding. Inline padding/border isn't laid out in the IFC yet, so this
 * cannot arise today; revisit when inline box decoration lands.
 */
function trimTrailingLetterSpacing(
  box: LayoutBox,
  trim: number,
  containingInlineSize: number,
): LayoutBox | undefined {
  if (box.type === "text-run") {
    // Whitespace-only leaf: its tracking left with the space — skip it so the
    // caller (or the enclosing inline) targets the preceding glyph leaf.
    if (box.text.trim() === "") return undefined;
    return createTextRunBox(
      box.key,
      box.inlineOffset, box.blockOffset, box.inlineSize - trim, box.blockSize,
      box.writingMode, box.direction,
      box.computedStyle, box.usedStyle,
      box.text,
      box.offsetLength,
      containingInlineSize,
      box.sourceDisplayLengths,
      // `clusterWidths`/`sourceStart` are geometry-independent of the trim (they
      // carry NATURAL per-unit advances + the source offset), so they copy
      // through verbatim — same rationale as `sourceDisplayLengths`. Forwarding
      // them keeps the trimmed line-end leaf splittable by the bidi reorder.
      box.clusterWidths,
      box.sourceStart,
      box.bidiLevel,
      /* containingBlockSize */ undefined,
      box.link,
    );
  }
  if (box.type === "inline") {
    // Find the last trimmable descendant (skip trailing whitespace-only leaves),
    // recurse to rebuild it, then shrink THIS InlineBox by the same `trim`.
    let idx = box.children.length - 1;
    let trimmedChild: LayoutBox | undefined;
    while (idx >= 0) {
      const child = box.children[idx];
      if (child === undefined) throw new Error(`ifc: trimTrailingLetterSpacing child ${idx} missing (unreachable)`);
      trimmedChild = trimTrailingLetterSpacing(child, trim, containingInlineSize);
      if (trimmedChild !== undefined) break;
      idx--;
    }
    if (trimmedChild === undefined) return undefined; // all-whitespace inline
    const newChildren = [
      ...box.children.slice(0, idx),
      trimmedChild,
      ...box.children.slice(idx + 1),
    ];
    return createInlineBox(
      box.key,
      box.inlineOffset, box.blockOffset, box.inlineSize - trim, box.blockSize,
      box.writingMode, box.direction,
      box.computedStyle, box.usedStyle,
      newChildren,
      box.fragmentEdge,
      box.ancestorKey,
      containingInlineSize,
    );
  }
  // inline-block / marker / etc: atomic, not letter-spacing-trimmable.
  return undefined;
}

/**
 * True iff every token in the unit is a space (and it has at least one token).
 *
 * Under preserving white-space modes that emit standalone space units
 * (`break-spaces` tokenizes each preserved space as its own 1-glyph unit;
 * `pre`/`pre-wrap` emit a space-run unit), a trailing or interior space at a
 * soft-wrap boundary is its OWN wrap unit. Under COLLAPSING `normal` the
 * trailing space is SLURPED into the preceding word's unit (so the unit is
 * `[word, space*]` — NOT all-spaces), so this predicate is false there and the
 * hang gate never fires — words wrap exactly as before.
 *
 * The greedy wrap loop uses this to HANG a space (#338): a space unit never
 * triggers its own soft wrap (it stays on the current line even when it
 * overflows, matching Google Docs' trailing-space-at-wrap behavior). A
 * line-break unit carries non-space sentinel tokens, so it is never a space
 * unit.
 */
function isSpaceUnit(unit: WrapUnit): boolean {
  return unit.tokens.length > 0 && unit.tokens.every(t => t.isSpace);
}

/**
 * Build a single-token WrapUnit cloned from `from`, carrying just `token`.
 * Used by `justifyUnits` to split a word+trailing-space unit into separate
 * word and space units (so the SPACE becomes its own positioned TextRunBox
 * whose width can be widened independently — caret/hit-test then read the
 * widened geometry via `box.x`). Ancestors / sourceKey / token-range metadata
 * are inherited from the source unit; `totalWidth` tracks `token.width`.
 */
function singleTokenUnit(from: WrapUnit, token: Token, tokenIdx: number): WrapUnit {
  return {
    tokens: [token],
    totalWidth: token.width,
    sourceKey: from.sourceKey,
    isLineBreak: false,
    inlineAncestors: from.inlineAncestors,
    inlineAncestorStyles: from.inlineAncestorStyles,
    tokenStartIdx: tokenIdx,
    tokenEndIdx: tokenIdx,
  };
}

/**
 * The ONE source-offset derivation for a wrap-time token split (M1
 * consolidation). When a text token is split at DISPLAY code-unit index
 * `prefixDisplayLen`, the suffix's absolute source base advances by exactly
 * that many code units past the prefix's base (the same quantity used to slice
 * the prefix `text`). Both `trySoftSplit` and `tryHyphenSplit` route through
 * this rather than re-parsing the token `id` string, so there is a single
 * offset-derivation path.
 *
 * Note this DOES change the suffix token's source value vs the old code: the
 * old `id`-parse recovered a NODE-RELATIVE offset (`matchStart + prefixDisplayLen`,
 * since `id` is `${key}:${matchStart}`), whereas this returns the ABSOLUTE base
 * (`childBase + matchStart + prefixDisplayLen`) — the correct value for the bidi
 * consumer. Safe because a split suffix's `id`/base is consumed by nothing
 * identity- or cache-bearing: split tokens live only in the transient
 * `unit.tokens` of the wrap loop and never enter the cached pre-wrap
 * `IFCState.tokens` array that `tokensEqual`/`findChangePoint` compare; box keys
 * derive from `runKey`, not the token id.
 */
export function splitSuffixSourceBase(prefixBase: number, prefixDisplayLen: number): number {
  return prefixBase + prefixDisplayLen;
}

/**
 * P3 — JUSTIFY a line's units (CSS Text 3 §7.3): widen the INTERIOR inter-word
 * spaces so the last non-trailing glyph's right edge reaches `lineInlineSize`,
 * WITHOUT shifting the line (its inline-start stays at the float-start).
 *
 * Algorithm:
 *   1. FLATTEN: split every unit into per-token units so each space token
 *      becomes its own unit. (A normal word unit is `[word, space*]`; the word
 *      stays a unit, each trailing space becomes its own space unit. Pure-space
 *      units — break-spaces, leading runs — split into one unit per space.)
 *      This makes each space individually positionable/widenable. Cloning
 *      (never mutating) the shared `units` is load-bearing: the wrap-cache
 *      reuses the original units across re-layouts.
 *   2. CLASSIFY interior spaces: a space unit is INTERIOR iff it lies strictly
 *      between the first and last NON-space (word/inline-block) units on the
 *      line — i.e. it has content on both sides. Leading and trailing space
 *      runs are excluded (trailing spaces hang; leading spaces are not stretched).
 *   3. DISTRIBUTE `gap = max(0, lineInlineSize − contentWidth)` equally across
 *      the N interior spaces (exact remainder via `computeJustifyExpansions`),
 *      widening each interior space token's `width` (clone) and its unit's
 *      `totalWidth`. The child-builder's `cursorInlineOffset` running-sum then
 *      shifts every subsequent run by the widened amount automatically.
 *
 * Returns the ORIGINAL `units` unchanged (same reference) when justify does not
 * apply (no interior space, or `gap <= 0`) so the non-justify path stays
 * byte-identical.
 *
 * @param units          the line's accumulated wrap units (not mutated).
 * @param lineInlineSize the available inline width of the line.
 * @param contentWidth   visible content width (trailing whitespace excluded) —
 *                       the SAME value P2 uses for alignment.
 */
function justifyUnits(
  units: readonly WrapUnit[],
  lineInlineSize: number,
  contentWidth: number,
): readonly WrapUnit[] {
  // Tab stops S8: Google Docs does NOT stretch a line that contains a tab. The
  // tab advances already position content to the stops; widening the inter-word
  // spaces would displace that content from its stops. Return the line units
  // UNCHANGED whenever any unit on the line is a tab. (Placed before any gap
  // computation so a tabbed line is byte-identical to its non-justified layout.)
  if (units.some((u) => u.isTab === true)) return units;

  const gap = lineInlineSize - contentWidth;
  if (gap <= 0 || units.length === 0) return units;

  // 1. Flatten to per-token units (words stay whole; spaces become singletons).
  const flat: WrapUnit[] = [];
  for (const unit of units) {
    // A unit's tokens are `[word?, space*]` (word units) or `[space]`/`[space*]`
    // (pure-space units). Emit the leading non-space token (if any) as a word
    // unit, then each space token as its own unit. Inline-block / line-break
    // units carry a single non-space token and pass through unchanged.
    let spawnedSpace = false;
    for (let k = 0; k < unit.tokens.length; k++) {
      const tok = unit.tokens[k];
      if (tok === undefined) throw new Error(`ifc: justify flatten token ${k} missing (unreachable)`);
      if (tok.isSpace) {
        flat.push(singleTokenUnit(unit, tok, unit.tokenStartIdx + k));
        spawnedSpace = true;
      } else if (k === 0 && unit.tokens.length === 1) {
        // Sole non-space token — pass the original unit through untouched.
        flat.push(unit);
      } else {
        // Leading word token of a `[word, space*]` unit: emit a word-only unit.
        flat.push(singleTokenUnit(unit, tok, unit.tokenStartIdx + k));
      }
    }
    // Defensive: a unit with zero tokens shouldn't exist, but keep it stable.
    if (unit.tokens.length === 0 && !spawnedSpace) flat.push(unit);
  }

  // 2. Find the first/last non-space units; interior spaces lie strictly between.
  let firstWordIdx = -1;
  let lastWordIdx = -1;
  for (let i = 0; i < flat.length; i++) {
    const fu = flat[i];
    if (fu === undefined) throw new Error(`ifc: justify flat unit ${i} missing (unreachable)`);
    if (!isSpaceUnit(fu)) {
      if (firstWordIdx < 0) firstWordIdx = i;
      lastWordIdx = i;
    }
  }
  if (firstWordIdx < 0) return units; // no content (all spaces) — nothing to justify.

  const interiorIdxs: number[] = [];
  for (let i = firstWordIdx + 1; i < lastWordIdx; i++) {
    const fu = flat[i];
    if (fu === undefined) throw new Error(`ifc: justify flat unit ${i} missing (unreachable)`);
    if (isSpaceUnit(fu)) interiorIdxs.push(i);
  }
  if (interiorIdxs.length === 0) return units; // single token / no interior space.

  // 3. Distribute the gap; widen each interior space token (clone, never mutate).
  const expansions = computeJustifyExpansions(gap, interiorIdxs.length);
  for (let e = 0; e < interiorIdxs.length; e++) {
    const idx = interiorIdxs[e];
    const add = expansions[e];
    if (idx === undefined || add === undefined) {
      throw new Error(`ifc: justify expansion ${e} missing (unreachable)`);
    }
    if (add === 0) continue;
    const su = flat[idx];
    if (su === undefined) throw new Error(`ifc: justify flat unit ${idx} missing (unreachable)`);
    const widened = su.tokens.map(t => ({ ...t, width: t.width + add }));
    flat[idx] = {
      ...su,
      tokens: widened,
      totalWidth: su.totalWidth + add,
    };
  }
  return flat;
}

/**
 * U+FFFC OBJECT REPLACEMENT CHARACTER — appended to `ifcSourceText` for each
 * non-text inline atomic (inline-block). UAX #14 classes it CB (Contingent
 * Break, LB20): a break is allowed BOTH before and after, giving the correct
 * "breakable around an inline object" semantics. (AL would WRONGLY suppress
 * breaks via LB28; that is why CB — not AL — is used here.)
 */
const OBJECT_REPLACEMENT = "￼";

/**
 * Accumulator threaded through `collectInlineTokens` so the IFC can derive
 * UAX #14 line-break opportunities (S2.4). It records:
 *  - `source`: the IFC's full SOURCE text, in child/visual order (each text
 *    child's verbatim `fullText`; one OBJECT REPLACEMENT char per inline atomic).
 *    This is the ONLY representation that is both source-faithful (NBSP/WJ seen,
 *    not the collapsed token-display text) and cross-run-correct (adjacent runs
 *    are ordinary adjacent code points, so cross-run pair rules — e.g.
 *    `well<b>known</b>` — resolve for free).
 *  - `runs`: one entry per source child, mapping an absolute offset back to the
 *    owning run's `whiteSpace` (for per-run soft-break gating).
 *  - `tokenBases`: parallel to `out`; tokenBases[i] is `out[i]`'s absolute base
 *    offset into `source`. Recorded at every push so the post-pass annotation can
 *    map each token's source span without re-walking the tree.
 *
 * The annotation runs as a POST-PASS (`annotateLineBreaks`) over the flat `out`
 * stream — the recursion only appends source + bases; classification + gating +
 * per-token annotation happen once, after the whole IFC is collected.
 */
interface IfcSourceAssembly {
  source: string;
  readonly runs: { start: number; end: number; whiteSpace: WhiteSpace }[];
  readonly tokenBases: number[];
}

function newIfcSourceAssembly(): IfcSourceAssembly {
  return { source: "", runs: [], tokenBases: [] };
}

/**
 * Recursively collect tokens from inline content, accumulating the ancestor
 * stack as we descend into display:inline element children.
 */
function collectInlineTokens(
  children: readonly RenderNode[],
  ancestors: readonly string[],
  ancestorStyles: readonly ComputedStyle[],
  shaper: TextShaper,
  // Auto-hyphenation: threaded ALONGSIDE `shaper` to the tokenization site. The
  // auto producer arm below READS it under `cs.hyphens === "auto"` + `cs.language`
  // to insert candidate hyphen break-points into the token's `hyphenBreaks`.
  // `undefined` ⇒ no auto hyphenation (falls back to manual).
  hyphenator: Hyphenator | undefined,
  // The PARENT IFC's writing-mode + direction (the mode the IFC lays everything
  // out in). Threaded together because both are needed to project an
  // inline-block child's PHYSICAL box onto the parent's inline/block axes (see
  // the inline-block sizing site below). `direction` is also consumed by text
  // shaping; `writingMode` is consumed only by the inline-block projection.
  writingMode: WritingMode,
  direction: Direction,
  out: Token[],
  asm: IfcSourceAssembly,
  intrinsicCache: IntrinsicSizesCache,
  // L-D (A6): parent layout context for inline-block sub-layout. When
  // present, inline-block descendants use makeChildContext so they
  // inherit the parent's prevLayoutCache / ifcStateCache — enabling
  // incremental reuse for unchanged inline-blocks. When absent (the
  // exported collectTokens test path and rewrap-incremental path), the
  // inline-block sub-layout falls back to makeRootContext (no
  // incremental reuse — matches pre-L-D behavior for those callers).
  parentCtx: LayoutContext | null,
): void {
  // Flatten `display: contents` elements: such an element generates no box, so
  // its children participate in this IFC as if direct children. Unlike the
  // `inline` branch below, a contents element adds NO entry to
  // `ancestors`/`ancestorStyles` (it produces no inline box); its children
  // already inherited through it via the cascade, and they tokenize at the same
  // ancestor level as the contents element's siblings. (Same-ref fast path when
  // no contents element is present — zero hot-path cost.)
  for (const child of flattenContents(children)) {
    if (!child.computedStyle) throw new Error("cascade required");
    const cs = child.computedStyle;

    if (child.type === "text") {
      // Shape the entire text node once; then sum cluster advances per token.
      const fullText = child.text;
      const shapedRun = fullText.length > 0 ? shaper.shape(fullText, cs, direction) : null;

      // S2.4: record this run's SOURCE span + white-space mode for UAX #14
      // line-break derivation. `childBase` is this run's absolute start offset
      // into `asm.source`; a token's absolute base = `childBase + matchStart`.
      const childBase = asm.source.length;
      asm.source += fullText;
      asm.runs.push({ start: childBase, end: childBase + fullText.length, whiteSpace: cs.whiteSpace });

      /**
       * Return the total inline advance for the substring [start, end) of the
       * shaped run. Clusters that start within the range are included.
       */
      function widthOfRange(start: number, end: number): number {
        if (!shapedRun) return 0;
        let w = 0;
        for (const c of shapedRun.clusters) {
          if (c.start >= start && c.start < end) w += c.inlineAdvance;
        }
        return w;
      }

      // Tokenize by white-space rules, then map each token string back to an
      // offset range in fullText so we can look up its cluster width.
      const parts = tokenize(fullText, cs.whiteSpace);
      // Collect this node's tokens with their source `matchStart` first; then
      // a second pass assigns `sourceLength` per the look-ahead rule (each
      // token spans up to the next token's matchStart; the last token spans to
      // `fullText.length`). This attributes any collapsed-away whitespace to
      // the PRECEDING token so cursor offsets after a collapse stay aligned
      // with state offsets. The two-pass shape is required because a token's
      // `sourceLength` depends on its successor's position.
      const nodeTokens: { token: Token; matchStart: number }[] = [];
      let cursor = 0;
      for (const part of parts) {
        if (part === LINE_BREAK) {
          // LINE_BREAK is a sentinel string — advance past any \n at cursor.
          // The token's source position is the `\n` it replaced; the
          // look-ahead rule then gives it sourceLength 1 (one source `\n`).
          const lbStart = cursor;
          if (cursor < fullText.length && fullText[cursor] === "\n") cursor++;
          nodeTokens.push({
            matchStart: lbStart,
            token: {
              id: `${child.key}:lb`,
              sourceKey: child.key,
              text: LINE_BREAK,
              // Patched in the second pass; provisional value here.
              sourceLength: 1,
              // Absolute base of the `\n` this LINE_BREAK replaces.
              absoluteSourceBase: childBase + lbStart,
              width: 0,
              style: cs,
              isSpace: false,
              isLineBreak: true,
              inlineAncestors: ancestors,
              inlineAncestorStyles: ancestorStyles,
            },
          });
          continue;
        }

        // Find part in fullText starting at cursor. Under collapsing
        // white-space ("normal"/"nowrap") a run of N source whitespace chars
        // collapses to a single one-char " " token; `indexOf` finds the FIRST
        // of those chars, so `matchStart` is the true source position of the
        // token's first glyph. The collapsed-away chars are reclaimed in the
        // second pass via the look-ahead `sourceLength`. (Under "pre"/
        // "pre-wrap" nothing collapses, so matchStart/sourceLength == text.)
        //
        // `indexOf` CAN return -1: under "normal"/"nowrap"/"pre-line" the
        // tokenizer emits a SYNTHETIC literal " " token for inter-word gaps
        // and trailing whitespace, but the source separator may be a TAB,
        // NBSP, or other `/\s+/` char rather than a literal space — so the
        // synthetic " " is not a verbatim substring at `cursor`. (A run of
        // ordinary spaces still collapses to a " " that DOES exist at the
        // gap's first char, so the double-space case never reaches here.)
        // Fall back to `cursor` as a best-effort source position: offsets
        // become approximate for the unusual separator but stay finite (the
        // second-pass sourceLength is next.matchStart − this.matchStart, never
        // NaN), and the editor does not crash. Surface a dev-mode warning so
        // the drift is visible without being fatal in production.
        // For synthetic " " (space) tokens — leading/interior/trailing whitespace
        // emitted by the tokenizer — `cursor` is positioned at a whitespace char
        // in the source. Use cursor directly: `indexOf(" ", cursor)` would skip
        // forward to the first LITERAL space, leaving non-space leading whitespace
        // (TAB at offset 0, NBSP, etc.) unowned (#365). For non-space tokens use
        // indexOf as before; if it returns -1 (rare; some other synthetic
        // separator), fall back to cursor with a dev-mode warning so the drift
        // is visible without being fatal.
        let matchStart: number;
        const cursorChar = cursor < fullText.length ? fullText[cursor] : undefined;
        if (part === " " && cursorChar !== undefined && /\s/.test(cursorChar)) {
          matchStart = cursor;
        } else {
          matchStart = fullText.indexOf(part, cursor);
          if (matchStart === -1) {
            const g = globalThis as {
              process?: { env?: { NODE_ENV?: string } };
              console?: { warn(...args: unknown[]): void };
            };
            if (g.process?.env?.NODE_ENV !== "production" && g.console !== undefined) {
              g.console.warn(
                `[layout/ifc] collectTokens: indexOf(${JSON.stringify(part)}, ${cursor}) failed in fullText="${fullText.slice(0, 64)}..."; ` +
                  `falling back to cursor — source offsets may be approximate.`,
              );
            }
            matchStart = cursor;
          }
        }
        const matchEnd = matchStart + part.length;

        const width = widthOfRange(matchStart, matchEnd);

        // Collect per-cluster widths and hyphen break opportunities within this token's range.
        let clusterWidths: number[] | undefined;
        let hyphenBreaks: number[] | undefined;
        const isWhitespaceToken = /^\s+$/.test(part);
        if (shapedRun && !isWhitespaceToken) {
          clusterWidths = [];
          // A grapheme cluster spans multiple code units; clusters.find matches only at
          // the grapheme's FIRST code unit (full advance there); interior code units find
          // no cluster -> 0. Prefix-sums (tryHyphenSplit) over code-unit indices therefore
          // still total each grapheme's full advance.
          for (let ci = 0; ci < part.length; ci++) {
            // Find the cluster in shapedRun that corresponds to matchStart + ci.
            const clusterStart = matchStart + ci;
            const cluster = shapedRun.clusters.find(c => c.start === clusterStart);
            clusterWidths.push(cluster ? cluster.inlineAdvance : 0);
          }

          // Hyphen breaks: filter shapedRun's "hyphen" kind breaks that fall within this token's range,
          // and convert clusterIndex (absolute in fullText) to token-relative index.
          const tokenHyphenBreaks = shapedRun.breakOpportunities.filter(
            b => b.kind === "hyphen" && b.clusterIndex > matchStart && b.clusterIndex <= matchEnd,
          ).map(b => b.clusterIndex - matchStart);

          // HYPH.S3 — manual producer. A U+00AD SOFT HYPHEN is an author-supplied
          // hyphenation opportunity. The engine's mock/canvas shapers classify it
          // (UAX #14 class BA) as a `kind:"soft"` break, NOT `kind:"hyphen"`, so
          // under `manual`/`auto` we SYNTHESIZE the hyphen-break opportunity from
          // the source U+00AD positions. The suffix begins at the char AFTER the
          // soft hyphen, so a U+00AD at token-relative index `ci` yields a
          // `hyphenBreaks` entry `ci + 1` — `tryHyphenSplit`'s prefix is
          // `text.slice(0, ci+1)`, keeping the (zero-advance) soft hyphen on the
          // prefix where it renders as the line-end "-" glyph. A TRAILING soft
          // hyphen (`ci + 1 === part.length`) has no suffix to break to → skipped.
          // `none` synthesizes nothing (the word stays unbreakable there; the soft
          // break is suppressed in annotateLineBreaks). Merge + dedup with any
          // shaper-reported `kind:"hyphen"` breaks. (Cleared for text-transform
          // grow tokens below, like the shaper-reported breaks.)
          const synthesizedHyphenBreaks: number[] = [];
          if (cs.hyphens !== "none") {
            for (let ci = 0; ci + 1 < part.length; ci++) {
              if (part.charCodeAt(ci) === 0x00ad) synthesizedHyphenBreaks.push(ci + 1);
            }
          }
          // HYPH.S4 — auto producer. Under `hyphens: auto` with a resolved content
          // language and an injected hyphenator, ask it for algorithmic in-word break
          // points (suffix-start indices over the DISPLAY word `part`) and keep only those
          // passing `hyphenate-limit-chars` (minWord/minBefore/minAfter). Merged with the
          // soft-hyphen + shaper breaks below; cleared for text-transform grow/shrink
          // tokens by the SAME guard as soft-hyphen breaks (source-relative indices). When
          // no hyphenator / no language, this contributes nothing → `auto` falls back to
          // `manual` (the correct CSS UA fallback).
          const autoHyphenBreaks: number[] = [];
          if (cs.hyphens === "auto" && cs.language !== "" && hyphenator !== undefined) {
            const [minWord, minBefore, minAfter] = cs.hyphenateLimitChars;
            if (part.length >= minWord) {
              for (const p of hyphenator.hyphenate(part, cs.language)) {
                if (p >= minBefore && part.length - p >= minAfter) autoHyphenBreaks.push(p);
              }
            }
          }
          const extraHyphenBreaks = synthesizedHyphenBreaks.length > 0 || autoHyphenBreaks.length > 0;
          const allHyphenBreaks = extraHyphenBreaks
            ? [...new Set([...tokenHyphenBreaks, ...synthesizedHyphenBreaks, ...autoHyphenBreaks])].sort((a, b) => a - b)
            : tokenHyphenBreaks;
          if (allHyphenBreaks.length > 0) hyphenBreaks = allHyphenBreaks;
        }

        // text-transform (CSS Text 3 §2.1): render the case-mapped DISPLAY text
        // while keeping `sourceLength` = the SOURCE span. Applied PER-TOKEN (each
        // whitespace-delimited token in isolation) — case mapping never alters
        // whitespace/`\n`, so source and display token boundaries are identical
        // and we avoid any run-level source→display offset translation. Skipped
        // for whitespace tokens and when `textTransform === "none"` (the default,
        // so existing layout is byte-for-byte unchanged).
        let tokenText = part;
        let tokenWidth = width;
        let tokenSourceDisplayLengths: readonly number[] | undefined;
        if (cs.textTransform !== "none" && !isWhitespaceToken) {
          const { display, sourceDisplayLengths } = transformRun(part, cs.textTransform);
          // Re-shape the DISPLAY text: case mapping can change glyph count/width
          // (e.g. `ß`→`SS`) and the painter shapes the same display string, so
          // measurement must shape it too (keeps caret/glyph geometry aligned).
          const dShaped = shaper.shape(display, cs, direction);
          tokenText = display;
          tokenWidth = dShaped.clusters.reduce((sum, c) => sum + c.inlineAdvance, 0);
          // Per-DISPLAY-char advances (one entry per display code unit) — mirror
          // the SOURCE clusterWidths loop above, now over the display clusters.
          const displayClusterWidths: number[] = [];
          // Same first-unit-full / interior-0 grapheme attribution as the SOURCE
          // loop above: clusters.find matches only at each grapheme's first code
          // unit, so a multi-code-unit display grapheme's interior units push 0.
          for (let ci = 0; ci < display.length; ci++) {
            const cluster = dShaped.clusters.find(c => c.start === ci);
            displayClusterWidths.push(cluster ? cluster.inlineAdvance : 0);
          }
          // For a 1:1 transform (display.length === part.length) clusterWidths is
          // indexed at DISPLAY positions, which equal source positions — so
          // hyphenBreaks (source-relative, kept for 1:1) stay valid indices into
          // clusterWidths in tryHyphenSplit. Grow/shrink tokens CLEAR hyphenBreaks
          // (below), so the source==display assumption that tryHyphenSplit relies
          // on is never violated.
          clusterWidths = displayClusterWidths;
          if (display.length !== part.length) {
            // GROW (or shrink) mapping: record the source→display length map so
            // later cursor tasks can translate state↔display offsets. Its
            // `hyphenBreaks` indices are SOURCE-relative and become invalid once
            // the display length differs (a grow char shifts later positions),
            // so clear them — a transformed-and-grown word simply won't
            // auto-hyphenate (correct + safe). 1:1 transforms keep hyphenBreaks
            // and omit the map (absence === all-1s in the leaf concat).
            tokenSourceDisplayLengths = sourceDisplayLengths;
            hyphenBreaks = undefined;
          }
        }

        nodeTokens.push({
          matchStart,
          token: {
            id: `${child.key}:${matchStart}`,
            sourceKey: child.key,
            text: tokenText,
            // Patched in the second pass below.
            sourceLength: part.length,
            // Absolute base into asm.source (mirrors asm.tokenBases push below).
            absoluteSourceBase: childBase + matchStart,
            width: tokenWidth,
            style: cs,
            isSpace: isWhitespaceToken,
            isLineBreak: false,
            inlineAncestors: ancestors,
            inlineAncestorStyles: ancestorStyles,
            ...(child.link !== undefined ? { link: child.link } : {}),
            ...(clusterWidths ? { clusterWidths } : {}),
            ...(hyphenBreaks ? { hyphenBreaks } : {}),
            ...(tokenSourceDisplayLengths ? { sourceDisplayLengths: tokenSourceDisplayLengths } : {}),
          },
        });

        cursor = matchEnd;
      }

      // Second pass: assign each token's `sourceLength` as the source span up
      // to the NEXT token's matchStart (last token → end of node). This makes
      // a token own its rendered chars PLUS any collapsed-away whitespace that
      // immediately follows it, so the next token's base offset equals the
      // state offset of its first rendered glyph.
      for (let ti = 0; ti < nodeTokens.length; ti++) {
        const nt = nodeTokens[ti];
        if (nt === undefined) throw new Error(`ifc: nodeTokens[${ti}] missing (unreachable)`);
        const start = nt.matchStart;
        const next = ti + 1 < nodeTokens.length ? nodeTokens[ti + 1] : undefined;
        const nextStart = next !== undefined ? next.matchStart : fullText.length;
        nt.token.sourceLength = nextStart - start;
        out.push(nt.token);
        // S2.4: this token's absolute base into `asm.source` (kept parallel to `out`).
        asm.tokenBases.push(childBase + start);
      }
    } else if (child.type === "element" && cs.display === "inline") {
      const newAncestors = [...ancestors, child.key];
      const newStyles = [...ancestorStyles, cs];
      collectInlineTokens(child.children, newAncestors, newStyles, shaper, hyphenator, writingMode, direction, out, asm, intrinsicCache, parentCtx);
    } else if (child.type === "element" && cs.display === "inline-block") {
      // S2.4: an inline atomic occupies one OBJECT REPLACEMENT char (class CB)
      // in the source string — breakable around (LB20), the correct
      // wrap-around-an-inline-object semantics.
      const ibBase = asm.source.length;
      asm.source += OBJECT_REPLACEMENT;
      asm.runs.push({ start: ibBase, end: ibBase + OBJECT_REPLACEMENT.length, whiteSpace: cs.whiteSpace });
      // A `<br>` / hard-break embed is a FORCED line break (CSS `<br>`; Google
      // Docs Shift+Enter). render-core emits it as a zero-width, child-less
      // inline-block atom; the IFC recognizes it via `metadata.embedType`
      // (the same hook the `tab` embed uses below) and emits a forced-break
      // unit — structurally identical to the `\n` LINE_BREAK token: width 0,
      // sourceLength 1 (one cursor unit), no `inlineBlock` payload. The wrap
      // loop already flushes the line on `isLineBreak` units. Emitted AFTER the
      // OBJECT REPLACEMENT char is appended to `asm.source` (so UAX #14
      // break-opportunity accounting on adjacent text is unaffected) but BEFORE
      // `layoutBlock` (the zero-child embed's BFC layout is wasted work).
      if (child.metadata?.embedType === HARD_BREAK_EMBED_TYPE) {
        out.push({
          id: child.key,
          sourceKey: child.key,
          text: "",
          sourceLength: 1,
          absoluteSourceBase: ibBase,
          width: 0,
          style: cs,
          isSpace: false,
          isLineBreak: true,
          inlineAncestors: ancestors,
          inlineAncestorStyles: ancestorStyles,
        });
        asm.tokenBases.push(ibBase);
        continue; // skip the inline-block layoutBlock + atomic-token push
      }
      // Resolve inlineSize using intrinsic sizes for auto (shrink-to-fit, CSS Sizing 3 §10.3.5).
      // cs.inlineSize: ComputedLengthOrAuto | IntrinsicSizingKeyword =
      //   number | { unit: "percent"; value } | "auto" | "min-content" | "max-content" | "fit-content".
      let inlineSizePx: number;
      if (typeof cs.inlineSize === "number") {
        inlineSizePx = cs.inlineSize;
      } else if (typeof cs.inlineSize === "object") {
        // percent (the only ComputedLength object shape — see length.ts): a
        // DEFINITE size resolved against the containing block's inline size
        // (the IFC content area = available), mirroring used-style.ts's
        // (value/100)*containingInlineSize. NOT shrink-to-fit: it is not
        // clamped to max-content nor floored at min-content. The external
        // collectTokens / rewrap path passes parentCtx === null (no
        // containing-width context) → fall back to max-content.
        inlineSizePx = parentCtx !== null
          ? (cs.inlineSize.value / 100) * parentCtx.containingInlineSize
          : computeIntrinsicSizes(child, shaper, intrinsicCache).maxContent;
      } else {
        // Now genuinely exhaustive: "auto" | "min-content" | "max-content" | "fit-content".
        // Compute intrinsic sizes once, then resolve per CSS Sizing 3:
        //   max-content → max-content unconditionally;
        //   min-content → min-content unconditionally;
        //   fit-content / auto → shrink-to-fit clamp (§10.3.5).
        const intrinsic = computeIntrinsicSizes(child, shaper, intrinsicCache);
        if (cs.inlineSize === "min-content") {
          inlineSizePx = intrinsic.minContent;
        } else if (cs.inlineSize === "max-content") {
          inlineSizePx = intrinsic.maxContent;
        } else {
          // "auto" | "fit-content": shrink-to-fit = min(maxContent, max(minContent, available)) — §10.3.5.
          // (fit-content == shrink-to-fit; auto in an IFC resolves the same way.) `available` is the
          // containing block's available inline size (the IFC content area = parentCtx.containingInlineSize).
          // The external collectTokens / rewrap path passes parentCtx === null (no available-width
          // context) → fall back to max-content (unchanged).
          inlineSizePx = parentCtx !== null
            ? Math.min(intrinsic.maxContent, Math.max(intrinsic.minContent, parentCtx.containingInlineSize))
            : intrinsic.maxContent;
        }
      }

      // Lay out at resolved inlineSize. When a parent context is in scope
      // (the production layoutInlineContent path), use makeChildContext so
      // the inline-block sub-layout inherits the parent's prevLayoutCache
      // and ifcStateCache — unchanged inline-blocks can then be reused
      // incrementally rather than re-laid out every keystroke (L-D / A6).
      // External callers (collectTokens / rewrap-incremental) pass null
      // and get the pre-L-D fresh-root behavior.
      const ibResolvedInlineSize = inlineSizePx > 0 ? inlineSizePx : 100;
      const ibCtx = parentCtx !== null
        ? makeChildContext(parentCtx, cs, ibResolvedInlineSize, "indefinite")
        : makeRootContext(cs, ibResolvedInlineSize);
      const bfcResult = layoutBlock(child, 0, 0, ibCtx, shaper, hyphenator);
      if (bfcResult.box === null) {
        throw new Error("layoutBlock without fragmentation returned null box; should be unreachable (no FragmentationContext passed)");
      }
      const bfc = bfcResult.box;
      // `bfc` is the inline-block laid out in ITS OWN writing mode, so
      // `bfc.width`/`bfc.height` are PHYSICAL extents. The parent IFC consumes
      // `finalInlineSize` as the token's advance along the PARENT's inline axis
      // and `finalBlockSize` as its extent along the PARENT's block axis. Project
      // the child's physical box onto the parent's axes via the parent IFC's
      // axisMap — NOT a blanket rename to bfc.inlineSize/blockSize (that would
      // break the cross-mode case, e.g. an h-tb parent with a vertical
      // inline-block child where bfc.width IS the correct parent inline advance).
      // For an h-tb parent (inline=x, block=y) this reduces to bfc.width/bfc.height.
      const parentAxisMap = axisMapFor(writingMode, direction);
      const childInlineFromPhysical = parentAxisMap.inline === "x" ? bfc.width : bfc.height;
      const childBlockFromPhysical = parentAxisMap.block === "x" ? bfc.width : bfc.height;
      const finalInlineSize = inlineSizePx > 0 ? inlineSizePx : childInlineFromPhysical;
      let finalBlockSize: number;
      if (typeof cs.blockSize === "number") {
        finalBlockSize = cs.blockSize;
      } else {
        finalBlockSize = childBlockFromPhysical;
      }

      out.push({
        id: child.key,
        sourceKey: child.key,
        text: "",
        // An inline-block is a state-model embed item = exactly 1 cursor unit.
        sourceLength: 1,
        // Absolute base = the OBJECT REPLACEMENT char's offset (mirrors the
        // asm.tokenBases.push(ibBase) below).
        absoluteSourceBase: ibBase,
        width: finalInlineSize,
        style: cs,
        isSpace: false,
        isLineBreak: false,
        inlineAncestors: ancestors,
        inlineAncestorStyles: ancestorStyles,
        inlineBlock: {
          key: child.key,
          blockSize: finalBlockSize,
          children: bfc.type === "block" ? Array.from(bfc.children) : [],
          targetId: typeof child.metadata?.targetId === "string" ? child.metadata.targetId : undefined,
          isReplaced: child.metadata?.replacedInline === true ? true : undefined,
        },
        // Tab stops S2: recognize a `"tab"` embed's inline-block as a tab unit.
        // The render layer emits the tab via its generic embed fallback as an
        // inline-block ElementBox carrying `metadata.embedType === "tab"`.
        isTab: child.metadata?.embedType === "tab",
      });
      // S2.4: the inline atomic's base is the OBJECT REPLACEMENT char's offset.
      asm.tokenBases.push(ibBase);
    }
    // Other display values (block, etc.) are ignored at this level.
  }
}

/**
 * POST-PASS: derive UAX #14 line-break opportunities over the IFC's assembled
 * SOURCE text and annotate each collected token with `softBreaks` (interior
 * soft positions) + `breakableBefore` (whether the wrap loop may break before
 * it). The wrap loop consumes these via `trySoftSplit` + the `breakableBefore`
 * gate (so CJK wraps between ideographs and NBSP/`GL` glue holds).
 *
 * `cjBreakable: true` hardcoded = CSS `line-break: normal/auto` (the editor
 * default — CJK ideographs break between each other regardless, and CJ small-
 * kana become breakable). There is no `line-break` computed-style property yet;
 * when one is added it threads through to this call site. NOTE for P7
 * (hyphenation): `hyphens: auto` + the document `language` will thread through
 * this same path — so when the `line-break` property is modeled, pass a
 * `ComputedStyle`-derived `LineBreakOptions` here rather than a literal, to
 * avoid two separate threading passes.
 */
function annotateLineBreaks(out: Token[], asm: IfcSourceAssembly): void {
  if (asm.source.length === 0) return;
  const pts = lineBreakOpportunities(asm.source, { cjBreakable: true });
  const softAt = new Set<number>();
  const mandatoryAt = new Set<number>();
  for (const p of pts) {
    if (p.mandatory) mandatoryAt.add(p.index);
    else softAt.add(p.index);
  }

  // Map an absolute offset to the white-space mode of the run that OWNS it (the
  // run whose [start, end) span contains it). Returns undefined if no run covers
  // the offset (only at/after the very end — never for an interior offset).
  const runWhiteSpaceAt = (offset: number): WhiteSpace | undefined => {
    for (const r of asm.runs) {
      if (offset >= r.start && offset < r.end) return r.whiteSpace;
    }
    return undefined;
  };
  // HYPH.S2/S3 — the glyph-less UAX #14 soft break a U+00AD SOFT HYPHEN suggests
  // is ALWAYS removed, regardless of `hyphens`. U+00AD is class BA, so
  // `lineBreakOpportunities` emits a soft break at the offset immediately AFTER
  // it; that plain (no-glyph) break is never the correct rendering of a soft
  // hyphen: under `hyphens: none` (CSS Text 4 §6.1) the word stays unbroken
  // there, and under `manual`/`auto` the break is realized as a glyph-bearing
  // HYPHEN break instead (the producer at the token-collection site adds a
  // `hyphenBreaks` entry, drawn by `tryHyphenSplit` + the synthetic "-" glyph).
  // So the soft break is suppressed unconditionally here; what differs by
  // `hyphens` value (break vs no break) is decided by whether a `hyphenBreaks`
  // entry exists, which the producer keys off the owning token's `cs.hyphens`.
  // Gating at the opportunity source (rather than scrubbing already-written token
  // `softBreaks`) also covers the rare case where the post-soft-hyphen offset
  // lands on a token boundary (`breakableBefore`), not an interior `softBreaks`
  // index. Real-space breaks elsewhere are unaffected — they are not preceded by
  // a soft hyphen.
  const suppressedSoftHyphenBreakAt = (k: number): boolean =>
    asm.source.charCodeAt(k - 1) === 0x00ad;
  // A white-space mode permits soft wrapping iff it is NOT `nowrap`/`pre`
  // (CSS Text 3 §3 — those two disallow soft-wrap opportunities; `normal`,
  // `pre-wrap`, `pre-line`, `break-spaces` keep them).
  const wsWraps = (ws: WhiteSpace | undefined): boolean => ws !== "nowrap" && ws !== "pre";

  // A SOFT break at absolute offset `k` ("the line may end after k-1") is active
  // after white-space gating:
  //   INTERIOR (k-1 and k in the same run): gate by that run's white-space.
  //   RUN-BOUNDARY (k-1 in run A, k in run B): active if EITHER run permits
  //     wrapping (CSS Text 3 §3 — a boundary BETWEEN inline elements is not
  //     interior to either, so a `nowrap` span governs only its own interior).
  const softActiveAt = (k: number): boolean => {
    if (!softAt.has(k)) return false;
    if (suppressedSoftHyphenBreakAt(k)) return false;
    const wsBefore = runWhiteSpaceAt(k - 1);
    const wsAfter = runWhiteSpaceAt(k);
    if (wsBefore !== undefined && wsAfter !== undefined && wsBefore === wsAfter) {
      // Same white-space on both sides — interior to one run, OR a boundary
      // between two identically-styled runs. Either way one verdict governs.
      return wsWraps(wsBefore);
    }
    // Run-boundary (or an offset at the string edge): active if either side wraps.
    return wsWraps(wsBefore) || wsWraps(wsAfter);
  };
  // Mandatory breaks are never white-space-gated (forced regardless).
  const breakableAt = (k: number): boolean => mandatoryAt.has(k) || softActiveAt(k);

  for (let i = 0; i < out.length; i++) {
    const token = out[i];
    const base = asm.tokenBases[i];
    if (token === undefined || base === undefined) {
      throw new Error(`ifc: token/base ${i} missing (unreachable; out/tokenBases parallel)`);
    }

    // LINE_BREAK tokens are mandatory-flushed by the wrap loop on their own
    // sentinel; they carry no soft-break annotation (the source `\n` is already
    // a mandatory break the tokenizer handles).
    if (token.isLineBreak) continue;

    if (token.isSpace) {
      // Whitespace tokens carry NO interior softBreaks. Their `breakableBefore`
      // reflects the inter-token boundary at the END of the (possibly collapsed)
      // gap they own — i.e. whether the line may break to separate them from the
      // following content. For a regular space this boundary IS a UAX #14
      // opportunity (true → omitted); for an NBSP-origin space it is NOT
      // (false → recorded). LB7 forbids a break BEFORE a space, so keying at
      // `base` would mislabel even regular spaces as non-breakable — the
      // meaningful boundary is `base + sourceLength` (== the next token's base).
      const gapEnd = base + token.sourceLength;
      // Only record `false` for an INTERIOR boundary (gapEnd < source.length):
      // a trailing-whitespace token whose gap runs to the IFC end has no
      // following content to join, so `false` would be meaningless.
      if (gapEnd < asm.source.length && !breakableAt(gapEnd)) token.breakableBefore = false;
      continue;
    }

    // breakableBefore: whether the wrap loop may break BEFORE this token, i.e.
    // whether a gated soft (or mandatory) opportunity exists at its base offset.
    // Recorded only when FALSE (default-absent === true) to keep the common case
    // byte-identical and the rewrap cache key default-equal. SKIP `base === 0`:
    // that is start-of-IFC-text (LB2 — never a break opportunity), but there is
    // no preceding content to join, so the first token stays default-true. A
    // recorded `false` means "an interior boundary that UAX #14 forbids breaking
    // at" (NBSP join, cross-run no-break) — the bit the Task-6 wrap gate reads.
    if (base > 0 && !breakableAt(base)) token.breakableBefore = false;

    // softBreaks: gated soft offsets STRICTLY inside the token's DISPLAY span
    // (base, base + text.length) — NOT the source span. A soft offset in the
    // collapsed-whitespace zone (>= base + text.length) has no glyph to split at
    // and is carried by the NEXT token's breakableBefore, never a split here.
    //
    // GROW-CASE (text-transform): when `sourceDisplayLengths` is set the token's
    // DISPLAY length differs from its SOURCE span, so a SOURCE offset does not
    // map 1:1 to a DISPLAY offset — OMIT softBreaks entirely (mirrors how the
    // collection code CLEARS hyphenBreaks for grow-case tokens). `breakableBefore`
    // (a boundary-at-base bit, not an interior offset) is unaffected.
    if (token.sourceDisplayLengths === undefined && !token.inlineBlock) {
      const displayEnd = base + token.text.length;
      let softBreaks: number[] | undefined;
      for (let k = base + 1; k < displayEnd; k++) {
        if (softActiveAt(k) || mandatoryAt.has(k)) {
          (softBreaks ??= []).push(k - base);
        }
      }
      if (softBreaks !== undefined && softBreaks.length > 0) token.softBreaks = softBreaks;
    }
  }
}

/**
 * Public re-export of the Token type so that tests and future incremental-wrap
 * code can reference it without going through private internals.
 */
export type { Token };

/**
 * Collect all tokens from `parent`'s inline children. Exposed for testing and
 * for incremental-wrap logic (Plan 3.G Task 3).
 */
export function collectTokens(
  parent: ElementBox,
  shaper: TextShaper,
  direction: Direction,
  intrinsicCache: IntrinsicSizesCache,
  // Auto-hyphenation: OPTIONAL trailing so the dozens of existing 4-arg
  // test/rewrap callers stay valid; forwarded into `collectInlineTokens`, where
  // the auto producer arm reads it. `undefined` ⇒ no auto hyphenation.
  hyphenator?: Hyphenator,
): Token[] {
  if (!parent.computedStyle) throw new Error("cascade required");
  const tokens: Token[] = [];
  const asm = newIfcSourceAssembly();
  // The IFC's writing mode is the parent block's own (writing-mode inherits;
  // ctx.writingMode === parent.computedStyle.writingMode on the production
  // layoutInlineContent path). Used by the inline-block sizing projection.
  const writingMode = parent.computedStyle.writingMode;
  // External path (rewrap-incremental + tests): no parent context
  // available. Inline-block sub-layout falls back to makeRootContext —
  // the production path uses makeChildContext (see layoutInlineContent).
  collectInlineTokens(parent.children, emptyAncestors, emptyAncestorStyles, shaper, hyphenator, writingMode, direction, tokens, asm, intrinsicCache, null);
  annotateLineBreaks(tokens, asm);
  return tokens;
}

/**
 * Lay out inline content (text — Plan 1 only handles text children)
 * into LineBoxes within the parent block's content area.
 */
export function layoutInlineContent(
  parent: ElementBox,
  inlineOffset: number,
  blockOffset: number,
  ctx: LayoutContext,
  shaper: TextShaper,
  // Auto-hyphenation: threaded ALONGSIDE `shaper`, forwarded into
  // `collectInlineTokens` where the auto producer arm reads it. `undefined` ⇒
  // no auto hyphenation.
  hyphenator: Hyphenator | undefined,
  // Coherent float+pagination: cumulative document-flow offset of this
  // paragraph's FIRST line — a fixed property of where the paragraph began,
  // stamped onto every IFCBreakToken so it survives across page fragments. A
  // later task queries floats at the line's TRUE cumulative offset; CARRIED ONLY
  // here (the float query is unchanged), so geometry is identical.
  paraFlowStart: number,
  fragmentation?: FragmentationContext,
): LayoutResult<BlockBox> {
  const tLayout = markStart("ifc.layout");
  try {
  if (!parent.computedStyle) throw new Error("cascade required");
  const parentCs = parent.computedStyle;
  const availableInlineSize = ctx.containingInlineSize;
  const writingMode = ctx.writingMode;
  const direction = ctx.direction;
  // P2 (#312): the block's resolved text alignment. Each flushed line (and the
  // empty-paragraph strut) shifts its LOGICAL inline start by a logical delta
  // from `computeAlignmentOffset`; `logicalToPhysical` (in the box factory)
  // resolves the physical edge. Because the line's children are positioned
  // relative to the line, shifting the line's inline start shifts the whole
  // line — so paint / caret / hit-test / selection geometry, all of which
  // consume the laid-out `box.x`, follow for free. JUSTIFY falls back to start
  // in P2. (RTL end/center line-box geometry is deferred — see ifc-align.ts and
  // ifc-align.test.ts; start under RTL is a no-op logical shift, no regression.)
  const textAlign = parentCs.textAlign;

  // Derive a legacy measurer for height-only calls (line height, marker text, etc.)
  const measurer = adaptShaperToMeasurer(shaper);

  const ws = parentCs.whiteSpace;
  // Plan 3.G Task 7: textWrap value pass-through. Only "wrap" / "nowrap" affect
  // behavior; "balance" / "pretty" / "stable" are reserved for future work
  // (Knuth-Plass-style optimal wrap; not yet implemented). They are treated as
  // "wrap" by default.
  // `break-spaces` is a wrapping mode: the formula `ws !== "nowrap" && ws !== "pre"`
  // already returns true for it (no allowlist needed). The per-token grouping
  // below (gated on `isBreakSpaces`) is what makes preserved spaces wrap
  // independently to the next line.
  const canWrap = ws !== "nowrap" && ws !== "pre";

  const floatEnv = ctx.floatEnv;

  // P5 (#391): CSS Text §8 `text-indent` — the block's first-line indent,
  // resolved to a used length (px) against the containing inline size. It is
  // LOGICAL (inline-start), so it composes additively with the float
  // `inlineStartSize` and is RTL/vertical-WM-correct via the existing logical
  // axis — no physical left/right handling. Negative values (hanging indent)
  // are permitted and NOT clamped. Applied to the block's FIRST line only.
  // Resolve ONLY the indent length (mirrors `used-style.ts`'s textIndent
  // resolution) rather than allocating a full UsedStyle here — this runs on the
  // hot cache-hit path before the wrap-cache short-circuit, so a per-call
  // ~50-field UsedStyle allocation would be a per-keystroke regression.
  const blockTextIndent = resolveUsedLength(parentCs.textIndent, availableInlineSize, 0);

  /**
   * Returns the effective line inlineOffset and inlineSize at a given
   * lineBlockOffset, accounting for floats. On the block's FIRST line
   * (`firstLine`), `text-indent` shifts the inline-start cursor and reduces the
   * available width by the same amount (so wrapping accounts for the indent).
   */
  function effectiveLineDims(lineBlockOffset: number, firstLine: boolean): { lineInlineCursor: number; lineInlineSize: number } {
    // Coherent float+pagination: query the float env at the line's TRUE
    // cumulative document-flow offset. `paraFlowStart` is the paragraph's
    // first-line cumulative offset (carried across fragments); `(lineBlockOffset
    // - blockOffset)` is the line's wrap offset RELATIVE to the paragraph's first
    // line. Their sum is the line's absolute cumulative position, the same frame
    // the BFC places floats in, so the narrowing applies on the page the float sits.
    const active = floatEnv.availableInlineSizeAt(paraFlowStart + (lineBlockOffset - blockOffset), availableInlineSize);
    const indent = firstLine ? blockTextIndent : 0;
    return {
      lineInlineCursor: inlineOffset + active.inlineStartSize + indent,
      lineInlineSize: availableInlineSize - active.inlineStartSize - active.inlineEndSize - indent,
    };
  }

  // Collect tokens from all inline children recursively
  const tokens: Token[] = [];
  const asm = newIfcSourceAssembly();
  collectInlineTokens(parent.children, emptyAncestors, emptyAncestorStyles, shaper, hyphenator, writingMode, direction, tokens, asm, ctx.intrinsicCache, ctx);
  // Derive UAX #14 softBreaks/breakableBefore over the assembled IFC source;
  // the wrap loop consults them via trySoftSplit + the breakableBefore gate.
  annotateLineBreaks(tokens, asm);

  // P4-C: resolve UAX #9 bidi embedding levels ONCE for the whole paragraph
  // (a run's level depends on surrounding runs, so it must run over the full
  // assembled source, not per-line). Each line later derives its U16 source
  // span and queries these levels in `reorderLineForBidi` (via the cheap fast
  // path that no-ops on pure-LTR lines). `direction` ("ltr"|"rtl") is a subset
  // of `BaseDirection`, so it threads through directly. Empty paragraphs (no
  // source) skip resolution — `null` makes the reorder no-op.
  const paragraphBidi: ParagraphBidi | null =
    asm.source.length === 0 ? null : resolveParagraphBidi(asm.source, direction);

  // Incremental-wrap cache: if tokens are identical and the available inline size hasn't
  // changed since the last layout, reuse the cached lines (no re-wrap needed).
  // Bypass the cache when fragmentation is active: the cached box was produced
  // without fragmentation and contains all lines. We must re-run the fit-check
  // to produce the correct partial box and breakToken for this fragment.
  // P-tabs: a cached entry that contains a tab cannot feed the cheap
  // incremental-wrap fast path — a tab's advance depends on its position
  // within the line, which the token-equality short-circuit doesn't capture.
  // Treat `hasTab` entries as a cache miss (`hasTab` is set at cache-save time
  // from `tokens.some((t) => t.isTab === true)`).
  const cachedState = fragmentation === undefined ? ctx.ifcStateCache.get(parent.key) : undefined;
  const prevState = cachedState !== undefined && !cachedState.hasTab ? cachedState : undefined;
  // P2 (#312) / #333: the cached lines bake in their alignment offset — each
  // top-level child's `inlineOffset` carries the alignment delta (the line
  // itself spans the full width at the natural inline-start). A change to ONLY
  // `textAlign` or `direction` — tokens + availableInlineSize unchanged — must
  // re-lay the lines, not return the stale (differently-aligned) ones. Gate the
  // hit on alignment too. P5 (#391): the FIRST line also bakes in `text-indent`
  // (its inline-start cursor + width), so gate on it as well — an indent-only
  // change must re-lay, not reuse stale first-line geometry.
  if (
    prevState !== undefined &&
    prevState.availableInlineSize === availableInlineSize &&
    prevState.textAlign === textAlign &&
    prevState.direction === direction &&
    prevState.textIndent === blockTextIndent &&
    prevState.defaultTabStop === parentCs.defaultTabStop &&
    tabStopsEqual(prevState.tabStops, parentCs.tabStops)
  ) {
    if (findChangePoint(prevState.tokens, tokens) === -1) {
      const tHit = markStart("ifc.cache.hit");
      try {
        const cachedLines = Array.from(prevState.lines);
        const cachedBlockSize = cachedLines.reduce((acc, l) => Math.max(acc, l.blockOffset + l.blockSize - blockOffset), 0);
        const cachedUsedStyle = computeUsedStyle(parentCs, availableInlineSize, "indefinite");
        return { box: createBlockBox(parent.key, inlineOffset, blockOffset, availableInlineSize, cachedBlockSize, writingMode, direction, parentCs, cachedUsedStyle, cachedLines, availableInlineSize), breakToken: null, inFlowConsumed: cachedBlockSize };
      } finally {
        markEnd("ifc.cache.hit", tHit);
      }
    }
  }
  const tMiss = markStart("ifc.cache.miss");
  markEnd("ifc.cache.miss", tMiss);

  // Per-line token-range metadata for incremental re-wrap (Plan 3.G Task 4+).
  // Keyed by the LineBox object (via WeakMap) so it doesn't prevent GC.
  const lineMeta = new WeakMap<LineBox, { startTokenIdx: number; endTokenIdx: number }>();

  // Group tokens into wrap units: non-space + optional trailing space (same source)
  // LINE_BREAK tokens become standalone units with isLineBreak: true.
  const units: WrapUnit[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === undefined) throw new Error(`ifc: wrap-grouper token ${i} missing (unreachable)`);
    // `break-spaces` mode → one wrap unit per token (each word + each space its
    // own unit). Derived per-token from `tok.style.whiteSpace` (the same source
    // the leading/orphan space branch reads), so an inline element carrying its
    // own white-space value is honored consistently across both grouper paths.
    const isBreakSpaces = tok.style.whiteSpace === "break-spaces";
    if (tok.isLineBreak) {
      units.push({
        tokens: [tok],
        totalWidth: 0,
        sourceKey: tok.sourceKey,
        isLineBreak: true,
        inlineAncestors: tok.inlineAncestors,
        inlineAncestorStyles: tok.inlineAncestorStyles,
        tokenStartIdx: i,
        tokenEndIdx: i,
      });
      i++;
      continue;
    }
    if (tok.isSpace) {
      // Leading/orphan space token (no preceding non-space unit slurped it).
      // Under a COLLAPSING white-space (`normal`/`nowrap`/`pre-line`) such a
      // space collapses away at line/segment start, so we skip it — its
      // `sourceLength` was already absorbed by the preceding token's
      // look-ahead span (see `collectInlineTokens`). Under a PRESERVING
      // white-space (`pre`/`pre-wrap`/`break-spaces`) the space must RENDER
      // and OWN its state offset, so emit the run of consecutive
      // leading/orphan space tokens of the same `sourceKey` (which implies the
      // same inline-ancestor stack, since the tokenizer emits one source
      // text-node per inline-ancestor boundary — so equal `sourceKey` ⇒ equal
      // ancestors) as a standalone space-run WrapUnit. This matches the
      // non-space unit grouper, which also slurps on `sourceKey` alone.
      // Adding it to `units[]` here (rather than via any
      // path that bypasses `pushUnit`) is load-bearing: the greedy wrap loop's
      // `pushUnit` advances `cursorOffset` by the unit's
      // `unitOffsetContribution`, so the line's `inlineOffsetStart..End` covers
      // the leading spaces (closing #308 for preserving modes).
      if (preservesWhitespace(tok.style.whiteSpace)) {
        // Under `break-spaces` every preserved space is its OWN wrap unit so a
        // run of spaces can wrap independently across lines (CSS Text 3: a
        // soft-wrap opportunity after every preserved space, incl. at line
        // end). Emitting a single-glyph unit here (instead of slurping the run)
        // is load-bearing: the greedy loop wraps an overflowing space to the
        // next line, and a 1-glyph space unit can never force-place past the
        // page edge — so the caret stays on-page (#314). For `pre`/`pre-wrap`
        // keep the run bundling.
        if (isBreakSpaces) {
          units.push({
            tokens: [tok],
            totalWidth: tok.width,
            sourceKey: tok.sourceKey,
            isLineBreak: false,
            inlineAncestors: tok.inlineAncestors,
            inlineAncestorStyles: tok.inlineAncestorStyles,
            tokenStartIdx: i,
            tokenEndIdx: i,
          });
          i++;
          continue;
        }
        const spaceRun: Token[] = [tok];
        let w = tok.width;
        const runStartIdx = i;
        let j = i + 1;
        while (j < tokens.length) {
          const next = tokens[j];
          if (next === undefined) throw new Error(`ifc: space-run token ${j} missing (unreachable)`);
          if (!next.isSpace || next.sourceKey !== tok.sourceKey) break;
          spaceRun.push(next);
          w += next.width;
          j++;
        }
        i = j;
        units.push({
          tokens: spaceRun,
          totalWidth: w,
          sourceKey: tok.sourceKey,
          isLineBreak: false,
          inlineAncestors: tok.inlineAncestors,
          inlineAncestorStyles: tok.inlineAncestorStyles,
          tokenStartIdx: runStartIdx,
          tokenEndIdx: i - 1,
        });
        continue;
      }
      // Collapsing mode — emit a ZERO-WIDTH unit so `pushUnit` advances
      // `cursorOffset` by the token's `sourceLength` (closing #308 for
      // collapsing modes). Symmetric with the preserving-mode emit above,
      // but we CLONE the token with `width: 0` so:
      //   - `pushUnit` advances the line's `currentWidth` by 0 (the
      //     leading/orphan space is visually collapsed away).
      //   - The downstream text-run leaf builder (which recomputes
      //     `unitWidth = sum(t.width)`) emits a TextRunBox at `width: 0`,
      //     `inlineOffset` at the current cursor position, so subsequent
      //     leaves stack at the same x. Caret-position then falls within the
      //     leaf's [absoluteX, absoluteX + 0] range and clamps to
      //     absoluteX = 0 via the existing leaf-right-edge clamp (#338 P2).
      //   - The token's `sourceLength` (1 source char per leading whitespace,
      //     assigned by the lookahead pass in `collectInlineTokens`) flows
      //     into `offsetLength = sum(t.sourceLength)`, so the leaf owns the
      //     state offset and `line.inlineOffsetEnd` covers all source chars.
      //
      // Without this, source offsets in [0, matchStart-of-first-word) are
      // owned by no unit; `cursorOffset` doesn't advance for them, and the
      // caret accumulator (cursor-position.ts) sees a line that ends BEFORE
      // those offsets — caret at offsets 0..N-1 of "   hello" falls past
      // `line.inlineOffsetEnd` and clamps (#308). Same gap applies to an
      // all-whitespace paragraph like "   " (today emits a strut line with
      // inlineOffsetEnd=0; with the fix the line owns all 3 source chars).
      const zeroWidthTok: Token = { ...tok, width: 0 };
      units.push({
        tokens: [zeroWidthTok],
        totalWidth: 0,
        sourceKey: tok.sourceKey,
        isLineBreak: false,
        inlineAncestors: tok.inlineAncestors,
        inlineAncestorStyles: tok.inlineAncestorStyles,
        tokenStartIdx: i,
        tokenEndIdx: i,
      });
      i++;
      continue;
    }
    // Non-space: collect it + all trailing space tokens from the same
    // source. Slurping ALL trailing spaces (not just one) keeps every
    // typed trailing-whitespace character inside this unit — otherwise
    // the extras drop into the "orphan leading space" skip on the next
    // iteration, losing their offset contribution and stranding the
    // cursor at the position past only the first trailing space (the
    // user-perceived "cursor stuck after typing a second space" bug).
    //
    // EXCEPT under `break-spaces`: the word emits ALONE (no trailing-space
    // slurp) so each following space becomes its own wrap unit via the
    // leading/orphan branch above. This is what lets an overflowing space
    // wrap to the next line while the word stays intact on the current line
    // (#314 — never split the word early, never push a glyph past the edge).
    // The spaces' offset contribution is preserved because that branch emits
    // them (closing the trailing-space offset gap for break-spaces).
    const unit: Token[] = [tok];
    let w = tok.width;
    const unitStartIdx = i;
    let j = i + 1;
    if (!isBreakSpaces) {
      while (j < tokens.length) {
        const next = tokens[j];
        if (next === undefined) throw new Error(`ifc: trailing-space token ${j} missing (unreachable)`);
        if (!next.isSpace || next.sourceKey !== tok.sourceKey) break;
        unit.push(next);
        w += next.width;
        j++;
      }
    }
    i = j;
    units.push({
      tokens: unit,
      totalWidth: w,
      sourceKey: tok.sourceKey,
      isLineBreak: false,
      inlineAncestors: tok.inlineAncestors,
      inlineAncestorStyles: tok.inlineAncestorStyles,
      tokenStartIdx: unitStartIdx,
      tokenEndIdx: i - 1,
      // Tab stops S2: a recognized tab inline-block is its own single-token
      // unit (an inline-block never slurps trailing spaces — it has none).
      isTab: tok.isTab === true,
    });
  }

  // Greedy line wrap over units
  const lines: LayoutBox[] = [];
  let lineBlockOffset = blockOffset;
  let currentUnits: WrapUnit[] = [];
  let currentWidth = 0;
  let lineIndex = 0;
  let pendingHyphen: HyphenBreak | null = null;
  // Track the first and last token index for the units accumulated on the current line.
  let currentLineStartTokenIdx = -1;
  let currentLineEndTokenIdx = -1;
  // E-E.1: state-model offset accumulator for stamping
  // `inlineOffsetStart` / `inlineOffsetEnd` on each emitted LineBox.
  // Advances per unit consumed via `pushUnit`. Each token contributes its
  // `sourceLength` — the count of STATE-model characters it owns: 1 for an
  // inline-block embed, 1 for a lone LINE_BREAK, and the rendered chars PLUS
  // any collapsed-away trailing whitespace for text/space tokens (UTF-16 code
  // units). Summing sourceLength keeps offsets state-aligned across a
  // collapsed run.
  let cursorOffset = 0;
  let currentLineStartOffset = -1;
  // Tracks whether the most-recently-consumed unit was a forced line break
  // (`\n` LINE_BREAK or a hard-break embed) with no content unit after it.
  // A forced break that TERMINATES the inline content must still leave an
  // empty trailing line (CSS `<br>`/Google-Docs Shift+Enter: a trailing
  // forced break opens a new, empty line the caret can land on). Two cases
  // drive this differently:
  //  - `pre`/`pre-wrap` "A\n": the tokenizer supplies a trailing empty text
  //    token (`["A", LINE_BREAK, ""]`) which flushes that line itself, so
  //    `lastUnitWasForcedBreak` is false there (the empty token cleared it
  //    via `pushUnit`) — the post-loop flag flush does NOT fire (no double
  //    emit).
  //  - `pre-line` "A\n" AND a terminal hard-break embed: NO trailing empty
  //    token is produced (`pre-line` tokenizes to `["A", LINE_BREAK]`, the
  //    embed has no text node at all), so `lastUnitWasForcedBreak` stays true
  //    and the post-loop flag flush below IS the mechanism that emits the
  //    trailing empty line.
  let lastUnitWasForcedBreak = false;

  /**
   * Try to split `unit` at a hyphen break opportunity so that the prefix
   * (plus a hyphen glyph) fits within `available` pixels.
   * Returns [prefixUnit, suffixUnit, hyphenBreak] when a split is found,
   * or null when no suitable hyphen break exists.
   */
  function tryHyphenSplit(
    unit: WrapUnit,
    available: number,
  ): [WrapUnit, WrapUnit, HyphenBreak] | null {
    const firstTok = unit.tokens[0];
    if (firstTok === undefined) throw new Error("ifc: wrap unit has no tokens (unreachable)");
    if (!firstTok.hyphenBreaks || !firstTok.clusterWidths || firstTok.hyphenBreaks.length === 0) return null;
    if (firstTok.isSpace || firstTok.inlineBlock) return null;

    // Shape a hyphen with the token's style to get its width.
    const hyphenRun = shaper.shape("-", firstTok.style, direction);
    const hyphenInlineSize = hyphenRun.clusters.reduce((s, c) => s + c.inlineAdvance, 0);

    const clusterWidths = firstTok.clusterWidths;

    // Find the last hyphen break point where prefix + hyphen fits.
    let bestBreakIdx: number | null = null;
    let bestPrefixWidth = 0;
    for (const breakAt of firstTok.hyphenBreaks) {
      // breakAt is the cluster index AFTER the last cluster of the prefix
      // (i.e. the prefix is [0, breakAt)).
      let w = 0;
      for (let ci = 0; ci < breakAt && ci < clusterWidths.length; ci++) {
        const cw = clusterWidths[ci];
        if (cw === undefined) throw new Error(`ifc: hyphen-split clusterWidth ${ci} missing (unreachable)`);
        w += cw;
      }
      if (w + hyphenInlineSize <= available) {
        bestBreakIdx = breakAt;
        bestPrefixWidth = w;
      }
    }

    if (bestBreakIdx === null) return null;
    // Capture into a const so the non-null narrowing flows into the closures
    // below (a `let` re-widens to `number | null` inside arrow bodies, which
    // would otherwise force a non-null `!`). Mirrors the `const splitAt` idiom
    // in trySoftSplit / tryEmergencyBreak.
    const breakIdx: number = bestBreakIdx;

    const prefixText = firstTok.text.slice(0, bestBreakIdx);
    const suffixText = firstTok.text.slice(bestBreakIdx);

    // M1: derive the suffix's source position from the token's
    // `absoluteSourceBase` field (the ONE offset-derivation path) rather than
    // re-parsing `firstTok.id`. The suffix begins `bestBreakIdx` DISPLAY code
    // units after the prefix, so its absolute base advances by exactly that
    // (the same quantity used to slice the prefix `text`). The suffix `id` is
    // rebuilt from this ABSOLUTE base — a value change vs the old node-relative
    // id-parse, safe because the suffix id is consumed by nothing identity/cache
    // bearing (see splitSuffixSourceBase docstring).
    const suffixSourceBase = splitSuffixSourceBase(firstTok.absoluteSourceBase, bestBreakIdx);

    const prefixToken: Token = {
      id: firstTok.id,
      sourceKey: firstTok.sourceKey,
      text: prefixText,
      // Split the original token's source span by character count at the break
      // index. The prefix is the original text's [0, bestBreakIdx). Set this
      // explicitly (no `?? text.length` fallback) so the sum of split tokens'
      // sourceLength always equals the original — never NaN on hyphen lines.
      sourceLength: bestBreakIdx,
      // Prefix keeps the original token's absolute base.
      absoluteSourceBase: firstTok.absoluteSourceBase,
      width: bestPrefixWidth,
      style: firstTok.style,
      isSpace: false,
      isLineBreak: false,
      inlineAncestors: firstTok.inlineAncestors,
      inlineAncestorStyles: firstTok.inlineAncestorStyles,
      // #521 PDF /Link: a word-split keeps both fragments inside the SAME link
      // as the original word, so the prefix word-run carries it through (the
      // synthetic hyphen inherits it via hyphenBreak.link).
      ...(firstTok.link !== undefined ? { link: firstTok.link } : {}),
    };

    const suffixToken: Token = {
      id: `${firstTok.sourceKey}:${suffixSourceBase}`,
      sourceKey: firstTok.sourceKey,
      text: suffixText,
      // #521 PDF /Link: the suffix fragment stays inside the original word's link.
      ...(firstTok.link !== undefined ? { link: firstTok.link } : {}),
      // The remainder of the original token's source span. Together with the
      // prefix's `bestBreakIdx` this re-sums to firstTok.sourceLength, which
      // (for a word token under collapse) may exceed text.length — the excess
      // trailing collapsed whitespace stays with the suffix's last position.
      sourceLength: firstTok.sourceLength - bestBreakIdx,
      // Suffix base advances by the prefix's DISPLAY length (bestBreakIdx).
      absoluteSourceBase: suffixSourceBase,
      width: firstTok.width - bestPrefixWidth,
      style: firstTok.style,
      isSpace: false,
      isLineBreak: false,
      inlineAncestors: firstTok.inlineAncestors,
      inlineAncestorStyles: firstTok.inlineAncestorStyles,
      // Pass remaining cluster widths and hyphen breaks to suffix for potential future splits.
      clusterWidths: firstTok.clusterWidths.slice(bestBreakIdx),
      hyphenBreaks: firstTok.hyphenBreaks
        .filter(b => b > breakIdx)
        .map(b => b - breakIdx),
      // The hyphenation point IS a break opportunity — the suffix may begin a
      // line. Set explicitly (mirrors trySoftSplit's suffix) so the symmetry is
      // self-documenting rather than relying on absent-means-breakable.
      breakableBefore: true,
    };

    const prefixUnit: WrapUnit = {
      tokens: [prefixToken],
      totalWidth: bestPrefixWidth,
      sourceKey: unit.sourceKey,
      isLineBreak: false,
      inlineAncestors: unit.inlineAncestors,
      inlineAncestorStyles: unit.inlineAncestorStyles,
      // Prefix occupies the same original token start; the split doesn't advance past the token.
      tokenStartIdx: unit.tokenStartIdx,
      tokenEndIdx: unit.tokenStartIdx,
    };

    // Suffix unit: include trailing space tokens from the original unit (if any).
    const trailingTokens = unit.tokens.slice(1); // space tokens after the word
    const trailingWidth = trailingTokens.reduce((s, t) => s + t.width, 0);
    const suffixUnit: WrapUnit = {
      tokens: [suffixToken, ...trailingTokens],
      totalWidth: suffixToken.width + trailingWidth,
      sourceKey: unit.sourceKey,
      isLineBreak: false,
      inlineAncestors: unit.inlineAncestors,
      inlineAncestorStyles: unit.inlineAncestorStyles,
      // Suffix still starts at the same original token (it's a sub-token split).
      tokenStartIdx: unit.tokenStartIdx,
      tokenEndIdx: unit.tokenEndIdx,
    };

    const hyphenBreak: HyphenBreak = {
      style: firstTok.style,
      inlineAncestors: firstTok.inlineAncestors,
      inlineAncestorStyles: firstTok.inlineAncestorStyles,
      sourceKey: firstTok.sourceKey,
      link: firstTok.link,
    };

    return [prefixUnit, suffixUnit, hyphenBreak];
  }

  /**
   * UAX #14 soft-split: the no-hyphen-glyph mirror of `tryHyphenSplit`, used to
   * break a unit at an interior `softBreaks` opportunity (e.g. between CJK
   * ideographs). Returns a 2-TUPLE (no `HyphenBreak`) — the line flushes with no
   * hyphen. The suffix carries its remaining `softBreaks` (re-sliced) and
   * `breakableBefore: true` (the split point IS a break opportunity).
   */
  function trySoftSplit(
    unit: WrapUnit,
    available: number,
  ): [WrapUnit, WrapUnit] | null {
    const firstTok = unit.tokens[0];
    if (firstTok === undefined) throw new Error("ifc: wrap unit has no tokens (unreachable)");
    if (!firstTok.softBreaks || !firstTok.clusterWidths || firstTok.softBreaks.length === 0) return null;
    if (firstTok.isSpace || firstTok.inlineBlock) return null;
    // No hyphen term here (tryHyphenSplit is implicitly safe because every
    // candidate adds hyphenInlineSize>0). A zero-width prefix would pass
    // `0 <= available` → zero-width line → the suffix re-enters the same overflow
    // → infinite loop. Guard: require available>0 AND a strictly non-zero prefix
    // (skips a combining-mark-only prefix).
    if (available <= 0) return null;

    const clusterWidths = firstTok.clusterWidths;

    let bestBreakIdx: number | null = null;
    let bestPrefixWidth = 0;
    for (const breakAt of firstTok.softBreaks) {
      let w = 0;
      for (let ci = 0; ci < breakAt && ci < clusterWidths.length; ci++) {
        const cw = clusterWidths[ci];
        if (cw === undefined) throw new Error(`ifc: soft-split clusterWidth ${ci} missing (unreachable)`);
        w += cw;
      }
      if (w > 0 && w <= available) {
        bestBreakIdx = breakAt;
        bestPrefixWidth = w;
      }
    }

    if (bestBreakIdx === null) return null;
    // Capture the narrowed value in a const so the closures below don't need a
    // `!` non-null assertion (TS won't narrow the `let` inside a nested closure).
    const splitAt: number = bestBreakIdx;

    const prefixText = firstTok.text.slice(0, splitAt);
    const suffixText = firstTok.text.slice(splitAt);

    // M1: mirror tryHyphenSplit — derive the suffix source position from the
    // `absoluteSourceBase` field (the single offset-derivation path), not by
    // re-parsing `firstTok.id`. The suffix begins `splitAt` DISPLAY code units
    // after the prefix.
    const suffixSourceBase = splitSuffixSourceBase(firstTok.absoluteSourceBase, splitAt);

    const prefixToken: Token = {
      id: firstTok.id,
      sourceKey: firstTok.sourceKey,
      text: prefixText,
      sourceLength: splitAt,
      // Prefix keeps the original token's absolute base.
      absoluteSourceBase: firstTok.absoluteSourceBase,
      width: bestPrefixWidth,
      style: firstTok.style,
      isSpace: false,
      isLineBreak: false,
      inlineAncestors: firstTok.inlineAncestors,
      inlineAncestorStyles: firstTok.inlineAncestorStyles,
      // #521 PDF /Link: a word-split keeps both fragments inside the SAME link as
      // the original word, so both the prefix and suffix runs carry it through. (No
      // synthetic hyphen on this path — that is tryHyphenSplit only.)
      ...(firstTok.link !== undefined ? { link: firstTok.link } : {}),
    };

    const suffixToken: Token = {
      id: `${firstTok.sourceKey}:${suffixSourceBase}`,
      sourceKey: firstTok.sourceKey,
      text: suffixText,
      // #521 PDF /Link: the suffix fragment stays inside the original word's link.
      ...(firstTok.link !== undefined ? { link: firstTok.link } : {}),
      sourceLength: firstTok.sourceLength - splitAt,
      // Suffix base advances by the prefix's DISPLAY length (splitAt).
      absoluteSourceBase: suffixSourceBase,
      width: firstTok.width - bestPrefixWidth,
      style: firstTok.style,
      isSpace: false,
      isLineBreak: false,
      inlineAncestors: firstTok.inlineAncestors,
      inlineAncestorStyles: firstTok.inlineAncestorStyles,
      clusterWidths: firstTok.clusterWidths.slice(splitAt),
      softBreaks: firstTok.softBreaks
        .filter(b => b > splitAt)
        .map(b => b - splitAt),
      // The split point is a break opportunity — the suffix may begin a line.
      breakableBefore: true,
    };

    const prefixUnit: WrapUnit = {
      tokens: [prefixToken],
      totalWidth: bestPrefixWidth,
      sourceKey: unit.sourceKey,
      isLineBreak: false,
      inlineAncestors: unit.inlineAncestors,
      inlineAncestorStyles: unit.inlineAncestorStyles,
      tokenStartIdx: unit.tokenStartIdx,
      tokenEndIdx: unit.tokenStartIdx,
    };

    const trailingTokens = unit.tokens.slice(1);
    const trailingWidth = trailingTokens.reduce((s, t) => s + t.width, 0);
    const suffixUnit: WrapUnit = {
      tokens: [suffixToken, ...trailingTokens],
      totalWidth: suffixToken.width + trailingWidth,
      sourceKey: unit.sourceKey,
      isLineBreak: false,
      inlineAncestors: unit.inlineAncestors,
      inlineAncestorStyles: unit.inlineAncestorStyles,
      tokenStartIdx: unit.tokenStartIdx,
      tokenEndIdx: unit.tokenEndIdx,
    };

    return [prefixUnit, suffixUnit];
  }

  /**
   * `overflow-wrap: break-word` (CSS Text 3 §5.1): the LAST-RESORT within-word
   * break. When a word has no real break opportunity (no UAX #14 soft break, no
   * authored hyphen) and exceeds the line, break it at a GRAPHEME-CLUSTER boundary.
   * Tried only AFTER `trySoftSplit` + `tryHyphenSplit` both fail, so a real break
   * always wins. Returns a 2-TUPLE (no `HyphenBreak`, NO glyph — break-word draws
   * no visible mark), structurally identical to `trySoftSplit` but breaking at an
   * arbitrary grapheme boundary rather than a precomputed `softBreaks` index.
   *
   * Gated to suppress ONLY `normal` (the initial — pure no-op, existing layout
   * byte-identical). Both `break-word` and `anywhere` emergency-break IDENTICALLY
   * in USED layout (CSS Text 3 §5.1: `anywhere`'s used break == `break-word`'s; the
   * two differ only in min-content intrinsic sizing, handled in
   * `intrinsic-sizes-pass.ts`). Skips space / inline-block / line-break units and
   * (mirroring `tryHyphenSplit`'s grow-token punt) text-transform grow/shrink tokens
   * whose `sourceDisplayLengths` make display≠source offsets unsafe for the
   * source-base split — a named follow-up, consistent with the shipped hyphen
   * behavior, not a new degradation.
   */
  function tryEmergencyBreak(
    unit: WrapUnit,
    available: number,
  ): [WrapUnit, WrapUnit] | null {
    const firstTok = unit.tokens[0];
    if (firstTok === undefined) throw new Error("ifc: wrap unit has no tokens (unreachable)");
    if (firstTok.style.overflowWrap === "normal") return null;
    if (firstTok.isSpace || firstTok.inlineBlock || firstTok.isLineBreak) return null;
    if (!firstTok.clusterWidths) return null;
    if (firstTok.sourceDisplayLengths !== undefined) return null;

    const clusterWidths = firstTok.clusterWidths;
    // Interior grapheme-cluster boundaries (code-unit offsets where a new grapheme
    // begins, excluding 0 and the end). break-word breaks BETWEEN graphemes, never
    // inside one (a surrogate pair / combining sequence stays whole). For 1:1
    // tokens (grow tokens are excluded above) these display indices equal source
    // indices, so `splitSuffixSourceBase` and `clusterWidths` slicing align.
    const boundaries: number[] = [];
    let idx = 0;
    for (const g of graphemeClusters(firstTok.text)) {
      idx += g.length;
      if (idx < firstTok.text.length) boundaries.push(idx);
    }
    // A single grapheme cannot be broken.
    if (boundaries.length === 0) return null;

    // Widest prefix (in grapheme boundaries) whose width fits. Mirror
    // `trySoftSplit`'s candidate-scan shape (prefix-sum `clusterWidths`).
    let bestBreakIdx: number | null = null;
    let bestPrefixWidth = 0;
    for (const breakAt of boundaries) {
      let w = 0;
      for (let ci = 0; ci < breakAt && ci < clusterWidths.length; ci++) {
        const cw = clusterWidths[ci];
        if (cw === undefined) throw new Error(`ifc: emergency-break clusterWidth ${ci} missing (unreachable)`);
        w += cw;
      }
      // `w > 0` mirrors trySoftSplit (ifc.ts ~1633): a zero-width prefix (e.g. a
      // leading combining-mark-only grapheme) would emit a spurious zero-width
      // line. The progress-guarantee path below still places grapheme 0 when no
      // positive-width prefix fits, so a genuinely too-wide first glyph is handled.
      if (w > 0 && w <= available) { bestBreakIdx = breakAt; bestPrefixWidth = w; }
    }
    // Progress guarantee (CSS Text 3 §5.1): if not even the first grapheme fits,
    // still place exactly one grapheme (it overflows the line). This guarantees the
    // wrap loop advances and never infinite-loops on a giant grapheme.
    if (bestBreakIdx === null) {
      const firstBoundary = boundaries[0];
      // `boundaries.length === 0` was already returned above, so [0] is present.
      if (firstBoundary === undefined) throw new Error("ifc: emergency-break boundary 0 missing (unreachable)");
      bestBreakIdx = firstBoundary;
      bestPrefixWidth = 0;
      for (let ci = 0; ci < bestBreakIdx && ci < clusterWidths.length; ci++) {
        const cw = clusterWidths[ci];
        if (cw === undefined) throw new Error(`ifc: emergency-break clusterWidth ${ci} missing (unreachable)`);
        bestPrefixWidth += cw;
      }
    }
    const splitAt: number = bestBreakIdx;

    const prefixText = firstTok.text.slice(0, splitAt);
    const suffixText = firstTok.text.slice(splitAt);
    const suffixSourceBase = splitSuffixSourceBase(firstTok.absoluteSourceBase, splitAt);

    const prefixToken: Token = {
      id: firstTok.id,
      sourceKey: firstTok.sourceKey,
      text: prefixText,
      sourceLength: splitAt,
      absoluteSourceBase: firstTok.absoluteSourceBase,
      width: bestPrefixWidth,
      style: firstTok.style,
      isSpace: false,
      isLineBreak: false,
      inlineAncestors: firstTok.inlineAncestors,
      inlineAncestorStyles: firstTok.inlineAncestorStyles,
      // #521 PDF /Link: a word-split keeps both fragments inside the SAME link as
      // the original word, so both the prefix and suffix runs carry it through. (No
      // synthetic hyphen on this path — that is tryHyphenSplit only.)
      ...(firstTok.link !== undefined ? { link: firstTok.link } : {}),
    };

    const suffixToken: Token = {
      id: `${firstTok.sourceKey}:${suffixSourceBase}`,
      sourceKey: firstTok.sourceKey,
      text: suffixText,
      // #521 PDF /Link: the suffix fragment stays inside the original word's link.
      ...(firstTok.link !== undefined ? { link: firstTok.link } : {}),
      sourceLength: firstTok.sourceLength - splitAt,
      absoluteSourceBase: suffixSourceBase,
      width: firstTok.width - bestPrefixWidth,
      style: firstTok.style,
      isSpace: false,
      isLineBreak: false,
      inlineAncestors: firstTok.inlineAncestors,
      inlineAncestorStyles: firstTok.inlineAncestorStyles,
      clusterWidths: firstTok.clusterWidths.slice(splitAt),
      // Preserve any real break opportunities BEYOND the split so the suffix can
      // still soft/hyphen-break on a later line (re-sliced to suffix-relative
      // offsets). Emergency break is the last resort here, but the suffix is a
      // generic token that may carry breaks the emergency split moved past.
      ...(firstTok.softBreaks
        ? { softBreaks: firstTok.softBreaks.filter(b => b > splitAt).map(b => b - splitAt) }
        : {}),
      ...(firstTok.hyphenBreaks
        ? { hyphenBreaks: firstTok.hyphenBreaks.filter(b => b > splitAt).map(b => b - splitAt) }
        : {}),
      // The split point is a break opportunity — the suffix may begin a line.
      breakableBefore: true,
    };

    const prefixUnit: WrapUnit = {
      tokens: [prefixToken],
      totalWidth: bestPrefixWidth,
      sourceKey: unit.sourceKey,
      isLineBreak: false,
      inlineAncestors: unit.inlineAncestors,
      inlineAncestorStyles: unit.inlineAncestorStyles,
      tokenStartIdx: unit.tokenStartIdx,
      tokenEndIdx: unit.tokenStartIdx,
    };

    const trailingTokens = unit.tokens.slice(1);
    const trailingWidth = trailingTokens.reduce((s, t) => s + t.width, 0);
    const suffixUnit: WrapUnit = {
      tokens: [suffixToken, ...trailingTokens],
      totalWidth: suffixToken.width + trailingWidth,
      sourceKey: unit.sourceKey,
      isLineBreak: false,
      inlineAncestors: unit.inlineAncestors,
      inlineAncestorStyles: unit.inlineAncestorStyles,
      tokenStartIdx: unit.tokenStartIdx,
      tokenEndIdx: unit.tokenEndIdx,
    };

    return [prefixUnit, suffixUnit];
  }

  /**
   * Flush the current accumulated units into a line, record its token-range
   * metadata, and reset accumulation state.
   */
  function flushLine(
    lineInlineCursor: number,
    lineInlineSize: number,
    hyphen: HyphenBreak | null,
    // P3 (#312): set on the FINAL flush (the last/only line of the paragraph)
    // and on a hard-LINE_BREAK-terminated flush. Neither is justified
    // (CSS Text 3 §7.3); both fall through to start-alignment. Soft-wrap and
    // hyphen-split flushes leave this `false` (more content follows → justify).
    //
    // Why an explicit flag rather than inspecting the unit queue: at a
    // soft-wrap flush the overflowing unit has already been dequeued (`uqi`
    // points past it) but has NOT yet been placed — it forms the NEXT line —
    // so a queue-position test would mis-classify a wrap-before-the-last-word
    // line as "last". The caller knows which flush is terminal; it tells us.
    noJustify: boolean = false,
  ): LineBox {
    // P2 (#312, #333): compute the alignment offset and apply it to the line's
    // CHILDREN's origin (via `buildLineWithFragments`'s `alignmentOffset` arg).
    // `lineInlineCursor` itself stays at the natural inline-start — the line
    // box covers the full available inline size, so `logicalToPhysical` mirrors
    // it correctly under RTL. Centering must use the VISIBLE width — exclude
    // trailing whitespace (the merged trailing-space tokens in collapsing modes,
    // and the standalone space units in break-spaces #314/#339 —
    // `trailingSpaceWidthOf` sums the full trailing RUN of space units across
    // both shapes).
    // CSS Text 3 §8.1: also exclude the trailing tracking (letter-spacing) of
    // the last retained typographic unit — composes with the trailing-space
    // trim (the space already carried away its own spacing, so no double count).
    const contentWidth =
      currentWidth
      - trailingSpaceWidthOf(currentUnits)
      - trailingLetterSpacingOf(currentUnits);
    const alignmentOffset = computeAlignmentOffset(lineInlineSize, contentWidth, textAlign, direction);

    // P3 (#312): JUSTIFY widens interior inter-word spaces (it does NOT shift
    // the line — `computeAlignmentOffset` returns 0 for justify). A line is
    // justified iff textAlign==="justify" AND it is NOT the last/only line of
    // the paragraph AND NOT hard-break-terminated (`noJustify` covers both).
    let buildUnits: readonly WrapUnit[] = currentUnits;
    if (textAlign === "justify" && !noJustify) {
      buildUnits = justifyUnits(currentUnits, lineInlineSize, contentWidth);
    }

    // Empty flush (no units pushed): anchor line offsets at the
    // current cursor. Both start and end are the same offset — the
    // line covers zero characters.
    const startOff = currentLineStartOffset >= 0 ? currentLineStartOffset : cursorOffset;
    const line = buildLineWithFragments(
      parent.key, lineIndex++, lineInlineCursor, lineBlockOffset, lineInlineSize,
      buildUnits, parentCs, measurer, writingMode, direction, availableInlineSize,
      hyphen, shaper,
      sourceBlockIdOf(parent.key), // ownerBlockId (see strut-line comment)
      startOff,              // inlineOffsetStart
      cursorOffset,          // inlineOffsetEnd
      alignmentOffset,
      paragraphBidi,         // P4-C: per-paragraph bidi levels (closure-captured)
    );
    if (currentLineStartTokenIdx >= 0) {
      lineMeta.set(line, {
        startTokenIdx: currentLineStartTokenIdx,
        endTokenIdx: currentLineEndTokenIdx,
      });
    }
    lines.push(line);
    lineBlockOffset += line.blockSize;
    currentUnits = [];
    currentWidth = 0;
    pendingHyphen = null;
    currentLineStartTokenIdx = -1;
    currentLineEndTokenIdx = -1;
    currentLineStartOffset = -1;
    return line;
  }

  /**
   * Compute a wrap-unit's state-model offset contribution. Each token
   * contributes its `sourceLength` — the count of STATE-model characters it
   * owns, which equals `text.length` for non-collapsing text but is larger
   * when the token absorbed trailing collapsed whitespace (and is 1 for
   * inline-block embed tokens and a lone `LINE_BREAK`). Summing sourceLength
   * keeps the per-block offset cursor state-correct, so the LineBox
   * `inlineOffsetStart`/`inlineOffsetEnd` stamped from it match state offsets
   * and the `nextLine.inlineOffsetStart === prevLine.inlineOffsetEnd`
   * invariant holds across a collapsed run.
   */
  function unitOffsetContribution(unit: WrapUnit): number {
    let total = 0;
    for (const t of unit.tokens) {
      total += t.sourceLength;
    }
    return total;
  }

  /**
   * Push a unit onto the current line, updating token-range tracking
   * and the state-model offset cursor.
   */
  function pushUnit(unit: WrapUnit): void {
    if (currentLineStartTokenIdx < 0) currentLineStartTokenIdx = unit.tokenStartIdx;
    currentLineEndTokenIdx = unit.tokenEndIdx;
    if (currentLineStartOffset < 0) currentLineStartOffset = cursorOffset;
    cursorOffset += unitOffsetContribution(unit);
    currentUnits.push(unit);
    currentWidth += unit.totalWidth;
    lastUnitWasForcedBreak = false;
  }

  // Strut line (CSS line-box semantics): an inline-bearing block with no
  // wrap units (e.g. an empty paragraph — no text, no inline-block, no
  // hard break) must still display as ONE line-height of vertical space,
  // not collapse to zero. Browsers achieve this via the line-box "strut" —
  // a synthetic, zero-content line carrying the block's font line-height.
  // Without this, empty paragraphs are invisible (h=0) and stacked-tight
  // against their neighbours, and selection/caret on the empty line has no
  // line box to attach to.
  if (units.length === 0) {
    const { lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset, lineIndex === 0);
    // P2 (#312) / #333: a strut (empty paragraph) has zero content width, so
    // the gap is the full line. The alignment is carried on a single zero-width
    // STRUT CHILD inside the line — caret/selection consumers walk `line.children`
    // (post-#172 / #208 LineBox-canonical), so the strut leaf naturally provides
    // the empty-line caret anchor at the right physical position under either
    // direction (LTR center → center; RTL center → center; LTR end → right;
    // RTL end → left). The LINE itself spans the full inline size at the
    // natural inline-start, so `logicalToPhysical` mirrors it correctly under
    // RTL.
    const strutAlignmentOffset = computeAlignmentOffset(lineInlineSize, 0, textAlign, direction);
    const strutBlockSize = measurer.measureHeight(parentCs);
    const strutUsedStyle = computeUsedStyle(parentCs, availableInlineSize, "indefinite");
    const strutChild = createTextRunBox(
      `${parent.key}-l${lineIndex}:strut`,
      /* inlineOffset */ strutAlignmentOffset,
      /* blockOffset */ 0,
      /* inlineSize */ 0,
      /* blockSize */ strutBlockSize,
      writingMode,
      direction,
      parentCs,
      strutUsedStyle,
      /* text */ "",
      // The strut owns ZERO state offsets — caret accounting treats it as a
      // null-width anchor (offsetContribution 0 in `collectLineLeaves`).
      /* offsetLength */ 0,
      /* containingInlineSize */ lineInlineSize,
      // The strut owns no source span — leave sourceDisplayLengths/clusterWidths/
      // sourceStart undefined (never a bidi-split target).
      /* sourceDisplayLengths */ undefined,
      /* clusterWidths */ undefined,
      /* sourceStart */ undefined,
      /* bidiLevel */ undefined,
      /* containingBlockSize */ undefined,
      /* link — strut is never inside a link */ undefined,
    );
    const strutLine = createLineBox(
      `${parent.key}-l${lineIndex++}`,
      lineInlineCursor,
      lineBlockOffset,
      lineInlineSize,
      strutBlockSize,
      writingMode,
      direction,
      parentCs,
      strutUsedStyle,
      [strutChild],
      /* baseline */ strutBlockSize,
      /* containingInlineSize */ availableInlineSize,
      // IFC is dispatched for the leaf block running the inline-flow.
      // When the BFC sees mixed inline+block children, it wraps inline
      // runs in anonymous blocks keyed "${sourceKey}/anon[N]". Strip
      // that suffix so `ownerBlockId` is the state-model SOURCE block
      // id (e.g. "p"), not the layout-only anonymous wrap key
      // (e.g. "p/anon[0]"). Downstream consumers pass this to state
      // APIs (`getBlock`, etc.) which only know about source blocks.
      /* ownerBlockId */ sourceBlockIdOf(parent.key),
      /* inlineOffsetStart */ 0,
      /* inlineOffsetEnd */ 0,
      /* isBlockBoundaryLine */ true,
    );
    lines.push(strutLine);
    lineBlockOffset += strutBlockSize;
  }

  // Units queue: we may inject split suffix units back into the front.
  let unitQueue: WrapUnit[] = [...units];
  let uqi = 0;

  const tWrap = markStart("ifc.wrap");
  try {
  while (uqi < unitQueue.length) {
    let unit = unitQueue[uqi++];
    if (unit === undefined) throw new Error(`ifc: wrap-loop unit ${uqi - 1} missing (unreachable)`);

    // Hard break on LINE_BREAK — advance the offset cursor by the
    // sentinel's contribution (1 char, matching the source `\n` in
    // the state model), then flush. The text tokenizer strips `\n`
    // from surrounding text tokens and emits a separate LINE_BREAK
    // sentinel, so neither neighbor counts the character; the offset
    // advance must come from the line-break unit itself. The current
    // line OWNS the `\n` offset (its `inlineOffsetEnd` is the
    // position past the `\n`); the next line starts at the same
    // offset, preserving `nextLine.start === currentLine.end`.
    if (unit.isLineBreak) {
      const { lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset, lineIndex === 0);
      if (currentLineStartOffset < 0) currentLineStartOffset = cursorOffset;
      cursorOffset += unitOffsetContribution(unit);
      // Hard-break-terminated line is NOT justified (P3, CSS Text 3 §7.3).
      flushLine(lineInlineCursor, lineInlineSize, pendingHyphen, /* noJustify */ true);
      lastUnitWasForcedBreak = true;
      continue;
    }

    // Soft wrap — only when canWrap is true
    let { lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset, lineIndex === 0);

    // Tab stops S3/S5 — resolve-at-the-overflow-check, freeze-geometry. A tab's
    // advance is POSITION-DEPENDENT: it depends on the running pen position
    // (`currentWidth`) when the tab is reached on this line. Resolve it HERE,
    // before the overflow test reads `unit.totalWidth`, and substitute a frozen
    // clone so both the wrap decision and the emitted box see the real advance.
    //
    // The destination stop's `alignment` selects how the advance is computed:
    //   - left / default-grid (`stop === null`): advance to the stop `position`
    //     (S3). The pen lands ON the stop; the following segment flows from it.
    //   - right: advance so the post-tab SEGMENT ENDS on the stop. Needs the
    //     segment's width `w` → `position − w − pen` (S5).
    //   - center: advance so the segment is CENTERED on the stop → `position
    //     − w/2 − pen` (S5).
    //   - decimal: the first '.' (U+002E) in the segment lands on the stop (S6).
    //     Needs the inline distance from the segment start to that '.' →
    //     `position − dOff − pen`. No '.' on the line → right fallback.
    // Right/center/decimal read the post-tab segment via a bounded look-ahead
    // over the SAME `unitQueue` (peeking by index from `uqi`, the cursor already
    // advanced past this tab) — it does NOT consume the loop cursor, so those
    // units still get placed by their normal loop iterations.
    //
    // Freezing must write BOTH fields the downstream reads: `unit.totalWidth`
    // (read by `pushUnit` to advance `currentWidth`) AND `unit.tokens[0].width`
    // (read by `buildLineChildrenForAncestorLevel` to size the box). The
    // destination stop's `leader` rides `tokens[0].tabLeader` to the box-emit.
    if (unit.isTab === true) {
      const { position: stopX, stop } = nextStop(
        currentWidth,
        parentCs.tabStops,
        parentCs.defaultTabStop,
        lineInlineSize,
      );
      const remaining = lineInlineSize - currentWidth;
      const alignment = stop?.alignment ?? "left";

      let rawAdvance: number;
      if (
        alignment === "right" ||
        alignment === "center" ||
        alignment === "decimal" ||
        alignment === "content-edge"
      ) {
        // Bounded look-ahead: walk the units AFTER the tab (unitQueue[uqi..]),
        // stopping at the next tab unit (exclusive), the end of the queue, or
        // when the running sum would exceed the line's remaining budget (so a
        // wrapped tail does not skew the on-line head's alignment). Reads the
        // same per-unit `totalWidth` the wrap loop uses — no re-measure — and
        // never advances `uqi`.
        //
        // For `decimal` (S6) we ALSO locate the FIRST decimal separator (v1 =
        // `.` U+002E) in the segment's DISPLAY text and accumulate the inline
        // distance from the segment start to the START of that `.` grapheme
        // (`dOff`). Within the unit/token that contains the `.`, the sub-token
        // prefix width is summed from the token's `clusterWidths` (the same
        // per-cluster advances `trySoftSplit`/`tryHyphenSplit` use for sub-token
        // measurement — no re-measure), falling back to a proportional split of
        // the token width when a token carries no `clusterWidths` (e.g. a
        // strut). A `.` beyond the remaining budget is treated as not-found on
        // this line → right fallback on the on-line head.
        let segmentWidth = 0;
        let dotOffset: number | null = null;
        for (let j = uqi; j < unitQueue.length; j++) {
          const peek = unitQueue[j];
          if (peek === undefined) throw new Error(`ifc: tab look-ahead unit ${j} missing (unreachable)`);
          if (peek.isTab === true || peek.isLineBreak) break;
          if (segmentWidth + peek.totalWidth > remaining) break;
          if (alignment === "decimal" && dotOffset === null) {
            // Search this unit's tokens in order for the first `.` grapheme.
            let unitConsumed = 0;
            for (const tok of peek.tokens) {
              const dotIdx = tok.text.indexOf(".");
              if (dotIdx >= 0) {
                let prefix = 0;
                const cws = tok.clusterWidths;
                if (cws) {
                  for (let ci = 0; ci < dotIdx && ci < cws.length; ci++) {
                    const cw = cws[ci];
                    if (cw === undefined) throw new Error(`ifc: decimal-tab clusterWidth ${ci} missing (unreachable)`);
                    prefix += cw;
                  }
                } else if (tok.text.length > 0) {
                  // No per-cluster widths: split the token width proportionally
                  // by code-unit count (uniform-advance fallback).
                  prefix = (tok.width * dotIdx) / tok.text.length;
                }
                dotOffset = segmentWidth + unitConsumed + prefix;
                break;
              }
              unitConsumed += tok.width;
            }
          }
          segmentWidth += peek.totalWidth;
        }
        // The pre-stop quantity: decimal → distance to the first `.`; right →
        // the full segment width; center → half the segment width. Decimal with
        // no on-line `.` falls back to right (`dOff = segmentWidth`).
        let offset: number;
        if (alignment === "right" || alignment === "content-edge") {
          // content-edge behaves like right (segment END at the destination),
          // but `stopX` is the line content edge (`lineInlineSize`), not a stored
          // px stop — so the segment's right edge lands at the content edge.
          offset = segmentWidth;
        } else if (alignment === "center") {
          offset = segmentWidth / 2;
        } else {
          offset = dotOffset ?? segmentWidth;
        }
        // max(0, …): the stop can sit LEFT of where the aligned point would land
        // → the ideal advance goes negative; clamp to 0 (no backward move, the
        // left-tab fallback). The segment then flows from the current pen.
        rawAdvance = Math.max(0, stopX - offset - currentWidth);
      } else {
        // left / default-grid: advance straight to the stop. A left/default stop
        // is always > pen so the raw advance is ≥ one cell.
        rawAdvance = stopX - currentWidth;
      }

      // `min` guards a stop beyond the line edge, `max(0, …)` guards the
      // degenerate clamp-below-zero case (line already full).
      const advance = Math.max(0, Math.min(rawAdvance, remaining));
      const tok = unit.tokens[0];
      if (tok === undefined) throw new Error("ifc: tab unit has no tokens (unreachable)");
      unit = {
        ...unit,
        totalWidth: advance,
        tokens: [{ ...tok, width: advance, tabLeader: stop?.leader ?? "none" }],
      };
    }

    // #338 (trailing-space HANG, match Google Docs): a SPACE unit never
    // triggers its own soft wrap. Only word / inline-block units wrap. When an
    // overflowing unit is all-spaces (a standalone space unit emitted by
    // `break-spaces`/`pre`/`pre-wrap`), skip the flush and fall through to
    // `pushUnit` so the space HANGS on the current line — the word stays put and
    // the lone space does not jump to the next line alone. `currentWidth` still
    // advances by the full space width (via pushUnit), so a FOLLOWING word still
    // wraps correctly (it hits this overflow→wrap branch with the advanced
    // currentWidth). Under collapsing `normal` the trailing space is slurped
    // into the word's unit, so `isSpaceUnit` is false there and words wrap as
    // before. (P2/#338 will CLAMP the hung space to the content edge; for now it
    // may extend past it.)
    if (canWrap && !isSpaceUnit(unit) && currentWidth + unit.totalWidth > lineInlineSize && currentUnits.length > 0) {
      const available = lineInlineSize - currentWidth;
      // UAX #14 soft split first (e.g. CJK between ideographs) — no hyphen glyph.
      // This is an INTERIOR break (inside the unit's first token), orthogonal to
      // `breakableBefore` (which only forbids a break BEFORE the unit's leading
      // boundary, e.g. an NBSP join). So we try it even when breakableBefore is
      // false: a long CJK run glued to the previous word by an NBSP still wraps
      // at its interior ideograph boundaries — the NBSP only pins the boundary.
      const softSplit = trySoftSplit(unit, available);
      if (softSplit !== null) {
        const [prefixUnit, suffixUnit] = softSplit;
        pushUnit(prefixUnit);
        flushLine(lineInlineCursor, lineInlineSize, pendingHyphen);
        ({ lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset, lineIndex === 0));
        unitQueue.splice(uqi, 0, suffixUnit);
        continue;
      }
      // Then a hyphenation split on the overflowing unit. Also an INTERIOR break
      // (it splits the word at a hyphenation point and inserts the hyphen glyph),
      // so it too is independent of `breakableBefore` — the prefix stays glued to
      // the previous unit on the current line; only the word's interior splits.
      const split = tryHyphenSplit(unit, available);
      if (split !== null) {
        const [prefixUnit, suffixUnit, hyphenBreak] = split;
        // Add the prefix to the current line, then flush with hyphen.
        pushUnit(prefixUnit);
        flushLine(lineInlineCursor, lineInlineSize, hyphenBreak);
        // Recompute dims and push the suffix unit back as next to process.
        ({ lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset, lineIndex === 0));
        // Insert suffix at the current position so it's processed next.
        unitQueue.splice(uqi, 0, suffixUnit);
        continue;
      }
      // No split possible — normal word wrap. This is the ONLY path here that
      // emits a break BEFORE the unit (the whole unit moves to the next line), so
      // it is the one gated by `breakableBefore`: a unit glued to the previous by
      // an NBSP (breakableBefore===false) is instead force-placed on the current
      // line — it overflows `lineInlineSize` (CSS-correct for a no-break space:
      // the line legitimately extends past its content box), falling through to
      // the end-of-loop `pushUnit`. Absent/true ⇒ unchanged (normal wrap).
      const headTok = unit.tokens[0];
      if (headTok === undefined) throw new Error("ifc: wrap unit has no tokens (unreachable)");
      if (headTok.breakableBefore !== false) {
        flushLine(lineInlineCursor, lineInlineSize, pendingHyphen);
        // Recompute dims for the new line position
        ({ lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset, lineIndex === 0));
      } else {
        // Glued (NBSP, breakableBefore===false): the unit can't move to a fresh
        // line, so without break-word it force-places + overflows. Under
        // `overflow-wrap: break-word` break it HERE as a last resort (CSS §5.1) —
        // prefix stays on the current line, suffix continues. (When breakableBefore
        // is TRUE the flush above moves the whole word to a fresh line, where the
        // alone-on-line site below emergency-breaks it if it still overflows —
        // matching browsers, which never break a word that can wholly move down.)
        const emergency = tryEmergencyBreak(unit, available);
        if (emergency !== null) {
          const [prefixUnit, suffixUnit] = emergency;
          pushUnit(prefixUnit);
          flushLine(lineInlineCursor, lineInlineSize, pendingHyphen);
          ({ lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset, lineIndex === 0));
          unitQueue.splice(uqi, 0, suffixUnit);
          continue;
        }
      }
    }

    // If even an empty line can't fit the token and there are active floats,
    // advance lineBlockOffset past the next float bottom and retry (CSS 9.5
    // below-min-content line push). We loop incrementally — each iteration
    // moves to the next float bottom — so we stop as soon as there is enough
    // space (the float that was squeezing this line may have ended while a
    // later float on the other side still leaves room).
    if (canWrap && currentWidth + unit.totalWidth > lineInlineSize && currentUnits.length === 0) {
      if (lineInlineSize < availableInlineSize) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          // Coherent float+pagination: query in the CUMULATIVE frame (the same
          // offset `effectiveLineDims` uses), then translate the returned
          // cumulative float bottom back to the wrap frame by subtracting
          // `(paraFlowStart - blockOffset)` so it is comparable to `lineBlockOffset`.
          const next = floatEnv.nextFloatBottomBelow(paraFlowStart + (lineBlockOffset - blockOffset)) - (paraFlowStart - blockOffset);
          if (next <= lineBlockOffset) break; // no float below; can't push further
          lineBlockOffset = next;
          ({ lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset, lineIndex === 0));
          if (lineInlineSize >= unit.totalWidth) break; // now fits
          if (lineInlineSize >= availableInlineSize) break; // no more floats squeezing
        }
      }
    }

    // Split on an otherwise-empty line: the unit doesn't fit even alone, but a
    // soft (UAX #14, e.g. CJK between ideographs) or hyphen break opportunity
    // lets a prefix fit. This is where a wide CJK run wraps across lines.
    if (canWrap && currentWidth + unit.totalWidth > lineInlineSize && currentUnits.length === 0) {
      const available = lineInlineSize - currentWidth;
      // Soft split first (UAX #14 interior break, e.g. CJK between ideographs).
      // No `breakableBefore` gate here: the unit is ALONE on this line
      // (currentUnits.length === 0), so there is no preceding unit on the line to
      // break away from — `breakableBefore` (a leading-boundary constraint) is
      // irrelevant. Both splits below are interior and run unconditionally.
      const softSplit = trySoftSplit(unit, available);
      if (softSplit !== null) {
        const [prefixUnit, suffixUnit] = softSplit;
        pushUnit(prefixUnit);
        flushLine(lineInlineCursor, lineInlineSize, pendingHyphen);
        ({ lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset, lineIndex === 0));
        unitQueue.splice(uqi, 0, suffixUnit);
        continue;
      }
      const split = tryHyphenSplit(unit, available);
      if (split !== null) {
        const [prefixUnit, suffixUnit, hyphenBreak] = split;
        pushUnit(prefixUnit);
        flushLine(lineInlineCursor, lineInlineSize, hyphenBreak);
        ({ lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset, lineIndex === 0));
        unitQueue.splice(uqi, 0, suffixUnit);
        continue;
      }
      // Last resort: `overflow-wrap: break-word` (CSS §5.1). A long unbreakable
      // word ALONE on a line that still overflows is broken at a grapheme boundary
      // (the ≥1-grapheme progress guarantee inside guarantees termination). No-op
      // under `overflow-wrap: normal`, so the word falls through to `pushUnit` and
      // overflows (the correct CSS `normal` behavior).
      const emergency = tryEmergencyBreak(unit, available);
      if (emergency !== null) {
        const [prefixUnit, suffixUnit] = emergency;
        pushUnit(prefixUnit);
        flushLine(lineInlineCursor, lineInlineSize, pendingHyphen);
        ({ lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset, lineIndex === 0));
        unitQueue.splice(uqi, 0, suffixUnit);
        continue;
      }
    }

    pushUnit(unit);
  }
  } finally {
    markEnd("ifc.wrap", tWrap);
  }

  if (currentUnits.length > 0) {
    const { lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset, lineIndex === 0);
    // Final flush — the last/only line of the paragraph is NOT justified (P3).
    flushLine(lineInlineCursor, lineInlineSize, pendingHyphen, /* noJustify */ true);
  } else if (lastUnitWasForcedBreak) {
    // The inline content ENDED on a forced break (hard-break embed) with no
    // content after it. Emit the empty trailing line the break opens, so the
    // caret-after-the-break has a line box to attach to (CSS `<br>` /
    // Google-Docs Shift+Enter; mirrors the `\n`-text path, where the
    // tokenizer's trailing empty token produces this line). `flushLine`
    // handles the empty case — `currentUnits` is empty, so it anchors the
    // line at `cursorOffset` (start === end, zero source chars).
    const { lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset, lineIndex === 0);
    flushLine(lineInlineCursor, lineInlineSize, pendingHyphen, /* noJustify */ true);
  }

  const result = assignFragmentEdges(lines);

  // `assignFragmentEdges` creates new frozen objects for each line. Copy
  // lineMeta from the original LineBox objects to the post-correction ones so
  // that incremental-wrap convergence detection can find metadata on the
  // cached lines.
  //
  // E-E.1: the `Object.freeze({ ...line, children: ... })` spread inside
  // assignFragmentEdges naturally propagates the new LineBox-canonical
  // fields (`ownerBlockId`, `inlineOffsetStart/End`, `isBlockBoundaryLine`)
  // because they are enumerable own-properties on the source LineBox.
  // If a future change routes this through `createLineBox` instead, those
  // fields must be passed explicitly via the factory's new positional
  // arguments.
  const resultLines: LineBox[] = [];
  for (let ri = 0; ri < result.length; ri++) {
    const box = result[ri];
    if (box === undefined) throw new Error(`ifc: result box ${ri} missing (unreachable)`);
    if (box.type !== "line") continue;
    const originalLine = lines[ri];
    if (originalLine !== undefined && originalLine.type === "line") {
      const meta = lineMeta.get(originalLine);
      if (meta !== undefined) lineMeta.set(box, meta);
    }
    resultLines.push(box);
  }

  // E-E.1: stamp `isBlockBoundaryLine = true` on the absolutely-last
  // line of the block. Strut lines (empty paragraph) were already
  // stamped at creation, so the no-op fast path covers them. For
  // wrapped blocks, every line was emitted with `false`; the last
  // one is patched here. Fragmentation slices resultLines later, but
  // only the truly-last line carries the flag — partial fragments
  // whose suffix doesn't include the last line correctly report
  // `isBlockBoundaryLine === false` on their tail.
  if (resultLines.length > 0) {
    const lastIdx = resultLines.length - 1;
    const lastLine = resultLines[lastIdx];
    if (lastLine === undefined) throw new Error(`ifc: resultLines[${lastIdx}] missing (unreachable)`);
    if (!lastLine.isBlockBoundaryLine) {
      const patched = Object.freeze({
        ...lastLine,
        isBlockBoundaryLine: true,
      }) as LineBox;
      const meta = lineMeta.get(lastLine);
      if (meta !== undefined) lineMeta.set(patched, meta);
      resultLines[lastIdx] = patched;
    }
  }

  // Save wrap state to cache for subsequent incremental re-wraps.
  // (Only when fragmentation is inactive; fragmented calls bypass the cache on
  // read and should not poison it with partial line sets on write either.)
  if (fragmentation === undefined) {
    ctx.ifcStateCache.set(parent.key, {
      tokens,
      lines: resultLines,
      availableInlineSize,
      textAlign,
      direction,
      textIndent: blockTextIndent,
      tabStops: parentCs.tabStops,
      defaultTabStop: parentCs.defaultTabStop,
      // S2: true when this block contains a recognized `"tab"` inline-block.
      // The cache READ path treats a `hasTab` entry as a forced miss (a tab's
      // resolved advance depends on its line-position, not just its token text),
      // so an incremental re-wrap of a tab-bearing block always re-lays.
      hasTab: tokens.some((t) => t.isTab === true),
    });
  }

  // D.1-D.5: Line-level fragmentation (fit-check, orphans, widows, hyphen-pair, resume).
  // Unified block: handles both fresh fragments (resumeFrom === null, startLine = 0)
  // and resumed fragments (resumeFrom.type === "ifc", startLine = resumeFrom.resumeAtLine).
  if (fragmentation !== undefined) {
    // D.5 — Determine where to start emitting lines (resume support).
    let startLine = 0;
    if (fragmentation.resumeFrom !== null) {
      if (fragmentation.resumeFrom.type !== "ifc") {
        throw new Error(
          `layoutInlineContent: expected IFCBreakToken at top-level resumeFrom, got ${fragmentation.resumeFrom.type}`,
        );
      }
      startLine = fragmentation.resumeFrom.resumeAtLine;
    }

    // The suffix of lines we consider on this fragment (lines[startLine..end]).
    const linesToConsider = resultLines.slice(startLine);

    // D.1 — Greedy fit-loop on the suffix.
    let used = 0;
    let placedLineCount = 0;
    for (let fi = 0; fi < linesToConsider.length; fi++) {
      const fitLine = linesToConsider[fi];
      if (fitLine === undefined) throw new Error(`ifc: linesToConsider[${fi}] missing (unreachable)`);
      const lineHeight = fitLine.blockSize;
      if (used + lineHeight > fragmentation.availableBlockSize) {
        break;
      }
      used += lineHeight;
      placedLineCount++;
    }

    if (placedLineCount === 0) {
      // First suffix line doesn't fit. Resume from startLine (not 0) on next fragment.
      return { box: null, breakToken: { type: "ifc", resumeAtLine: startLine, paraFlowStart }, inFlowConsumed: 0 };
    }

    // D.2 — Orphans constraint (CSS Fragmentation L4 §5.4).
    // At least `orphans` lines must remain on the current fragment. Default 2 per CSS spec.
    const orphans = parentCs.orphans ?? 2;
    if (placedLineCount < linesToConsider.length && placedLineCount < orphans) {
      return { box: null, breakToken: { type: "ifc", resumeAtLine: startLine, paraFlowStart }, inFlowConsumed: 0 };
    }

    // D.3 — Widows constraint (CSS Fragmentation L4 §5.4).
    // At least `widows` lines must carry over to the next fragment. Default 2 per CSS spec.
    // Back off placedLineCount until the constraint is satisfied.
    const widows = parentCs.widows ?? 2;
    while (placedLineCount > 0 && placedLineCount < linesToConsider.length && linesToConsider.length - placedLineCount < widows) {
      placedLineCount--;
    }
    // After widows back-off, re-check orphans (back-off may have violated it).
    if (placedLineCount < linesToConsider.length && placedLineCount < orphans) {
      return { box: null, breakToken: { type: "ifc", resumeAtLine: startLine, paraFlowStart }, inFlowConsumed: 0 };
    }

    // D.4 — Hyphen-pair constraint (CSS Fragmentation L4 §5).
    // A page break must not fall between two lines of a hyphenated word. If the
    // last placed line ends with a hyphen continuation, back off past it.
    // Live now that `hyphens: manual` produces real hyphenated lines from authored
    // U+00AD soft hyphens (the producer sets `endsWithHyphenContinuation`); covered
    // by the IFC-fragmentation hyphen-pair test.
    while (
      placedLineCount > 0 &&
      placedLineCount < linesToConsider.length &&
      linesToConsider[placedLineCount - 1]?.endsWithHyphenContinuation === true
    ) {
      placedLineCount--;
    }
    // After hyphen-pair back-off, re-check orphans.
    if (placedLineCount < linesToConsider.length && placedLineCount < orphans) {
      return { box: null, breakToken: { type: "ifc", resumeAtLine: startLine, paraFlowStart }, inFlowConsumed: 0 };
    }

    // Recompute used block size after all back-off adjustments.
    let usedAdjusted = 0;
    for (let i = 0; i < placedLineCount; i++) {
      const adjLine = linesToConsider[i];
      if (adjLine === undefined) throw new Error(`ifc: linesToConsider[${i}] missing (unreachable)`);
      usedAdjusted += adjLine.blockSize;
    }

    // Rebase the suffix lines' blockOffsets. The wrap pass produces lines
    // with blockOffset values relative to the IFC's `blockOffset` parameter
    // (line K = blockOffset + K * lineHeight). When resuming at line
    // `startLine`, the first emitted line must land at `blockOffset` again
    // — it is the first thing on the new fragment — not at its original
    // wrap-pass position. Without this rebase, paint renders the lines
    // past the wrapping BlockBox's bottom and they appear to be missing on
    // page 2+.
    function rebaseLine(line: LineBox, newBlockOffset: number): LineBox {
      return createLineBox(
        line.key,
        line.inlineOffset,
        newBlockOffset,
        line.inlineSize,
        line.blockSize,
        line.writingMode,
        line.direction,
        line.computedStyle,
        line.usedStyle,
        line.children,
        line.baseline,
        availableInlineSize,
        line.ownerBlockId,
        line.inlineOffsetStart,
        line.inlineOffsetEnd,
        line.isBlockBoundaryLine,
        line.endsWithHyphenContinuation,
      );
    }
    const rebasedSuffix: LineBox[] = [];
    if (startLine === 0) {
      // No resume — the wrap-pass lines already start at `blockOffset`.
      rebasedSuffix.push(...linesToConsider);
    } else {
      let cursorY = blockOffset;
      for (const line of linesToConsider) {
        rebasedSuffix.push(rebaseLine(line, cursorY));
        cursorY += line.blockSize;
      }
    }

    if (placedLineCount < linesToConsider.length) {
      // Partial fit: build a BlockBox with the placed suffix slice.
      const placedLines = rebasedSuffix.slice(0, placedLineCount);
      const placedUsedStyle = computeUsedStyle(parentCs, availableInlineSize, "indefinite");
      const placedBox = createBlockBox(
        parent.key,
        inlineOffset,
        blockOffset,
        availableInlineSize,
        usedAdjusted,
        writingMode,
        direction,
        parentCs,
        placedUsedStyle,
        placedLines,
        availableInlineSize,
      );
      return { box: placedBox, breakToken: { type: "ifc", resumeAtLine: startLine + placedLineCount, paraFlowStart }, inFlowConsumed: usedAdjusted };
    }

    // All suffix lines placed — emit them and return no break token.
    const allSuffixUsedStyle = computeUsedStyle(parentCs, availableInlineSize, "indefinite");
    const allSuffixBox = createBlockBox(
      parent.key,
      inlineOffset,
      blockOffset,
      availableInlineSize,
      usedAdjusted,
      writingMode,
      direction,
      parentCs,
      allSuffixUsedStyle,
      rebasedSuffix,
      availableInlineSize,
    );
    return { box: allSuffixBox, breakToken: null, inFlowConsumed: usedAdjusted };
  }

  // E-E.1: use `resultLines` (which has the isBlockBoundaryLine patch
  // applied to the last line) rather than `result` (pre-patch), so the
  // BlockBox's children agree with the cache. Otherwise a cache hit on
  // a subsequent layout pass returns the patched lines while the
  // BlockBox would have the pre-patch lines on a fresh build, breaking
  // ref-equality contracts.
  const totalBlockSize = resultLines.reduce((acc, l) => Math.max(acc, l.blockOffset + l.blockSize - blockOffset), 0);
  const parentUsedStyleForBox = computeUsedStyle(parentCs, availableInlineSize, "indefinite");
  const box = createBlockBox(parent.key, inlineOffset, blockOffset, availableInlineSize, totalBlockSize, writingMode, direction, parentCs, parentUsedStyleForBox, resultLines, availableInlineSize);
  return { box, breakToken: null, inFlowConsumed: totalBlockSize };
  } finally {
    markEnd("ifc.layout", tLayout);
  }
}

/**
 * Block-axis baseline shift fractions for `vertical-align: super` / `sub`,
 * expressed as a multiple of the PARENT's used font-size (CSS Inline 3
 * baseline-shift: "raise by one third of the parent's used font-size" /
 * "drop by one fifth of the parent's used font-size"). Using the parent's
 * size (not the child's) is what makes a `<sup>` carrying `font-size: smaller`
 * still raise by the full parent-relative amount — matching browsers. Browsers
 * derive the exact fraction from font metrics where available; these fixed
 * fractions match Chrome/Firefox closely for the common sans/serif faces and
 * give a faithful, reviewable raise/lower. The footnote call-marker relies on
 * `SUPERSCRIPT_RAISE_FRACTION`.
 *
 * `super` RAISES the box (block-axis offset DECREASES — up the page);
 * `sub` LOWERS it (offset INCREASES). Neither changes the box's size —
 * the smaller glyphs of a `<sup>`/`<sub>` come from a separate
 * `font-size: smaller`, resolved earlier in the cascade.
 */
export const SUPERSCRIPT_RAISE_FRACTION = 0.34;
export const SUBSCRIPT_LOWER_FRACTION = 0.2;

/**
 * The baseline-aligned block-axis offset for an inline child within a line.
 * Approximation: parent baseline sits at `lineBlockSize * 0.8`; the child's
 * own baseline sits at `child.blockSize * 0.8`. Positioning the child so its
 * baseline coincides with the line's baseline yields this offset. `super`/`sub`
 * shift relative to THIS baseline position.
 */
function baselineBlockOffset(lineBlockSize: number, childBlockSize: number): number {
  return lineBlockSize * 0.8 - childBlockSize * 0.8;
}

/**
 * Reposition inline children inside a line according to their `verticalAlign`.
 *
 * The computed block-axis position is a LOGICAL offset relative to the
 * line's content-box origin (block-axis = vertical under `horizontal-tb`).
 * We update `blockOffset` and let the factory derive `y`; spread-patching
 * physical `y` while leaving `blockOffset` stale would break the
 * logical↔physical invariant.
 *
 * @param containingInlineSize the line's inline-size — i.e. the children's
 *   containing-block inline-size. Required for the factory's physical-x
 *   derivation under RTL.
 * @param parentFontSize the line's (parent's) used font-size — the `super`/`sub`
 *   baseline shift is a fraction of THIS, per CSS Inline 3 (not the child's
 *   font-size, so a `<sup font-size:smaller>` still raises the full amount).
 */
function applyVerticalAlign(
  children: readonly LayoutBox[],
  lineBlockSize: number,
  containingInlineSize: number,
  parentFontSize: number,
): LayoutBox[] {
  return children.map((c) => {
    const va = c.computedStyle.verticalAlign;
    let newBlockOffset: number;
    switch (va) {
      case "top":
        newBlockOffset = 0;
        break;
      case "middle":
        newBlockOffset = (lineBlockSize - c.blockSize) / 2;
        break;
      case "bottom":
        newBlockOffset = lineBlockSize - c.blockSize;
        break;
      case "super":
        // Baseline-align, then RAISE by a fraction of the PARENT's font-size
        // (up = smaller offset). Parent-relative per CSS Inline 3, so a `<sup>`
        // with `font-size: smaller` still raises by the full amount. Baseline-
        // only shift: the box keeps its size (no resize here).
        newBlockOffset =
          baselineBlockOffset(lineBlockSize, c.blockSize) -
          parentFontSize * SUPERSCRIPT_RAISE_FRACTION;
        break;
      case "sub":
        // Baseline-align, then LOWER by a fraction of the PARENT's font-size
        // (down = larger offset).
        newBlockOffset =
          baselineBlockOffset(lineBlockSize, c.blockSize) +
          parentFontSize * SUBSCRIPT_LOWER_FRACTION;
        break;
      case "baseline":
      default:
        if (c.type === "inline-block" && c.isReplaced === true) {
          // CSS2 §10.8.1: a REPLACED inline-block (an image — no in-flow line
          // boxes, no text baseline) aligns its BOTTOM margin edge with the
          // parent's baseline. The whole box sits above the baseline, so its
          // top (blockOffset) is `lineBlockSize*0.8 − blockSize` (vs the *0.8
          // content-baseline rule used for text-bearing inline-blocks).
          newBlockOffset = lineBlockSize * 0.8 - c.blockSize;
        } else {
          newBlockOffset = baselineBlockOffset(lineBlockSize, c.blockSize);
        }
        break;
    }
    if (c.blockOffset === newBlockOffset) return c;
    const repositioned = withBlockOffset(c, newBlockOffset, containingInlineSize);
    assertLayoutBoxConsistent(repositioned, containingInlineSize);
    return repositioned;
  });
}

function buildLineWithFragments(
  parentKey: string,
  lineIndex: number,
  lineInlineCursor: number,
  lineBlockOffset: number,
  lineInlineSize: number,
  units: readonly WrapUnit[],
  parentCs: ComputedStyle,
  measurer: TextMeasurer,
  writingMode: WritingMode,
  direction: Direction,
  containingInlineSize: number,
  hyphenBreak: HyphenBreak | null,
  shaper: TextShaper,
  ownerBlockId: BlockId,
  inlineOffsetStart: number,
  inlineOffsetEnd: number,
  // #333: alignment offset applied to the children's line-relative origin so
  // the LINE itself spans the full inline size (`lineInlineCursor` stays at
  // the natural inline-start). `logicalToPhysical` then mirrors the line
  // correctly under RTL — content lands at the right physical position for
  // end/center under both directions. See the design doc:
  // docs/superpowers/specs/2026-05-28-textalign-rtl-fullwidth-line-design.md.
  alignmentOffset: number = 0,
  // P4-C: the paragraph's resolved bidi levels (resolved once per paragraph in
  // `layoutInlineContent`). `null` for an empty/source-less paragraph. The line
  // derives its own U16 source span from `units` and passes both to
  // `reorderLineForBidi`, which fast-paths to identity when the line is pure-LTR.
  paragraphBidi: ParagraphBidi | null = null,
): LineBox {
  const parentUsedStyle = computeUsedStyle(parentCs, containingInlineSize, "indefinite");
  const lineBlockSizeTracker = { value: 0 };
  // `originInlineOffset = alignmentOffset` is the PHYSICAL position where this
  // level's content begins within the line; `buildLineChildrenForAncestorLevel`
  // uses it ONLY to compare a hung trailing space's PHYSICAL position against
  // `lineInlineSize` for the #338/#340 clamp. Box-positioning (each child's
  // own `inlineOffset` within the line) is still LEVEL-RELATIVE — see the
  // post-build shift below.
  let children = buildLineChildrenForAncestorLevel(
    parentKey, lineIndex, units, 0, measurer, lineBlockSizeTracker, writingMode, direction, lineInlineSize,
    /* originInlineOffset */ alignmentOffset,
  );

  // Append synthetic hyphen TextRunBox when this line ends at a hyphen break.
  if (hyphenBreak !== null) {
    const hyphenRun = shaper.shape("-", hyphenBreak.style, direction);
    const hyphenInlineSize = hyphenRun.clusters.reduce((s, c) => s + c.inlineAdvance, 0);
    const hyphenBlockSize = hyphenRun.ascent + hyphenRun.descent + hyphenRun.lineGap;
    lineBlockSizeTracker.value = Math.max(lineBlockSizeTracker.value, hyphenBlockSize);

    // Inline offset: sum of existing children's sizes (level-relative, like
    // every other top-level child). The post-build shift below adds the
    // alignment offset uniformly.
    const cursorInlineOffset = children.reduce((s, c) => s + c.inlineSize, 0);
    const hyphenUsedStyle = computeUsedStyle(hyphenBreak.style, lineInlineSize, "indefinite");
    const hyphenBox = createTextRunBox(
      `${hyphenBreak.sourceKey}:hyphen-${lineIndex}`,
      cursorInlineOffset, 0, hyphenInlineSize, hyphenBlockSize,
      writingMode, direction,
      hyphenBreak.style, hyphenUsedStyle,
      "-",
      // The synthetic hyphen glyph has no backing state character; it owns
      // zero state offsets so cursor accounting skips over it.
      /* offsetLength */ 0,
      /* containingInlineSize */ lineInlineSize,
      /* sourceDisplayLengths */ undefined,
      // The hyphen owns no source span and is never a bidi-split target —
      // leave clusterWidths/sourceStart undefined (P4-C skips it).
      /* clusterWidths */ undefined,
      /* sourceStart */ undefined,
      /* bidiLevel */ undefined,
      /* containingBlockSize */ undefined,
      /* link — inherit the split word's link (#521 PDF /Link) */ hyphenBreak.link,
    );
    children = [...children, hyphenBox];
  }

  // CSS Text 3 §8.1 caret-edge trim: the trailing tracking of the line's last
  // typographic unit is removed so the end-of-line caret + the last selection
  // rect (both of which sum leaf advances) land at the trimmed content edge —
  // matching the `contentWidth` trim `flushLine` applies for alignment. Skip
  // hyphenated lines: the visible edge is the synthetic hyphen glyph (whose
  // own tracking ≠ the word's), and the line continues on the next line so the
  // end-of-line caret semantics don't apply. `trim` is 0 under the default
  // (`letter-spacing: normal`) → this block is inert (the normal-identity
  // contract). The last unit is always a text-run leaf (trailing tracking sits
  // after a glyph; trailing spaces are excluded from the content edge by
  // `flushLine`'s trailing-space trim, and a space leaf carries away its own
  // tracking).
  const trim = hyphenBreak === null ? trailingLetterSpacingOf(units) : 0;
  if (trim > 0 && children.length > 0) {
    // Walk children backward to the last RETAINED glyph leaf and shrink it by
    // `trim`. `trimTrailingLetterSpacing` IS the skip oracle: it returns the
    // rebuilt box for a trimmable glyph leaf (a top-level `text-run`, OR an
    // InlineBox whose last glyph is nested inside a `display:inline` element,
    // e.g. `<em>word</em>` at the line end — #434), and `undefined` for a box
    // that carries no trimmable trailing glyph (a whitespace-only `text-run` —
    // the hung trailing space that lands AFTER the word leaf under
    // `break-spaces`; an all-whitespace InlineBox like `<em> </em>`; or an
    // atomic inline-block/marker). Advance past every `undefined` so the trim
    // lands on the same glyph `trailingLetterSpacingOf` measured at the unit
    // level. For an InlineBox it recurses to the innermost trailing glyph and
    // shrinks BOTH that leaf and every enclosing InlineBox by `trim`.
    // Every line-tree box is built with `containingInlineSize: lineInlineSize`
    // (see buildLineChildrenForAncestorLevel), which isn't stored on the box,
    // so re-pass it here; inlineSize-only reductions don't change physical-coord
    // derivation for LTR, and for RTL the reduced inline extent re-mirrors
    // correctly off the same containing size.
    let trimIdx = children.length - 1;
    let rebuilt: LayoutBox | undefined;
    while (trimIdx >= 0) {
      const trimChild = children[trimIdx];
      if (trimChild === undefined) throw new Error(`ifc: trim children[${trimIdx}] missing (unreachable)`);
      rebuilt = trimTrailingLetterSpacing(trimChild, trim, lineInlineSize);
      if (rebuilt !== undefined) break;
      trimIdx--;
    }
    if (rebuilt !== undefined) {
      children = [...children.slice(0, trimIdx), rebuilt, ...children.slice(trimIdx + 1)];
    }
  }

  const lineBlockSize = lineBlockSizeTracker.value > 0 ? lineBlockSizeTracker.value : measurer.measureHeight(parentCs);

  // #333: shift every top-level child by `alignmentOffset` so the content sits
  // at the right inline position within the (full-width) line. `buildLineChildren`
  // packs children from `cursorInlineOffset=0` (level-relative); the shift
  // applies once, uniformly, AT THE TOP LEVEL. Recursive levels (inside
  // InlineBoxes) don't need shifting — their parent inline-box's inlineOffset
  // already carries the alignment, and their own children stay parent-relative.
  // logicalToPhysical re-derives each shifted box's physical x; under RTL the
  // shift composes correctly with the inline-axis flip.
  if (alignmentOffset !== 0) {
    children = children.map(c =>
      withInlineOffset(c, c.inlineOffset + alignmentOffset, lineInlineSize),
    );
  }

  const aligned = applyVerticalAlign(children, lineBlockSize, lineInlineSize, parentCs.fontSize);
  // P4-C: derive this line's U16 source span from its wrap units, then reorder
  // by the paragraph's bidi levels. The fast path no-ops for pure-LTR lines.
  const lineSourceRange = deriveLineSourceRangeU16(units);
  const reordered = reorderLineForBidi(
    aligned,
    lineInlineSize,
    paragraphBidi,
    lineSourceRange?.startU16 ?? -1,
    lineSourceRange?.endU16 ?? -1,
    alignmentOffset,
    direction,
  );
  return createLineBox(`${parentKey}-l${lineIndex}`, lineInlineCursor, lineBlockOffset, lineInlineSize, lineBlockSize, writingMode, direction, parentCs, parentUsedStyle, reordered,
    /* baseline */ lineBlockSize,
    /* containingInlineSize */ containingInlineSize,
    /* ownerBlockId */ ownerBlockId,
    /* inlineOffsetStart */ inlineOffsetStart,
    /* inlineOffsetEnd */ inlineOffsetEnd,
    /* isBlockBoundaryLine — stamped later if this line ends the block */ false,
    /* endsWithHyphenContinuation */ hyphenBreak !== null ? true : undefined,
  );
}

/**
 * Walk wrap units at a given inline-ancestor depth. Units at this level (no deeper ancestor)
 * become TextRunBoxes; consecutive runs of units that share an ancestor at `depth` get
 * grouped into an InlineBox containing the recursive result.
 *
 * `originInlineOffset` is the accumulated PHYSICAL (line-relative) inline position
 * where THIS build level begins. The top-level call passes 0 (its children are
 * line-relative); a recursive call for an inline element passes the physical
 * position where that element's box sits (so its inner children's frame is
 * `originInlineOffset` from the line origin). The hung-SPACE clamp (#338 P2 / #340)
 * compares the box's PHYSICAL position (`originInlineOffset + cursorInlineOffset`)
 * against `lineInlineSize` — without the origin, a recursive call would compare an
 * INNER-relative offset and miss a trailing space that hangs past the line content
 * edge (#340: `<em>word   </em>` at the edge).
 */
function buildLineChildrenForAncestorLevel(
  parentKey: string,
  lineIndex: number,
  units: readonly WrapUnit[],
  depth: number,
  measurer: TextMeasurer,
  lineBlockSizeTracker: { value: number },
  writingMode: WritingMode,
  direction: Direction,
  lineInlineSize: number,
  originInlineOffset: number,
): LayoutBox[] {
  const out: LayoutBox[] = [];
  let cursorInlineOffset = 0;
  let i = 0;

  // Track per-source-key run counters for text run box keys.
  // Keys follow the pattern `{sourceKey}:{runIdx}` so that cursor-position.ts
  // can match by state node id.
  const runCounters: Record<string, number> = {};

  while (i < units.length) {
    const unit = units[i];
    if (unit === undefined) throw new Error(`ifc: buildLineChildren unit ${i} missing (unreachable)`);

    if (unit.inlineAncestors.length <= depth) {
      const firstTok = unit.tokens[0];
      if (firstTok === undefined) throw new Error("ifc: wrap unit has no tokens (unreachable)");
      const unitWidth = unit.tokens.reduce((sum, t) => sum + t.width, 0);
      const tokStyle = firstTok.style;

      if (firstTok.inlineBlock) {
        // Inline-block atomic unit — emit an InlineBlockBox.
        const ib = firstTok.inlineBlock;
        const ibBlockSize = ib.blockSize;
        lineBlockSizeTracker.value = Math.max(lineBlockSizeTracker.value, ibBlockSize);
        const ibUsedStyle = computeUsedStyle(tokStyle, lineInlineSize, "indefinite");
        out.push(createInlineBlockBox(
          `${parentKey}-l${lineIndex}-ib${out.length}-${ib.key}`,
          cursorInlineOffset, 0, unitWidth, ibBlockSize, writingMode, direction, tokStyle, ibUsedStyle, ib.children,
          /* containingInlineSize */ lineInlineSize,
          /* sourceStart — the OBJECT_REPLACEMENT char's absolute source offset */ firstTok.absoluteSourceBase,
          /* bidiLevel */ undefined,
          /* containingBlockSize */ undefined,
          // Tab stops S2/S3: stamp typed tab metadata onto the recognized tab
          // box. The destination-stop leader is resolved at the overflow-check
          // seam (S3) and carried on `firstTok.tabLeader`; absent (the S2
          // zero-advance sentinel, or a default-grid stop) defaults to "none".
          firstTok.isTab === true
            ? { embedType: "tab", leader: firstTok.tabLeader ?? "none" }
            : undefined,
          /* relativeOffset */ undefined,
          /* targetId */ ib.targetId,
          /* isReplaced */ ib.isReplaced,
        ));
      } else {
        // Regular token — emit a TextRunBox (merging tokens in the unit).
        const text = unit.tokens.map(t => t.text).join("");
        // State-character span this run owns: the SUM of its tokens'
        // sourceLength (each token's rendered chars + any collapsed-away
        // trailing whitespace it absorbed). This is ≥ the rendered text length
        // and is what the cursor layer uses to keep offsets state-aligned.
        const offsetLength = unit.tokens.reduce((sum, t) => sum + t.sourceLength, 0);

        // text-transform leaf concat: build the per-SOURCE-code-unit → display-
        // code-unit length map for the WHOLE run by concatenating each token's
        // map. Only materialized when some token actually grew/shrank (a token
        // carries `sourceDisplayLengths` only then); otherwise the run is 1:1
        // and the field stays undefined (the existing fast path). For each token
        // we push its rendered source-unit lengths, then one `0` per collapsed-
        // away whitespace unit it absorbed (`sourceLength − renderedSourceUnits`)
        // so the leaf map's length equals `offsetLength` (the state span).
        let leafSDL: number[] | undefined;
        if (unit.tokens.some(t => t.sourceDisplayLengths)) {
          leafSDL = [];
          for (const t of unit.tokens) {
            const sdl = t.sourceDisplayLengths ?? new Array<number>(t.text.length).fill(1);
            leafSDL.push(...sdl);
            const collapsed = t.sourceLength - sdl.length;
            for (let k = 0; k < collapsed; k++) leafSDL.push(0);
          }
        }

        // Per-DISPLAY-code-unit advances for the WHOLE run, used by the P4-C
        // bidi reorder to split the box at a level boundary. Built by
        // concatenating each token's `clusterWidths` — SAME partition shape as
        // `leafSDL` above, but over DISPLAY code units (`t.text.length`), not
        // the state span. Whitespace tokens carry NO token-level clusterWidths
        // (gated at tokenization), so synthesize them: one entry per display
        // code unit, the token's whole advance on the first unit and 0 on the
        // rest (mirroring the first-unit-full / interior-0 grapheme attribution
        // the non-whitespace clusterWidths loop uses). Invariant:
        // `clusterWidths.length === text.length` (the assembled box text).
        const clusterWidths: number[] = [];
        for (const t of unit.tokens) {
          if (t.clusterWidths) {
            clusterWidths.push(...t.clusterWidths);
          } else {
            for (let k = 0; k < t.text.length; k++) {
              clusterWidths.push(k === 0 ? t.width : 0);
            }
          }
        }
        const sourceStart = firstTok.absoluteSourceBase;

        const tokBlockSize = measurer.measureHeight(tokStyle);
        lineBlockSizeTracker.value = Math.max(lineBlockSizeTracker.value, tokBlockSize);

        const runIdx = runCounters[unit.sourceKey] ?? 0;
        runCounters[unit.sourceKey] = runIdx + 1;
        const runKey = `${unit.sourceKey}:${runIdx}`;

        const tokUsedStyle = computeUsedStyle(tokStyle, lineInlineSize, "indefinite");

        // #338 P2 / #340 — clamp a HUNG SPACE box's physical geometry to the line
        // content edge (`lineInlineSize`, line-relative). A trailing/interior
        // space that hangs past the edge (P1) must not draw, position the caret,
        // or extend selection past it. Clamp ONLY space boxes — a word/inline
        // unit that overflows (a force-placed unbreakable word wider than the
        // line) legitimately overflows per CSS and must NOT be clipped. The clamp
        // is physical only: `offsetLength` (state span) is unchanged, and the
        // running `cursorInlineOffset` advances by the NATURAL `unitWidth` below
        // (so a following word still wraps and stacked past-edge spaces each pin
        // to the edge with width 0). A straddling space draws partial width up to
        // the edge.
        //
        // #340: `cursorInlineOffset` is relative to THIS build level's frame,
        // which for a recursive inline-element call is offset from the line origin
        // by `originInlineOffset`. The clamp compares the PHYSICAL position
        // `physBase = originInlineOffset + cursorInlineOffset` against
        // `lineInlineSize`. The written `inlineOffset` stays PARENT-RELATIVE (so
        // it composes with the enclosing InlineBox's own `x`); clamping it so
        // `originInlineOffset + writeInlineOffset ≤ lineInlineSize` pins a
        // fully-past-edge inner space to the physical content edge with width 0.
        const isSpaceBox = firstTok.isSpace;
        const physBase = originInlineOffset + cursorInlineOffset;
        const writeInlineOffset = isSpaceBox
          ? Math.min(cursorInlineOffset, Math.max(0, lineInlineSize - originInlineOffset))
          : cursorInlineOffset;
        const writeWidth = isSpaceBox
          ? Math.max(0, Math.min(unitWidth, lineInlineSize - physBase))
          : unitWidth;
        out.push(createTextRunBox(
          runKey,
          writeInlineOffset, 0, writeWidth, tokBlockSize, writingMode, direction, tokStyle, tokUsedStyle, text,
          offsetLength,
          /* containingInlineSize */ lineInlineSize,
          /* sourceDisplayLengths */ leafSDL,
          /* clusterWidths */ clusterWidths,
          /* sourceStart */ sourceStart,
          /* bidiLevel */ undefined,
          /* containingBlockSize */ undefined,
          /* link */ firstTok.link,
        ));
      }
      cursorInlineOffset += unitWidth;
      i++;
      continue;
    }

    // Group consecutive units that share the same ancestor at `depth`.
    // We reached the else-branch because `unit.inlineAncestors.length > depth`,
    // so `[depth]` is present on both the key and the style arrays.
    const ancestorKey = unit.inlineAncestors[depth];
    const ancestorStyle = unit.inlineAncestorStyles[depth];
    if (ancestorKey === undefined || ancestorStyle === undefined) {
      throw new Error(`ifc: buildLineChildren ancestor at depth ${depth} missing (unreachable)`);
    }
    let j = i;
    while (j < units.length) {
      const ju = units[j];
      if (ju === undefined) throw new Error(`ifc: buildLineChildren group unit ${j} missing (unreachable)`);
      if (ju.inlineAncestors.length <= depth || ju.inlineAncestors[depth] !== ancestorKey) break;
      j++;
    }

    const innerUnits = units.slice(i, j);
    const innerBlockSizeTracker = { value: 0 };
    const innerChildren = buildLineChildrenForAncestorLevel(
      parentKey, lineIndex, innerUnits, depth + 1,
      measurer, innerBlockSizeTracker, writingMode, direction, lineInlineSize,
      // #340: the inline element's box sits at the PHYSICAL position
      // `originInlineOffset + cursorInlineOffset` (this level's frame plus the
      // accumulated offset before the box) — its inner children's clamp edge is
      // measured from there.
      /* originInlineOffset */ originInlineOffset + cursorInlineOffset,
    );

    const boxInlineSize = innerChildren.reduce((acc, c) => acc + c.inlineSize, 0);
    const boxBlockSize = innerBlockSizeTracker.value > 0 ? innerBlockSizeTracker.value : measurer.measureHeight(ancestorStyle);
    lineBlockSizeTracker.value = Math.max(lineBlockSizeTracker.value, boxBlockSize);

    const ancestorUsedStyle = computeUsedStyle(ancestorStyle, lineInlineSize, "indefinite");
    // For B.2, hardcode fragmentEdge to "only". B.3 fixes cross-line resolution.
    out.push(createInlineBox(
      `${parentKey}-l${lineIndex}-i${out.length}-${ancestorKey}`,
      cursorInlineOffset, 0, boxInlineSize, boxBlockSize, writingMode, direction, ancestorStyle, ancestorUsedStyle, innerChildren, "only",
      ancestorKey, // L-C: store explicitly; do not derive from box.key
      /* containingInlineSize */ lineInlineSize,
    ));
    // `boxInlineSize` is the sum of the (possibly clamped) inner child widths, so
    // this under-advances when an inline element's trailing spaces clamped to 0.
    // Safe: a space is only clamped once its physical position reaches
    // `lineInlineSize`, which means the greedy wrap loop's `currentWidth` (summed
    // from NATURAL unit widths) is already ≥ `lineInlineSize` — so any following
    // non-space unit overflows and wraps to the next line. Hence no content can
    // follow a clamped inline trailing space on the SAME line, and the under-advance
    // is never observable.
    cursorInlineOffset += boxInlineSize;
    i = j;
  }

  return out;
}

/**
 * Walk the lines list and assign correct fragmentEdges per InlineBox.
 * The same inline element can appear as InlineBox children of multiple lines
 * (because the inline content wrapped); each fragment gets first/middle/last/only
 * based on which lines contain it.
 */
function assignFragmentEdges(lines: LayoutBox[]): LayoutBox[] {
  // Phase 1: tally line indices per inline-ancestor key.
  const lineIndicesByAncestor = new Map<string, number[]>();
  lines.forEach((line, idx) => {
    if (line.type !== "line") return;
    visitInlineBoxes(line.children, (inline) => {
      const ancestor = inline.ancestorKey;
      const arr = lineIndicesByAncestor.get(ancestor) ?? [];
      if (!arr.includes(idx)) arr.push(idx);
      lineIndicesByAncestor.set(ancestor, arr);
    });
  });

  // Phase 2: rebuild each line with corrected fragmentEdges.
  //
  // The spread-and-cast below is INTENTIONALLY NOT routed through
  // `withInlineOffset`/`withBlockOffset`/`createLineBox`. It mutates ONLY
  // `children` — not `inlineOffset`, `blockOffset`, `inlineSize`, or
  // `blockSize`. The logical↔physical position invariant (the one L-A
  // introduced `assertLayoutBoxConsistent` to protect) is untouched here,
  // so this pattern is safe.
  //
  // If a future change to this site mutates a position field, route it
  // through a `with*` helper instead — and add an `assertLayoutBoxConsistent`
  // check, as in `bfc.ts`'s float-placement site and `ifc.ts`'s
  // `applyVerticalAlign`.
  //
  // E-E.1: the spread also propagates the LineBox-canonical fields
  // (`ownerBlockId`, `inlineOffsetStart/End`, `isBlockBoundaryLine`)
  // because they are enumerable own-properties on the source LineBox.
  // If a future change routes this through `createLineBox` instead,
  // those four fields must be passed explicitly via the factory's
  // new positional arguments — or they will be silently dropped.
  return lines.map((line, idx) => {
    if (line.type !== "line") return line;
    const newChildren = line.children.map((c) => correctFragmentEdge(c, idx, lineIndicesByAncestor));
    return Object.freeze({ ...line, children: Object.freeze(newChildren) }) as LayoutBox;
  });
}

function visitInlineBoxes(children: readonly LayoutBox[], visit: (b: InlineBox) => void): void {
  for (const c of children) {
    if (c.type === "inline") {
      visit(c);
      visitInlineBoxes(c.children, visit);
    }
  }
}

/**
 * Reorder a line's child boxes for visual presentation per their bidi
 * levels. Plan 3.C ships uniform-level reordering (all children share the
 * same level — produced by mock/canvas shapers). Mixed-level reordering
 * (Unicode Bidi Algorithm L1–L3) lands in a later plan when bidi-aware
 * shapers ship.
 *
 * @param children logical-order children, each with an `inlineOffset`
 *   placing it within the line.
 * @param lineInlineSize the line's inline-extent.
 * @returns children in visual order with rewritten `inlineOffset`s.
 */
/**
 * The half-open U16 source span `[startU16, endU16)` a line covers in the
 * assembled paragraph source (`IfcSourceAssembly.source`). Both ends are
 * UTF-16 code-unit offsets into that source — the SAME coordinate space as
 * `Token.absoluteSourceBase` and `ParagraphBidi.cpIndexAtUtf16`.
 */
export interface LineSourceRangeU16 {
  /** First U16 offset the line covers (the first real token's base). */
  readonly startU16: number;
  /**
   * One-past-the-last U16 offset the line covers (EXCLUSIVE) — the last real
   * token's base plus its DISPLAY length. "Display" (not state) length so a
   * line ending in collapsed/hung trailing whitespace still extends the span
   * to the visible edge (for a single-line paragraph this equals
   * `source.length`).
   */
  readonly endU16: number;
}

/**
 * Structural view of a wrap unit that {@link deriveLineSourceRangeU16} consumes.
 * The full {@link WrapUnit} is assignable to this; declaring the narrow shape
 * keeps the helper unit-testable without constructing a complete `WrapUnit`.
 */
export interface LineRangeUnit {
  readonly tokens: readonly { readonly absoluteSourceBase: number; readonly text: string }[];
}

/**
 * Derive a line's half-open U16 source range from its wrap units.
 *
 * The start is the FIRST real token's `absoluteSourceBase`; the end is the LAST
 * real token's `absoluteSourceBase + text.length` (an EXCLUSIVE display-U16
 * offset — `text` is the DISPLAY string, so trailing collapsed/hung whitespace
 * folded into a token's display extends the span to the visible edge).
 *
 * "Real" excludes synthetic tokens (the hyphen glyph is appended AFTER this in
 * `buildLineWithFragments`, never inside `units`, but a defensive empty-tokens
 * unit is skipped). A line with no real tokens (empty/strut-only flush) returns
 * `null` so `reorderLineForBidi` no-ops via its fast path.
 *
 * Note: `text.length` is the DISPLAY length, never `sourceLength` (the
 * state-model count). The bidi levels are indexed over the same DISPLAY source
 * the IFC assembled, so the display span is the correct query window.
 */
export function deriveLineSourceRangeU16(
  units: readonly LineRangeUnit[],
): LineSourceRangeU16 | null {
  let startU16 = -1;
  let endU16 = -1;
  for (const unit of units) {
    for (const tok of unit.tokens) {
      if (startU16 < 0) startU16 = tok.absoluteSourceBase;
      // The end advances with EVERY real token; the last one wins. Using the
      // token's display `text.length` (not `sourceLength`) keeps the end on the
      // display-U16 axis the bidi levels are indexed in.
      endU16 = tok.absoluteSourceBase + tok.text.length;
    }
  }
  if (startU16 < 0) return null;
  return { startU16, endU16 };
}

function reorderLineForBidi(
  children: readonly LayoutBox[],
  lineInlineSize: number,
  paragraphBidi: ParagraphBidi | null,
  lineSourceStartU16: number,
  lineSourceEndU16: number,
  alignmentOffset: number,
  direction: Direction,
): LayoutBox[] {
  if (children.length === 0) return [];

  // FAST PATH (P4-C.1 T3): a line needs no reorder when the paragraph has no
  // bidi resolution (empty/source-less) OR the paragraph base is LTR (level 0)
  // AND no codepoint in THIS line's source span carries an RTL (level > 0)
  // embedding. This covers the overwhelmingly common pure-LTR case at zero
  // allocation — just a tight scan of the line's level slice. The fast path is
  // IDENTITY: under LTR the incoming `children` are already physical-correct
  // (logical == physical, alignment pre-shift applied at the call site), so
  // pure-LTR content is byte-identical to pre-P4-C.
  if (paragraphBidi === null) {
    return [...children];
  }
  // A strut-only / empty-source line (degenerate range) carries no real text to
  // reorder — identity.
  if (lineSourceStartU16 < 0 || lineSourceEndU16 < 0) {
    return [...children];
  }
  // Map the line's U16 span to the codepoint index space, clamped into the valid
  // `cpIndexAtUtf16` range. Needed both for the LTR fast-path scan and for the
  // reorder's `applyL1` window below.
  const maxU16 = paragraphBidi.cpIndexAtUtf16.length - 1;
  const startU16 = Math.min(lineSourceStartU16, maxU16);
  const endU16 = Math.min(lineSourceEndU16, maxU16);
  const lineStartCp = paragraphBidi.cpIndexAtUtf16[startU16];
  const lineEndCp = paragraphBidi.cpIndexAtUtf16[endU16];
  if (lineStartCp === undefined || lineEndCp === undefined) {
    throw new Error("ifc: bidi line cp index out of range (unreachable; startU16/endU16 clamped to maxU16)");
  }

  if (paragraphBidi.paragraphLevel === 0) {
    // Scan the line's level slice for any RTL run.
    let hasRtl = false;
    for (let cp = lineStartCp; cp < lineEndCp; cp++) {
      const level = paragraphBidi.levels[cp];
      if (level !== undefined && level > 0) {
        hasRtl = true;
        break;
      }
    }
    if (!hasRtl) {
      // Pure-LTR line under an LTR paragraph — identity, same as before P4-C.
      return [...children];
    }
  }

  // REORDER PATH (P4-C.1 T6): the line carries RTL content (or an RTL paragraph
  // base). Produce real UAX #9 L1/L2 visual order via `reorderLineLeaves`, which
  // emits VISUAL-ORDER boxes packed-from-0 on the LOGICAL inline axis, positioned
  // `direction:"ltr"` so `logicalToPhysical` applies no RTL inline-flip. That
  // inline offset then maps to the active physical inline axis (X for
  // horizontal-tb — so `x === inlineOffset`; Y for vertical). The line's alignment
  // is applied as an inline-axis offset, mapping the logical `alignmentOffset`
  // through `logicalToPhysical` for the line's base `direction`. (The "physical
  // start" / "x" naming below is the horizontal-tb projection; the computation is
  // on the inline-OFFSET axis and is writing-mode-general.)
  //
  // Note: the incoming `children` were pre-shifted by `alignmentOffset` (LOGICAL)
  // at the call site, but `reorderLineLeaves` repacks from 0 (it ignores incoming
  // offsets for ordering), so we recompute the physical start fresh from
  // `alignmentOffset`; we do NOT re-add the incoming logical shift.
  const postL1 = applyL1(
    paragraphBidi.levels,
    paragraphBidi.types,
    paragraphBidi.paragraphLevel,
    lineStartCp,
    lineEndCp,
  );
  const reordered = reorderLineLeaves(
    children,
    paragraphBidi,
    lineStartCp,
    postL1,
    lineInlineSize,
  );
  const contentWidth = reordered.reduce((sum, c) => sum + c.inlineSize, 0);
  // Map the logical alignment origin to a physical start. Equivalent to
  // logicalToPhysical({ inlineOffset: alignmentOffset, inlineSize: contentWidth },
  // …, direction, lineInlineSize).x — LTR identity, RTL inline-axis flip.
  const physicalStart =
    direction === "ltr"
      ? alignmentOffset
      : lineInlineSize - alignmentOffset - contentWidth;
  if (physicalStart === 0) {
    return reordered;
  }
  // Shift every top-level reordered box by the physical start. The boxes are
  // ltr-positioned (identity), so `x` tracks `inlineOffset + physicalStart`.
  return reordered.map(child =>
    withInlineOffset(child, child.inlineOffset + physicalStart, lineInlineSize),
  );
}

function correctFragmentEdge(
  box: LayoutBox,
  lineIdx: number,
  lineIndicesByAncestor: Map<string, number[]>,
): LayoutBox {
  if (box.type !== "inline") return box;
  const ancestor = box.ancestorKey;
  const indices = lineIndicesByAncestor.get(ancestor) ?? [lineIdx];
  let edge: "first" | "middle" | "last" | "only";
  if (indices.length === 1) edge = "only";
  else if (lineIdx === indices[0]) edge = "first";
  else if (lineIdx === indices[indices.length - 1]) edge = "last";
  else edge = "middle";

  const newChildren = box.children.map((c) => correctFragmentEdge(c, lineIdx, lineIndicesByAncestor));
  // Spread-and-cast safe here: this mutates only `children` and
  // `fragmentEdge`, neither of which is part of the logical↔physical
  // position invariant L-A protects. If a future change mutates a
  // position field, switch to `withBlockOffset` / `withOffsets` and add
  // an `assertLayoutBoxConsistent` check.
  return Object.freeze({ ...box, children: Object.freeze(newChildren), fragmentEdge: edge }) as LayoutBox;
}

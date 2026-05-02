import type { RenderNode } from "../render/render-node-v2";
import type { ElementBox } from "../render/render-node-v2";
import type { ComputedStyle } from "../styles";
import type { LayoutBox, LineBox, InlineBox, BlockBox } from "./layout-box-v2";
import { createInlineBox, createInlineBlockBox, createLineBox, createTextRunBox, withInlineOffset, createBlockBox } from "./layout-box-v2";
import type { FragmentationContext, LayoutResult } from "./fragmentation";
import type { TextShaper } from "./text-shaper";
import type { TextMeasurer } from "./text-measurer";
import { adaptShaperToMeasurer } from "./text-measurer";
import { tokenize, LINE_BREAK } from "./text-tokenize";
import { layoutBlock } from "./bfc";
import type { WritingMode, Direction } from "../styles/writing-mode";
import { computeUsedStyle } from "./used-style";
import type { LayoutContext } from "./layout-context";
import { makeRootContext } from "./layout-context";
import type { IntrinsicSizesCache } from "./intrinsic-sizes";
import { computeIntrinsicSizes } from "./intrinsic-sizes-pass";
import { findChangePoint } from "./wrap-incremental";
import { markStart, markEnd } from "../perf/perf-trace";

/**
 * Shared empty arrays for token creation. Used to ensure reference equality
 * when comparing tokens with identical empty ancestor stacks across layouts.
 */
const emptyAncestors: readonly string[] = [];
const emptyAncestorStyles: readonly ComputedStyle[] = [];

interface Token {
  /** Stable identifier for this token. Format: "{sourceKey}:{offset}" for text tokens
   * (where offset is the character index within the source text node where the token starts);
   * "{sourceKey}" for atomic tokens (inline-blocks); "{sourceKey}:lb" for hard-break tokens. */
  id: string;
  /** Key of the source TextBox (render node) — used for layout key tracing. */
  sourceKey: string;
  text: string;
  width: number;
  style: ComputedStyle;
  isSpace: boolean;
  isLineBreak: boolean;
  /** ElementBox keys of all inline ancestors, root-most first. */
  inlineAncestors: readonly string[];
  /** Computed styles of all inline ancestors (parallel to inlineAncestors). */
  inlineAncestorStyles: readonly ComputedStyle[];
  /** When set, this token represents an inline-block atomic unit. */
  inlineBlock?: {
    key: string;
    blockSize: number;
    children: readonly LayoutBox[];
  };
  /**
   * Hyphen break opportunities within this token's text (cluster indices
   * relative to this token's text). Only present for text tokens from a
   * shaped run that contains "hyphen" kind break opportunities.
   */
  hyphenBreaks?: readonly number[];
  /**
   * Width of each character (cluster) in this token's text, in order.
   * Used to compute the width of a prefix when splitting at a hyphen break.
   */
  clusterWidths?: readonly number[];
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
  direction: Direction,
  out: Token[],
  intrinsicCache: IntrinsicSizesCache,
): void {
  for (const child of children) {
    if (!child.computedStyle) throw new Error("cascade required");
    const cs = child.computedStyle;

    if (child.type === "text") {
      // Shape the entire text node once; then sum cluster advances per token.
      const fullText = child.text;
      const shapedRun = fullText.length > 0 ? shaper.shape(fullText, cs, direction) : null;

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
      let cursor = 0;
      for (const part of parts) {
        if (part === LINE_BREAK) {
          // LINE_BREAK is a sentinel string — advance past any \n at cursor.
          if (cursor < fullText.length && fullText[cursor] === "\n") cursor++;
          out.push({
            id: `${child.key}:lb`,
            sourceKey: child.key,
            text: LINE_BREAK,
            width: 0,
            style: cs,
            isSpace: false,
            isLineBreak: true,
            inlineAncestors: ancestors,
            inlineAncestorStyles: ancestorStyles,
          });
          continue;
        }

        // Find part in fullText starting at cursor (handles collapsed whitespace).
        let matchStart = fullText.indexOf(part, cursor);
        if (matchStart === -1) matchStart = cursor;
        const matchEnd = matchStart + part.length;

        const width = widthOfRange(matchStart, matchEnd);

        // Collect per-cluster widths and hyphen break opportunities within this token's range.
        let clusterWidths: number[] | undefined;
        let hyphenBreaks: number[] | undefined;
        if (shapedRun && !(/^\s+$/.test(part))) {
          clusterWidths = [];
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
          if (tokenHyphenBreaks.length > 0) hyphenBreaks = tokenHyphenBreaks;
        }

        out.push({
          id: `${child.key}:${matchStart}`,
          sourceKey: child.key,
          text: part,
          width,
          style: cs,
          isSpace: /^\s+$/.test(part),
          isLineBreak: false,
          inlineAncestors: ancestors,
          inlineAncestorStyles: ancestorStyles,
          ...(clusterWidths ? { clusterWidths } : {}),
          ...(hyphenBreaks ? { hyphenBreaks } : {}),
        });

        cursor = matchEnd;
      }
    } else if (child.type === "element" && cs.display === "inline") {
      const newAncestors = [...ancestors, child.key];
      const newStyles = [...ancestorStyles, cs];
      collectInlineTokens(child.children, newAncestors, newStyles, shaper, direction, out, intrinsicCache);
    } else if (child.type === "element" && cs.display === "inline-block") {
      // Resolve inlineSize using intrinsic sizes for auto (shrink-to-fit, CSS Sizing 3 §10.3.5).
      let inlineSizePx: number;
      if (typeof cs.inlineSize === "number") {
        inlineSizePx = cs.inlineSize;
      } else {
        // auto: use max-content (shrink-to-fit in an IFC means content width).
        const intrinsic = computeIntrinsicSizes(child, shaper, intrinsicCache);
        inlineSizePx = intrinsic.maxContent;
      }

      // Lay out at resolved inlineSize
      const ibCtx = makeRootContext(cs, inlineSizePx > 0 ? inlineSizePx : 100);
      const bfcResult = layoutBlock(child, 0, 0, ibCtx, shaper);
      if (bfcResult.box === null) {
        throw new Error("layoutBlock without fragmentation returned null box; should be unreachable (no FragmentationContext passed)");
      }
      const bfc = bfcResult.box;
      const finalInlineSize = inlineSizePx > 0 ? inlineSizePx : bfc.width;
      let finalBlockSize: number;
      if (typeof cs.blockSize === "number") {
        finalBlockSize = cs.blockSize;
      } else {
        finalBlockSize = bfc.height;
      }

      out.push({
        id: child.key,
        sourceKey: child.key,
        text: "",
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
        },
      });
    }
    // Other display values (block, etc.) are ignored at this level.
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
): Token[] {
  if (!parent.computedStyle) throw new Error("cascade required");
  const tokens: Token[] = [];
  collectInlineTokens(parent.children, emptyAncestors, emptyAncestorStyles, shaper, direction, tokens, intrinsicCache);
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
  fragmentation?: FragmentationContext,
): LayoutResult<BlockBox> {
  const tLayout = markStart("ifc.layout");
  try {
  if (!parent.computedStyle) throw new Error("cascade required");
  const parentCs = parent.computedStyle;
  const availableInlineSize = ctx.containingInlineSize;
  const writingMode = ctx.writingMode;
  const direction = ctx.direction;

  // Derive a legacy measurer for height-only calls (line height, marker text, etc.)
  const measurer = adaptShaperToMeasurer(shaper);

  const ws = parentCs.whiteSpace;
  // Plan 3.G Task 7: textWrap value pass-through. Only "wrap" / "nowrap" affect
  // behavior; "balance" / "pretty" / "stable" are reserved for future work
  // (Knuth-Plass-style optimal wrap; not yet implemented). They are treated as
  // "wrap" by default.
  const canWrap = ws !== "nowrap" && ws !== "pre";

  const floatEnv = ctx.floatEnv;

  /** Returns the effective line inlineOffset and inlineSize at a given lineBlockOffset, accounting for floats. */
  function effectiveLineDims(lineBlockOffset: number): { lineInlineCursor: number; lineInlineSize: number } {
    const active = floatEnv.availableInlineSizeAt(lineBlockOffset, availableInlineSize);
    return {
      lineInlineCursor: inlineOffset + active.inlineStartSize,
      lineInlineSize: availableInlineSize - active.inlineStartSize - active.inlineEndSize,
    };
  }

  // Collect tokens from all inline children recursively
  const tokens: Token[] = [];
  collectInlineTokens(parent.children, emptyAncestors, emptyAncestorStyles, shaper, direction, tokens, ctx.intrinsicCache);

  // Incremental-wrap cache: if tokens are identical and the available inline size hasn't
  // changed since the last layout, reuse the cached lines (no re-wrap needed).
  // Bypass the cache when fragmentation is active: the cached box was produced
  // without fragmentation and contains all lines. We must re-run the fit-check
  // to produce the correct partial box and breakToken for this fragment.
  const prevState = fragmentation === undefined ? ctx.ifcStateCache.get(parent.key) : undefined;
  if (prevState !== undefined && prevState.availableInlineSize === availableInlineSize) {
    if (findChangePoint(prevState.tokens, tokens) === -1) {
      const tHit = markStart("ifc.cache.hit");
      try {
        const cachedLines = Array.from(prevState.lines);
        const cachedBlockSize = cachedLines.reduce((acc, l) => Math.max(acc, l.y + l.height - blockOffset), 0);
        const cachedUsedStyle = computeUsedStyle(parentCs, availableInlineSize, "indefinite");
        return { box: createBlockBox(parent.key, inlineOffset, blockOffset, availableInlineSize, cachedBlockSize, writingMode, direction, parentCs, cachedUsedStyle, cachedLines, availableInlineSize), breakToken: null };
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
      // Orphan leading space — skip
      i++;
      continue;
    }
    // Non-space: collect it + optional trailing space from same source
    const unit: Token[] = [tok];
    let w = tok.width;
    const unitStartIdx = i;
    if (i + 1 < tokens.length && tokens[i + 1].isSpace && tokens[i + 1].sourceKey === tok.sourceKey) {
      unit.push(tokens[i + 1]);
      w += tokens[i + 1].width;
      i += 2;
    } else {
      i++;
    }
    units.push({
      tokens: unit,
      totalWidth: w,
      sourceKey: tok.sourceKey,
      isLineBreak: false,
      inlineAncestors: tok.inlineAncestors,
      inlineAncestorStyles: tok.inlineAncestorStyles,
      tokenStartIdx: unitStartIdx,
      tokenEndIdx: i - 1,
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
        w += clusterWidths[ci];
      }
      if (w + hyphenInlineSize <= available) {
        bestBreakIdx = breakAt;
        bestPrefixWidth = w;
      }
    }

    if (bestBreakIdx === null) return null;

    const prefixText = firstTok.text.slice(0, bestBreakIdx);
    const suffixText = firstTok.text.slice(bestBreakIdx);

    // Compute the suffix token's id by adding bestBreakIdx to the original token's source offset.
    // firstTok.id has the form "{sourceKey}:{offset}" for text tokens.
    const colonIdx = firstTok.id.lastIndexOf(":");
    const originalOffset = colonIdx >= 0 ? Number(firstTok.id.slice(colonIdx + 1)) : 0;
    const suffixOffset = (Number.isFinite(originalOffset) ? originalOffset : 0) + bestBreakIdx;

    const prefixToken: Token = {
      id: firstTok.id,
      sourceKey: firstTok.sourceKey,
      text: prefixText,
      width: bestPrefixWidth,
      style: firstTok.style,
      isSpace: false,
      isLineBreak: false,
      inlineAncestors: firstTok.inlineAncestors,
      inlineAncestorStyles: firstTok.inlineAncestorStyles,
    };

    const suffixToken: Token = {
      id: `${firstTok.sourceKey}:${suffixOffset}`,
      sourceKey: firstTok.sourceKey,
      text: suffixText,
      width: firstTok.width - bestPrefixWidth,
      style: firstTok.style,
      isSpace: false,
      isLineBreak: false,
      inlineAncestors: firstTok.inlineAncestors,
      inlineAncestorStyles: firstTok.inlineAncestorStyles,
      // Pass remaining cluster widths and hyphen breaks to suffix for potential future splits.
      clusterWidths: firstTok.clusterWidths.slice(bestBreakIdx),
      hyphenBreaks: firstTok.hyphenBreaks
        .filter(b => b > bestBreakIdx!)
        .map(b => b - bestBreakIdx!),
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
    };

    return [prefixUnit, suffixUnit, hyphenBreak];
  }

  /**
   * Flush the current accumulated units into a line, record its token-range
   * metadata, and reset accumulation state.
   */
  function flushLine(
    lineInlineCursor: number,
    lineInlineSize: number,
    hyphen: HyphenBreak | null,
  ): LineBox {
    const line = buildLineWithFragments(
      parent.key, lineIndex++, lineInlineCursor, lineBlockOffset, lineInlineSize,
      currentUnits, parentCs, measurer, writingMode, direction, availableInlineSize,
      hyphen, shaper,
    );
    if (currentLineStartTokenIdx >= 0) {
      lineMeta.set(line, {
        startTokenIdx: currentLineStartTokenIdx,
        endTokenIdx: currentLineEndTokenIdx,
      });
    }
    lines.push(line);
    lineBlockOffset += line.height;
    currentUnits = [];
    currentWidth = 0;
    pendingHyphen = null;
    currentLineStartTokenIdx = -1;
    currentLineEndTokenIdx = -1;
    return line;
  }

  /**
   * Push a unit onto the current line, updating token-range tracking.
   */
  function pushUnit(unit: WrapUnit): void {
    if (currentLineStartTokenIdx < 0) currentLineStartTokenIdx = unit.tokenStartIdx;
    currentLineEndTokenIdx = unit.tokenEndIdx;
    currentUnits.push(unit);
    currentWidth += unit.totalWidth;
  }

  // Units queue: we may inject split suffix units back into the front.
  let unitQueue: WrapUnit[] = [...units];
  let uqi = 0;

  const tWrap = markStart("ifc.wrap");
  try {
  while (uqi < unitQueue.length) {
    const unit = unitQueue[uqi++];

    // Hard break on LINE_BREAK — flush current line and start a new one
    if (unit.isLineBreak) {
      const { lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset);
      flushLine(lineInlineCursor, lineInlineSize, pendingHyphen);
      continue;
    }

    // Soft wrap — only when canWrap is true
    let { lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset);

    if (canWrap && currentWidth + unit.totalWidth > lineInlineSize && currentUnits.length > 0) {
      // Before flushing: try hyphen-split on the overflowing unit.
      const available = lineInlineSize - currentWidth;
      const split = tryHyphenSplit(unit, available);
      if (split !== null) {
        const [prefixUnit, suffixUnit, hyphenBreak] = split;
        // Add the prefix to the current line, then flush with hyphen.
        pushUnit(prefixUnit);
        flushLine(lineInlineCursor, lineInlineSize, hyphenBreak);
        // Recompute dims and push the suffix unit back as next to process.
        ({ lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset));
        // Insert suffix at the current position so it's processed next.
        unitQueue.splice(uqi, 0, suffixUnit);
        continue;
      }
      // No hyphen split possible — normal word wrap.
      flushLine(lineInlineCursor, lineInlineSize, pendingHyphen);
      // Recompute dims for the new line position
      ({ lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset));
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
          const next = floatEnv.nextFloatBottomBelow(lineBlockOffset);
          if (next <= lineBlockOffset) break; // no float below; can't push further
          lineBlockOffset = next;
          ({ lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset));
          if (lineInlineSize >= unit.totalWidth) break; // now fits
          if (lineInlineSize >= availableInlineSize) break; // no more floats squeezing
        }
      }
    }

    // Hyphen split on an otherwise-empty line: the unit doesn't fit even alone,
    // but a hyphen break opportunity allows a prefix to fit.
    if (canWrap && currentWidth + unit.totalWidth > lineInlineSize && currentUnits.length === 0) {
      const available = lineInlineSize - currentWidth;
      const split = tryHyphenSplit(unit, available);
      if (split !== null) {
        const [prefixUnit, suffixUnit, hyphenBreak] = split;
        pushUnit(prefixUnit);
        flushLine(lineInlineCursor, lineInlineSize, hyphenBreak);
        ({ lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset));
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
    const { lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset);
    flushLine(lineInlineCursor, lineInlineSize, pendingHyphen);
  }

  const result = assignFragmentEdges(lines);

  // `assignFragmentEdges` creates new frozen objects for each line. Copy
  // lineMeta from the original LineBox objects to the post-correction ones so
  // that incremental-wrap convergence detection can find metadata on the
  // cached lines.
  const resultLines: LineBox[] = [];
  for (let ri = 0; ri < result.length; ri++) {
    const box = result[ri];
    if (box.type !== "line") continue;
    const originalLine = lines[ri];
    if (originalLine !== undefined && originalLine.type === "line") {
      const meta = lineMeta.get(originalLine);
      if (meta !== undefined) lineMeta.set(box, meta);
    }
    resultLines.push(box);
  }

  // Save wrap state to cache for subsequent incremental re-wraps.
  // (Only when fragmentation is inactive; fragmented calls bypass the cache on
  // read and should not poison it with partial line sets on write either.)
  if (fragmentation === undefined) {
    ctx.ifcStateCache.set(parent.key, {
      tokens,
      lines: resultLines,
      availableInlineSize,
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
      const lineHeight = linesToConsider[fi].blockSize;
      if (used + lineHeight > fragmentation.availableBlockSize) {
        break;
      }
      used += lineHeight;
      placedLineCount++;
    }

    if (placedLineCount === 0) {
      // First suffix line doesn't fit. Resume from startLine (not 0) on next fragment.
      return { box: null, breakToken: { type: "ifc", resumeAtLine: startLine } };
    }

    // D.2 — Orphans constraint (CSS Fragmentation L4 §5.4).
    // At least `orphans` lines must remain on the current fragment. Default 2 per CSS spec.
    const orphans = parentCs.orphans ?? 2;
    if (placedLineCount < linesToConsider.length && placedLineCount < orphans) {
      return { box: null, breakToken: { type: "ifc", resumeAtLine: startLine } };
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
      return { box: null, breakToken: { type: "ifc", resumeAtLine: startLine } };
    }

    // D.4 — Hyphen-pair constraint (CSS Fragmentation L4 §5).
    // A page break must not fall between two lines of a hyphenated word. If the
    // last placed line ends with a hyphen continuation, back off past it.
    // This is a no-op until hyphenation infrastructure produces actual
    // hyphenated lines (P7 — hyphens); the guard is in place so P7 doesn't
    // need to revisit this code.
    while (placedLineCount > 0 && placedLineCount < linesToConsider.length && linesToConsider[placedLineCount - 1].endsWithHyphenContinuation === true) {
      placedLineCount--;
    }
    // After hyphen-pair back-off, re-check orphans.
    if (placedLineCount < linesToConsider.length && placedLineCount < orphans) {
      return { box: null, breakToken: { type: "ifc", resumeAtLine: startLine } };
    }

    // Recompute used block size after all back-off adjustments.
    let usedAdjusted = 0;
    for (let i = 0; i < placedLineCount; i++) usedAdjusted += linesToConsider[i].blockSize;

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
      return { box: placedBox, breakToken: { type: "ifc", resumeAtLine: startLine + placedLineCount } };
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
    return { box: allSuffixBox, breakToken: null };
  }

  const totalBlockSize = result.reduce((acc, l) => Math.max(acc, l.y + l.height - blockOffset), 0);
  const parentUsedStyleForBox = computeUsedStyle(parentCs, availableInlineSize, "indefinite");
  const box = createBlockBox(parent.key, inlineOffset, blockOffset, availableInlineSize, totalBlockSize, writingMode, direction, parentCs, parentUsedStyleForBox, result, availableInlineSize);
  return { box, breakToken: null };
  } finally {
    markEnd("ifc.layout", tLayout);
  }
}

function applyVerticalAlign(children: readonly LayoutBox[], lineBlockSize: number): LayoutBox[] {
  return children.map((c) => {
    const va = c.computedStyle.verticalAlign;
    let y: number;
    switch (va) {
      case "top":
        y = 0;
        break;
      case "middle":
        y = (lineBlockSize - c.height) / 2;
        break;
      case "bottom":
        y = lineBlockSize - c.height;
        break;
      case "baseline":
      default:
        // Approximation: parent baseline at lineBlockSize * 0.8; child baseline at child.height * 0.8.
        // Position child so its baseline lines up with the line's baseline.
        y = lineBlockSize * 0.8 - c.height * 0.8;
        break;
    }
    if (c.y === y) return c;
    return Object.freeze({ ...c, y }) as LayoutBox;
  });
}

function buildLineWithFragments(
  parentKey: string,
  lineIndex: number,
  lineInlineCursor: number,
  lineBlockOffset: number,
  lineInlineSize: number,
  units: WrapUnit[],
  parentCs: ComputedStyle,
  measurer: TextMeasurer,
  writingMode: WritingMode,
  direction: Direction,
  containingInlineSize: number,
  hyphenBreak: HyphenBreak | null,
  shaper: TextShaper,
): LineBox {
  const parentUsedStyle = computeUsedStyle(parentCs, containingInlineSize, "indefinite");
  const lineBlockSizeTracker = { value: 0 };
  let children = buildLineChildrenForAncestorLevel(
    parentKey, lineIndex, units, 0, measurer, lineBlockSizeTracker, writingMode, direction, lineInlineSize,
  );

  // Append synthetic hyphen TextRunBox when this line ends at a hyphen break.
  if (hyphenBreak !== null) {
    const hyphenRun = shaper.shape("-", hyphenBreak.style, direction);
    const hyphenInlineSize = hyphenRun.clusters.reduce((s, c) => s + c.inlineAdvance, 0);
    const hyphenBlockSize = hyphenRun.ascent + hyphenRun.descent + hyphenRun.lineGap;
    lineBlockSizeTracker.value = Math.max(lineBlockSizeTracker.value, hyphenBlockSize);

    // Compute inline offset: sum of all existing children's sizes.
    const cursorInlineOffset = children.reduce((s, c) => s + c.inlineSize, 0);
    const hyphenUsedStyle = computeUsedStyle(hyphenBreak.style, lineInlineSize, "indefinite");
    const hyphenBox = createTextRunBox(
      `${hyphenBreak.sourceKey}:hyphen-${lineIndex}`,
      cursorInlineOffset, 0, hyphenInlineSize, hyphenBlockSize,
      writingMode, direction,
      hyphenBreak.style, hyphenUsedStyle,
      "-",
      /* containingInlineSize */ lineInlineSize,
    );
    children = [...children, hyphenBox];
  }

  const lineBlockSize = lineBlockSizeTracker.value > 0 ? lineBlockSizeTracker.value : measurer.measureHeight(parentCs);
  const aligned = applyVerticalAlign(children, lineBlockSize);
  const reordered = reorderLineForBidi(aligned, lineInlineSize);
  return createLineBox(`${parentKey}-l${lineIndex}`, lineInlineCursor, lineBlockOffset, lineInlineSize, lineBlockSize, writingMode, direction, parentCs, parentUsedStyle, reordered,
    /* baseline */ lineBlockSize,
    /* containingInlineSize */ containingInlineSize,
    /* endsWithHyphenContinuation */ hyphenBreak !== null ? true : undefined,
  );
}

/**
 * Walk wrap units at a given inline-ancestor depth. Units at this level (no deeper ancestor)
 * become TextRunBoxes; consecutive runs of units that share an ancestor at `depth` get
 * grouped into an InlineBox containing the recursive result.
 */
function buildLineChildrenForAncestorLevel(
  parentKey: string,
  lineIndex: number,
  units: WrapUnit[],
  depth: number,
  measurer: TextMeasurer,
  lineBlockSizeTracker: { value: number },
  writingMode: WritingMode,
  direction: Direction,
  lineInlineSize: number,
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

    if (unit.inlineAncestors.length <= depth) {
      const firstTok = unit.tokens[0];
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
        ));
      } else {
        // Regular token — emit a TextRunBox (merging tokens in the unit).
        const text = unit.tokens.map(t => t.text).join("");
        const tokBlockSize = measurer.measureHeight(tokStyle);
        lineBlockSizeTracker.value = Math.max(lineBlockSizeTracker.value, tokBlockSize);

        const runIdx = runCounters[unit.sourceKey] ?? 0;
        runCounters[unit.sourceKey] = runIdx + 1;
        const runKey = `${unit.sourceKey}:${runIdx}`;

        const tokUsedStyle = computeUsedStyle(tokStyle, lineInlineSize, "indefinite");
        out.push(createTextRunBox(
          runKey,
          cursorInlineOffset, 0, unitWidth, tokBlockSize, writingMode, direction, tokStyle, tokUsedStyle, text,
          /* containingInlineSize */ lineInlineSize,
        ));
      }
      cursorInlineOffset += unitWidth;
      i++;
      continue;
    }

    // Group consecutive units that share the same ancestor at `depth`.
    const ancestorKey = unit.inlineAncestors[depth];
    const ancestorStyle = unit.inlineAncestorStyles[depth];
    let j = i;
    while (
      j < units.length &&
      units[j].inlineAncestors.length > depth &&
      units[j].inlineAncestors[depth] === ancestorKey
    ) j++;

    const innerUnits = units.slice(i, j);
    const innerBlockSizeTracker = { value: 0 };
    const innerChildren = buildLineChildrenForAncestorLevel(
      parentKey, lineIndex, innerUnits, depth + 1,
      measurer, innerBlockSizeTracker, writingMode, direction, lineInlineSize,
    );

    const boxInlineSize = innerChildren.reduce((acc, c) => acc + c.width, 0);
    const boxBlockSize = innerBlockSizeTracker.value > 0 ? innerBlockSizeTracker.value : measurer.measureHeight(ancestorStyle);
    lineBlockSizeTracker.value = Math.max(lineBlockSizeTracker.value, boxBlockSize);

    const ancestorUsedStyle = computeUsedStyle(ancestorStyle, lineInlineSize, "indefinite");
    // For B.2, hardcode fragmentEdge to "only". B.3 fixes cross-line resolution.
    out.push(createInlineBox(
      `${parentKey}-l${lineIndex}-i${out.length}-${ancestorKey}`,
      cursorInlineOffset, 0, boxInlineSize, boxBlockSize, writingMode, direction, ancestorStyle, ancestorUsedStyle, innerChildren, "only",
      /* containingInlineSize */ lineInlineSize,
    ));
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
      const ancestor = extractAncestorKey(inline.key);
      const arr = lineIndicesByAncestor.get(ancestor) ?? [];
      if (!arr.includes(idx)) arr.push(idx);
      lineIndicesByAncestor.set(ancestor, arr);
    });
  });

  // Phase 2: rebuild each line with corrected fragmentEdges.
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

/** Extract the ancestor key from an InlineBox key like "<parent>-l<i>-i<idx>-<ancestor>". */
function extractAncestorKey(inlineBoxKey: string): string {
  const lastDash = inlineBoxKey.lastIndexOf("-");
  return lastDash >= 0 ? inlineBoxKey.slice(lastDash + 1) : inlineBoxKey;
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
function reorderLineForBidi(
  children: readonly LayoutBox[],
  lineInlineSize: number,
): LayoutBox[] {
  if (children.length === 0) return [];

  // Infer the line's overall bidi direction from the first child's
  // computedStyle. All children of a uniform RTL paragraph share
  // direction "rtl" (set by the cascade from the paragraph element).
  const allRtl = children.every(c => c.computedStyle.direction === "rtl");

  if (!allRtl) {
    // LTR-uniform (or mixed; mixed treated as LTR for v1) — identity.
    return [...children];
  }

  // RTL-uniform: mirror inline offsets so visual order is reversed.
  // new inlineOffset = lineInlineSize - oldInlineOffset - inlineSize
  return children.map(child => {
    const newInlineOffset = lineInlineSize - child.inlineOffset - child.inlineSize;
    return withInlineOffset(child, newInlineOffset, lineInlineSize);
  });
}

function correctFragmentEdge(
  box: LayoutBox,
  lineIdx: number,
  lineIndicesByAncestor: Map<string, number[]>,
): LayoutBox {
  if (box.type !== "inline") return box;
  const ancestor = extractAncestorKey(box.key);
  const indices = lineIndicesByAncestor.get(ancestor) ?? [lineIdx];
  let edge: "first" | "middle" | "last" | "only";
  if (indices.length === 1) edge = "only";
  else if (lineIdx === indices[0]) edge = "first";
  else if (lineIdx === indices[indices.length - 1]) edge = "last";
  else edge = "middle";

  const newChildren = box.children.map((c) => correctFragmentEdge(c, lineIdx, lineIndicesByAncestor));
  return Object.freeze({ ...box, children: Object.freeze(newChildren), fragmentEdge: edge }) as LayoutBox;
}

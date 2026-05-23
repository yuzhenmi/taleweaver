import type { RenderNode } from "../render/render-node";
import type { ElementBox } from "../render/render-node";
import type { ComputedStyle } from "../styles";
import type { LayoutBox, LineBox, InlineBox, BlockBox } from "./layout-box-v2";
import type { BlockId } from "../state/block-id";
import { createInlineBox, createInlineBlockBox, createLineBox, createTextRunBox, withInlineOffset, withBlockOffset, assertLayoutBoxConsistent, createBlockBox } from "./layout-box-v2";
import type { FragmentationContext, LayoutResult } from "./fragmentation";
import type { TextShaper } from "./text-shaper";
import type { TextMeasurer } from "./text-measurer";
import { adaptShaperToMeasurer } from "./text-measurer";
import { tokenize, LINE_BREAK } from "./text-tokenize";
import { layoutBlock } from "./bfc";
import type { WritingMode, Direction } from "../styles/writing-mode";
import { computeUsedStyle } from "./used-style";
import type { LayoutContext } from "./layout-context";
import { makeRootContext, makeChildContext } from "./layout-context";
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
  // L-D (A6): parent layout context for inline-block sub-layout. When
  // present, inline-block descendants use makeChildContext so they
  // inherit the parent's prevLayoutCache / ifcStateCache — enabling
  // incremental reuse for unchanged inline-blocks. When absent (the
  // exported collectTokens test path and rewrap-incremental path), the
  // inline-block sub-layout falls back to makeRootContext (no
  // incremental reuse — matches pre-L-D behavior for those callers).
  parentCtx: LayoutContext | null,
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
        //
        // L-F / A4: if `indexOf` fails (the tokenizer collapsed whitespace
        // in a way that no source substring matches `part` from `cursor`),
        // we fall back to `cursor` as a best-effort source position. The
        // resulting `matchStart` / `matchEnd` advance by token length,
        // which under collapsing whitespace can diverge from the true
        // source advance — making downstream `widthOfRange` / cluster-
        // width lookups reference the wrong source positions. The bug is
        // dormant for default `white-space: normal` (one collapsed space
        // is a one-char part, position-stable) but activates on `pre-wrap`
        // where multiple consecutive whitespace chars survive as multi-
        // char source ranges that don't equal the token's collapsed form.
        //
        // For now: surface a dev-mode warning so the bug becomes visible
        // if it ever fires in production. A proper fix requires teaching
        // the tokenizer to preserve source positions (or threading them
        // through), which is out of scope for this fix bundle.
        let matchStart = fullText.indexOf(part, cursor);
        if (matchStart === -1) {
          const g = globalThis as {
            process?: { env?: { NODE_ENV?: string } };
            console?: { warn(...args: unknown[]): void };
          };
          if (g.process?.env?.NODE_ENV !== "production" && g.console !== undefined) {
            g.console.warn(
              `[layout/ifc] collectTokens: indexOf("${part}", ${cursor}) failed in fullText="${fullText.slice(0, 64)}..."; ` +
                `falling back to cursor — widthOfRange may be inaccurate. ` +
                `If white-space: pre-wrap is active, this indicates a tokenizer/source-position drift bug.`,
            );
          }
          matchStart = cursor;
        }
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
      collectInlineTokens(child.children, newAncestors, newStyles, shaper, direction, out, intrinsicCache, parentCtx);
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
  // External path (rewrap-incremental + tests): no parent context
  // available. Inline-block sub-layout falls back to makeRootContext —
  // the production path uses makeChildContext (see layoutInlineContent).
  collectInlineTokens(parent.children, emptyAncestors, emptyAncestorStyles, shaper, direction, tokens, intrinsicCache, null);
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
  collectInlineTokens(parent.children, emptyAncestors, emptyAncestorStyles, shaper, direction, tokens, ctx.intrinsicCache, ctx);

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
  // E-E.1: state-model offset accumulator for stamping
  // `inlineOffsetStart` / `inlineOffsetEnd` on each emitted LineBox.
  // Advances per unit consumed via `pushUnit`. Each token contributes
  // 1 for inline-block (state-model embed) tokens or `text.length` for
  // text / space / line-break tokens (matches the state-model rule:
  // each embed counts as one cursor position; text chars are UTF-16
  // code units).
  let cursorOffset = 0;
  let currentLineStartOffset = -1;

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
    // Empty flush (no units pushed): anchor line offsets at the
    // current cursor. Both start and end are the same offset — the
    // line covers zero characters.
    const startOff = currentLineStartOffset >= 0 ? currentLineStartOffset : cursorOffset;
    const line = buildLineWithFragments(
      parent.key, lineIndex++, lineInlineCursor, lineBlockOffset, lineInlineSize,
      currentUnits, parentCs, measurer, writingMode, direction, availableInlineSize,
      hyphen, shaper,
      parent.key as BlockId, // ownerBlockId (see strut-line comment above)
      startOff,              // inlineOffsetStart
      cursorOffset,          // inlineOffsetEnd
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
    currentLineStartOffset = -1;
    return line;
  }

  /**
   * Compute a wrap-unit's state-model offset contribution. Text /
   * space / line-break tokens contribute `text.length`; inline-block
   * tokens (representing state-model embed items) contribute exactly
   * 1. Used by the wrap pass's per-block offset accumulator to stamp
   * `inlineOffsetStart` / `inlineOffsetEnd` on emitted LineBoxes.
   */
  function unitOffsetContribution(unit: WrapUnit): number {
    let total = 0;
    for (const t of unit.tokens) {
      total += t.inlineBlock !== undefined ? 1 : t.text.length;
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
    const { lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset);
    const strutBlockSize = measurer.measureHeight(parentCs);
    const strutUsedStyle = computeUsedStyle(parentCs, availableInlineSize, "indefinite");
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
      [],
      /* baseline */ strutBlockSize,
      /* containingInlineSize */ availableInlineSize,
      // IFC is always dispatched for a block whose RenderNode key is
      // its BlockId (per BFC's invocation site — `node.key` for an
      // inline-bearing leaf block is the source block's id). The cast
      // is safe at all callers of layoutInlineContent.
      /* ownerBlockId */ parent.key as BlockId,
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
    const unit = unitQueue[uqi++];

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
      const { lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset);
      if (currentLineStartOffset < 0) currentLineStartOffset = cursorOffset;
      cursorOffset += unitOffsetContribution(unit);
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

  // E-E.1: use `resultLines` (which has the isBlockBoundaryLine patch
  // applied to the last line) rather than `result` (pre-patch), so the
  // BlockBox's children agree with the cache. Otherwise a cache hit on
  // a subsequent layout pass returns the patched lines while the
  // BlockBox would have the pre-patch lines on a fresh build, breaking
  // ref-equality contracts.
  const totalBlockSize = resultLines.reduce((acc, l) => Math.max(acc, l.y + l.height - blockOffset), 0);
  const parentUsedStyleForBox = computeUsedStyle(parentCs, availableInlineSize, "indefinite");
  const box = createBlockBox(parent.key, inlineOffset, blockOffset, availableInlineSize, totalBlockSize, writingMode, direction, parentCs, parentUsedStyleForBox, resultLines, availableInlineSize);
  return { box, breakToken: null };
  } finally {
    markEnd("ifc.layout", tLayout);
  }
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
 */
function applyVerticalAlign(
  children: readonly LayoutBox[],
  lineBlockSize: number,
  containingInlineSize: number,
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
      case "baseline":
      default:
        // Approximation: parent baseline at lineBlockSize * 0.8; child baseline
        // at child.blockSize * 0.8. Position child so its baseline lines up
        // with the line's baseline.
        newBlockOffset = lineBlockSize * 0.8 - c.blockSize * 0.8;
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
  units: WrapUnit[],
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
  const aligned = applyVerticalAlign(children, lineBlockSize, lineInlineSize);
  const reordered = reorderLineForBidi(aligned, lineInlineSize);
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
      ancestorKey, // L-C: store explicitly; do not derive from box.key
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

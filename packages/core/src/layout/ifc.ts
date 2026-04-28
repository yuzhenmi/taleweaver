import type { RenderNode } from "../render/render-node-v2";
import type { ElementBox } from "../render/render-node-v2";
import type { ComputedStyle } from "../styles";
import type { LayoutBox, LineBox, InlineBox } from "./layout-box-v2";
import { createInlineBox, createInlineBlockBox, createLineBox, createTextRunBox } from "./layout-box-v2";
import type { TextMeasurer } from "./text-measurer";
import { tokenize, LINE_BREAK } from "./text-tokenize";
import { layoutBlock } from "./bfc";
import type { FloatContext } from "./float-context";
import type { WritingMode, Direction } from "../styles/writing-mode";

interface Token {
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
}

/**
 * Recursively collect tokens from inline content, accumulating the ancestor
 * stack as we descend into display:inline element children.
 */
function collectInlineTokens(
  children: readonly RenderNode[],
  ancestors: readonly string[],
  ancestorStyles: readonly ComputedStyle[],
  measurer: TextMeasurer,
  out: Token[],
): void {
  for (const child of children) {
    if (!child.computedStyle) throw new Error("cascade required");
    const cs = child.computedStyle;

    if (child.type === "text") {
      const parts = tokenize(child.text, cs.whiteSpace);
      for (const part of parts) {
        if (part === LINE_BREAK) {
          out.push({
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
        out.push({
          sourceKey: child.key,
          text: part,
          width: measurer.measureWidth(part, cs),
          style: cs,
          isSpace: /^\s+$/.test(part),
          isLineBreak: false,
          inlineAncestors: ancestors,
          inlineAncestorStyles: ancestorStyles,
        });
      }
    } else if (child.type === "element" && cs.display === "inline") {
      const newAncestors = [...ancestors, child.key];
      const newStyles = [...ancestorStyles, cs];
      collectInlineTokens(child.children, newAncestors, newStyles, measurer, out);
    } else if (child.type === "element" && cs.display === "inline-block") {
      // Resolve inlineSize
      let inlineSizePx: number;
      if (typeof cs.inlineSize === "number") {
        inlineSizePx = cs.inlineSize;
      } else {
        // max-content: lay out at very large width
        const bfcInf = layoutBlock(child, 0, 0, 100000, measurer);
        inlineSizePx = bfcInf.width;
      }

      // Lay out at resolved inlineSize
      const bfc = layoutBlock(child, 0, 0, inlineSizePx > 0 ? inlineSizePx : 100, measurer);
      const finalInlineSize = inlineSizePx > 0 ? inlineSizePx : bfc.width;
      let finalBlockSize: number;
      if (typeof cs.blockSize === "number") {
        finalBlockSize = cs.blockSize;
      } else {
        finalBlockSize = bfc.height;
      }

      out.push({
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
 * Lay out inline content (text — Plan 1 only handles text children)
 * into LineBoxes within the parent block's content area.
 */
export function layoutInlineContent(
  parent: ElementBox,
  inlineOffset: number,
  blockOffset: number,
  availableInlineSize: number,
  measurer: TextMeasurer,
  floatCtx?: FloatContext,
  writingMode: WritingMode = "horizontal-tb",
  direction: Direction = "ltr",
): LayoutBox[] {
  if (!parent.computedStyle) throw new Error("cascade required");
  const parentCs = parent.computedStyle;

  const ws = parentCs.whiteSpace;
  const canWrap = ws !== "nowrap" && ws !== "pre";

  /** Returns the effective line inlineOffset and inlineSize at a given lineBlockOffset, accounting for floats. */
  function effectiveLineDims(lineBlockOffset: number): { lineInlineCursor: number; lineInlineSize: number } {
    if (!floatCtx) return { lineInlineCursor: inlineOffset, lineInlineSize: availableInlineSize };
    const active = floatCtx.activeAt(lineBlockOffset);
    return {
      lineInlineCursor: inlineOffset + active.leftWidth,
      lineInlineSize: availableInlineSize - active.leftWidth - active.rightWidth,
    };
  }

  // Collect tokens from all inline children recursively
  const tokens: Token[] = [];
  collectInlineTokens(parent.children, [], [], measurer, tokens);

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
    });
  }

  // Greedy line wrap over units
  const lines: LayoutBox[] = [];
  let lineBlockOffset = blockOffset;
  let currentUnits: WrapUnit[] = [];
  let currentWidth = 0;
  let lineIndex = 0;

  for (const unit of units) {
    // Hard break on LINE_BREAK — flush current line and start a new one
    if (unit.isLineBreak) {
      const { lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset);
      const line = buildLineWithFragments(parent.key, lineIndex++, lineInlineCursor, lineBlockOffset, lineInlineSize, currentUnits, parentCs, measurer, writingMode, direction);
      lines.push(line);
      lineBlockOffset += line.height;
      currentUnits = [];
      currentWidth = 0;
      continue;
    }

    // Soft wrap — only when canWrap is true
    let { lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset);

    if (canWrap && currentWidth + unit.totalWidth > lineInlineSize && currentUnits.length > 0) {
      const line = buildLineWithFragments(parent.key, lineIndex++, lineInlineCursor, lineBlockOffset, lineInlineSize, currentUnits, parentCs, measurer, writingMode, direction);
      lines.push(line);
      lineBlockOffset += line.height;
      currentUnits = [];
      currentWidth = 0;
      // Recompute dims for the new line position
      ({ lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset));
    }

    // If even an empty line can't fit the token and there are active floats,
    // advance lineBlockOffset past the nearest float bottom and retry (CSS "skip past floats").
    if (canWrap && currentWidth + unit.totalWidth > lineInlineSize && currentUnits.length === 0 && floatCtx) {
      const active = floatCtx.activeAt(lineBlockOffset);
      if (active.nearestBottom !== Infinity && lineInlineSize < availableInlineSize) {
        lineBlockOffset = active.nearestBottom;
        ({ lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset));
      }
    }

    currentUnits.push(unit);
    currentWidth += unit.totalWidth;
  }

  if (currentUnits.length > 0) {
    const { lineInlineCursor, lineInlineSize } = effectiveLineDims(lineBlockOffset);
    const line = buildLineWithFragments(parent.key, lineIndex++, lineInlineCursor, lineBlockOffset, lineInlineSize, currentUnits, parentCs, measurer, writingMode, direction);
    lines.push(line);
  }

  return assignFragmentEdges(lines);
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
): LineBox {
  const lineBlockSizeTracker = { value: 0 };
  const children = buildLineChildrenForAncestorLevel(
    parentKey, lineIndex, units, 0, parentCs, measurer, lineBlockSizeTracker, writingMode, direction,
  );
  const lineBlockSize = lineBlockSizeTracker.value > 0 ? lineBlockSizeTracker.value : measurer.measureHeight(parentCs);
  const aligned = applyVerticalAlign(children, lineBlockSize);
  return createLineBox(`${parentKey}-l${lineIndex}`, lineInlineCursor, lineBlockOffset, lineInlineSize, lineBlockSize, writingMode, direction, parentCs, aligned);
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
  parentCs: ComputedStyle,
  measurer: TextMeasurer,
  lineBlockSizeTracker: { value: number },
  writingMode: WritingMode,
  direction: Direction,
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
        out.push(createInlineBlockBox(
          `${parentKey}-l${lineIndex}-ib${out.length}-${ib.key}`,
          cursorInlineOffset, 0, unitWidth, ibBlockSize, writingMode, direction, tokStyle, ib.children,
        ));
      } else {
        // Regular token — emit a TextRunBox (merging tokens in the unit).
        const text = unit.tokens.map(t => t.text).join("");
        const tokBlockSize = measurer.measureHeight(tokStyle);
        lineBlockSizeTracker.value = Math.max(lineBlockSizeTracker.value, tokBlockSize);

        const runIdx = runCounters[unit.sourceKey] ?? 0;
        runCounters[unit.sourceKey] = runIdx + 1;
        const runKey = `${unit.sourceKey}:${runIdx}`;

        out.push(createTextRunBox(
          runKey,
          cursorInlineOffset, 0, unitWidth, tokBlockSize, writingMode, direction, tokStyle, text,
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
      ancestorStyle, measurer, innerBlockSizeTracker, writingMode, direction,
    );

    const boxInlineSize = innerChildren.reduce((acc, c) => acc + c.width, 0);
    const boxBlockSize = innerBlockSizeTracker.value > 0 ? innerBlockSizeTracker.value : measurer.measureHeight(ancestorStyle);
    lineBlockSizeTracker.value = Math.max(lineBlockSizeTracker.value, boxBlockSize);

    // For B.2, hardcode fragmentEdge to "only". B.3 fixes cross-line resolution.
    out.push(createInlineBox(
      `${parentKey}-l${lineIndex}-i${out.length}-${ancestorKey}`,
      cursorInlineOffset, 0, boxInlineSize, boxBlockSize, writingMode, direction, ancestorStyle, innerChildren, "only",
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

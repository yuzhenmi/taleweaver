import type { ElementBox } from "../render/render-node-v2";
import type { ComputedStyle } from "../styles";
import type { LayoutBox, LineBox } from "./layout-box-v2";
import { createLineBox, createTextRunBox } from "./layout-box-v2";
import type { TextMeasurer } from "./text-measurer";
import { tokenize, LINE_BREAK } from "./text-tokenize";

interface Token {
  /** Key of the source TextBox (render node) — used for layout key tracing. */
  sourceKey: string;
  text: string;
  width: number;
  style: ComputedStyle;
  isSpace: boolean;
  isLineBreak: boolean;
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
}

/**
 * Lay out inline content (text — Plan 1 only handles text children)
 * into LineBoxes within the parent block's content area.
 */
export function layoutInlineContent(
  parent: ElementBox,
  contentX: number,
  contentY: number,
  contentWidth: number,
  measurer: TextMeasurer,
): LayoutBox[] {
  if (!parent.computedStyle) throw new Error("cascade required");
  const parentCs = parent.computedStyle;

  const ws = parentCs.whiteSpace;
  const canWrap = ws !== "nowrap" && ws !== "pre";

  // Collect tokens from all text children
  const tokens: Token[] = [];
  for (const child of parent.children) {
    if (child.type !== "text") continue;
    if (!child.computedStyle) throw new Error("cascade required");
    const cs = child.computedStyle;
    const parts = tokenize(child.text, cs.whiteSpace);
    for (const part of parts) {
      if (part === LINE_BREAK) {
        tokens.push({
          sourceKey: child.key,
          text: LINE_BREAK,
          width: 0,
          style: cs,
          isSpace: false,
          isLineBreak: true,
        });
        continue;
      }
      tokens.push({
        sourceKey: child.key,
        text: part,
        width: measurer.measureWidth(part, cs),
        style: cs,
        isSpace: /^\s+$/.test(part),
        isLineBreak: false,
      });
    }
  }

  // Group tokens into wrap units: non-space + optional trailing space (same source)
  // LINE_BREAK tokens become standalone units with isLineBreak: true.
  const units: WrapUnit[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.isLineBreak) {
      units.push({ tokens: [tok], totalWidth: 0, sourceKey: tok.sourceKey, isLineBreak: true });
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
    units.push({ tokens: unit, totalWidth: w, sourceKey: tok.sourceKey, isLineBreak: false });
  }

  // Greedy line wrap over units
  const lines: LayoutBox[] = [];
  let lineY = contentY;
  let currentUnits: WrapUnit[] = [];
  let currentWidth = 0;
  let lineIndex = 0;

  for (const unit of units) {
    // Hard break on LINE_BREAK — flush current line and start a new one
    if (unit.isLineBreak) {
      const line = buildLine(parent.key, lineIndex++, contentX, lineY, contentWidth, currentUnits, parentCs, measurer);
      lines.push(line);
      lineY += line.height;
      currentUnits = [];
      currentWidth = 0;
      continue;
    }

    // Soft wrap — only when canWrap is true
    if (canWrap && currentWidth + unit.totalWidth > contentWidth && currentUnits.length > 0) {
      const line = buildLine(parent.key, lineIndex++, contentX, lineY, contentWidth, currentUnits, parentCs, measurer);
      lines.push(line);
      lineY += line.height;
      currentUnits = [];
      currentWidth = 0;
    }
    currentUnits.push(unit);
    currentWidth += unit.totalWidth;
  }

  if (currentUnits.length > 0) {
    const line = buildLine(parent.key, lineIndex++, contentX, lineY, contentWidth, currentUnits, parentCs, measurer);
    lines.push(line);
  }

  return lines;
}

function buildLine(
  parentKey: string,
  lineIndex: number,
  x: number,
  y: number,
  width: number,
  units: WrapUnit[],
  parentCs: ComputedStyle,
  measurer: TextMeasurer,
): LineBox {
  // Track per-source-key run counters for text run box keys.
  // Keys follow the pattern `{sourceKey}:{runIdx}` so that cursor-position.ts
  // can match by state node id.
  const runCounters: Record<string, number> = {};

  const children: LayoutBox[] = [];
  let runX = 0;
  let lineHeight = 0;
  for (const unit of units) {
    // Merge tokens in the unit into a single text string
    const text = unit.tokens.map(t => t.text).join("");
    const unitWidth = unit.tokens.reduce((sum, t) => sum + t.width, 0);
    const tokStyle = unit.tokens[0].style;
    const tokHeight = measurer.measureHeight(tokStyle);
    lineHeight = Math.max(lineHeight, tokHeight);

    const runIdx = runCounters[unit.sourceKey] ?? 0;
    runCounters[unit.sourceKey] = runIdx + 1;
    const runKey = `${unit.sourceKey}:${runIdx}`;

    children.push(createTextRunBox(
      runKey,
      runX, 0, unitWidth, tokHeight, tokStyle, text,
    ));
    runX += unitWidth;
  }
  if (lineHeight === 0) lineHeight = measurer.measureHeight(parentCs);
  return createLineBox(
    `${parentKey}-l${lineIndex}`,
    x, y, width, lineHeight, parentCs, children,
  );
}

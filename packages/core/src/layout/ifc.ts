import type { ElementBox, RenderNode, TextBox } from "../render/render-node-v2";
import type { ComputedStyle } from "../styles";
import type { LayoutBox, LineBox } from "./layout-box-v2";
import { createLineBox, createTextRunBox } from "./layout-box-v2";
import type { TextMeasurer } from "./text-measurer";
import { tokenize } from "./text-tokenize";

interface Token {
  text: string;
  width: number;
  style: ComputedStyle;
  isSpace: boolean;
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

  // Collect tokens from all text children
  const tokens: Token[] = [];
  for (const child of parent.children) {
    if (child.type !== "text") continue;
    if (!child.computedStyle) throw new Error("cascade required");
    const cs = child.computedStyle;
    const parts = tokenize(child.text, cs.whiteSpace);
    for (const part of parts) {
      tokens.push({
        text: part,
        width: measurer.measureWidth(part, cs),
        style: cs,
        isSpace: /^\s+$/.test(part),
      });
    }
  }

  // Greedy line wrap
  const lines: LayoutBox[] = [];
  let lineY = contentY;
  let currentTokens: Token[] = [];
  let currentWidth = 0;
  let lineIndex = 0;

  for (const tok of tokens) {
    if (currentWidth + tok.width > contentWidth && currentTokens.length > 0) {
      // Drop trailing space
      while (currentTokens.length > 0 && currentTokens[currentTokens.length - 1].isSpace) {
        currentTokens.pop();
      }
      const line = buildLine(parent.key, lineIndex++, contentX, lineY, contentWidth, currentTokens, parentCs, measurer);
      lines.push(line);
      lineY += line.height;
      currentTokens = [];
      currentWidth = 0;
      if (tok.isSpace) continue;  // skip leading space on new line
    }
    currentTokens.push(tok);
    currentWidth += tok.width;
  }

  if (currentTokens.length > 0) {
    while (currentTokens.length > 0 && currentTokens[currentTokens.length - 1].isSpace) {
      currentTokens.pop();
    }
    const line = buildLine(parent.key, lineIndex++, contentX, lineY, contentWidth, currentTokens, parentCs, measurer);
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
  tokens: Token[],
  parentCs: ComputedStyle,
  measurer: TextMeasurer,
): LineBox {
  // Group consecutive tokens of the same style into TextRunBoxes.
  // For Plan 1 simplicity, every token is its own TextRunBox.
  const children: LayoutBox[] = [];
  let runX = 0;
  let lineHeight = 0;
  for (const tok of tokens) {
    const tokHeight = measurer.measureHeight(tok.style);
    lineHeight = Math.max(lineHeight, tokHeight);
    children.push(createTextRunBox(
      `${parentKey}-l${lineIndex}-r${children.length}`,
      runX, 0, tok.width, tokHeight, tok.style, tok.text,
    ));
    runX += tok.width;
  }
  if (lineHeight === 0) lineHeight = measurer.measureHeight(parentCs);
  return createLineBox(
    `${parentKey}-l${lineIndex}`,
    x, y, width, lineHeight, parentCs, children,
  );
}

// Suppress unused-import warnings for future Plan 2 use
void (undefined as unknown as RenderNode);
void (undefined as unknown as TextBox);

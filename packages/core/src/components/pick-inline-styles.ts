import type { RenderStyles } from "../render/render-node";
import type { StateNode } from "../state/state-node";

/** Extract inline style properties from a state node's properties record. */
export function pickInlineStyles(
  properties: StateNode["properties"],
): RenderStyles {
  const styles: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: string;
    fontStyle?: string;
    textDecoration?: string;
    lineHeight?: number;
  } = {};
  if (typeof properties.fontFamily === "string")
    styles.fontFamily = properties.fontFamily;
  if (typeof properties.fontSize === "number")
    styles.fontSize = properties.fontSize;
  if (typeof properties.fontWeight === "string")
    styles.fontWeight = properties.fontWeight;
  if (typeof properties.fontStyle === "string")
    styles.fontStyle = properties.fontStyle;
  if (typeof properties.textDecoration === "string")
    styles.textDecoration = properties.textDecoration;
  if (typeof properties.lineHeight === "number")
    styles.lineHeight = properties.lineHeight;
  return styles;
}

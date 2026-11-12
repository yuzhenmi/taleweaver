import type { ElementBox, RenderNode } from "@taleweaver/core";

/**
 * The floated atoms (wrapped inline images) of a paragraph's inline run, in
 * source order. They sit in the IFC as zero-width placeholders; the BFC places
 * their boxes at the paragraph's top before the lines are wrapped (Word /
 * Google Docs: a wrapped image is positioned relative to its paragraph).
 * Descends `display: inline` wrappers, as the IFC token walk does.
 */
export function paragraphFloats(children: readonly RenderNode[]): ElementBox[] {
  const out: ElementBox[] = [];
  for (const child of children) {
    if (child.type !== "element") continue;
    const cs = child.computedStyle;
    if (cs === undefined) continue;
    if (cs.display === "inline-block" && cs.float !== "none") out.push(child);
    else if (cs.display === "inline") out.push(...paragraphFloats(child.children));
  }
  return out;
}

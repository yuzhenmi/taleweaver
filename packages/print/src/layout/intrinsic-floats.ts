import type { ElementBox, IntrinsicContribution, IntrinsicFloats } from "@taleweaver/core";

/** A floated box (a block float or a floated atom such as a wrapped image). */
export function isFloated(node: ElementBox): boolean {
  return node.computedStyle !== undefined && node.computedStyle.float !== "none";
}

/**
 * One floated box as a float component, from its margin-box contribution: an
 * unbreakable item for min-content; for max-content it sits beside its line on
 * its side — a `break` image (full-width exclusion) takes a line of its own.
 */
export function floatOf(node: ElementBox, outer: IntrinsicContribution): IntrinsicFloats {
  const ownLine = node.metadata?.inlineFloat?.exclusion === "full";
  const start = !ownLine && node.computedStyle?.float === "inline-start";
  return {
    min: outer.minContent,
    startMax: start ? outer.maxContent : 0,
    endMax: !ownLine && !start ? outer.maxContent : 0,
    ownLineMax: ownLine ? outer.maxContent : 0,
    alone: true,
  };
}

export function mergeFloats(a: IntrinsicFloats | undefined, b: IntrinsicFloats): IntrinsicFloats {
  if (a === undefined) return b;
  return {
    min: Math.max(a.min, b.min),
    startMax: a.startMax + b.startMax,
    endMax: a.endMax + b.endMax,
    ownLineMax: Math.max(a.ownLineMax, b.ownLineMax),
    alone: a.alone && b.alone,
  };
}

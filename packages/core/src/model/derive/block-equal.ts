import { attrsEqual } from "../equality";
import type { Block, InlineItem, ReadonlyAttrs } from "../block";
import { isText } from "../scan/kinds";

function itemEqual(a: InlineItem, b: InlineItem): boolean {
  if (a === b) return true; // unchanged runs share their item objects
  if (isText(a)) return isText(b) && a.text === b.text && attrsEqual(a.attrs, b.attrs);
  return !isText(b) && a.embedType === b.embedType && attrsEqual(a.attrs, b.attrs) && attrsEqual(a.properties, b.properties);
}

const optAttrsEqual = (a: ReadonlyAttrs | undefined, b: ReadonlyAttrs | undefined): boolean =>
  a === undefined || b === undefined ? a === b : attrsEqual(a, b);

/** Two records read the same. */
export function blockEqual(a: Block, b: Block): boolean {
  if (
    a.id !== b.id ||
    a.type !== b.type ||
    a.parentId !== b.parentId ||
    a.prevSiblingId !== b.prevSiblingId ||
    a.nextSiblingId !== b.nextSiblingId ||
    a.firstChildId !== b.firstChildId ||
    a.lastChildId !== b.lastChildId ||
    !attrsEqual(a.attrs, b.attrs) ||
    !optAttrsEqual(a.markAttrs, b.markAttrs) ||
    a.breakSuggestion?.insertionId !== b.breakSuggestion?.insertionId ||
    a.breakSuggestion?.deletionId !== b.breakSuggestion?.deletionId ||
    (a.breakSuggestion === undefined) !== (b.breakSuggestion === undefined)
  ) {
    return false;
  }
  const ia = a.inlineContent?.items;
  const ib = b.inlineContent?.items;
  if (ia === undefined || ib === undefined) return ia === ib;
  if (ia.length !== ib.length) return false;
  for (let i = 0; i < ia.length; i++) {
    const x = ia[i];
    const y = ib[i];
    if (x === undefined || y === undefined || !itemEqual(x, y)) return false;
  }
  return true;
}

import * as Y from "yjs";

/** The embedded item map at storage `index` of `piece` (Plans read storage only where the version keeps no reference). */
export function mapAtIndex(piece: Y.Text, index: number): Y.Map<unknown> | null {
  let n = 0;
  for (let it = piece._start; it !== null; it = it.right) {
    if (it.deleted || !it.countable) continue;
    if (n === index) return it.content instanceof Y.ContentType && it.content.type instanceof Y.Map ? it.content.type : null;
    n += it.length;
    if (n > index) return null;
  }
  return null;
}

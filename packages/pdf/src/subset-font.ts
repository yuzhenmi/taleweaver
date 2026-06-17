/**
 * Subset a parsed sfnt to the used GIDs, returning new embeddable program bytes:
 * the whole sfnt for `glyf` (FontFile2), or the bare `CFF ` table for `cff`
 * (FontFile3). Unused glyph OUTLINES are dropped; GID/CID numbering is preserved.
 */

import { MalformedFontError, type ParsedFont } from "./truetype-parser";
import { subsetGlyf } from "./subset-glyf";
import { subsetCff } from "./subset-cff";

export function subsetFont(parsed: ParsedFont, usedGids: ReadonlySet<number>): Uint8Array {
  if (parsed.glyphFormat === "cff") {
    const cff = parsed.cff;
    if (cff === undefined) {
      throw new MalformedFontError("cff glyphFormat without a parsed CFF table");
    }
    return subsetCff(cff.programBytes, parsed.numGlyphs, usedGids);
  }
  return subsetGlyf(parsed.bytes, parsed.tables, parsed.indexToLocFormat, parsed.numGlyphs, usedGids);
}

/**
 * A deterministic 6-uppercase-letter subset tag derived from the sorted used-GID
 * set (PDF §9.6.4 subset-font `XXXXXX+` prefix). FNV-1a over the GID bytes, then
 * base-26. Same subset → same tag (reproducible output); different subsets → (very
 * likely) different tags.
 */
export function subsetTag(usedGids: ReadonlySet<number>): string {
  let h = 0x811c9dc5;
  for (const g of [...usedGids].sort((a, b) => a - b)) {
    for (let s = 0; s < 32; s += 8) {
      h ^= (g >>> s) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  let tag = "";
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (h % 26));
    h = Math.floor(h / 26);
  }
  return tag;
}

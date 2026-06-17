/**
 * Build a PDF `/ToUnicode` CMap (PDF §9.10.3) mapping each CID (as it appears in
 * the content stream under Identity-H encoding) to its Unicode text. This is what
 * makes the embedded text searchable/copyable in a PDF reader.
 *
 * The destination of each `bfchar` entry is the Unicode value encoded as
 * **UTF-16BE**. Because JS strings are already UTF-16, we iterate the string's
 * code UNITS (`charCodeAt`) — NOT codepoints (`codePointAt` / `for…of`). An
 * astral scalar (e.g. U+1F600) is therefore already a surrogate pair of two code
 * units and naturally emits as `D83DDE00`. Emitting the 4-byte UCS-4 scalar value
 * (`0001F600`) instead would break PDF readers, which expect UTF-16BE here.
 *
 * The source side (the CID) is a 4-hex-digit code, consistent with the
 * `<0000> <FFFF>` codespacerange.
 */

/** A CID as 4 zero-padded uppercase hex digits. */
function cidHex(cid: number): string {
  return (cid & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/** The string as concatenated UTF-16BE code units (4 hex digits each). */
function utf16beHex(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    out += (s.charCodeAt(i) & 0xffff).toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}

/** Max bfchar entries per block, per the CMap spec. */
const BFCHAR_CHUNK = 100;

/**
 * Build the `/ToUnicode` CMap text for the given CID→Unicode entries. Entries are
 * emitted in the Map's insertion order, chunked into `beginbfchar`/`endbfchar`
 * blocks of at most {@link BFCHAR_CHUNK} entries each.
 */
export function buildToUnicodeCMap(entries: ReadonlyMap<number, string>): string {
  const all: string[] = [];
  for (const [cid, unicode] of entries) {
    all.push(`<${cidHex(cid)}> <${utf16beHex(unicode)}>`);
  }

  let bfBlocks = "";
  for (let i = 0; i < all.length; i += BFCHAR_CHUNK) {
    const chunk = all.slice(i, i + BFCHAR_CHUNK);
    bfBlocks += `${chunk.length} beginbfchar\n${chunk.join("\n")}\nendbfchar\n`;
  }

  return (
    "/CIDInit /ProcSet findresource begin\n" +
    "12 dict begin\n" +
    "begincmap\n" +
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
    "/CMapName /Adobe-Identity-UCS def\n" +
    "/CMapType 2 def\n" +
    "1 begincodespacerange\n" +
    "<0000> <FFFF>\n" +
    "endcodespacerange\n" +
    bfBlocks +
    "endcmap\n" +
    "CMapName currentdict /CMap defineresource pop\n" +
    "end\n" +
    "end\n"
  );
}

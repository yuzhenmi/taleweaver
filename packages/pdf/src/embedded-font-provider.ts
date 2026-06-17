import type { ComputedStyle } from "@taleweaver/core";
import type { PdfWriter } from "./pdf-writer";
import {
  createStandard14FontProvider,
  type PdfFontProvider,
  type PdfFontHandle,
  type EncodedCluster,
  type EncodedRun,
} from "./font-provider";
import { parseSfnt, type ParsedFont } from "./truetype-parser";
import { writeCompositeFontObjects, type CompositeFontData } from "./composite-font";
import { subsetFont, subsetTag } from "./subset-font";

/**
 * The real, end-to-end embedded-font provider: parses each host-supplied sfnt
 * once at construction — `glyf`-flavoured TrueType OR OpenType-CFF (`OTTO`) —
 * resolves a `ComputedStyle` whose `fontFamily` matches a parsed family to an
 * EMBEDDED handle, encodes runs to 2-byte Identity-H content codes via the
 * font's own `cmap`, and writes the full composite object graph (Type0 /
 * CIDFontType2+FontFile2 for `glyf`, or CIDFontType0+FontFile3/CIDFontType0C for
 * CFF / FontDescriptor / ToUnicode) through the SHARED
 * {@link writeCompositeFontObjects} seam. Any family NOT in `fonts` delegates to
 * a fallback (default: the standard-14 provider), so a mixed document
 * round-trips.
 *
 * THE CID INVARIANT (load-bearing for CID-keyed CFF): the 2-byte code emitted by
 * `encodeRun`, the keys of the `/W` widths map, the keys of the `/ToUnicode`
 * map, and the CID space the viewer resolves through the embedded charset ALL
 * agree = the CID (not the GID). For a non-CID-keyed CFF and for `glyf`, the
 * font has no CID layer, so CID == GID and all four legs coincide on the GID.
 * `encodeRun` computes the emitted CODE from the GID (CID for a CID-keyed CFF,
 * else the GID itself) and accumulates BY THAT CODE; `writeFontObjects` keys
 * `/W` + `/ToUnicode` by the same code, recovering the GID (via a per-family
 * code→GID map) only to read the `hmtx` advance.
 *
 * Zero runtime dependencies; pure-byte (no DOM/Node). A malformed host font
 * surfaces loudly: `parseSfnt` throws at construction (a host error).
 *
 * `fontKey` IS the family name (one font program per family). The per-family
 * code→unicode map (`codeToUnicode`) is accumulated during `encodeRun` and feeds
 * both the `/W` (used codes only) and the `/ToUnicode` CMap at write time — it is
 * keyed per-family because code N in FontA and code N in FontB are DISTINCT glyphs.
 */
export function createEmbeddedFontProvider(opts: {
  readonly fonts: Readonly<Record<string, Uint8Array>>;
  readonly fallback?: PdfFontProvider;
}): PdfFontProvider {
  const fallback = opts.fallback ?? createStandard14FontProvider();

  // Parse each host font once. A malformed font throws here (a host error).
  const parsedFonts = new Map<string, ParsedFont>();
  for (const [family, bytes] of Object.entries(opts.fonts)) {
    parsedFonts.set(family, parseSfnt(bytes));
  }

  // family → (emitted CODE → its Unicode text), populated as `encodeRun` encodes
  // glyphs. The CODE is the CID for a CID-keyed CFF, else the GID (CID==GID).
  // Per-family: code N in two different fonts are distinct glyphs, so a single
  // flat map would be WRONG for a multi-family document.
  const codeToUnicode = new Map<string, Map<number, string>>();

  // family → (emitted CODE → GID). For a CID-keyed CFF the CID differs from the
  // GID; `/W` is keyed by the CID but the `hmtx` advance is indexed by the GID,
  // so we remember the GID per emitted code. For non-CID-keyed/glyf this is the
  // identity map (CID==GID) and the lookup falls back to the code itself.
  const codeToGid = new Map<string, Map<number, number>>();

  function parsedFor(fontKey: string): ParsedFont {
    const parsed = parsedFonts.get(fontKey);
    if (parsed === undefined) {
      throw new Error(`pdf: no parsed font for embedded fontKey ${JSON.stringify(fontKey)}`);
    }
    return parsed;
  }

  function codeMapFor(fontKey: string): Map<number, string> {
    let fam = codeToUnicode.get(fontKey);
    if (fam === undefined) {
      fam = new Map<number, string>();
      codeToUnicode.set(fontKey, fam);
    }
    return fam;
  }

  function codeToGidFor(fontKey: string): Map<number, number> {
    let c2g = codeToGid.get(fontKey);
    if (c2g === undefined) {
      c2g = new Map<number, number>();
      codeToGid.set(fontKey, c2g);
    }
    return c2g;
  }

  return {
    resolveFont(used: ComputedStyle): PdfFontHandle {
      const family = used.fontFamily;
      if (family !== undefined) {
        const parsed = parsedFonts.get(family);
        if (parsed !== undefined) {
          return {
            kind: "embedded",
            baseFont: parsed.descriptor.fontName,
            fontKey: family,
          };
        }
      }
      return fallback.resolveFont(used);
    },

    encodeRun(handle: PdfFontHandle, text: string): EncodedRun {
      if (handle.kind !== "embedded") {
        return fallback.encodeRun(handle, text);
      }
      const parsed = parsedFor(handle.fontKey);
      const fam = codeMapFor(handle.fontKey);
      const c2g = codeToGidFor(handle.fontKey);
      const clusters: EncodedCluster[] = [];
      // Bind `cff` once with explicit narrowing (mirrors writeFontObjects) — for a
      // "cff" glyphFormat parseSfnt guarantees it, but the `!== undefined` guard
      // keeps the type proof local rather than leaning on that contract.
      const cff = parsed.cff;
      const cidKeyed = parsed.glyphFormat === "cff" && cff !== undefined && cff.isCidKeyed;
      // `for...of` iterates by Unicode code point, so an astral char is ONE step.
      for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        const gid = parsed.cmapLookup(cp);
        // THE CID INVARIANT: the emitted code is the CID for a CID-keyed CFF,
        // else the GID itself (CID==GID for non-CID-keyed CFF and glyf). The
        // `?? 0` yields CID 0 (.notdef) for an implicit GID-0 the charset never
        // enumerates — load-bearing; do NOT drop it.
        const code = cidKeyed && cff !== undefined ? (cff.gidToCid?.get(gid) ?? 0) : gid;
        // 2-byte big-endian content code (Identity-H).
        const bytes = new Uint8Array([(code >> 8) & 0xff, code & 0xff]);
        // Accumulate keyed by the EMITTED CODE (the invariant); remember the GID
        // so `writeFontObjects` can read the `hmtx` advance.
        fam.set(code, ch);
        c2g.set(code, gid);
        clusters.push({ bytes, unicode: ch });
      }
      return { clusters, dropped: 0 };
    },

    // Contract (mirrors the standard-14 / mock providers): `encodeRun` MUST have
    // run for every embedded handle before `writeFontObjects` — that is what
    // populates the per-family code→unicode map this reads. A handle that was
    // resolved but never encoded has an empty map, yielding an empty `/W` + empty
    // ToUnicode (a legal, if inert, font object); the emitter always encodes runs
    // before writing fonts, so this path is not reached in practice.
    writeFontObjects(
      usedHandles: readonly PdfFontHandle[],
      writer: PdfWriter,
    ): ReadonlyMap<PdfFontHandle, number> {
      const map = new Map<PdfFontHandle, number>();
      for (const h of usedHandles) {
        if (h.kind !== "embedded") {
          // Delegate std-14 handles to the fallback, keying by the SAME handle
          // reference (the fallback returns a map keyed by the handle it was
          // given — do NOT structurally re-key).
          const sub = fallback.writeFontObjects([h], writer);
          const id = sub.get(h);
          if (id === undefined) {
            throw new Error(`pdf: fallback returned no object for ${h.fontKey}`);
          }
          map.set(h, id);
          continue;
        }
        const parsed = parsedFor(h.fontKey);
        const fam = codeMapFor(h.fontKey);
        const c2g = codeToGidFor(h.fontKey);

        // Used GIDs: every emitted code's GID, PLUS GID 0 (.notdef) unconditionally
        // — the universal fallback glyph, which may not appear in c2g.values().
        const usedGids = new Set<number>([0, ...c2g.values()]);

        // /W over the USED codes only (the keys of `fam`) — never all numGlyphs,
        // which would bloat /W for a large CJK font. Keyed by the EMITTED CODE
        // (CID for a CID-keyed CFF, else GID); the advance is read from `hmtx`
        // via the GID, recovered from the code→GID map (CID==GID fallback).
        const widths = new Map<number, number>();
        for (const code of fam.keys()) {
          const gid = c2g.get(code) ?? code;
          widths.set(code, Math.round((parsed.advanceOf(gid) * 1000) / parsed.unitsPerEm));
        }

        // Subset the embedded program (drops unused glyph OUTLINES; preserves
        // GID/CID numbering, so widths / cidToUnicode / embed are all unchanged).
        // glyf → the whole subset sfnt (FontFile2); CFF → the bare subset CFF table.
        const programBytes = subsetFont(parsed, usedGids);

        // Subset font tag (PDF §9.6.4): the 6-letter `XXXXXX+` prefix on BOTH the
        // /BaseFont and the FontDescriptor /FontName signals "subset" to viewers.
        const tag = subsetTag(usedGids);
        const taggedName = `${tag}+${parsed.descriptor.fontName}`;

        // Embedded-program organisation follows the sfnt's glyph-outline format:
        // CFF → FontFile3/CIDFontType0C; glyf → FontFile2/CIDFontType2.
        let embed: CompositeFontData["embed"];
        const cff = parsed.cff;
        if (parsed.glyphFormat === "cff" && cff !== undefined) {
          if (cff.isCidKeyed) {
            if (cff.ros === undefined) {
              // Unreachable: parseCff guarantees `ros` whenever isCidKeyed.
              throw new Error("pdf: CID-keyed CFF lacks ROS");
            }
            embed = {
              kind: "cff",
              cidSystemInfo: {
                registry: cff.ros.registry,
                ordering: cff.ros.ordering,
                supplement: cff.ros.supplement,
              },
            };
          } else {
            // Non-CID-keyed CFF: embed under the Identity CID system (CID==GID).
            embed = { kind: "cff", cidSystemInfo: { registry: "Adobe", ordering: "Identity", supplement: 0 } };
          }
        } else {
          embed = { kind: "truetype" };
        }

        const data: CompositeFontData = {
          baseFont: taggedName,
          programBytes,
          descriptor: { ...parsed.descriptor, fontName: taggedName },
          widths,
          defaultWidth: 1000,
          cidToUnicode: fam,
          embed,
        };
        const id = writeCompositeFontObjects(data, writer);
        map.set(h, id);
      }
      return map;
    },
  };
}

import type { ComputedStyle } from "@taleweaver/core";
import type { PdfWriter } from "./pdf-writer";
import { encodeWinAnsi } from "./winansi";

/** One encoded display cluster: the bytes to show + its logical Unicode. */
export interface EncodedCluster {
  readonly bytes: Uint8Array;
  readonly unicode: string;
}

export interface EncodedRun {
  readonly clusters: readonly EncodedCluster[];
  /** Count of codepoints dropped to '?' (out of the provider's coverage). */
  readonly dropped: number;
}

/**
 * A resolved font, opaque to the emitter except for diagnostics. `baseFont` is
 * the PostScript name (for tests/debug); `fontKey` is the per-PROGRAM identity
 * the emitter de-dupes and resource-names by. For a standard-14 simple font the
 * two coincide (one program per base font); for an embedded CIDFont they differ
 * (`fontKey` keys a font PROGRAM, which may serve several base names / subsets).
 */
export interface PdfFontHandle {
  readonly kind: "standard14" | "embedded";
  readonly baseFont: string;
  readonly fontKey: string;
}

/**
 * The injected font capability. A provider owns the mapping from a
 * `ComputedStyle` to a font (`resolveFont`), the encoding of a run into display
 * clusters + bytes (`encodeRun`), and — the seam — the writing of its own PDF
 * font objects (`writeFontObjects`). The per-program identity of a handle is
 * read directly off `PdfFontHandle.fontKey` (the handle carries its own dedup
 * key). The emitter de-dupes used handles by `fontKey`, assigns
 * one stable `/Fn` resource name per key document-wide, and hands the deduped
 * handles to `writeFontObjects`, which allocates + writes each handle's font
 * object(s) and returns a handle→objId map for the resource dict. The standard-14
 * provider writes one simple Type1 object per handle; the embedded path writes
 * composite (Type0 + CIDFont + descriptor + font-file) objects through the SAME
 * seam.
 */
export interface PdfFontProvider {
  /** Map a `ComputedStyle` to a font. Resolution is intended to be cheap &
   *  stateless — callers may invoke it per text leaf, so providers SHOULD NOT
   *  need to cache results. */
  resolveFont(used: ComputedStyle): PdfFontHandle;
  encodeRun(handle: PdfFontHandle, text: string): EncodedRun;
  writeFontObjects(
    usedHandles: readonly PdfFontHandle[],
    writer: PdfWriter,
  ): ReadonlyMap<PdfFontHandle, number>;
}

/**
 * `ComputedStyle.fontWeight` is `"normal" | "bold" | "lighter" | "bolder" |
 * number` (styles/style.ts) and the cascade emits the literal string `"bold"`
 * (cascade/builtin-attrs.ts) — so a numeric-only check would silently miss every
 * actually-bold run. Treat `"bold"`/`"bolder"` and numeric ≥ 600 as bold.
 */
function isBold(weight: ComputedStyle["fontWeight"]): boolean {
  if (typeof weight === "number") return weight >= 600;
  return weight === "bold" || weight === "bolder";
}

function isSerif(family: string): boolean {
  const f = family.toLowerCase();
  // A bare `serif` keyword (and not a `sans`/`sans-serif` family) → serif.
  if (f.includes("serif") && !f.includes("sans")) return true;
  // Named serif families. NOTE: `serif` is deliberately NOT in this regex —
  // `\bserif\b` would match the `serif` inside `sans-serif` (the hyphen is a word
  // boundary), misclassifying e.g. "Inter, sans-serif" as serif. The guard above
  // handles the generic keyword; this catches a named serif even in a list that
  // also contains a `sans-serif` fallback (e.g. "Times, sans-serif" → Times).
  return /\b(times|georgia|garamond|cambria|book antiqua)\b/.test(f);
}

function isMono(family: string): boolean {
  const f = family.toLowerCase();
  return /\b(mono|courier|consolas|menlo)\b/.test(f);
}

function baseFontFor(used: ComputedStyle): string {
  const bold = isBold(used.fontWeight);
  const italic = used.fontStyle === "italic" || used.fontStyle === "oblique";
  const family = used.fontFamily ?? "sans-serif";
  if (isMono(family)) {
    if (bold && italic) return "Courier-BoldOblique";
    if (bold) return "Courier-Bold";
    if (italic) return "Courier-Oblique";
    return "Courier";
  }
  if (isSerif(family)) {
    if (bold && italic) return "Times-BoldItalic";
    if (bold) return "Times-Bold";
    if (italic) return "Times-Italic";
    return "Times-Roman";
  }
  if (bold && italic) return "Helvetica-BoldOblique";
  if (bold) return "Helvetica-Bold";
  if (italic) return "Helvetica-Oblique";
  return "Helvetica";
}

/**
 * The default zero-dependency provider: standard-14 simple Type1 fonts,
 * WinAnsi-encoded. A PERMANENT baseline (it coexists with the future embedded
 * provider); not a v1 substitute for embedding (spec §2/§4.8).
 */
export function createStandard14FontProvider(): PdfFontProvider {
  return {
    resolveFont(used: ComputedStyle): PdfFontHandle {
      const baseFont = baseFontFor(used);
      // For a simple standard-14 font the program identity IS the base name.
      return { kind: "standard14", baseFont, fontKey: baseFont };
    },

    encodeRun(_handle: PdfFontHandle, text: string): EncodedRun {
      const clusters: EncodedCluster[] = [];
      let dropped = 0;
      for (const ch of text) {
        const enc = encodeWinAnsi(ch);
        dropped += enc.dropped;
        clusters.push({ bytes: enc.bytes, unicode: ch });
      }
      return { clusters, dropped };
    },

    writeFontObjects(
      usedHandles: readonly PdfFontHandle[],
      writer: PdfWriter,
    ): ReadonlyMap<PdfFontHandle, number> {
      const map = new Map<PdfFontHandle, number>();
      for (const h of usedHandles) {
        const id = writer.allocate();
        writer.writeObject(
          id,
          `<< /Type /Font /Subtype /Type1 /BaseFont /${h.baseFont} /Encoding /WinAnsiEncoding >>`,
        );
        map.set(h, id);
      }
      return map;
    },
  };
}

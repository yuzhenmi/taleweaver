import type { ComputedStyle } from "@taleweaver/core";
import type { PdfWriter } from "./pdf-writer";
import {
  createStandard14FontProvider,
  type PdfFontProvider,
  type PdfFontHandle,
  type EncodedCluster,
  type EncodedRun,
} from "./font-provider";
import { writeCompositeFontObjects, type CompositeFontData } from "./composite-font";

/**
 * A MOCK embedded-font provider for unit-testing the composite (Type0 /
 * CIDFontType2) object-graph machinery WITHOUT a real TrueType parser, a font
 * asset, or subsetting (those land in slices c.2/c.3). It synthesizes a tiny,
 * deterministic per-family "font program" blob, a trivial codepoint→CID cmap,
 * per-CID widths, and FontDescriptor metrics, then writes the full embedded
 * object graph through the same `writeFontObjects` seam the standard-14 provider
 * uses. It also holds an inner standard-14 provider so a MIXED document (embedded
 * + std-14 runs) round-trips: non-embedded families delegate to it.
 *
 * NOT added to the public barrel — it is a test fixture + a conformance target
 * for the real embedded provider's object graph.
 */

/** All metrics here are in 1000-unit em (font design) space — NOT px/pt. */
interface MockDescriptor {
  readonly flags: number;
  readonly fontBBox: readonly [number, number, number, number];
  readonly italicAngle: number;
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly stemV: number;
  readonly fontName: string;
}

interface MockFontData {
  /** codepoint → CID. */
  readonly cmap: ReadonlyMap<number, number>;
  /** CID → advance (1000-em units). */
  readonly widths: ReadonlyMap<number, number>;
  /** Deterministic, per-family-distinct synthetic font-program blob. */
  readonly programBytes: Uint8Array;
  readonly descriptor: MockDescriptor;
}

/** The fontKey for an embedded family (per-PROGRAM identity — NOT baseFont). */
function embeddedFontKey(family: string): string {
  return `embedded:${family}`;
}

/** Every mock embedded family resolves to this (deliberately shared) baseFont so
 *  the collision test can prove dedup keys on fontKey, not baseFont. */
const SHARED_BASE_FONT = "AAAAAA+MockFont";

// The ToUnicode CMap is pure ASCII, a subset of UTF-8, so this is byte-exact.
const UTF8 = new TextEncoder();

/**
 * Build a deterministic, per-family-distinct program blob. Embedding the family
 * name's bytes guarantees two families' blobs byte-differ (the collision test).
 * A small fixed prefix stands in for a (mock) sfnt header.
 */
function makeProgramBytes(family: string): Uint8Array {
  const name = UTF8.encode(family);
  const prefix = Uint8Array.of(0x00, 0x01, 0x00, 0x00, 0x4d, 0x4f, 0x43, 0x4b); // "\0\1\0\0MOCK"
  const out = new Uint8Array(prefix.length + name.length);
  out.set(prefix, 0);
  out.set(name, prefix.length);
  return out;
}

function makeFontData(family: string): MockFontData {
  // Trivial cmap: map each printable ASCII codepoint to a CID equal to the
  // codepoint (so 'A' = U+0041 = cid 65). Widths vary trivially per CID.
  const cmap = new Map<number, number>();
  const widths = new Map<number, number>();
  for (let cp = 0x20; cp <= 0x7e; cp++) {
    const cid = cp;
    cmap.set(cp, cid);
    // Deterministic width: a base plus a small per-cid wobble, in 1000-em units.
    // 'A' (cid 65) → 540 (asserted by the test).
    widths.set(cid, cid === 65 ? 540 : 500 + (cid % 7) * 10);
  }
  // One astral codepoint (U+1F600 😀) so the ToUnicode surrogate-pair path is
  // exercised end-to-end through the real emit pipeline. cid 200 (outside ASCII).
  const ASTRAL_CP = 0x1f600;
  const ASTRAL_CID = 200;
  cmap.set(ASTRAL_CP, ASTRAL_CID);
  widths.set(ASTRAL_CID, 1000);
  return {
    cmap,
    widths,
    programBytes: makeProgramBytes(family),
    descriptor: {
      flags: 32, // nonzero (bit 6 = Nonsymbolic), conventional for a text font
      fontBBox: [-200, -250, 1000, 900],
      italicAngle: 0,
      ascent: 750,
      descent: -250,
      capHeight: 700,
      stemV: 80,
      fontName: SHARED_BASE_FONT,
    },
  };
}

/** The provider type with a test-only accessor for the synthetic program blob. */
export interface MockEmbeddedFontProvider extends PdfFontProvider {
  /** TEST-ONLY: the deterministic program blob written as FontFile2 for `family`. */
  __test_programBytes(family: string): Uint8Array;
}

export function createMockEmbeddedFontProvider(opts?: {
  embeddedFamilies?: readonly string[];
}): MockEmbeddedFontProvider {
  const families = opts?.embeddedFamilies ?? ["MockEmbedded"];
  const familySet = new Set(families);
  const inner = createStandard14FontProvider();

  // fontKey → mock data, built eagerly at construction time.
  const dataByKey = new Map<string, MockFontData>();
  // family → MockFontData (used by __test_programBytes).
  const dataByFamily = new Map<string, MockFontData>();
  for (const fam of families) {
    const data = makeFontData(fam);
    dataByFamily.set(fam, data);
    dataByKey.set(embeddedFontKey(fam), data);
  }

  function dataFor(handle: PdfFontHandle): MockFontData {
    const data = dataByKey.get(handle.fontKey);
    if (data === undefined) {
      throw new Error(
        `mock-embedded: no font data for fontKey ${JSON.stringify(handle.fontKey)}`,
      );
    }
    return data;
  }

  return {
    resolveFont(used: ComputedStyle): PdfFontHandle {
      const family = used.fontFamily;
      if (family !== undefined && familySet.has(family)) {
        return {
          kind: "embedded",
          baseFont: SHARED_BASE_FONT,
          fontKey: embeddedFontKey(family),
        };
      }
      return inner.resolveFont(used);
    },

    encodeRun(handle: PdfFontHandle, text: string): EncodedRun {
      if (handle.kind !== "embedded") return inner.encodeRun(handle, text);
      const data = dataFor(handle);
      const clusters: EncodedCluster[] = [];
      for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        const cid = data.cmap.get(cp) ?? 0;
        // 2-byte big-endian CID (Identity-H).
        const bytes = new Uint8Array([(cid >> 8) & 0xff, cid & 0xff]);
        clusters.push({ bytes, unicode: ch });
      }
      return { clusters, dropped: 0 };
    },

    writeFontObjects(
      usedHandles: readonly PdfFontHandle[],
      writer: PdfWriter,
    ): ReadonlyMap<PdfFontHandle, number> {
      const map = new Map<PdfFontHandle, number>();
      for (const h of usedHandles) {
        if (h.kind === "standard14") {
          const sub = inner.writeFontObjects([h], writer);
          const id = sub.get(h);
          if (id === undefined) {
            throw new Error(
              `mock-embedded: inner provider returned no object for ${h.fontKey}`,
            );
          }
          map.set(h, id);
          continue;
        }
        // Embedded composite graph — assemble CompositeFontData from the mock's
        // fields and delegate to the shared writer (byte-identical graph as the
        // real provider). The mock's cmap implies cid → the codepoint's character.
        const data = dataFor(h);
        const cidToUnicode = new Map<number, string>();
        for (const [cp, cid] of data.cmap) {
          cidToUnicode.set(cid, String.fromCodePoint(cp));
        }
        const compositeData: CompositeFontData = {
          baseFont: h.baseFont,
          programBytes: data.programBytes,
          descriptor: data.descriptor,
          widths: data.widths,
          defaultWidth: 1000,
          cidToUnicode,
          embed: { kind: "truetype" },
        };
        const t0Id = writeCompositeFontObjects(compositeData, writer);
        map.set(h, t0Id);
      }
      return map;
    },

    __test_programBytes(family: string): Uint8Array {
      const data = dataByFamily.get(family);
      if (data === undefined) {
        throw new Error(`mock-embedded: no family ${JSON.stringify(family)}`);
      }
      return data.programBytes;
    },
  };
}

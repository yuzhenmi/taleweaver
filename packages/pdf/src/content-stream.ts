import type { Rgb } from "./color";

/**
 * Format a number with ≤4 decimals, trailing zeros + dot trimmed. Throws on a
 * non-finite value: `num(NaN)`/`num(±Infinity)` would emit a token (`"NaN"`,
 * `"Infinity"`) that corrupts the whole content stream, so this — the package's
 * single numeric chokepoint — fails loud rather than passing garbage through
 * (cf. `pdf-writer.encodeLatin1` throwing on non-Latin1).
 */
export function num(n: number): string {
  if (!Number.isFinite(n)) {
    throw new RangeError(`pdf: non-finite number in content stream: ${n}`);
  }
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/\.?0+$/, "");
}

function hexString(bytes: Uint8Array): string {
  let s = "<";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s + ">";
}

/**
 * Accumulates PDF content-stream operators for one page as a latin1 string,
 * flushed to bytes. Phase (a): text-showing + fill color only.
 */
export class ContentStreamBuilder {
  private out = "";

  setFillColor(rgb: Rgb): void {
    this.out += `${num(rgb.r)} ${num(rgb.g)} ${num(rgb.b)} rg\n`;
  }

  /**
   * Show `bytes` at absolute PDF text origin (x,y) in font `resourceName` at
   * `sizePt`. Emits a self-contained `BT … Tf … Td … Tj … ET` so each call is
   * independently positioned (absolute per-cluster placement — spec §3).
   */
  showTextAt(
    resourceName: string,
    sizePt: number,
    x: number,
    y: number,
    bytes: Uint8Array,
  ): void {
    this.out +=
      `BT\n${resourceName} ${num(sizePt)} Tf\n` +
      `${num(x)} ${num(y)} Td\n${hexString(bytes)} Tj\nET\n`;
  }

  /** Fill an axis-aligned rect (PDF point space) with `rgb`. */
  fillRect(rgb: Rgb, x: number, y: number, w: number, h: number): void {
    this.out +=
      `${num(rgb.r)} ${num(rgb.g)} ${num(rgb.b)} rg\n` +
      `${num(x)} ${num(y)} ${num(w)} ${num(h)} re\nf\n`;
  }

  /** Fill a circle (PDF point space) with `rgb`, via the 4-Bézier approximation. */
  fillCircle(rgb: Rgb, cx: number, cy: number, radius: number): void {
    const k = 0.5522847498307936 * radius; // kappa·r
    const r = radius;
    const p = (n: number) => num(n);
    this.out +=
      `${num(rgb.r)} ${num(rgb.g)} ${num(rgb.b)} rg\n` +
      `${p(cx + r)} ${p(cy)} m\n` +
      `${p(cx + r)} ${p(cy + k)} ${p(cx + k)} ${p(cy + r)} ${p(cx)} ${p(cy + r)} c\n` +
      `${p(cx - k)} ${p(cy + r)} ${p(cx - r)} ${p(cy + k)} ${p(cx - r)} ${p(cy)} c\n` +
      `${p(cx - r)} ${p(cy - k)} ${p(cx - k)} ${p(cy - r)} ${p(cx)} ${p(cy - r)} c\n` +
      `${p(cx + k)} ${p(cy - r)} ${p(cx + r)} ${p(cy - k)} ${p(cx + r)} ${p(cy)} c\n` +
      `f\n`;
  }

  /** Place an image XObject: `q <cm> cm /<name> Do Q`. The 6 cm operands map the
   *  PDF unit image square [0,1]×[0,1] onto the device rect (translate + scale). */
  drawImageXObject(
    resourceName: string,
    cm: readonly [number, number, number, number, number, number],
  ): void {
    this.out += `q\n${cm.map(num).join(" ")} cm\n${resourceName} Do\nQ\n`;
  }

  /** Open a marked-content sequence linking drawn content to a structure
   *  element by MCID: `/<tag> <</MCID n>> BDC`. `tag` is the BDC tag (the
   *  structure type, e.g. "P"/"H1"/"Span"). Pair with endMarkedContent(). */
  beginMarkedContent(tag: string, mcid: number): void {
    if (!Number.isInteger(mcid) || mcid < 0) {
      throw new RangeError(`pdf: MCID must be a non-negative integer, got ${mcid}`);
    }
    this.out += `/${tag} <</MCID ${mcid}>> BDC\n`;
  }

  /** Close the innermost marked-content sequence: `EMC`. */
  endMarkedContent(): void {
    this.out += `EMC\n`;
  }

  /** Open an artifact sequence: `/Artifact BDC`. Content drawn between this and
   *  endArtifact() is excluded from the logical structure tree (PDF/UA: running
   *  heads/folios, decorative rules/images). */
  beginArtifact(): void {
    this.out += `/Artifact BDC\n`;
  }

  /** Close the innermost artifact sequence: `EMC`. */
  endArtifact(): void {
    this.out += `EMC\n`;
  }

  toBytes(): Uint8Array {
    const s = this.out;
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const cu = s.charCodeAt(i);
      if (cu > 0xff) {
        throw new RangeError(
          `ContentStreamBuilder: non-Latin1 code unit U+${cu.toString(16).toUpperCase()} at index ${i}`,
        );
      }
      b[i] = cu;
    }
    return b;
  }
}

/**
 * Parse a CSS color string to PDF RGB channels in [0,1]. `rgba()` alpha is
 * FLATTENED to opaque (PDF has no fill alpha without an ExtGState — deferred,
 * spec §3.1). `transparent` → null (caller skips the paint). An unrecognized
 * value falls back to opaque black (never throws — a PDF must always emit).
 *
 * There is no reusable CSS-color parser in core/dom (the canvas renderer passes
 * strings straight to `ctx.fillStyle`), so this is the new seam.
 */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const NAMED: Record<string, Rgb> = {
  black: { r: 0, g: 0, b: 0 },
  white: { r: 1, g: 1, b: 1 },
  red: { r: 1, g: 0, b: 0 },
  green: { r: 0, g: 128 / 255, b: 0 },
  blue: { r: 0, g: 0, b: 1 },
  gray: { r: 128 / 255, g: 128 / 255, b: 128 / 255 },
  grey: { r: 128 / 255, g: 128 / 255, b: 128 / 255 },
};

/** Opaque black — the universal fallback for unrecognized/unparsable colors. */
export const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/**
 * A 0–255 channel → a PDF [0,1] channel, CLAMPED. PDF `rg` operands must be in
 * [0,1] (PDF §8.6.4); CSS allows out-of-range ints (`rgb(300,0,0)` ≡ red), so we
 * clamp rather than emit an out-of-spec operand.
 */
function channel(n255: number): number {
  return Math.min(1, Math.max(0, n255 / 255));
}

/** Build an `Rgb` from three 0–255 ints, or BLACK if any is NaN (malformed). */
function rgbFrom255(r: number, g: number, b: number): Rgb {
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return BLACK;
  return { r: channel(r), g: channel(g), b: channel(b) };
}

/**
 * Supported input subset (matching what the engine's cascade actually emits —
 * `authorColorOf` produces `#rrggbb`, plus `rgb()/rgba()` integer notation, the
 * NAMED table, and `transparent`): `#rgb`, `#rrggbb`, `rgb(r,g,b)`,
 * `rgba(r,g,b,a)` (alpha ignored), a named color, or `transparent`. Anything else
 * — including CSS `hsl()`, `%` channels, or space-separated CSS-Color-4 syntax —
 * falls back to opaque black (a visible wrong color, never a crash or a NaN).
 */
export function parseCssColor(value: string): Rgb | null {
  const v = value.trim().toLowerCase();
  if (v === "transparent") return null;
  const named = NAMED[v];
  if (named !== undefined) return named;

  if (v.startsWith("#")) {
    const hex = v.slice(1);
    if (hex.length === 3) {
      const h0 = hex[0];
      const h1 = hex[1];
      const h2 = hex[2];
      // length === 3 guarantees indices 0..2 are present (structural invariant).
      if (h0 === undefined || h1 === undefined || h2 === undefined) {
        throw new Error(`parseCssColor: 3-char hex '${hex}' missing a digit`);
      }
      return rgbFrom255(
        parseInt(h0 + h0, 16),
        parseInt(h1 + h1, 16),
        parseInt(h2 + h2, 16),
      );
    }
    if (hex.length === 6) {
      return rgbFrom255(
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      );
    }
    return BLACK;
  }

  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m !== null) {
    const body = m[1];
    // Capture group 1 is mandatory on a successful match of this pattern.
    if (body === undefined) {
      throw new Error("parseCssColor: rgb() match missing its capture group");
    }
    const parts = body.split(",").map((p) => p.trim());
    if (parts.length >= 3) {
      return rgbFrom255(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    }
    return BLACK;
  }

  return BLACK;
}

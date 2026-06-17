import type { Color } from "./color";

/**
 * A fixed palette of visually-distinct, accessible author colors used to tint
 * tracked-change suggestions (insertion underline, deletion strike-through,
 * formatting-proposal indicator). Each author is hashed to one of these — same
 * author ⇒ same color on every call, mirroring Google Docs' per-collaborator
 * suggestion colors. The colors are deliberately saturated-but-dark enough to
 * read as text on a white page (each clears WCAG AA contrast against #fff).
 *
 * The palette is FIXED and small for v1. A host-configurable palette is a named
 * future follow-up — NOT this slice — so this stays a module-level constant
 * rather than an injected dependency.
 */
const AUTHOR_COLOR_PALETTE: readonly Color[] = [
  "#1a73e8", // blue
  "#d93025", // red
  "#188038", // green
  "#9334e6", // purple
  "#e8710a", // orange
  "#1a8aa0", // teal
  "#c5221f", // crimson
  "#a142f4", // violet
];

/**
 * Deterministically map an author string to a stable color from
 * {@link AUTHOR_COLOR_PALETTE}. Same author ⇒ same color every call; different
 * authors ⇒ (mostly) different colors. Uses a small djb2-style hash over the
 * author string's code units, then indexes the palette by the hash modulo its
 * length. Pure — no global state, no allocation beyond the integer hash.
 *
 * Collisions are possible (any hash into a fixed-size palette can collide), and
 * acceptable for v1: the palette is intentionally small + fixed, and a
 * host-configurable palette is the named future follow-up.
 */
export function authorColorOf(author: string): Color {
  // djb2: hash = hash * 33 + c, kept in 32-bit unsigned range via >>> 0.
  let hash = 5381;
  for (let i = 0; i < author.length; i++) {
    hash = (((hash << 5) + hash) + author.charCodeAt(i)) >>> 0;
  }
  const index = hash % AUTHOR_COLOR_PALETTE.length;
  // `hash >>> 0` is a non-negative integer and the palette is a fixed, non-empty
  // constant, so `index` is always a valid palette index.
  const color = AUTHOR_COLOR_PALETTE[index];
  if (color === undefined) {
    throw new Error(
      `author-color: palette index ${index} out of range (palette length ${AUTHOR_COLOR_PALETTE.length})`,
    );
  }
  return color;
}

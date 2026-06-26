/**
 * Dependency-free, runtime-agnostic base64 codec.
 * @taleweaver/core is DOM-free and may run in Node / worker / browser —
 * so btoa/atob (DOM-only) and Buffer (Node-only) are intentionally avoided.
 */

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Reverse lookup: char-code → 6-bit value, -1 for invalid chars.
const DECODE = new Int8Array(256).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) {
  DECODE[ALPHABET.charCodeAt(i)] = i;
}
const PAD = "=".charCodeAt(0);

/**
 * Encode a Uint8Array to a standard base64 string (RFC 4648 §4).
 * Output length is always a multiple of 4 (padded with `=`).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  const full = Math.floor(len / 3);
  const rem = len % 3;
  const outLen = (full + (rem > 0 ? 1 : 0)) * 4;
  const chars: string[] = new Array(outLen);

  let i = 0;
  let o = 0;
  for (; i < full * 3; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    chars[o++] = ALPHABET[b0 >> 2] ?? "";
    chars[o++] = ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)] ?? "";
    chars[o++] = ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] ?? "";
    chars[o++] = ALPHABET[b2 & 0x3f] ?? "";
  }

  if (rem === 1) {
    const b0 = bytes[i] ?? 0;
    chars[o++] = ALPHABET[b0 >> 2] ?? "";
    chars[o++] = ALPHABET[(b0 & 0x03) << 4] ?? "";
    chars[o++] = "=";
    chars[o++] = "=";
  } else if (rem === 2) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    chars[o++] = ALPHABET[b0 >> 2] ?? "";
    chars[o++] = ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)] ?? "";
    chars[o++] = ALPHABET[(b1 & 0x0f) << 2] ?? "";
    chars[o++] = "=";
  }

  return chars.join("");
}

/**
 * Decode a standard base64 string to a Uint8Array.
 * Returns `null` on any malformed input — never throws.
 * Accepts only the strict RFC 4648 §4 alphabet (A-Z a-z 0-9 + /) with
 * correct `=` padding; rejects whitespace, URL-safe alphabet, and
 * misplaced padding.
 */
export function base64ToBytes(b64: string): Uint8Array | null {
  const len = b64.length;
  if (len % 4 !== 0) return null;
  if (len === 0) return new Uint8Array(0);

  // Validate and count padding.
  let padCount = 0;
  for (let i = 0; i < len; i++) {
    const code = b64.charCodeAt(i);
    if (code === PAD) {
      // Padding is only allowed in the last two positions.
      if (i < len - 2) return null;
      padCount++;
    } else if (DECODE[code < 256 ? code : 0] === -1) {
      return null;
    }
  }
  if (padCount > 2) return null;

  // Verify padding chars are at the very end (not mixed in the middle).
  // (The loop above already enforces i >= len-2 for any '=', so if we
  // have 2 padding chars they must both be in the last two slots.)

  const byteLen = (len / 4) * 3 - padCount;
  const out = new Uint8Array(byteLen);
  let o = 0;

  // Every char was validated above (the validation loop rejects any non-alphabet,
  // non-padding char, including code >= 256 via the clamp-to-0 lookup), so the
  // `?? -1` / `=== -1` guards below are belt-and-suspenders, not the real gate.
  for (let i = 0; i < len; i += 4) {
    const c0 = b64.charCodeAt(i);
    const c1 = b64.charCodeAt(i + 1);
    const c2 = b64.charCodeAt(i + 2);
    const c3 = b64.charCodeAt(i + 3);

    const v0 = DECODE[c0] ?? -1;
    const v1 = DECODE[c1] ?? -1;
    // For the last group, c2/c3 may be '='
    const v2 = c2 === PAD ? 0 : (DECODE[c2 < 256 ? c2 : 0] ?? -1);
    const v3 = c3 === PAD ? 0 : (DECODE[c3 < 256 ? c3 : 0] ?? -1);

    if (v0 === -1 || v1 === -1 || v2 === -1 || v3 === -1) return null;

    const triple = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;

    if (o < byteLen) out[o++] = (triple >> 16) & 0xff;
    if (o < byteLen) out[o++] = (triple >> 8) & 0xff;
    if (o < byteLen) out[o++] = triple & 0xff;
  }

  return out;
}

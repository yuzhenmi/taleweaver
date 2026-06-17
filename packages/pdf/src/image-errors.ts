/**
 * Thrown at image RESOLVE time when an image of a format we DO support is
 * malformed, or uses a variant we recognize but cannot embed (e.g. arithmetic
 * JPEG; 16-bit or interlaced PNG). This is the LOUD-failure contract — distinct
 * from returning `null` for an absent or out-of-scope/unrecognized format (which
 * yields a grey placeholder). Both the JPEG parser and the PNG decoder throw it.
 */
export class MalformedImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedImageError";
  }
}

import { decodeLatin1 } from "./pdf-writer";
import { zlibDecompress } from "./zlib";

/** A coarse parse-back of a PDF for STRUCTURAL test assertions (not a real reader). */
export interface ParsedPdf {
  readonly raw: string;
  readonly objectCount: number;
  /** body text of object N (between `N 0 obj` and `endobj`). */
  object(id: number): string | null;
  /** the /Root object id from the trailer. */
  rootId(): number | null;
  /** all page object bodies (objects with /Type /Page). */
  pageBodies(): string[];
  /** Stream object N: its dict text (incl. `<< >>`) and the raw payload bytes,
   *  extracted by the dict's /Length (binary-safe — unlike `object()`, the payload
   *  may contain `endobj` bytes). null if no such object or it is not a stream. */
  streamObject(id: number): { readonly dict: string; readonly payload: Uint8Array } | null;
}

export function parsePdf(bytes: Uint8Array): ParsedPdf {
  const raw = decodeLatin1(bytes);
  const objRe = /(\d+) 0 obj([\s\S]*?)endobj/g;
  const bodies = new Map<number, string>();
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(raw)) !== null) {
    const id = m[1];
    const body = m[2];
    // Both capture groups are mandatory on a successful match of `objRe`.
    if (id === undefined || body === undefined) {
      throw new Error("parsePdf: object match missing a capture group");
    }
    bodies.set(Number(id), body);
  }
  return {
    raw,
    objectCount: bodies.size,
    object: (id) => bodies.get(id) ?? null,
    rootId: () => {
      const r = raw.match(/\/Root (\d+) 0 R/);
      return r === null ? null : Number(r[1]);
    },
    pageBodies: () =>
      [...bodies.values()].filter((b) => /\/Type\s*\/Page\b/.test(b)),
    streamObject: (id) => {
      // 1. Locate the `N 0 obj` header. Require no preceding digit so searching
      //    `2 0 obj` cannot match inside a larger id like `12 0 obj`.
      // `id` is a number, so interpolating it into the regex source is safe (no
      // escaping needed — it can only contribute `[0-9]`).
      const objRe = new RegExp(`(?<![0-9])${id} 0 obj`);
      const m = objRe.exec(raw);
      if (m === null) {
        return null;
      }
      const objIdx = m.index;
      // `m[0]` is the matched `N 0 obj` header token; its length is where the
      // dict scan resumes.
      const afterObj = objIdx + m[0].length;
      // 2. Scan for the BALANCED dict-terminating `>>` so a nested sub-dict (e.g.
      //    `<< /DecodeParms << /Predictor 12 >> >>`) is not truncated at the
      //    inner `>>`. The dict starts at the first `<<` at/after the header.
      //    NOTE: PDF string literals (`( ... )`) can legally contain `>>` bytes,
      //    which this depth scan would miscount — but PdfWriter never emits a
      //    string-literal dict value, so this parse-back (PdfWriter output only)
      //    is safe. Revisit if a caller passes a dict with a `( ... )` value.
      const dictStart = raw.indexOf("<<", afterObj);
      if (dictStart === -1) {
        return null;
      }
      let depth = 0;
      let dictEnd = -1; // index just past the balanced closing `>>`
      for (let i = dictStart; i < raw.length; ) {
        if (raw.startsWith("<<", i)) {
          depth++;
          i += 2;
        } else if (raw.startsWith(">>", i)) {
          depth--;
          i += 2;
          if (depth === 0) {
            dictEnd = i;
            break;
          }
        } else {
          i++;
        }
      }
      if (dictEnd === -1) {
        return null;
      }
      // 3. The dict must be IMMEDIATELY followed by `stream\n` (only whitespace
      //    allowed between). A non-stream object has `endobj` here instead → null.
      //    This also prevents latching onto a LATER stream object's payload.
      const sm = /^\s*stream\n/.exec(raw.slice(dictEnd));
      if (sm === null) {
        return null;
      }
      // 4. dict = the full balanced `<< ... >>` text.
      const dict = raw.slice(dictStart, dictEnd);
      // 5. Authoritative /Length from the dict.
      const lenMatch = dict.match(/\/Length (\d+)/);
      if (lenMatch === null) {
        return null;
      }
      const length = Number(lenMatch[1]);
      // 6. Slice the payload by /Length and re-encode (latin1 is byte-exact).
      const payloadStart = dictEnd + sm[0].length;
      const payload = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        payload[i] = raw.charCodeAt(payloadStart + i) & 0xff;
      }
      // FlateDecode streams inflate transparently, so callers see the original
      // (decompressed) bytes. The dict is returned as-is (still shows /Filter).
      if (/\/Filter\s*\/FlateDecode\b/.test(dict)) {
        return { dict, payload: zlibDecompress(payload) };
      }
      return { dict, payload };
    },
  };
}

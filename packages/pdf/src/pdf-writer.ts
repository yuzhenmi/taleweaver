/**
 * Minimal PDF 1.7 document writer: indirect objects, stream objects, the
 * cross-reference table, and the trailer. Layout-agnostic — pure bytes.
 *
 * PDF strings here are LATIN1 (single-byte) because content-stream operands and
 * dictionary tokens are ASCII/PDFDocEncoding; binary stream payloads are passed
 * as `Uint8Array` and copied verbatim.
 */

import { zlibCompress } from "./zlib";

function encodeLatin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const cu = s.charCodeAt(i);
    // PDF syntax strings (dict tokens, operators) are ASCII/PDFDocEncoding. A code
    // unit > 0xFF would silently truncate into a corrupt PDF — throw instead so a
    // misuse (e.g. a Unicode literal that should be a hex string) surfaces loudly.
    // Binary payloads never pass through here; they are copied as Uint8Array.
    if (cu > 0xff) {
      throw new RangeError(
        `PdfWriter: non-Latin1 code unit U+${cu.toString(16).toUpperCase()} at index ${i}`,
      );
    }
    out[i] = cu;
  }
  return out;
}

interface PendingObject {
  readonly id: number;
  readonly bytes: Uint8Array;
}

export class PdfWriter {
  private nextId = 1;
  private readonly objects: PendingObject[] = [];
  private readonly writtenIds = new Set<number>();

  /** Reserve the next object number. */
  allocate(): number {
    return this.nextId++;
  }

  /** Record one object's serialized bytes; rejects a duplicate id (which would
   *  emit two `N 0 obj` blocks but only one resolvable xref entry → corrupt PDF). */
  private record(id: number, bytes: Uint8Array): void {
    if (this.writtenIds.has(id)) {
      throw new Error(`PdfWriter: object ${id} written more than once`);
    }
    this.writtenIds.add(id);
    this.objects.push({ id, bytes });
  }

  /** Write a plain (non-stream) indirect object: `<id> 0 obj <body> endobj`. */
  writeObject(id: number, body: string): void {
    this.record(id, encodeLatin1(`${id} 0 obj\n${body}\nendobj\n`));
  }

  /**
   * Write a stream object. `dictBody` is the stream dict WITHOUT `/Length`
   * (added here from the emitted payload) and WITH the surrounding `<< >>` — pass
   * the full `<< ... >>`. The payload is FlateDecode-compressed when that shrinks
   * it (`/Filter /FlateDecode` is then injected and `/Length` is the COMPRESSED
   * length); tiny/incompressible streams stay raw (no `/Filter`). Any caller-set
   * dict keys (e.g. `/Length1`, the uncompressed sfnt length) are left intact.
   */
  writeStream(id: number, dictBody: string, content: Uint8Array): void {
    if (!dictBody.startsWith("<<")) {
      // The /Length injection anchors on a leading "<<"; a dict without it would
      // silently get no /Length (an invalid stream dict, PDF §7.3.8.1).
      throw new Error(
        `PdfWriter.writeStream: dictBody must start with "<<" (got: ${JSON.stringify(dictBody.slice(0, 16))})`,
      );
    }
    // Compress when it helps — never expand (zlib overhead means tiny/incompressible
    // streams stay raw). The caller-set /Length1 (uncompressed sfnt length) is left
    // intact; only /Length (compressed length) + /Filter are writer-managed.
    //
    // A caller that declares its OWN /Filter (e.g. /DCTDecode for a JPEG) owns the
    // stream's encoding — the writer must NOT re-compress it (double-filtering would
    // corrupt it). Embed verbatim; /Length is the raw byte count.
    const callerFiltered = /\/Filter\b/.test(dictBody);
    const compressed = callerFiltered ? content : zlibCompress(content);
    const useFlate = !callerFiltered && compressed.length < content.length;
    const payload = useFlate ? compressed : content;
    let dict = dictBody;
    if (useFlate) {
      dict = dict.replace(/^<<\s*/, "<< /Filter /FlateDecode ");
    }
    const dictWithLength = dict.replace(/^<<\s*/, `<< /Length ${payload.length} `);
    const head = encodeLatin1(`${id} 0 obj\n${dictWithLength}\nstream\n`);
    const tail = encodeLatin1(`\nendstream\nendobj\n`);
    const bytes = new Uint8Array(head.length + payload.length + tail.length);
    bytes.set(head, 0);
    bytes.set(payload, head.length);
    bytes.set(tail, head.length + payload.length);
    this.record(id, bytes);
  }

  /**
   * Serialize the whole document. `rootId` is the object number of the document
   * catalog (the `/Root`). Objects are written in ascending id order; the xref
   * records each object's byte offset; the trailer points at the root.
   */
  finish(rootId: number): Uint8Array {
    const header = encodeLatin1("%PDF-1.7\n");
    const sorted = [...this.objects].sort((a, b) => a.id - b.id);
    const count = this.nextId - 1; // highest allocated id

    // Every allocated id MUST have been written: a gap would emit an in-use xref
    // entry with offset 0 (pointing at the file header) — an invalid PDF that a
    // conforming reader rejects. Fail loudly here instead of producing it.
    for (let id = 1; id <= count; id++) {
      if (!this.writtenIds.has(id)) {
        throw new Error(`PdfWriter.finish: object ${id} was allocated but never written`);
      }
    }

    // Concatenate header + objects, recording each object's start offset.
    const offsets = new Map<number, number>();
    const chunks: Uint8Array[] = [header];
    let pos = header.length;
    for (const obj of sorted) {
      offsets.set(obj.id, pos);
      chunks.push(obj.bytes);
      pos += obj.bytes.length;
    }

    // Cross-reference table. Subsection "0 <count+1>": a free entry for object 0,
    // then one in-use entry per object 1..count (each: 10-digit offset, 5-digit
    // generation, 'n', and a 2-char EOL — total 20 bytes).
    const xrefStart = pos;
    let xref = `xref\n0 ${count + 1}\n`;
    xref += "0000000000 65535 f \n";
    for (let id = 1; id <= count; id++) {
      const off = offsets.get(id) ?? 0;
      xref += `${String(off).padStart(10, "0")} 00000 n \n`;
    }
    const trailer =
      `trailer\n<< /Size ${count + 1} /Root ${rootId} 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`;
    chunks.push(encodeLatin1(xref + trailer));

    // Flatten.
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

/**
 * Decode bytes back to a string, byte-for-byte (used by the test parse-back).
 *
 * Each byte 0x00–0xFF maps to the identical code unit (true ISO-8859-1 /
 * code-page identity), so a `charCodeAt(i) & 0xff` round-trips EVERY byte
 * verbatim. We do NOT use `TextDecoder("latin1")`: per the WHATWG Encoding
 * Standard that label is an alias for windows-1252, which REMAPS bytes 0x80–0x9F
 * to higher code points (e.g. 0x84 → U+201E) — corrupting binary stream payloads
 * (a real embedded font program has bytes throughout that range) on read-back.
 */
export function decodeLatin1(b: Uint8Array): string {
  let out = "";
  // Chunk to bound the spread-arg count on large payloads (embedded fonts).
  const CHUNK = 0x8000;
  for (let i = 0; i < b.length; i += CHUNK) {
    out += String.fromCharCode(...b.subarray(i, Math.min(i + CHUNK, b.length)));
  }
  return out;
}

/**
 * A PDF literal string `( … )` with the three mandatory escapes (PDF §7.3.4.2):
 * backslash first, then the parens. ASCII / percent-encoded input only.
 */
export function pdfString(s: string): string {
  return "(" + s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)") + ")";
}

/**
 * A PDF text string for human-readable content (e.g. an outline `/Title`).
 * Pure-Latin-1 input → a literal `( … )` (delegates to `pdfString`'s escaping).
 * Any code unit > 0xFF → a UTF-16BE hex string `<FEFF…>` with the mandatory BOM
 * (ISO 32000-1 §7.9.2.2), iterating JS string CODE UNITS so an astral scalar
 * emits its surrogate pair (same convention as `tounicode.ts`). No content is
 * ever dropped (unlike a malformed export URL).
 */
export function pdfTextString(s: string): string {
  let needsUtf16 = false;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0xff) {
      needsUtf16 = true;
      break;
    }
  }
  if (!needsUtf16) return pdfString(s);
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) {
    hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  return `<${hex}>`;
}

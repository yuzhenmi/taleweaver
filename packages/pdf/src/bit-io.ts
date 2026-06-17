/**
 * DEFLATE bit packing (RFC 1951 §3.1.1) — the bit-ordering hazard, isolated.
 * Data elements are packed LSB-first into bytes; Huffman codes are packed
 * MSB-first (the most-significant bit of the code goes first into the LSB-first
 * stream). `writeHuffman` reverses the code's bits so callers store plain
 * integers. `BitReader` THROWS on any read past the end of input — a
 * truncated/corrupt stream surfaces loudly, never zero-padded garbage.
 */

/** Accumulates bits LSB-first into a growable byte buffer. */
export class BitWriter {
  private readonly bytes: number[] = [];
  private bitBuf = 0; // pending bits, LSB-aligned
  private bitCount = 0;

  /** Append the low `count` bits of `value`, LSB-first (count ≤ 24). */
  writeBits(value: number, count: number): void {
    this.bitBuf |= (value & ((1 << count) - 1)) << this.bitCount;
    this.bitCount += count;
    while (this.bitCount >= 8) {
      this.bytes.push(this.bitBuf & 0xff);
      this.bitBuf >>>= 8;
      this.bitCount -= 8;
    }
  }

  /** Emit a Huffman `code` of `count` bits MSB-first (reversed into the LSB stream). */
  writeHuffman(code: number, count: number): void {
    let rev = 0;
    for (let i = 0; i < count; i++) rev = (rev << 1) | ((code >> i) & 1);
    this.writeBits(rev, count);
  }

  /** Pad with 0 bits up to the next byte boundary (for stored blocks). */
  alignToByte(): void {
    if (this.bitCount > 0) {
      this.bytes.push(this.bitBuf & 0xff);
      this.bitBuf = 0;
      this.bitCount = 0;
    }
  }

  /** Append raw bytes verbatim (caller must be byte-aligned via alignToByte). */
  writeBytes(data: Uint8Array): void {
    for (const b of data) this.bytes.push(b);
  }

  /** Flush the final partial byte and return the buffer. */
  finish(): Uint8Array {
    this.alignToByte();
    return Uint8Array.from(this.bytes);
  }
}

/** Reads bits LSB-first; `takeBytes` reads byte-aligned raw bytes. */
export class BitReader {
  private bitBuf = 0;
  private bitCount = 0;
  private pos = 0;

  constructor(private readonly data: Uint8Array) {}

  private ensure(count: number): void {
    while (this.bitCount < count) {
      if (this.pos >= this.data.length) {
        throw new Error("inflate: read past the end of input (truncated stream)");
      }
      // `data[pos]` is in-bounds (checked above); the `?? 0` satisfies
      // noUncheckedIndexedAccess without masking a real read (it never fires).
      this.bitBuf |= (this.data[this.pos++] ?? 0) << this.bitCount;
      this.bitCount += 8;
    }
  }

  readBits(count: number): number {
    this.ensure(count);
    const v = this.bitBuf & ((1 << count) - 1);
    this.bitBuf >>>= count;
    this.bitCount -= count;
    return v;
  }

  readBit(): number {
    return this.readBits(1);
  }

  /** Discard any buffered partial-byte bits, re-aligning to the next byte. */
  alignToByte(): void {
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  /** Copy `n` raw bytes (must be byte-aligned via alignToByte); throws if short. */
  takeBytes(n: number): Uint8Array {
    if (this.bitCount !== 0) throw new Error("inflate: takeBytes not byte-aligned");
    if (this.pos + n > this.data.length) {
      throw new Error("inflate: stored block runs past the end of input");
    }
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

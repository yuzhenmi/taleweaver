import type { State } from "../state";

/** A serialized document: binary (Yjs update) or text (a human-friendly format). */
export type SerializedDocument = Uint8Array | string;

/**
 * A pluggable document (de)serializer. One per wire format. `encode`/`decode`
 * are INVERSES for round-trippable formats (the binary serializer is exactly
 * lossless). Any dependencies a serializer needs (e.g. an IdAllocator for a
 * future structured decoder) are injected at CONSTRUCTION (a factory closing
 * over them), NOT passed per call — keeping this a clean two-method contract.
 */
export interface DocumentSerializer<TWire extends SerializedDocument = SerializedDocument> {
  /** Stable format id, e.g. "taleweaver-binary". The registry key. */
  readonly format: string;
  /** Serialize a document State to the wire format. */
  encode(state: State): TWire;
  /** Reconstruct a document State from the wire format. */
  decode(source: TWire): State;
}

/** Thrown by serializeDocument/deserializeDocument when no serializer is registered for `format`. */
export class UnknownSerializerFormatError extends Error {
  constructor(public readonly format: string) {
    super(`No document serializer registered for format "${format}"`);
    this.name = "UnknownSerializerFormatError";
  }
}

/** Thrown by a serializer's decode when the wire data is structurally invalid (e.g. a decoded doc with no meta rootId). */
export class MalformedDocumentError extends Error {
  constructor(public readonly format: string) {
    super(`Malformed document for format "${format}"`);
    this.name = "MalformedDocumentError";
  }
}

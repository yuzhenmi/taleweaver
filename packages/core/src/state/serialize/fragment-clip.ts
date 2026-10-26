/**
 * Lossless clipboard codec for fragment States.
 *
 * A fragment `State` → binary bytes (via the Yjs-native binary serializer)
 * → base64 string (via the runtime-agnostic codec), carried under the private
 * MIME type `TALEWEAVER_CLIP_MIME`.
 *
 * This module is intentionally thin: it is a pure composition of
 * `createBinaryDocumentSerializer` and `bytesToBase64`/`base64ToBytes`.
 * All hard work (Yjs encode/decode, format validation) lives in those pieces.
 *
 * DOM-free: no `btoa`/`atob`, no DOM globals, no sibling-package imports.
 */

import type { State } from "../state";
import { bytesToBase64, base64ToBytes } from "./base64";
import { createBinaryDocumentSerializer } from "./binary-serializer";

/**
 * Private MIME type for the Taleweaver lossless clipboard flavor.
 * Carried alongside `text/html` and `text/plain` in ClipboardItem writes.
 */
export const TALEWEAVER_CLIP_MIME = "application/x-taleweaver-clip";

/**
 * Encode a fragment `State` to a base64 string suitable for storage under
 * `TALEWEAVER_CLIP_MIME` in the system clipboard.
 *
 * The encoding is: `bytesToBase64(binarySerializer.encode(fragment))`.
 * Every field in the Y.Doc (blocks, embedContents, templateContents,
 * listDefs, meta, suggestion records) is captured by the Yjs state-update
 * snapshot — the round-trip is lossless.
 */
export function encodeFragmentClip(fragment: State): string {
  const bytes = createBinaryDocumentSerializer().encode(fragment);
  return bytesToBase64(bytes);
}

/**
 * Decode a base64 clip string back to a fragment `State`.
 *
 * Returns `null` (never throws) on any malformed input:
 *   - non-base64 string → `base64ToBytes` returns null
 *   - valid base64 but invalid Yjs doc → decoder throws `MalformedDocumentError`
 *     (or any other error — all are caught)
 */
export function decodeFragmentClip(clip: string): State | null {
  const bytes = base64ToBytes(clip);
  if (bytes === null) return null;
  try {
    return createBinaryDocumentSerializer().decode(bytes);
  } catch {
    // Any decode failure — a thrown MalformedDocumentError on a non-document
    // payload, or a Yjs-internal parse error on structurally invalid bytes —
    // resolves to null. The contract is "never throws".
    return null;
  }
}

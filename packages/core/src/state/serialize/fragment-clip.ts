/**
 * Lossless clipboard codec for fragment States.
 *
 * A fragment `State` → binary bytes (via the Yjs-native binary serializer)
 * → base64 string (via the runtime-agnostic codec), carried under the private
 * MIME type `TALEWEAVER_CLIP_MIME`.
 *
 * This module is intentionally thin: a composition of the Yjs-native binary
 * codec and `bytesToBase64`/`base64ToBytes`. Decoding runs `upgradeDocument` on
 * the clip doc (a private, single-authority doc) so a clip from a legacy engine
 * pastes correctly.
 *
 * DOM-free: no `btoa`/`atob`, no DOM globals, no sibling-package imports.
 */

import type { BlockKindResolver } from "../block-kinds";
import * as Y from "yjs";
import { createState, type State } from "../state";
import { getMetaRootId } from "../yjs-doc";
import { upgradeDocument } from "../upgrade";
import { bindAttrRegistry } from "../mark-attrs";
import type { AttrRegistry } from "../../cascade/attr-registry";
import { bytesToBase64, base64ToBytes } from "./base64";
import { STATE_INTERNAL } from "../state-internal";

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
  const bytes = Y.encodeStateAsUpdate(fragment[STATE_INTERNAL].doc);
  return bytesToBase64(bytes);
}

/**
 * Decode a base64 clip string back to a fragment `State`.
 *
 * `attrRegistry` is the host attr registry, bound to the clip's document (a legacy
 * clip's ¶ character props are upgraded through it).
 *
 * Returns `null` (never throws) on any malformed input:
 *   - non-base64 string → `base64ToBytes` returns null
 *   - valid base64 but invalid Yjs doc → decoder throws `MalformedDocumentError`
 *     (or any other error — all are caught)
 */
export function decodeFragmentClip(clip: string, resolver: BlockKindResolver, attrRegistry: AttrRegistry): State | null {
  const bytes = base64ToBytes(clip);
  if (bytes === null) return null;
  try {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, bytes);
    const rootId = getMetaRootId(doc);
    if (rootId === undefined) return null;
    // A clip is a private, single-authority document: upgrade legacy inline
    // storage (a clip copied from an older engine) before loading it.
    bindAttrRegistry(doc, attrRegistry);
    upgradeDocument(doc, { resolver });
    return createState({ rootId, doc, resolver });
  } catch {
    // Any decode failure — a thrown MalformedDocumentError on a non-document
    // payload, or a Yjs-internal parse error on structurally invalid bytes —
    // resolves to null. The contract is "never throws".
    return null;
  }
}

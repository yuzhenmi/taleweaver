/**
 * The `taleweaver-html` human-friendly `DocumentSerializer<string>` — a readable
 * HTML-subset format for AUTHORING/SEEDING documents (not lossless interchange;
 * the binary serializer owns that). Spec:
 * `docs/superpowers/specs/2026-06-08-human-friendly-serializer-design.md` §4.
 *
 * Lives in `packages/dom` (not core) because DECODE needs the browser-native
 * `DOMParser`, a DOM API absent from the platform-agnostic core. ENCODE is pure
 * (no DOM). DECODE lowers parsed HTML to a declarative `BlockNode` tree and
 * defers id/link derivation to core's `buildDocumentFromTree`.
 *
 * Registration (the host composes manually — core can't pre-wire a serializer
 * that needs an `IdAllocator`):
 *
 *   const reg = createDefaultSerializerRegistry();
 *   reg.register(createHtmlDocumentSerializer({ allocator: productionAllocator }));
 */
import type { DocumentSerializer, IdAllocator } from "@taleweaver/core";
import { encodeHtml } from "./html-encode";
import { decodeHtml } from "./html-decode";

/** Stable registry key for the human-friendly HTML format. */
export const HTML_FORMAT = "taleweaver-html";

/**
 * Construct the `taleweaver-html` serializer. `allocator` is injected at
 * construction (mints fresh block ids on decode — the human format does NOT
 * preserve ids; decoding the same HTML twice yields distinct ids by design).
 */
export function createHtmlDocumentSerializer(deps: {
  allocator: IdAllocator;
}): DocumentSerializer<string> {
  return {
    format: HTML_FORMAT,
    encode: (state) => encodeHtml(state),
    decode: (html) => decodeHtml(html, deps.allocator),
  };
}

/**
 * The `taleweaver-html` human-friendly `DocumentSerializer<string>` — a readable
 * HTML-subset format for AUTHORING/SEEDING documents (not lossless interchange;
 * the binary serializer owns that). Spec:
 * `docs/superpowers/specs/2026-06-08-human-friendly-serializer-design.md` §4.
 *
 * Lives in `@taleweaver/core`; DECODE parses via an injected `HtmlParser` (the
 * host supplies a DOM-backed adapter), keeping core DOM-free. ENCODE is pure (no
 * DOM). DECODE lowers parsed HTML to a declarative `BlockNode` tree and defers
 * id/link derivation to core's `buildDocumentFromTree`.
 *
 * Registration (the host composes manually — core can't pre-wire a serializer
 * that needs an `IdAllocator` + an `HtmlParser`):
 *
 *   const reg = createDefaultSerializerRegistry();
 *   reg.register(createHtmlDocumentSerializer({
 *     allocator: productionAllocator,
 *     parseHtml: browserHtmlParser,
 *   }));
 */
import type { IdAllocator } from "../block-id";
import type { DocumentSerializer } from "./document-serializer";
import type { HtmlParser } from "./html-node";
import { encodeHtml } from "./html-encode";
import { decodeHtml } from "./html-decode";

/** Stable registry key for the human-friendly HTML format. */
export const HTML_FORMAT = "taleweaver-html";

/**
 * Construct the `taleweaver-html` serializer. `allocator` is injected at
 * construction (mints fresh block ids on decode — the human format does NOT
 * preserve ids; decoding the same HTML twice yields distinct ids by design).
 * `parseHtml` is the host-supplied DOM-free HTML parser the decode walks.
 */
export function createHtmlDocumentSerializer(deps: {
  allocator: IdAllocator;
  parseHtml: HtmlParser;
}): DocumentSerializer<string> {
  return {
    format: HTML_FORMAT,
    encode: (state) => encodeHtml(state),
    decode: (html) => decodeHtml(html, deps.allocator, deps.parseHtml),
  };
}

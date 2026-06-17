/**
 * Link-URL safety predicates shared by the two places a hyperlink URL leaves the
 * engine: the DOM controller's Cmd/Ctrl-click navigation (HL.3) and the
 * `taleweaver-html` export's `<a href>` emission.
 *
 * The threat: a `link` attr is document content and can arrive from an untrusted
 * source (paste / decode / programmatic SET_LINK). A `javascript:` / `data:` /
 * `vbscript:` URL must never be navigated to, nor emitted into exported HTML
 * where a downstream consumer could open it and execute script. We use an
 * ALLOWLIST of safe schemes (not a denylist) so a novel dangerous scheme is
 * rejected by default.
 */

/** Schemes safe to navigate to AND to emit in an `<a href>`. */
const SAFE_URL_SCHEMES: ReadonlySet<string> = new Set(["http", "https", "mailto", "tel"]);

/**
 * The leading scheme of `url` (lowercased), or `null` when it has none (a
 * relative path, fragment, or scheme-relative `//host` URL).
 *
 * Browsers ignore ASCII control characters and spaces when resolving a scheme
 * (they strip tab/newline from a URL entirely and trim leading control/space),
 * so `"java\tscript:"` and `"  javascript:"` both resolve to the `javascript`
 * scheme. We strip every ASCII char <= 0x20 for the check (the original string
 * is what gets emitted/opened) to defeat that obfuscation. A scheme is, per
 * RFC 3986, `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )` followed by `":"`.
 */
function schemeOf(url: string): string | null {
  let normalized = "";
  for (const ch of url) {
    if (ch.charCodeAt(0) > 0x20) normalized += ch;
  }
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(normalized);
  if (match === null) return null;
  const scheme = match[1];
  if (scheme === undefined) {
    throw new Error("url-safety: scheme capture group unexpectedly absent on a matched URL");
  }
  return scheme.toLowerCase();
}

/**
 * True iff `url` is safe to NAVIGATE to (open in a new tab). Requires an
 * explicit safe scheme: a relative / scheme-less URL returns `false` (there is
 * nothing meaningful to open from a document editor), matching the click path's
 * original positive-allowlist behavior.
 */
export function isOpenableLinkUrl(url: string): boolean {
  const scheme = schemeOf(url);
  return scheme !== null && SAFE_URL_SCHEMES.has(scheme);
}

/**
 * True iff `url` is safe to EMIT in an exported `<a href>`. Permits safe-scheme
 * URLs AND relative / scheme-less URLs (a relative link is legitimate in
 * exported HTML and carries no executable scheme); rejects only URLs whose
 * explicit scheme is not in the safe allowlist (`javascript:` / `data:` /
 * `vbscript:` / `file:` / …).
 */
export function isExportSafeLinkUrl(url: string): boolean {
  const scheme = schemeOf(url);
  return scheme === null || SAFE_URL_SCHEMES.has(scheme);
}

import { describe, it, expect } from "vitest";
import { isOpenableLinkUrl, isExportSafeLinkUrl } from "./url-safety";

describe("isOpenableLinkUrl (navigate/open allowlist)", () => {
  it("opens http/https/mailto/tel URLs", () => {
    expect(isOpenableLinkUrl("https://example.com")).toBe(true);
    expect(isOpenableLinkUrl("http://example.com/path?q=1")).toBe(true);
    expect(isOpenableLinkUrl("mailto:a@b.com")).toBe(true);
    expect(isOpenableLinkUrl("tel:+15551234")).toBe(true);
    expect(isOpenableLinkUrl("HTTPS://EXAMPLE.COM")).toBe(true); // scheme is case-insensitive
  });

  it("does NOT open dangerous schemes (javascript/data/vbscript)", () => {
    expect(isOpenableLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableLinkUrl("data:text/html,<script>1</script>")).toBe(false);
    expect(isOpenableLinkUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isOpenableLinkUrl("file:///etc/passwd")).toBe(false);
  });

  it("does NOT open a relative/scheme-less URL (nothing meaningful to navigate to)", () => {
    expect(isOpenableLinkUrl("/path")).toBe(false);
    expect(isOpenableLinkUrl("#fragment")).toBe(false);
    expect(isOpenableLinkUrl("//host/path")).toBe(false);
    expect(isOpenableLinkUrl("example.com")).toBe(false);
  });

  it("defeats whitespace/control-char obfuscation of a dangerous scheme", () => {
    // Browsers strip tab/newline from a URL and trim leading control/space
    // before resolving the scheme; these must NOT slip through as openable.
    expect(isOpenableLinkUrl("  javascript:alert(1)")).toBe(false);
    expect(isOpenableLinkUrl("java\tscript:alert(1)")).toBe(false);
    expect(isOpenableLinkUrl("java\nscript:alert(1)")).toBe(false);
    expect(isOpenableLinkUrl("javascript:alert(1)")).toBe(false);
  });

  it("opens a safe URL with harmless leading whitespace", () => {
    expect(isOpenableLinkUrl("  https://example.com")).toBe(true);
  });

  it("strips a leading NUL before the scheme check (control-char obfuscation)", () => {
    expect(isOpenableLinkUrl(String.fromCharCode(0) + "javascript:alert(1)")).toBe(false);
    expect(isExportSafeLinkUrl(String.fromCharCode(0) + "javascript:alert(1)")).toBe(false);
  });
});

describe("isExportSafeLinkUrl (<a href> emit guard)", () => {
  it("permits safe-scheme AND relative URLs (relative is legitimate in exported HTML)", () => {
    expect(isExportSafeLinkUrl("https://example.com")).toBe(true);
    expect(isExportSafeLinkUrl("mailto:a@b.com")).toBe(true);
    expect(isExportSafeLinkUrl("/path")).toBe(true);
    expect(isExportSafeLinkUrl("#fragment")).toBe(true);
    expect(isExportSafeLinkUrl("//host/path")).toBe(true);
    expect(isExportSafeLinkUrl("example.com/page")).toBe(true);
  });

  it("rejects dangerous executable schemes so the exported HTML can't run script", () => {
    expect(isExportSafeLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isExportSafeLinkUrl("data:text/html,<script>1</script>")).toBe(false);
    expect(isExportSafeLinkUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isExportSafeLinkUrl("blob:https://x")).toBe(false);
    expect(isExportSafeLinkUrl("file:///etc/passwd")).toBe(false);
  });

  it("defeats whitespace/control-char obfuscation", () => {
    expect(isExportSafeLinkUrl("  javascript:alert(1)")).toBe(false);
    expect(isExportSafeLinkUrl("java\tscript:alert(1)")).toBe(false);
    expect(isExportSafeLinkUrl("java\nscript:alert(1)")).toBe(false);
  });
});

// End-to-end paste integration: REAL core, REAL reconciler, REAL browserHtmlParser
// (jsdom DOMParser) — NO mocks. This is the layer the controller unit tests (which
// mock @taleweaver/core) cannot cover: it proves an HTML paste actually decodes and
// inserts rich content through the live createDigitalController path. Guards against
// regressions where the wiring "calls the right functions" but the integration breaks.
import { describe, it, expect } from "vitest";
import { createDigitalController } from "./digital-controller";
import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  getBlock,
  type Document,
  type BlockId,
} from "@taleweaver/core";

/** Build a paste event with a jsdom-friendly clipboardData stub (no DataTransfer in jsdom). */
function makePasteEvent(flavors: { html?: string; text?: string }): Event {
  const map: Record<string, string> = {
    "text/html": flavors.html ?? "",
    "text/plain": flavors.text ?? "",
  };
  const clipboardData = { getData: (t: string) => map[t] ?? "", setData: () => {} };
  const e = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "clipboardData", { value: clipboardData, configurable: true });
  return e;
}

// Recurse into children so nested blocks (table cells, etc.) aren't silently
// skipped — a leaf contributes its text; a container recurses into its children.
function blockTexts(document: Document): string[] {
  const out: string[] = [];
  const walk = (startId: BlockId | null): void => {
    let id = startId;
    while (id) {
      const b = getBlock(document, id);
      if (!b) break;
      if (b.firstChildId !== null) {
        walk(b.firstChildId);
      } else {
        out.push((b.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "")).join(""));
      }
      id = b.nextSiblingId;
    }
  };
  const root = getBlock(document, document.rootId);
  walk(root?.firstChildId ?? null);
  return out;
}

function mountController(): { ctrl: ReturnType<typeof createDigitalController>; container: HTMLElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const ctrl = createDigitalController({
    container,
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
  });
  ctrl.focus();
  return { ctrl, container };
}

describe("digital HTML paste — end-to-end through real core", () => {
  it("decodes and inserts a single rich paragraph (marks preserved)", () => {
    const { ctrl, container } = mountController();
    container.dispatchEvent(makePasteEvent({ html: "<p>world <strong>bold</strong></p>", text: "world bold" }));
    expect(blockTexts(ctrl.editorState.document).join("")).toContain("world bold");
    // The reconciler rendered it into the live contentEditable DOM.
    expect(container.textContent).toContain("world bold");
    ctrl.destroy();
    document.body.removeChild(container);
  });

  it("decodes and inserts a multi-block paste (heading + paragraphs + list)", () => {
    const { ctrl, container } = mountController();
    const html =
      "<h1>Title</h1><p>First para with <em>italic</em>.</p><p>Second.</p><ul><li>one</li><li>two</li></ul>";
    container.dispatchEvent(makePasteEvent({ html, text: "Title\nFirst para with italic.\nSecond.\none\ntwo" }));
    const joined = blockTexts(ctrl.editorState.document).join("|");
    expect(joined).toContain("Title");
    expect(joined).toContain("First para with italic.");
    expect(joined).toContain("Second.");
    expect(joined).toContain("two");
    ctrl.destroy();
    document.body.removeChild(container);
  });
});

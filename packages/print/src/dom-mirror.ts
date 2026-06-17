import type { AccessibilityNode, AccessibilityTextRun } from "@taleweaver/core";
import { BROKEN_CROSS_REFERENCE_TEXT, isExportSafeLinkUrl } from "@taleweaver/core";

/** The displayed text of a run: a field run's resolved value (or its placeholder
 *  when unresolved); any non-field run unchanged. */
export function resolveFieldText(
  run: AccessibilityTextRun,
  resolvedFields: ReadonlyMap<string, string> | undefined,
): string {
  if (run.fieldKey === undefined) return run.text;
  const v = resolvedFields?.get(run.fieldKey);
  if (v === undefined) return run.text; // page-number / absent map / non-virtual path
  if (v === "" && run.fieldKind === "cross-ref-page") return BROKEN_CROSS_REFERENCE_TEXT;
  return v;
}

/** Return `node` (and its subtree) with every field run's text resolved from
 *  `resolvedFields`. Nodes whose runs and descendants are all unchanged are
 *  returned BY REFERENCE (no copy); non-field runs are likewise shared. */
export function resolveTreeFields(
  node: AccessibilityNode,
  resolvedFields: ReadonlyMap<string, string>,
): AccessibilityNode {
  const origText = node.text;
  let text = origText;
  if (origText !== undefined) {
    const mapped = origText.map((r) =>
      r.fieldKey === undefined ? r : { ...r, text: resolveFieldText(r, resolvedFields) },
    );
    if (mapped.some((r, i) => r !== origText[i])) text = mapped;
  }
  const origChildren = node.children;
  const children = origChildren.map((c) => resolveTreeFields(c, resolvedFields));
  const childrenChanged = children.some((c, i) => c !== origChildren[i]);
  if (text === origText && !childrenChanged) return node;
  return text === undefined ? { ...node, children } : { ...node, text, children };
}

/**
 * The emphasis marks, derived from core's `AccessibilityTextRun.emphasis` union
 * (NOT redeclared locally) so the two modules can't drift: adding an emphasis
 * kind in core makes `EMPHASIS_TAG` below stop compiling here with a clear
 * "missing key" error, rather than failing at a cryptic downstream assignment.
 */
type EmphasisKey = NonNullable<AccessibilityTextRun["emphasis"]>[number];

/** Fixed emphasis nesting order (outermost → innermost in the DOM). */
const EMPHASIS_ORDER = ["bold", "italic", "underline", "strikethrough"] as const satisfies readonly EmphasisKey[];

const EMPHASIS_TAG: Record<EmphasisKey, string> = {
  bold: "strong",
  italic: "em",
  underline: "u",
  strikethrough: "s",
};

/**
 * Build the DOM element for one `AccessibilityTextRun`.
 *
 * Outermost wrapper is chosen by run kind: `noteref` → <a role=doc-noteref>,
 * `link` → <a>, `insertion` → <ins>, `deletion` → <del>, plain → <span>.
 * A link `href` is sanitized through {@link isExportSafeLinkUrl} (the same seam
 * the HTML export uses) so a `javascript:`/`data:` URL is never emitted into the
 * mirror DOM that slice 2b mounts. Emphasis is nested innermost-first so the
 * outermost emphasis element is <strong> when bold is active. `data-offset-start` /
 * `data-offset-end` (the LITERAL block offsets, I5) are stamped on the
 * outermost wrapper — the forward hook slice 2b uses to map a browser Selection
 * position back to a literal {blockId, offset} Position.
 */
export function buildRunElement(run: AccessibilityTextRun, doc: Document): HTMLElement {
  let wrapper: HTMLElement;
  if (run.imageAlt !== undefined) {
    // An inline image: a childless role="img" element labeled by its alt text.
    // The alt is conveyed via aria-label (mirroring the node-level img idiom in
    // buildElement), NOT as text content — the run's text stays "".
    wrapper = doc.createElement("span");
    wrapper.setAttribute("role", "img");
    wrapper.setAttribute("aria-label", run.imageAlt);
  } else if (run.noteref !== undefined) {
    wrapper = doc.createElement("a");
    wrapper.setAttribute("role", "doc-noteref");
    wrapper.setAttribute("href", "#" + run.noteref);
  } else if (run.link !== undefined) {
    wrapper = doc.createElement("a");
    // Sanitize the href the same way the HTML export does: omit it entirely for a
    // dangerous scheme (javascript:/data:/…) so the mirror DOM that slice 2b mounts
    // can never carry an executable href. The <a> wrapper stays for AT semantics.
    if (isExportSafeLinkUrl(run.link)) {
      wrapper.setAttribute("href", run.link);
    }
  } else if (run.suggestion === "insertion") {
    wrapper = doc.createElement("ins");
  } else if (run.suggestion === "deletion") {
    wrapper = doc.createElement("del");
  } else {
    wrapper = doc.createElement("span");
  }

  wrapper.setAttribute("data-offset-start", String(run.sourceOffsetStart));
  wrapper.setAttribute("data-offset-end", String(run.sourceOffsetEnd));
  if (run.inComment === true) {
    wrapper.setAttribute("data-in-comment", "true");
  }

  // An inline image (imageAlt set) is CHILDLESS: its alt text is conveyed via
  // aria-label, not as a text node. Skip the text-node/emphasis/appendChild tail
  // entirely so the role="img" span has no children — but keep the data-offset
  // stamping above (the Selection-mapping hooks) intact.
  if (run.imageAlt === undefined) {
    let inner: Node = doc.createTextNode(run.text);
    const active: ReadonlyArray<EmphasisKey> = run.emphasis ?? [];
    for (let i = EMPHASIS_ORDER.length - 1; i >= 0; i--) {
      const key = EMPHASIS_ORDER[i];
      if (key === undefined) {
        throw new Error(`dom-mirror: EMPHASIS_ORDER entry at ${i} unexpectedly undefined`);
      }
      if (active.includes(key)) {
        const el = doc.createElement(EMPHASIS_TAG[key]);
        el.appendChild(inner);
        inner = el;
      }
    }
    wrapper.appendChild(inner);
  }
  return wrapper;
}

function appendTextRuns(
  parent: HTMLElement,
  runs: readonly AccessibilityTextRun[],
  doc: Document,
): void {
  for (const run of runs) {
    parent.appendChild(buildRunElement(run, doc));
  }
}

/**
 * Builds a detached, visually-hidden, AT-visible semantic DOM subtree from an
 * `AccessibilityNode` tree produced by core's `buildAccessibilityTree`.
 *
 * Pure function — no DOM side effects, no mounting, no controller coupling.
 * The `doc` parameter defaults to the ambient `document` global and is
 * injected in tests (jsdom supplies it).
 *
 * Slice 2a: structural transform only. Controller wiring, focus management,
 * Selection sync, and `DomMirrorCache` are slice 2b concerns.
 */
export function buildDomMirror(
  node: AccessibilityNode,
  doc: Document = document,
): HTMLElement {
  const el = buildElement(node, doc);
  // Forward hook for slice-2b Selection mapping: a browser Selection position
  // resolves to {blockId, offset} where the offset comes off the run wrapper
  // (data-offset-*) and the blockId comes off the nearest block ancestor stamped
  // here. Applied uniformly to ALL roles whose node has a real source block;
  // synthetic nodes (lists, landmarks) carry sourceBlockId === null and are skipped.
  if (node.sourceBlockId !== null) {
    el.setAttribute("data-block-id", node.sourceBlockId);
  }
  if (node.text !== undefined && node.text.length > 0) {
    appendTextRuns(el, node.text, doc);
  }
  for (const child of node.children) {
    el.appendChild(buildDomMirror(child, doc));
  }
  return el;
}

/**
 * The tag name `buildElement` produces for a node — the SINGLE source of truth
 * the incremental reconciler uses for its tag-match (a key match with a DIFFERENT
 * rendered tag, e.g. a heading whose level changed or a paragraph→heading role
 * change, must build a fresh element, not patch in place). Kept in lockstep with
 * `buildElement` by `dom-mirror.test.ts`'s no-drift test.
 */
export function renderedTag(node: AccessibilityNode): string {
  switch (node.role) {
    case "document": return "div";
    case "paragraph": return "p";
    case "list": return node.listOrdered === true ? "ol" : "ul";
    case "listitem": return "li";
    case "table": return "table";
    case "row": return "tr";
    case "cell": return "td";
    case "columnheader": return "th";
    case "heading": {
      const lvl = typeof node.level === "number" && node.level >= 1 && node.level <= 6 ? node.level : 1;
      return `h${lvl}`;
    }
    case "img": return "span";
    case "separator": return "hr";
    case "navigation": return "nav";
    case "banner": return "header";
    case "contentinfo": return "footer";
    case "doc-footnote": return "section";
  }
}

function buildElement(node: AccessibilityNode, doc: Document): HTMLElement {
  switch (node.role) {
    case "document": {
      const el = doc.createElement("div");
      el.setAttribute("role", "document");
      // Visually hidden via the clip technique: AT-visible, NOT display:none /
      // visibility:hidden / aria-hidden (the host must stay AT-visible).
      // 2b: finalize focusable-host attributes (contenteditable or
      // role=textbox aria-multiline) after browser smoke confirms the AT model.
      el.style.cssText =
        "position:absolute;width:1px;height:1px;overflow:hidden;" +
        "clip:rect(0,0,0,0);white-space:nowrap;padding:0;border:0";
      return el;
    }
    case "paragraph":
      return doc.createElement("p");
    case "list":
      return doc.createElement(node.listOrdered === true ? "ol" : "ul");
    case "listitem": {
      const li = doc.createElement("li");
      // #555: an ordered item's resolved ordinal → native `<li value=N>` so a
      // screen reader announces the TRUE number (start-at / restart aware) rather
      // than the bare `<ol>`'s 1,2,3…. Absent for bullets.
      if (node.listOrdinal !== undefined) li.setAttribute("value", String(node.listOrdinal));
      return li;
    }
    case "table":
      return doc.createElement("table");
    case "row":
      return doc.createElement("tr");
    case "cell":
      return doc.createElement("td");
    case "columnheader": {
      const th = doc.createElement("th");
      th.setAttribute("scope", "col");
      return th;
    }
    case "heading": {
      const lvl =
        typeof node.level === "number" && node.level >= 1 && node.level <= 6
          ? node.level
          : 1;
      return doc.createElement(`h${lvl}`);
    }
    case "img": {
      const el = doc.createElement("span");
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", node.name ?? "");
      return el;
    }
    case "separator":
      return doc.createElement("hr");
    case "navigation": {
      const el = doc.createElement("nav");
      // A named landmark (e.g. the TOC's "Table of contents") must carry an
      // accessible name, or a screen reader announces an unlabeled navigation
      // region. Only emit when present + non-empty (an empty aria-label is worse
      // than none on a landmark). Mirrors the img role's name handling.
      if (node.name !== undefined && node.name !== "") {
        el.setAttribute("aria-label", node.name);
      }
      return el;
    }
    case "banner":
      return doc.createElement("header");
    case "contentinfo":
      return doc.createElement("footer");
    case "doc-footnote": {
      const el = doc.createElement("section");
      el.setAttribute("role", "doc-footnote");
      if (node.sourceBlockId !== null) {
        el.id = node.sourceBlockId;
      }
      return el;
    }
  }
}

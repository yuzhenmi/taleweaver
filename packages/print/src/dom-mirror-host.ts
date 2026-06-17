import type { AccessibilityNode, Selection as EngineSelection, Span } from "@taleweaver/core";
import { reconcileMirror, type NodeElMap } from "./dom-mirror-cache";
import { resolveTreeFields } from "./dom-mirror";
import { placeMirrorSelection, readMirrorSelection } from "./dom-mirror-selection";

export interface DomMirrorHostOptions {
  readonly container: HTMLElement;
  readonly doc?: Document;
  readonly onSelectionChange?: (selection: Span) => void;
  readonly onKeyDown?: (e: KeyboardEvent) => void;
  readonly onInsertText?: (text: string) => void;
  readonly onCompositionStart?: () => void;
  readonly onCompositionEnd?: (text: string) => void;
  readonly onCopy?: (e: ClipboardEvent) => void;
  readonly onCut?: (e: ClipboardEvent) => void;
  readonly onPaste?: (e: ClipboardEvent) => void;
  readonly onFocus?: (e: FocusEvent) => void;
  readonly onBlur?: (e: FocusEvent) => void;
}

export interface DomMirrorHost {
  readonly element: HTMLElement;
  syncTree(tree: AccessibilityNode, resolvedFields?: ReadonlyMap<string, string>): void;
  syncSelection(selection: EngineSelection): void;
  focus(): void;
  destroy(): void;
}

export function createDomMirrorHost(options: DomMirrorHostOptions): DomMirrorHost {
  const doc = options.doc ?? document;
  const element = doc.createElement("div");
  element.setAttribute("data-taleweaver-a11y-mirror", "true");
  element.setAttribute("contenteditable", "true");
  element.setAttribute("role", "textbox");
  element.setAttribute("aria-multiline", "true");
  element.tabIndex = 0;
  // Visually hidden but AT-visible (clip technique; NOT display:none / aria-hidden).
  const s = element.style;
  s.position = "absolute";
  s.width = "1px";
  s.height = "1px";
  s.overflow = "hidden";
  s.clip = "rect(0 0 0 0)";
  s.clipPath = "inset(50%)";
  s.whiteSpace = "pre";
  s.caretColor = "transparent";
  s.outline = "none";
  options.container.appendChild(element);

  let priorTree: AccessibilityNode | null = null;
  let priorMap: NodeElMap | null = null;

  function syncTree(tree: AccessibilityNode, resolvedFields?: ReadonlyMap<string, string>): void {
    if (isComposing) return; // IME safety: do not mutate the mirror mid-composition;
                             // committed state is unchanged until compositionend.
    // Resolve page-valued field runs' text BEFORE reconcile, so the existing
    // fingerprint/build chain (selfFingerprint hashes run.text) sees the resolved
    // value — a page-count change re-fingerprints and rebuilds the reused node.
    // Skip entirely when there are no resolved fields (default-off / non-virtual).
    const resolved =
      resolvedFields !== undefined && resolvedFields.size > 0 ? resolveTreeFields(tree, resolvedFields) : tree;
    // Incremental reconcile: diff `resolved` against the prior tree, mutating `element`'s
    // children in place — O(changed), preserving DOM identity for unchanged blocks so
    // the browser Selection / AT review cursor survive an edit. First call (priorTree
    // null) builds fresh (prior=null → every child materialized). The document-role
    // root unwraps to `element`'s children exactly as the full-rebuild did.
    priorMap = reconcileMirror(element, priorTree === null ? null : priorTree.children, resolved.children, priorMap, doc);
    priorTree = resolved;
  }

  const win = doc.defaultView;

  function syncSelection(selection: EngineSelection): void {
    if (win === null) return;
    placeMirrorSelection(element, selection, win);
  }

  function handleSelectionChange(): void {
    if (win === null || options.onSelectionChange === undefined) return;
    const span = readMirrorSelection(element, win);
    // readMirrorSelection returns null unless both endpoints are inside the mirror,
    // so this only fires for in-mirror selections. Loop-prevention is the controller's
    // idempotency check (Task 8), not a host-side flag.
    if (span !== null) options.onSelectionChange(span);
  }

  doc.addEventListener("selectionchange", handleSelectionChange);

  let isComposing = false;

  function handleKeyDown(e: KeyboardEvent): void {
    options.onKeyDown?.(e);
  }
  function handleBeforeInput(e: InputEvent): void {
    if (e.inputType === "insertText" && e.data !== null && !isComposing) {
      e.preventDefault();
      options.onInsertText?.(e.data);
      return;
    }
    e.preventDefault();
  }
  function handleCompositionStart(): void {
    isComposing = true;
    options.onCompositionStart?.();
  }
  function handleCompositionEnd(e: CompositionEvent): void {
    isComposing = false;
    if (e.data.length > 0) options.onCompositionEnd?.(e.data);
  }
  function handleCopy(e: ClipboardEvent): void { options.onCopy?.(e); }
  function handleCut(e: ClipboardEvent): void { options.onCut?.(e); }
  function handlePaste(e: ClipboardEvent): void { options.onPaste?.(e); }
  function handleFocus(e: FocusEvent): void { options.onFocus?.(e); }
  function handleBlur(e: FocusEvent): void {
    isComposing = false;
    options.onBlur?.(e);
  }

  element.addEventListener("keydown", handleKeyDown);
  element.addEventListener("beforeinput", handleBeforeInput);
  element.addEventListener("compositionstart", handleCompositionStart);
  element.addEventListener("compositionend", handleCompositionEnd);
  element.addEventListener("copy", handleCopy);
  element.addEventListener("cut", handleCut);
  element.addEventListener("paste", handlePaste);
  element.addEventListener("focus", handleFocus);
  element.addEventListener("blur", handleBlur);

  function focus(): void {
    element.focus();
  }

  function destroy(): void {
    doc.removeEventListener("selectionchange", handleSelectionChange);
    element.removeEventListener("keydown", handleKeyDown);
    element.removeEventListener("beforeinput", handleBeforeInput);
    element.removeEventListener("compositionstart", handleCompositionStart);
    element.removeEventListener("compositionend", handleCompositionEnd);
    element.removeEventListener("copy", handleCopy);
    element.removeEventListener("cut", handleCut);
    element.removeEventListener("paste", handlePaste);
    element.removeEventListener("focus", handleFocus);
    element.removeEventListener("blur", handleBlur);
    priorTree = null;
    priorMap = null;
    element.remove();
  }

  return { element, syncTree, syncSelection, focus, destroy };
}

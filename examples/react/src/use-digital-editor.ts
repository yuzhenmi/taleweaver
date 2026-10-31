/**
 * Example-local hook that mounts the `@taleweaver/digital` interactive editing
 * controller (contenteditable, browser-flowed DOM — NO print geometry) into a
 * ref'd container over an editor the hook owns, and re-renders React after every
 * dispatch so the toolbar/menu can bind to it. Counterpart to `usePerfEditor` (the print/canvas backend); the
 * tab-bar swaps between the two, handing the live `Document` off on switch.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  createDefaultComponentRegistry,
  createEditor,
  type EditorAction,
  type EditorConfig,
  type EditorExtensions,
  type Editor,
  type PageConfig,
  type Document,
} from "@taleweaver/core";
import {
  browserHtmlParser,
  createDigitalController,
  type DigitalController,
  type DecorationPointerEvent,
} from "@taleweaver/digital";
import type { Anchor, Decoration, FindStatus, Position, Proposal, ProposeResult, SuggestionGroupStyle } from "@taleweaver/core";
import type { FindHandle } from "./components/find-bar";
import { createDemoAttrRegistry } from "./components/mentions";

const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 816,
  pageBlockSize: 1056,
  pageMargins: { blockStart: 96, blockEnd: 96, inlineStart: 72, inlineEnd: 72 },
  pageGap: 24,
};

export interface UseDigitalEditorResult {
  editor: Editor;
  dispatch: React.Dispatch<EditorAction>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  focus: () => void;
  /** The live core `Document` — read at a tab-bar switch to hand off the document. */
  getDocument: () => Document;
  /** Replace the host decoration layer (view-only; mapped through edits). */
  setDecorations: (decorations: readonly Decoration[], basedOn?: Document) => void;
  /** Find / replace, same surface as the print `EditorViewHandle` (drives the shared find bar). */
  findHandle: FindHandle;
  /** Anchor a range that follows every later edit (the async-check demo). */
  createAnchor: (from: Position, to: Position) => Anchor | null;
  /** Offer a proposal as one suggestion group (the suggest-edit demo). */
  propose: (proposal: Proposal, options?: { readonly basedOn?: Document }) => Promise<ProposeResult>;
  /** Live per-group suggestion styling (the suggest-edit demo). */
  setSuggestionStyles: (styleOf: SuggestionGroupStyle | null) => void;
}

export function useDigitalEditor(
  initialDocument?: Document,
  onDecorationPointer?: (event: DecorationPointerEvent) => void,
  extensions?: EditorExtensions,
): UseDigitalEditorResult {
  // Registries + config built once (stable across renders).
  const configRef = useRef<EditorConfig | null>(null);
  if (configRef.current === null) {
    configRef.current = {
      componentRegistry: createDefaultComponentRegistry(),
      attrRegistry: createDemoAttrRegistry(), // built-ins + the demo `mention` mark
      ...(extensions !== undefined ? { extensions } : {}),
      containerWidth: 816,
      pageConfig: PAGE_CONFIG,
      htmlParser: browserHtmlParser, // rich paste decodes text/html
    };
  }
  const config = configRef.current;

  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<DigitalController | null>(null);

  // The ONE editor, built at once (so the toolbar has it before the mount effect runs).
  // `initialDocument` is a mount-time seed only (the tab-bar remounts on switch via a
  // `key`, so a fresh hook instance picks up the new seed).
  const [editor] = useState<Editor>(() =>
    initialDocument !== undefined
      ? createEditor(config, { document: initialDocument })
      : createEditor(config),
  );
  // It changes in place: re-render after every dispatch (the controller subscribes too).
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => editor.subscribe(rerender), [editor]);
  // Latest pointer callback, read through a ref so the mount effect stays one-shot.
  const pointerRef = useRef(onDecorationPointer);
  pointerRef.current = onDecorationPointer;

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const controller = createDigitalController({
      container: el,
      editor,
      onDecorationPointer: (event) => pointerRef.current?.(event),
    });
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [editor]);

  const dispatch = useCallback<React.Dispatch<EditorAction>>((action) => {
    controllerRef.current?.dispatch(action);
  }, []);
  const focus = useCallback(() => {
    controllerRef.current?.focus();
  }, []);
  // Stable getter (the editor never changes identity): the tab-bar hand-off reads the
  // live document.
  const getDocument = useCallback(() => editor.document, [editor]);

  const setDecorations = useCallback((decorations: readonly Decoration[], basedOn?: Document) => {
    controllerRef.current?.setDecorations(decorations, basedOn);
  }, []);

  const findHandle = useMemo<FindHandle>(() => {
    const none: FindStatus = { total: 0, activeIndex: -1 };
    return {
      findStart: (query, options) => controllerRef.current?.findStart(query, options) ?? none,
      findNext: () => controllerRef.current?.findNext() ?? none,
      findPrev: () => controllerRef.current?.findPrev() ?? none,
      findClose: () => controllerRef.current?.findClose(),
      findStatus: () => controllerRef.current?.findStatus() ?? none,
      replaceActive: (r) => controllerRef.current?.replaceActive(r) ?? none,
      replaceAll: (r) => controllerRef.current?.replaceAll(r) ?? none,
    };
  }, []);

  const createAnchor = useCallback(
    (from: Position, to: Position) => controllerRef.current?.createAnchor(from, to) ?? null,
    [],
  );

  const propose = useCallback(
    (proposal: Proposal, options?: { readonly basedOn?: Document }): Promise<ProposeResult> =>
      controllerRef.current?.propose(proposal, options) ??
      Promise.resolve({ ok: false, reason: "rejected", problem: { kind: "invalid", message: "not mounted" } }),
    [],
  );

  const setSuggestionStyles = useCallback((styleOf: SuggestionGroupStyle | null) => {
    controllerRef.current?.setSuggestionStyles(styleOf);
  }, []);

  return { editor, dispatch, containerRef, focus, getDocument, setDecorations, findHandle, createAnchor, propose, setSuggestionStyles };
}

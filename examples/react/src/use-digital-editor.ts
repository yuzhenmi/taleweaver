/**
 * Example-local hook that mounts the `@taleweaver/digital` interactive editing
 * controller (contenteditable, browser-flowed DOM — NO print geometry) into a
 * ref'd container and mirrors its `editorState` into React so the toolbar/menu
 * can bind to it. Counterpart to `usePerfEditor` (the print/canvas backend); the
 * tab-bar swaps between the two, handing the live `Document` off on switch.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDefaultComponentRegistry,
  createEditorStateFromDocument,
  createInitialEditorState,
  initialSelectionForDocument,
  type EditorAction,
  type EditorConfig,
  type EditorExtensions,
  type EditorState,
  type PageConfig,
  type Document,
} from "@taleweaver/core";
import {
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
  editorState: EditorState;
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
    };
  }
  const config = configRef.current;

  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<DigitalController | null>(null);

  // Seed React state synchronously (so the toolbar has a non-null state before the
  // mount effect runs); the controller pushes subsequent transitions via onChange.
  const [editorState, setEditorState] = useState<EditorState>(() =>
    initialDocument !== undefined
      ? createEditorStateFromDocument(initialDocument, initialSelectionForDocument(initialDocument), config)
      : createInitialEditorState(config),
  );

  // `initialDocument` is a mount-time seed only (the tab-bar remounts on switch via a
  // `key`, so a fresh hook instance picks up the new seed). Holding it in a ref keeps
  // the mount effect's dependency array empty without lying to the linter.
  const seedRef = useRef(initialDocument);
  // Latest pointer callback, read through a ref so the mount effect stays one-shot.
  const pointerRef = useRef(onDecorationPointer);
  pointerRef.current = onDecorationPointer;

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const controller = createDigitalController({
      container: el,
      componentRegistry: config.componentRegistry,
      attrRegistry: config.attrRegistry,
      pageConfig: PAGE_CONFIG,
      initialDocument: seedRef.current,
      onChange: setEditorState,
      onDecorationPointer: (event) => pointerRef.current?.(event),
      ...(config.extensions !== undefined ? { extensions: config.extensions } : {}),
    });
    controllerRef.current = controller;
    // No initial setEditorState here: the `useState` initializer already seeded the
    // same content (both call createEditorStateFromDocument/createInitialEditorState the
    // same way), so a second set would only force a redundant render. Future
    // transitions arrive via the controller's `onChange` → setEditorState.
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [config]);

  const dispatch = useCallback<React.Dispatch<EditorAction>>((action) => {
    controllerRef.current?.dispatch(action);
  }, []);
  const focus = useCallback(() => {
    controllerRef.current?.focus();
  }, []);
  // Stable getter: the live arm reads the always-current controller `editorState`,
  // so this never needs to depend on React `editorState` — keeping it stable avoids
  // re-registering the tab-bar hand-off getter on every keystroke. The `editorState`
  // fallback (first-render seed) is only reached before the controller mounts.
  const initialStateRef = useRef(editorState);
  const getDocument = useCallback(
    () => controllerRef.current?.editorState.document ?? initialStateRef.current.document,
    [],
  );

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

  return { editorState, dispatch, containerRef, focus, getDocument, setDecorations, findHandle, createAnchor, propose, setSuggestionStyles };
}

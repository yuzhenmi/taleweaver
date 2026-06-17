/**
 * Example-local hook that mounts the `@taleweaver/digital` interactive editing
 * controller (contenteditable, browser-flowed DOM — NO print geometry) into a
 * ref'd container and mirrors its `editorState` into React so the toolbar/menu
 * can bind to it. Counterpart to `usePerfEditor` (the print/canvas backend); the
 * tab-bar swaps between the two, handing the live `State` off on switch.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createEditorStateFromState,
  createInitialEditorState,
  initialSelectionForState,
  type EditorAction,
  type EditorConfig,
  type EditorState,
  type PageConfig,
  type State,
} from "@taleweaver/core";
import { createDigitalController, type DigitalController } from "@taleweaver/digital";

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
  /** The live core `State` — read at a tab-bar switch to hand off the document. */
  getState: () => State;
}

export function useDigitalEditor(initialState?: State): UseDigitalEditorResult {
  // Registries + config built once (stable across renders).
  const configRef = useRef<EditorConfig | null>(null);
  if (configRef.current === null) {
    configRef.current = {
      componentRegistry: createDefaultComponentRegistry(),
      attrRegistry: createDefaultAttrRegistry(),
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
    initialState !== undefined
      ? createEditorStateFromState(initialState, initialSelectionForState(initialState), config)
      : createInitialEditorState(config),
  );

  // `initialState` is a mount-time seed only (the tab-bar remounts on switch via a
  // `key`, so a fresh hook instance picks up the new seed). Holding it in a ref keeps
  // the mount effect's dependency array empty without lying to the linter.
  const seedRef = useRef(initialState);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const controller = createDigitalController({
      container: el,
      componentRegistry: config.componentRegistry,
      attrRegistry: config.attrRegistry,
      pageConfig: PAGE_CONFIG,
      initialState: seedRef.current,
      onChange: setEditorState,
    });
    controllerRef.current = controller;
    // No initial setEditorState here: the `useState` initializer already seeded the
    // same content (both call createEditorStateFromState/createInitialEditorState the
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
  const getState = useCallback(
    () => controllerRef.current?.editorState.state ?? initialStateRef.current.state,
    [],
  );

  return { editorState, dispatch, containerRef, focus, getState };
}

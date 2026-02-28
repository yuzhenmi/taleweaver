import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  createCursor,
  createSelection,
  createPosition,
  isCollapsed,
  extractText,
  selectWord,
  getNodeByPath,
  getTextContentLength,
  type Position,
} from "@taleweaver/core";
import {
  mapKeyEvent,
  resolvePixelPosition,
  resolvePositionFromPixel,
  computeSelectionRects,
  FONT_CONFIG,
  findFirstTextDescendant,
  findLastTextDescendant,
  type EditorAction,
  type EditorState,
} from "@taleweaver/dom";
import type { TextMeasurer } from "@taleweaver/core";
import { renderLayoutTree } from "./layout-renderer";
import { CursorView } from "./cursor-view";
import { SelectionView } from "./selection-view";

export interface EditorViewProps {
  editorState: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  measurer: TextMeasurer;
}

export function EditorView({ editorState, dispatch, containerRef, measurer }: EditorViewProps) {

  // Drag state (transient UI, not in reducer)
  const isDragging = useRef(false);
  const dragAnchor = useRef<Position | null>(null);

  // Refs for values accessed in mousemove effect (avoids stale closures and listener churn)
  const stateRef = useRef(editorState.state);
  const layoutRef = useRef(editorState.layoutTree);
  stateRef.current = editorState.state;
  layoutRef.current = editorState.layoutTree;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const action = mapKeyEvent(e.nativeEvent);
      if (action) {
        e.preventDefault();
        dispatch(action);
      }
    },
    [dispatch],
  );

  const cursorPos = useMemo(() => {
    return resolvePixelPosition(
      editorState.state,
      editorState.selection.focus,
      editorState.layoutTree,
      measurer,
    );
  }, [editorState.state, editorState.selection, editorState.layoutTree, measurer]);

  const selectionRects = useMemo(() => {
    if (isCollapsed(editorState.selection)) return [];
    return computeSelectionRects(
      editorState.state,
      editorState.selection,
      editorState.layoutTree,
      measurer,
      editorState.containerWidth,
    );
  }, [editorState.state, editorState.selection, editorState.layoutTree, editorState.containerWidth, measurer]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const pos = resolvePositionFromPixel(
        editorState.state,
        editorState.layoutTree,
        measurer,
        x,
        y,
      );
      if (!pos) return;

      // Triple-click: select paragraph
      if (e.detail >= 3) {
        const blockPath = pos.path.slice(0, 1);
        const block = getNodeByPath(editorState.state, blockPath);
        if (block) {
          const first = findFirstTextDescendant(block, blockPath);
          const last = findLastTextDescendant(block, blockPath);
          if (first && last) {
            const lastNode = getNodeByPath(editorState.state, last.path);
            const endOffset = lastNode ? getTextContentLength(lastNode) : 0;
            dispatch({
              type: "SET_SELECTION",
              selection: createSelection(
                createPosition(first.path, 0),
                createPosition(last.path, endOffset),
              ),
            });
          }
        }
        return;
      }

      // Double-click: select word
      if (e.detail === 2) {
        const wordSel = selectWord(editorState.state, pos);
        dispatch({ type: "SET_SELECTION", selection: wordSel });
        return;
      }

      // Shift-click: extend selection from current anchor
      if (e.shiftKey) {
        dispatch({
          type: "SET_SELECTION",
          selection: createSelection(
            editorState.selection.anchor,
            createPosition(pos.path, pos.offset),
          ),
        });
        return;
      }

      // Single click: position cursor + start drag
      isDragging.current = true;
      dragAnchor.current = pos;
      dispatch({
        type: "SET_SELECTION",
        selection: createCursor(pos.path, pos.offset),
      });
    },
    [editorState.state, editorState.layoutTree, editorState.selection, dispatch, measurer],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !dragAnchor.current) return;
      const el = containerRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const pos = resolvePositionFromPixel(
        stateRef.current,
        layoutRef.current,
        measurer,
        x,
        y,
      );
      if (pos) {
        dispatch({
          type: "SET_SELECTION",
          selection: createSelection(
            dragAnchor.current,
            createPosition(pos.path, pos.offset),
          ),
        });
      }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [measurer, dispatch]);

  const handleCopy = useCallback(
    (e: React.ClipboardEvent) => {
      if (isCollapsed(editorState.selection)) return;
      e.preventDefault();
      const text = extractText(editorState.state, editorState.selection);
      e.clipboardData.setData("text/plain", text);
    },
    [editorState.state, editorState.selection],
  );

  const handleCut = useCallback(
    (e: React.ClipboardEvent) => {
      if (isCollapsed(editorState.selection)) return;
      e.preventDefault();
      const text = extractText(editorState.state, editorState.selection);
      e.clipboardData.setData("text/plain", text);
      dispatch({ type: "DELETE_BACKWARD" });
    },
    [editorState.state, editorState.selection, dispatch],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      if (text) {
        dispatch({ type: "PASTE", text });
      }
    },
    [dispatch],
  );

  const cursorKey = `${cursorPos.x}-${cursorPos.y}`;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onCopy={handleCopy}
      onCut={handleCut}
      onPaste={handlePaste}
      autoFocus
      style={{
        position: "relative",
        outline: "none",
        fontFamily: FONT_CONFIG.fontFamily,
        fontSize: FONT_CONFIG.fontSize,
        lineHeight: `${FONT_CONFIG.lineHeight}px`,
        cursor: "text",
        userSelect: "none",
        minHeight: "100%",
      }}
    >
      <SelectionView rects={selectionRects} />
      {renderLayoutTree(editorState.layoutTree)}
      <CursorView
        key={cursorKey}
        x={cursorPos.x}
        y={cursorPos.y}
        height={cursorPos.height}
      />
    </div>
  );
}

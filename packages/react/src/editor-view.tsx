import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  paintCanvas,
  type EditorAction,
  type EditorState,
  type CursorState,
} from "@taleweaver/dom";
import type { TextMeasurer } from "@taleweaver/core";

export interface EditorViewProps {
  editorState: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  measurer: TextMeasurer;
}

export function EditorView({ editorState, dispatch, containerRef, textareaRef, measurer }: EditorViewProps) {

  // Drag state (transient UI, not in reducer)
  const isDragging = useRef(false);
  const dragAnchor = useRef<Position | null>(null);
  const isComposingRef = useRef(false);

  // Refs for values accessed in effects/callbacks (avoids stale closures and listener churn)
  const stateRef = useRef(editorState.state);
  const layoutRef = useRef(editorState.layoutTree);
  const selectionRef = useRef(editorState.selection);
  stateRef.current = editorState.state;
  layoutRef.current = editorState.layoutTree;
  selectionRef.current = editorState.selection;

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const cursorVisibleRef = useRef(true);
  const focusedRef = useRef(true);
  const [focused, setFocused] = useState(true);
  const scrollParentRef = useRef<HTMLElement | Window>(window);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isComposingRef.current || e.nativeEvent.isComposing) return;
      const action = mapKeyEvent(e.nativeEvent);
      if (action) {
        e.preventDefault();
        dispatch(action);
      }
    },
    [dispatch],
  );

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      if (isComposingRef.current) return;
      const textarea = e.currentTarget;
      const text = textarea.value;
      if (text) {
        dispatch({ type: "INSERT_TEXT", text });
      }
      textarea.value = "";
    },
    [dispatch],
  );

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent) => {
      isComposingRef.current = false;
      const text = e.data;
      if (text) {
        dispatch({ type: "INSERT_TEXT", text });
      }
      if (textareaRef.current) textareaRef.current.value = "";
    },
    [dispatch, textareaRef],
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

  // Stable refs for paint callback
  const selectionRectsRef = useRef(selectionRects);
  const cursorPosRef = useRef(cursorPos);
  selectionRectsRef.current = selectionRects;
  cursorPosRef.current = cursorPos;

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!ctxRef.current) ctxRef.current = canvas.getContext("2d");
    const ctx = ctxRef.current;
    if (!ctx) return;

    const tree = layoutRef.current;
    const logicalWidth = tree.width;
    const logicalHeight = tree.height;

    const dpr = typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1;
    const physicalWidth = logicalWidth * dpr;
    const physicalHeight = logicalHeight * dpr;
    if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
      canvas.width = physicalWidth;
      canvas.height = physicalHeight;
      canvas.style.width = `${logicalWidth}px`;
      canvas.style.height = `${logicalHeight}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Compute visible range using scroll parent
    const sp = scrollParentRef.current;
    let visibleTop: number;
    let viewportHeight: number;
    if (sp instanceof Window) {
      const rect = canvas.getBoundingClientRect();
      visibleTop = Math.max(0, -rect.top);
      viewportHeight = sp.innerHeight;
    } else {
      visibleTop = sp.scrollTop;
      viewportHeight = sp.clientHeight;
    }
    const visibleBottom = visibleTop + viewportHeight;

    let cursorState: CursorState;
    if (!focusedRef.current) {
      cursorState = "inactive";
    } else if (cursorVisibleRef.current) {
      cursorState = "active";
    } else {
      cursorState = "hidden";
    }

    paintCanvas(
      ctx,
      tree,
      selectionRectsRef.current,
      cursorPosRef.current,
      cursorState,
      logicalWidth,
      logicalHeight,
      visibleTop,
      visibleBottom,
    );
  }, []);

  // Repaint on state change
  useEffect(() => {
    paint();
  }, [editorState, paint]);

  // Focus tracking — controls cursor active/inactive state
  const handleFocus = useCallback(() => {
    focusedRef.current = true;
    setFocused(true);
    cursorVisibleRef.current = true;
    paint();
  }, [paint]);

  const handleBlur = useCallback(() => {
    focusedRef.current = false;
    setFocused(false);
    paint();
  }, [paint]);

  // Cursor blink interval — only blinks when focused
  const cursorKey = `${cursorPos.x},${cursorPos.y},${cursorPos.height}`;
  useEffect(() => {
    cursorVisibleRef.current = true;
    paint();

    if (!focused) return;

    const id = setInterval(() => {
      cursorVisibleRef.current = !cursorVisibleRef.current;
      paint();
    }, 500);

    return () => clearInterval(id);
  }, [cursorKey, focused, paint]);

  // Scroll repaint: find nearest scrollable ancestor and listen for scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scrollParent: HTMLElement | Window = window;
    let el: HTMLElement | null = container.parentElement;
    while (el) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === "auto" || overflow === "scroll") {
        scrollParent = el;
        break;
      }
      el = el.parentElement;
    }
    scrollParentRef.current = scrollParent;

    let rafId = 0;
    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => paint());
    };
    scrollParent.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      cancelAnimationFrame(rafId);
      scrollParent.removeEventListener("scroll", handleScroll);
    };
  }, [containerRef, paint]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Prevent browser from moving focus away from textarea
      e.preventDefault();
      textareaRef.current?.focus();

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
      if (!pos) {
        // Empty document or no text boxes — place cursor at document end
        dispatch({ type: "MOVE_DOCUMENT_BOUNDARY", boundary: "end" });
        return;
      }

      // Triple-click: select paragraph
      if (e.detail >= 3) {
        const blockPath = pos.path.slice(0, 1);
        const block = getNodeByPath(stateRef.current, blockPath);
        if (block) {
          const first = findFirstTextDescendant(block, blockPath);
          const last = findLastTextDescendant(block, blockPath);
          if (first && last) {
            const lastNode = getNodeByPath(stateRef.current, last.path);
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
        const wordSel = selectWord(stateRef.current, pos);
        dispatch({ type: "SET_SELECTION", selection: wordSel });
        return;
      }

      // Shift-click: extend selection from current anchor
      if (e.shiftKey) {
        dispatch({
          type: "SET_SELECTION",
          selection: createSelection(
            selectionRef.current.anchor,
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
    [dispatch, measurer, textareaRef, containerRef],
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
      if (isCollapsed(selectionRef.current)) return;
      e.preventDefault();
      const text = extractText(stateRef.current, selectionRef.current);
      e.clipboardData.setData("text/plain", text);
    },
    [],
  );

  const handleCut = useCallback(
    (e: React.ClipboardEvent) => {
      if (isCollapsed(selectionRef.current)) return;
      e.preventDefault();
      const text = extractText(stateRef.current, selectionRef.current);
      e.clipboardData.setData("text/plain", text);
      dispatch({ type: "DELETE_BACKWARD" });
    },
    [dispatch],
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

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
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
      {/* Spacer to establish scroll height from layout tree */}
      <div style={{ height: editorState.layoutTree.height, pointerEvents: "none" }} />
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", left: 0, top: 0 }}
      />
      <textarea
        ref={textareaRef}
        autoFocus
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        style={{
          position: "absolute",
          left: cursorPos.x,
          top: cursorPos.y,
          width: 1,
          height: cursorPos.height,
          opacity: 0,
          border: "none",
          padding: 0,
          margin: 0,
          outline: "none",
          resize: "none",
          overflow: "hidden",
          caretColor: "transparent",
          fontSize: FONT_CONFIG.fontSize,
          fontFamily: FONT_CONFIG.fontFamily,
        }}
        tabIndex={0}
      />
    </div>
  );
}

import { useEffect } from "react";

const BLINK_KEYFRAMES = `@keyframes taleweaver-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}`;
const STYLE_ID = "taleweaver-blink-keyframes";

function injectKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = BLINK_KEYFRAMES;
  document.head.appendChild(style);
}

interface CursorViewProps {
  x: number;
  y: number;
  height: number;
}

/** Blinking cursor caret. Remount via key change to reset blink animation. */
export function CursorView({ x, y, height }: CursorViewProps) {
  useEffect(() => {
    injectKeyframes();
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 2,
        height,
        backgroundColor: "black",
        animation: "taleweaver-blink 1s step-end infinite",
      }}
    />
  );
}
